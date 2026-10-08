import { ensureSchema } from "../../_lib/db.js";
import { callbackToken, deliverYouTubePush, deliverySecret, parseYouTubePush, topicUrl, validHubSignature } from "../../_lib/youtube-push.js";

const deny = () => new Response("Not found", { status: 404 });

async function verifiedTopic(env, url) {
  const channelId = url.searchParams.get("channel") || "";
  if (!/^UC[\w-]{20,}$/.test(channelId) || String(env.YOUTUBE_WEBHOOK_SECRET || "").length < 32) return null;
  if (url.searchParams.get("token") !== await callbackToken(env.YOUTUBE_WEBHOOK_SECRET, channelId)) return null;
  await ensureSchema(env.DB);
  const topic = await env.DB.prepare("SELECT channel_id,requested_at,lease_expires_at FROM youtube_push_topics WHERE channel_id=?").bind(channelId).first();
  return topic || null;
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const topic = await verifiedTopic(env, url);
  const challenge = url.searchParams.get("hub.challenge") || "";
  if (!topic || url.searchParams.get("hub.mode") !== "subscribe" || url.searchParams.get("hub.topic") !== topicUrl(topic.channel_id) || !challenge || challenge.length > 512 || Date.now() - topic.requested_at > 10 * 60_000) return deny();
  const leaseSeconds = Number(url.searchParams.get("hub.lease_seconds"));
  if (!Number.isFinite(leaseSeconds) || leaseSeconds < 60) return deny();
  await env.DB.prepare("UPDATE youtube_push_topics SET lease_expires_at=?,requested_at=0 WHERE channel_id=?").bind(Date.now() + leaseSeconds * 1000, topic.channel_id).run();
  return new Response(challenge, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function onRequestPost({ env, request }) {
  const url = new URL(request.url);
  const topic = await verifiedTopic(env, url);
  if (!topic || topic.lease_expires_at < Date.now()) return deny();
  if (Number(request.headers.get("content-length") || 0) > 128_000) return new Response("Too large", { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > 128_000) return new Response("Too large", { status: 413 });
  const signature = request.headers.get("X-Hub-Signature-256") || request.headers.get("X-Hub-Signature");
  if (!(await validHubSignature(await deliverySecret(env.YOUTUBE_WEBHOOK_SECRET, topic.channel_id), body, signature))) return new Response("Unauthorized", { status: 401 });
  const entries = parseYouTubePush(new TextDecoder().decode(body)).filter((entry) => entry.channelId === topic.channel_id);
  try {
    for (const entry of entries) await deliverYouTubePush(env, entry);
  } catch { return new Response("Delivery failed", { status: 503 }); }
  return new Response("OK");
}
