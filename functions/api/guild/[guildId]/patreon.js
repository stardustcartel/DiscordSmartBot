import { json, cookie, publicUrl, seal } from '../../../_lib/auth.js';
import { authorizedGuild } from '../../../_lib/authorize.js';
import { getState, mutateState } from '../../../_lib/db.js';
import { connection, configured, scopes, api, auditConnection } from '../../../_lib/patreon.js';

const headers = { 'Cache-Control': 'no-store' };
export async function onRequestGet({ env, request, params }) {
  if (!await authorizedGuild(env, request, params.guildId)) return json({ error: 'You do not have access to this server.' }, 403);
  const row = await connection(env, params.guildId), state = await getState(env.DB, params.guildId);
  const status = row && await env.DB.prepare('SELECT * FROM patreon_status WHERE guild_id=? AND generation=?').bind(params.guildId, row.generation).first();
  return json({ configured: configured(env), connected: Boolean(row), name: row?.name, connectedAt: row?.connected_at, webhook: Boolean(row?.webhook_id), channelIds: state?.settings?.patreonChannelIds || [], status: status ? JSON.parse(status.status_json) : null, reportedAt: status?.reported_at || 0 }, 200, headers);
}
export async function onRequestPost({ env, request, params }) {
  const access = await authorizedGuild(env, request, params.guildId);
  if (!access) return json({ error: 'You do not have access to this server.' }, 403);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);
  const row = await connection(env, params.guildId);
  if (body.action === 'connect') {
    if (!configured(env)) return json({ error: 'Patreon connection setup is pending. The service owner needs to configure the Patreon application.' }, 503);
    const nonce = crypto.randomUUID();
    await env.DB.prepare('DELETE FROM patreon_oauth WHERE expires_at<?').bind(Date.now()).run();
    await env.DB.prepare('INSERT INTO patreon_oauth VALUES (?,?,?,?)').bind(nonce, params.guildId, access.user.id, Date.now() + 600000).run();
    const state = await seal({ nonce, guildId: params.guildId, userId: access.user.id, expiresAt: Date.now() + 600000 }, env.DASHBOARD_SESSION_SECRET);
    const url = new URL('https://www.patreon.com/oauth2/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: env.PATREON_CLIENT_ID, redirect_uri: `${publicUrl(env, request)}/auth/patreon/callback`, scope: scopes, state });
    return json({ url: url.href }, 200, { ...headers, 'Set-Cookie': cookie('patreon_oauth_state', state, 600) });
  }
  if (!row) return json({ error: 'Connect Patreon first.' }, 400);
  if (body.action === 'sync') {
    await env.DB.prepare('UPDATE patreon_connections SET revision=revision+1 WHERE guild_id=?').bind(params.guildId).run();
    return json({ ok: true }, 200, headers);
  }
  if (body.action === 'visibility') {
    if (!Array.isArray(body.channelIds) || body.channelIds.length > 100 || body.channelIds.some(id => typeof id !== 'string' || !/^\d{15,25}$/.test(id))) return json({ error: 'Choose valid channels.' }, 400);
    const response = await fetch(`https://discord.com/api/v10/guilds/${params.guildId}/channels`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    if (!response.ok) return json({ error: 'Could not verify channels.' }, 502);
    const channels = await response.json();
    if (body.channelIds.some(id => !channels.some(c => c.id === id && [0,5,15].includes(c.type)))) return json({ error: 'Choose channels from this server.' }, 400);
    await mutateState(env.DB, params.guildId, state => ({ ...state, settings: { ...state.settings, patreonChannelIds: [...new Set(body.channelIds)] } }), access.user.id);
    return json({ ok: true }, 200, headers);
  }
  if (body.action === 'disconnect') {
    // Delete credentials first. Local knowledge becomes inaccessible immediately;
    // the next bot sync removes its stored post data.
    await env.DB.batch([env.DB.prepare('DELETE FROM patreon_connections WHERE guild_id=?').bind(params.guildId), env.DB.prepare('DELETE FROM patreon_status WHERE guild_id=?').bind(params.guildId), env.DB.prepare('DELETE FROM patreon_events WHERE guild_id=?').bind(params.guildId)]);
    await auditConnection(env, params.guildId, access.user.id, 'patreon_disconnected', null);
    if (row.webhook_id) await api(env, { ...row, expires_at: Number.MAX_SAFE_INTEGER }, `/webhooks/${encodeURIComponent(row.webhook_id)}`, { method: 'DELETE' }).catch(() => {});
    return json({ ok: true }, 200, headers);
  }
  return json({ error: 'Unknown Patreon action.' }, 400);
}
