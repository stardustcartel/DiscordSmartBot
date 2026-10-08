import { ensureSchema, getState, writeState } from "./db.js";

const encoder = new TextEncoder();
const validChannel = /^UC[\w-]{20,}$/;
const validVideo = /^[\w-]{11}$/;
const HUB = "https://pubsubhubbub.appspot.com/subscribe";
const TEMPLATE = "📺 **{channel} uploaded a new video:**\n**{title}**";

function xmlText(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'").trim();
}

function tag(xml, name) {
  return xmlText(String(xml).match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1]);
}

export function parseYouTubePush(xml) {
  const entries = [...String(xml).matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)].map(([entry]) => ({
    channelId: tag(entry, "yt:channelId"),
    videoId: tag(entry, "yt:videoId"),
    title: tag(entry, "title"),
    channelName: tag(entry, "name"),
  })).filter((entry) => validChannel.test(entry.channelId) && validVideo.test(entry.videoId));
  return entries.slice(0, 10);
}

export function topicUrl(channelId) {
  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

async function hmac(secret, data, hash = "SHA-256") {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash }, false, ["sign", "verify"]);
  return key;
}

async function derivedSecret(secret, purpose, channelId) {
  const key = await hmac(secret);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`youtube-${purpose}:${channelId}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const callbackToken = (secret, channelId) => derivedSecret(secret, "callback", channelId);
export const deliverySecret = (secret, channelId) => derivedSecret(secret, "delivery", channelId);

export async function validHubSignature(secret, body, header) {
  const match = /^(sha1|sha256)=([0-9a-f]+)$/i.exec(header || "");
  if (!match) return false;
  const expectedLength = match[1].toLowerCase() === "sha1" ? 40 : 64;
  if (match[2].length !== expectedLength) return false;
  const signature = Uint8Array.from(match[2].match(/../g), (hex) => parseInt(hex, 16));
  return crypto.subtle.verify("HMAC", await hmac(secret, body, match[1].toLowerCase() === "sha1" ? "SHA-1" : "SHA-256"), signature, body);
}

export async function maintainYouTubeSubscriptions(env) {
  if (String(env.YOUTUBE_WEBHOOK_SECRET || "").length < 32 || !env.DASHBOARD_PUBLIC_URL) return;
  await ensureSchema(env.DB);
  const states = await env.DB.prepare("SELECT settings_json FROM guild_state").all();
  const channels = new Set();
  for (const row of states.results || []) {
    let settings;
    try { settings = JSON.parse(row.settings_json); } catch { continue; }
    for (const subscription of settings.youtubeSubscriptions || []) {
      if (validChannel.test(subscription.youtubeChannelId)) channels.add(subscription.youtubeChannelId);
    }
  }
  const now = Date.now();
  for (const channelId of channels) {
    await env.DB.prepare("INSERT OR IGNORE INTO youtube_push_topics (channel_id,created_at) VALUES (?,?)").bind(channelId, now).run();
    const topic = await env.DB.prepare("SELECT requested_at,lease_expires_at FROM youtube_push_topics WHERE channel_id=?").bind(channelId).first();
    if (Number(topic?.requested_at || 0) > now - 10 * 60_000 || Number(topic?.lease_expires_at || 0) > now + 24 * 60 * 60_000) continue;
    await env.DB.prepare("UPDATE youtube_push_topics SET requested_at=? WHERE channel_id=?").bind(now, channelId).run();
    const callback = new URL("/api/youtube/webhook", env.DASHBOARD_PUBLIC_URL);
    callback.searchParams.set("channel", channelId);
    callback.searchParams.set("token", await callbackToken(env.YOUTUBE_WEBHOOK_SECRET, channelId));
    const form = new URLSearchParams({ "hub.callback": callback.toString(), "hub.mode": "subscribe", "hub.topic": topicUrl(channelId), "hub.verify": "async", "hub.secret": await deliverySecret(env.YOUTUBE_WEBHOOK_SECRET, channelId) });
    try {
      const response = await fetch(HUB, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.warn(`YouTube subscription request failed for ${channelId}: ${error.message}`);
      await env.DB.prepare("UPDATE youtube_push_topics SET requested_at=0 WHERE channel_id=?").bind(channelId).run();
    }
  }
}

export async function deliverYouTubePush(env, entry) {
  await ensureSchema(env.DB);
  const topic = await env.DB.prepare("SELECT created_at,lease_expires_at FROM youtube_push_topics WHERE channel_id=?").bind(entry.channelId).first();
  if (!topic || Number(topic.lease_expires_at) < Date.now()) return;
  const states = await env.DB.prepare("SELECT guild_id,settings_json FROM guild_state").all();
  let failed = false;
  for (const row of states.results || []) {
    let settings;
    try { settings = JSON.parse(row.settings_json); } catch { continue; }
    for (const sub of settings.youtubeSubscriptions || []) {
      if (sub.youtubeChannelId !== entry.channelId || !/^\d{15,25}$/.test(sub.destinationChannelId || "")) continue;
      if (sub.lastVideoId === entry.videoId) continue;
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO youtube_push_deliveries (guild_id,destination_id,channel_id,video_id) VALUES (?,?,?,?)").bind(row.guild_id, sub.destinationChannelId, entry.channelId, entry.videoId).run();
      if (!claim.meta?.changes) continue;
      const template = String(sub.announcementTemplate || TEMPLATE).replaceAll("{channel}", entry.channelName || sub.sourceName || "YouTube channel").replaceAll("{title}", entry.title || "New video").trim();
      const url = `https://www.youtube.com/watch?v=${entry.videoId}`;
      const content = `${template.slice(0, 2000 - url.length - 1)}\n${url}`;
      try {
        if (!env.DISCORD_BOT_TOKEN) throw new Error("Discord bot token missing");
        const response = await fetch(`https://discord.com/api/v10/channels/${sub.destinationChannelId}/messages`, { method: "POST", headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
        if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
        await env.DB.prepare("UPDATE youtube_push_deliveries SET sent_at=? WHERE guild_id=? AND destination_id=? AND channel_id=? AND video_id=?").bind(Date.now(), row.guild_id, sub.destinationChannelId, entry.channelId, entry.videoId).run();
        const current = await getState(env.DB, row.guild_id);
        if (current) {
          const youtubeSubscriptions = (current.settings.youtubeSubscriptions || []).map((item) => item.youtubeChannelId === entry.channelId && item.destinationChannelId === sub.destinationChannelId ? { ...item, lastVideoId: entry.videoId, lastVideoUpdatedAt: Date.now() } : item);
          await writeState(env.DB, row.guild_id, { ...current.settings, youtubeSubscriptions }, current.geminiSecret, current.openaiSecret, "youtube-push");
        }
      } catch (error) {
        failed = true;
        console.warn(`YouTube push delivery failed for ${row.guild_id}/${sub.destinationChannelId}: ${error.message}`);
        await env.DB.prepare("DELETE FROM youtube_push_deliveries WHERE guild_id=? AND destination_id=? AND channel_id=? AND video_id=? AND sent_at=0").bind(row.guild_id, sub.destinationChannelId, entry.channelId, entry.videoId).run();
      }
    }
  }
  if (failed) throw new Error("At least one YouTube announcement failed.");
}
