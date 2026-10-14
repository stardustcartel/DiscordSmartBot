import { cookie, cookies, publicUrl, unseal } from '../../_lib/auth.js';
import { authorizedGuild } from '../../_lib/authorize.js';
import { encryptGuildKey } from '../../_lib/gemini-secret.js';
import { schema, exchange, apiToken, connection, addWebhook, auditConnection } from '../../_lib/patreon.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url), base = publicUrl(env, request);
  let guildId = '', outcome = 'failed';
  try {
    const signed = url.searchParams.get('state');
    const state = await unseal(signed, env.DASHBOARD_SESSION_SECRET);
    if (!state || state.expiresAt < Date.now() || signed !== cookies(request).patreon_oauth_state) throw Error('Invalid OAuth state');
    const access = await authorizedGuild(env, request, state.guildId);
    if (!access || access.user.id !== state.userId) throw Error('Discord access changed');
    guildId = state.guildId;
    await schema(env.DB);
    const used = await env.DB.prepare('DELETE FROM patreon_oauth WHERE nonce=? AND guild_id=? AND user_id=? AND expires_at>? RETURNING nonce').bind(state.nonce, guildId, state.userId, Date.now()).first();
    if (!used) throw Error('Expired OAuth request');
    if (url.searchParams.has('error')) outcome = 'cancelled';
    else {
      const token = await exchange(env, { grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: `${base}/auth/patreon/callback` });
      const campaigns = await apiToken(token.access_token, '/campaigns?fields[campaign]=creation_name,name');
      if (campaigns?.data?.length !== 1) { outcome = campaigns?.data?.length ? 'multiple-campaigns' : 'no-campaign'; }
      else {
        const campaign = campaigns.data[0];
        const previous = await connection(env, guildId);
        if (previous && previous.campaign_id !== String(campaign.id)) { outcome = 'already-connected'; }
        else if (previous) {
          await env.DB.prepare('UPDATE patreon_connections SET token_json=?,expires_at=?,refresh_until=0,revision=revision+1,connected_by=?,connected_at=? WHERE guild_id=? AND generation=?').bind(JSON.stringify(await encryptGuildKey(JSON.stringify(token), env.GUILD_SECRETS_KEY)), Date.now() + Number(token.expires_in || 3600) * 1000, access.user.id, Date.now(), guildId, previous.generation).run();
          const row = await connection(env, guildId);
          if (!row.webhook_id) await addWebhook(env, row, base).catch(() => {});
          outcome = 'connected';
        }
        else {
          const generation = crypto.randomUUID(), hookKey = crypto.randomUUID() + crypto.randomUUID();
          await env.DB.prepare('INSERT INTO patreon_connections (guild_id,generation,campaign_id,name,token_json,expires_at,hook_key,connected_by,connected_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(guildId, generation, String(campaign.id), String(campaign.attributes?.name || campaign.attributes?.creation_name || 'Patreon creator'), JSON.stringify(await encryptGuildKey(JSON.stringify(token), env.GUILD_SECRETS_KEY)), Date.now() + Number(token.expires_in || 3600) * 1000, hookKey, access.user.id, Date.now()).run();
          const row = await connection(env, guildId);
          await addWebhook(env, row, base).catch(() => {});
          outcome = 'connected';
        }
      }
    }
    if (outcome === 'connected') await auditConnection(env, guildId, access.user.id, 'patreon_connected', await connection(env, guildId));
  } catch { /* Never include tokens, codes, or provider response bodies in logs. */ }
  return new Response(null, { status: 302, headers: { Location: `${base}/dashboard?patreon=${encodeURIComponent(outcome)}&guild=${encodeURIComponent(guildId)}`, 'Set-Cookie': cookie('patreon_oauth_state', '', 0), 'Cache-Control': 'no-store' } });
}
