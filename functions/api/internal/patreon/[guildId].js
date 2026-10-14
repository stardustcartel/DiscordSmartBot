import { json } from '../../../_lib/auth.js';
import { getState } from '../../../_lib/db.js';
import { connection, api, accessToken, apiToken, postFields, postPath, cleanPost } from '../../../_lib/patreon.js';

export async function onRequestPost({ env, request, params }) {
  if (!env.BOT_SYNC_SECRET || request.headers.get('Authorization') !== `Bearer ${env.BOT_SYNC_SECRET}`) return json({ error: 'Unauthorized' }, 401);
  const row = await connection(env, params.guildId);
  if (!row) return json({ connected: false });
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, 400);
  const state = await getState(env.DB, params.guildId);
  const meta = { connected: true, generation: row.generation, campaignId: row.campaign_id, name: row.name, revision: row.revision, webhook: Boolean(row.webhook_id), channelIds: state?.settings?.patreonChannelIds || [] };
  if (body.generation && body.generation !== row.generation) return json({ ...meta, changed: true }, 409);
  try {
    if (body.action === 'meta') {
      const events = await env.DB.prepare('SELECT id,post_id,kind FROM patreon_events WHERE guild_id=? AND generation=? AND id>? ORDER BY id LIMIT 100').bind(params.guildId, row.generation, Math.max(0, Number(body.after) || 0)).all();
      return json({ ...meta, events: events.results || [] });
    }
    if (body.action === 'status') {
      if (!body.status || JSON.stringify(body.status).length > 10000) return json({ error: 'Invalid status' }, 400);
      await env.DB.prepare('INSERT INTO patreon_status VALUES (?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET generation=excluded.generation,status_json=excluded.status_json,reported_at=excluded.reported_at').bind(params.guildId, row.generation, JSON.stringify(body.status), Date.now()).run();
      if (Number.isSafeInteger(body.eventId) && body.eventId > 0) await env.DB.prepare('DELETE FROM patreon_events WHERE guild_id=? AND generation=? AND id<=?').bind(params.guildId, row.generation, body.eventId).run();
      return json({ ok: true });
    }
    if (body.action === 'page') {
      const query = new URLSearchParams({ include: 'campaign', 'fields[post]': postFields, 'page[count]': '25' });
      if (body.cursor) { if (typeof body.cursor !== 'string' || body.cursor.length > 2000) return json({ error: 'Invalid cursor' }, 400); query.set('page[cursor]', body.cursor); }
      const result = await api(env, row, `/campaigns/${encodeURIComponent(row.campaign_id)}/posts?${query}`);
      if (!Array.isArray(result?.data)) throw Error('Patreon returned an incomplete post list.');
      if (result.data.some(post => post?.type !== 'post' || String(post.relationships?.campaign?.data?.id || '') !== row.campaign_id)) throw Error('Patreon returned posts without a verifiable campaign. No archived posts were removed.');
      let cursor = result.meta?.pagination?.cursors?.next || null;
      if (result.links?.next) { const next = new URL(result.links.next); cursor = next.searchParams.get('page[cursor]'); if (!cursor) throw Error('Patreon pagination could not be continued.'); }
      return json({ ...meta, posts: result.data.map(post => cleanPost(post, row.campaign_id)).filter(Boolean), cursor });
    }
    if (body.action === 'posts') {
      if (!Array.isArray(body.ids) || body.ids.length > 8 || body.ids.some(id => !/^\d+$/.test(String(id)))) return json({ error: 'Invalid post IDs' }, 400);
      const token = await accessToken(env, row);
      const posts = await Promise.all(body.ids.map(async id => { const result = await apiToken(token, postPath(id)); return { id: String(id), post: cleanPost(result?.data, row.campaign_id) }; }));
      return json({ ...meta, posts });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    if (error.status === 401) await env.DB.prepare('UPDATE patreon_connections SET expires_at=0 WHERE guild_id=? AND generation=?').bind(row.guild_id, row.generation).run();
    return json({ error: error.message }, [401,403,429].includes(error.status) ? error.status : 502);
  }
}
