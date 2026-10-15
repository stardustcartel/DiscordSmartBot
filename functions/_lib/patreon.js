import { encryptGuildKey, decryptGuildKey } from './gemini-secret.js';
import { getState, createStateIfMissing } from './db.js';
import { settingsAuditSnapshot, auditPermissions, prepareAuditInsert } from './settings-audit.js';

export const scopes = 'identity campaigns campaigns.posts w:campaigns.webhook';
export const configured = env => Boolean(env.PATREON_CLIENT_ID && env.PATREON_CLIENT_SECRET && env.GUILD_SECRETS_KEY);
export async function schema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS patreon_connections (guild_id TEXT PRIMARY KEY, generation TEXT NOT NULL, campaign_id TEXT NOT NULL, name TEXT NOT NULL, token_json TEXT NOT NULL, expires_at INTEGER NOT NULL, refresh_until INTEGER NOT NULL DEFAULT 0, webhook_id TEXT, webhook_secret TEXT, hook_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, connected_by TEXT NOT NULL, connected_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patreon_oauth (nonce TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patreon_events (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, generation TEXT NOT NULL, post_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS patreon_events_scope ON patreon_events(guild_id,generation,id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patreon_status (guild_id TEXT PRIMARY KEY, generation TEXT NOT NULL, status_json TEXT NOT NULL, reported_at INTEGER NOT NULL)`),
  ]);
}
export async function connection(env, guildId) {
  await schema(env.DB);
  return env.DB.prepare('SELECT * FROM patreon_connections WHERE guild_id=?').bind(guildId).first();
}
export function failure(status) {
  return Object.assign(new Error(status === 401 || status === 403 ? 'Patreon authorization needs attention. Reconnect Patreon.' : status === 429 ? 'Patreon is limiting requests. Synchronization will retry automatically.' : 'Patreon could not be reached. Synchronization will retry automatically.'), { status });
}
export async function exchange(env, values) {
  const response = await fetch('https://www.patreon.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TheSmartBot - Knowledge Sync' }, body: new URLSearchParams({ client_id: env.PATREON_CLIENT_ID, client_secret: env.PATREON_CLIENT_SECRET, ...values }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    let code = null;
    try {
      const providerError = (await response.json()).error;
      if (['invalid_client', 'invalid_grant', 'invalid_request'].includes(providerError)) code = providerError;
    } catch { /* Ignore provider response bodies that are not JSON. */ }
    throw Object.assign(failure(response.status), { code });
  }
  const token = await response.json();
  if (!token.access_token || !token.refresh_token) throw failure(401);
  return token;
}
export async function apiToken(token, path, options = {}) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid Patreon endpoint.');
  const endpoint = new URL('https://www.patreon.com/api/oauth2/v2' + path);
  endpoint.search = endpoint.searchParams.toString();
  const response = await fetch(endpoint, { ...options, headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'TheSmartBot - Knowledge Sync', 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (response.status === 404) return null;
  if (!response.ok) throw failure(response.status);
  return response.status === 204 ? {} : response.json();
}
export async function accessToken(env, row) {
  let token = JSON.parse(await decryptGuildKey(JSON.parse(row.token_json), env.GUILD_SECRETS_KEY));
  if (row.expires_at < Date.now() + 120000) {
    const lock = await env.DB.prepare('UPDATE patreon_connections SET refresh_until=? WHERE guild_id=? AND generation=? AND refresh_until<?').bind(Date.now() + 30000, row.guild_id, row.generation, Date.now()).run();
    if (!lock.meta?.changes && !lock.changes) throw Object.assign(new Error('Patreon authorization is refreshing. Retrying shortly.'), { status: 503 });
    try {
      token = await exchange(env, { grant_type: 'refresh_token', refresh_token: token.refresh_token });
      await env.DB.prepare('UPDATE patreon_connections SET token_json=?,expires_at=?,refresh_until=0 WHERE guild_id=? AND generation=?').bind(JSON.stringify(await encryptGuildKey(JSON.stringify(token), env.GUILD_SECRETS_KEY)), Date.now() + Number(token.expires_in || 3600) * 1000, row.guild_id, row.generation).run();
    } catch (error) {
      await env.DB.prepare('UPDATE patreon_connections SET refresh_until=0 WHERE guild_id=? AND generation=?').bind(row.guild_id, row.generation).run();
      throw error;
    }
  }
  return token.access_token;
}
export async function api(env, row, path, options = {}) {
  try { return await apiToken(await accessToken(env, row), path, options); }
  catch (error) {
    if (error.status === 401) await env.DB.prepare('UPDATE patreon_connections SET expires_at=0 WHERE guild_id=? AND generation=?').bind(row.guild_id, row.generation).run();
    throw error;
  }
}
export async function auditConnection(env, guildId, actorId, action, row) {
  const state = await getState(env.DB, guildId) || await createStateIfMissing(env.DB, guildId);
  const snapshot = settingsAuditSnapshot(state.settings, state.geminiSecret, state.openaiSecret, await auditPermissions(env.DB, guildId));
  snapshot.patreonConnection = { connected: Boolean(row), campaignId: row?.campaign_id || null, name: row?.name || null };
  await prepareAuditInsert(env.DB, guildId, snapshot, { actorId, action }).run();
}
export const postFields = 'title,content,published_at,url,is_public,tiers,embed_url';
export function postPath(id) { return `/posts/${encodeURIComponent(id)}?include=campaign&fields[post]=${postFields}`; }
export function cleanPost(post, campaignId) {
  if (post?.type !== 'post' || !/^\d+$/.test(String(post.id)) || String(post.relationships?.campaign?.data?.id || '') !== campaignId) return null;
  const a = post.attributes || {};
  if (!a.published_at || !Number.isFinite(Date.parse(a.published_at)) || Date.parse(a.published_at) > Date.now()) return null;
  let url;
  try { url = new URL(a.url); if (url.protocol !== 'https:' || !['www.patreon.com', 'patreon.com'].includes(url.hostname)) return null; } catch { return null; }
  return { id: String(post.id), title: String(a.title || 'Patreon post'), html: String(a.content || ''), publishedAt: a.published_at, url: url.href, isPublic: a.is_public === true, tiers: Array.isArray(a.tiers) ? a.tiers : [], embedUrl: typeof a.embed_url === 'string' ? a.embed_url : '' };
}
export async function addWebhook(env, row, base) {
  const result = await api(env, row, '/webhooks', { method: 'POST', body: JSON.stringify({ data: { type: 'webhook', attributes: { triggers: ['posts:publish', 'posts:update', 'posts:delete'], uri: `${base}/api/patreon/webhook/${row.hook_key}` }, relationships: { campaign: { data: { type: 'campaign', id: row.campaign_id } } } } }) });
  if (!result?.data?.id || !result.data.attributes?.secret) throw new Error('Patreon notifications could not be enabled. Periodic sync remains available.');
  await env.DB.prepare('UPDATE patreon_connections SET webhook_id=?,webhook_secret=? WHERE guild_id=? AND generation=?').bind(result.data.id, JSON.stringify(await encryptGuildKey(result.data.attributes.secret, env.GUILD_SECRETS_KEY)), row.guild_id, row.generation).run();
}
