import HmacMD5 from 'crypto-js/hmac-md5.js';
import { decryptGuildKey } from '../../../_lib/gemini-secret.js';
import { schema } from '../../../_lib/patreon.js';

export async function onRequestPost({ env, request, params }) {
  await schema(env.DB);
  const row = await env.DB.prepare('SELECT * FROM patreon_connections WHERE hook_key=?').bind(params.key).first();
  if (!row?.webhook_secret) return new Response('Not found', { status: 404 });
  const raw = await request.text();
  if (raw.length > 2000000) return new Response('Too large', { status: 413 });
  const secret = await decryptGuildKey(JSON.parse(row.webhook_secret), env.GUILD_SECRETS_KEY);
  const expected = HmacMD5(raw, secret).toString();
  const supplied = request.headers.get('X-Patreon-Signature') || '';
  let mismatch = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
  if (mismatch) return new Response('Unauthorized', { status: 401 });
  let payload; try { payload = JSON.parse(raw); } catch { return new Response('Invalid payload', { status: 400 }); }
  const kind = request.headers.get('X-Patreon-Event');
  if (!['posts:publish','posts:update','posts:delete'].includes(kind)) return new Response('Ignored');
  const records = Array.isArray(payload.data) ? payload.data : [payload.data];
  for (const post of records) {
    if (post?.type !== 'post' || !/^\d+$/.test(String(post.id))) continue;
    const campaign = post.relationships?.campaign?.data?.id;
    if (campaign && String(campaign) !== row.campaign_id) continue;
    await env.DB.prepare('INSERT INTO patreon_events (guild_id,generation,post_id,kind,created_at) VALUES (?,?,?,?,?)').bind(row.guild_id, row.generation, String(post.id), kind, Date.now()).run();
  }
  return new Response('OK');
}
