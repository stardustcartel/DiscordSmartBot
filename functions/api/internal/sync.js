import { json } from "../../_lib/auth.js";
import { getState, registerInstallations, statesForGuilds, writeState } from "../../_lib/db.js";
import { maintainYouTubeSubscriptions } from "../../_lib/youtube-push.js";

function authorized(request, env) {
  const supplied = request.headers.get("Authorization") || "";
  return Boolean(env.BOT_SYNC_SECRET && supplied === `Bearer ${env.BOT_SYNC_SECRET}`);
}

async function storeAssets(env, snapshot, currentSettings = {}) {
  const settings = structuredClone(snapshot.settings || {});
  settings.profile = settings.profile || {};
  const currentProfile = currentSettings.profile || {};
  for (const kind of ["avatar", "banner"]) {
    const keyName = `${kind}Key`;
    const asset = snapshot.assets?.[kind];
    if (!asset?.base64 || !/^image\/(png|jpeg|webp)$/.test(asset.contentType || "")) {
      if (!settings.profile[keyName] && currentProfile[keyName]) settings.profile[keyName] = currentProfile[keyName];
      continue;
    }
    if (!env.BOT_ASSETS) {
      if (!settings.profile[keyName] && currentProfile[keyName]) settings.profile[keyName] = currentProfile[keyName];
      continue;
    }
    const extension = asset.contentType === "image/jpeg" ? "jpg" : asset.contentType.split("/")[1];
    const key = `guilds/${snapshot.guildId}/${kind}.${extension}`;
    const bytes = Uint8Array.from(atob(asset.base64), (character) => character.charCodeAt(0));
    await env.BOT_ASSETS.put(key, bytes, { httpMetadata: { contentType: asset.contentType } });
    settings.profile[keyName] = key;
  }
  return settings;
}

async function preservePushCheckpoints(db, guildId, settings) {
  const rows = await db.prepare("SELECT destination_id,channel_id,video_id,sent_at FROM youtube_push_deliveries WHERE guild_id=? AND sent_at>0 ORDER BY sent_at DESC LIMIT 200").bind(guildId).all();
  const latest = new Map();
  for (const row of rows.results || []) {
    const key = `${row.channel_id}:${row.destination_id}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  settings.youtubeSubscriptions = (settings.youtubeSubscriptions || []).map((subscription) => {
    const checkpoint = latest.get(`${subscription.youtubeChannelId}:${subscription.destinationChannelId}`);
    return checkpoint && Number(checkpoint.sent_at) > Number(subscription.lastVideoUpdatedAt || 0) ? { ...subscription, lastVideoId: checkpoint.video_id, lastVideoUpdatedAt: Number(checkpoint.sent_at) } : subscription;
  });
  return settings;
}

export async function onRequestPost({ env, request, context }) {
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid sync payload." }, 400); }
  const installedGuilds = Array.isArray(body.installedGuilds) ? body.installedGuilds.filter((guild) => /^\d{15,25}$/.test(String(guild.id || ""))) : [];
  await registerInstallations(env.DB, installedGuilds);
  const installedIds = installedGuilds.map((guild) => String(guild.id));
  for (const guildId of installedIds) {
    const status = body.knowledgeStatus?.[guildId];
    if (status && JSON.stringify(status).length < 10000) await env.DB.prepare("INSERT INTO knowledge_status VALUES (?,?,?) ON CONFLICT(guild_id) DO UPDATE SET status_json=excluded.status_json, updated_at=excluded.updated_at").bind(guildId, JSON.stringify(status), Date.now()).run();
    const runtime = body.openAiRuntime?.[guildId];
    if (runtime && /^gpt-[a-z0-9.-]{1,40}$/.test(runtime.model || "") && ["auto", "default", "fast"].includes(runtime.requestedSpeed) && ["auto", "default", "priority", "fast", "flex", "scale", "ultrafast"].includes(runtime.serviceTier) && Number.isFinite(runtime.observedAt)) {
      await env.DB.prepare("INSERT INTO openai_runtime VALUES (?,?,?) ON CONFLICT(guild_id) DO UPDATE SET runtime_json=excluded.runtime_json, updated_at=excluded.updated_at").bind(guildId, JSON.stringify(runtime), Date.now()).run();
    }
  }
  for (const snapshot of Array.isArray(body.bootstrap) ? body.bootstrap : []) {
    if (!installedIds.includes(String(snapshot.guildId))) continue;
    const current = await getState(env.DB, String(snapshot.guildId));
    if (!current || current.updatedBy === "bootstrap") await writeState(env.DB, String(snapshot.guildId), await preservePushCheckpoints(env.DB, String(snapshot.guildId), await storeAssets(env, snapshot, current?.settings)), snapshot.geminiSecret, snapshot.openaiSecret ?? current?.openaiSecret, "oracle-bootstrap");
  }
  for (const change of Array.isArray(body.changes) ? body.changes : []) {
    if (!installedIds.includes(String(change.guildId))) continue;
    const current = await getState(env.DB, String(change.guildId));
    const settings = await preservePushCheckpoints(env.DB, String(change.guildId), await storeAssets(env, change, current?.settings));
    if (settings.aiProvider === undefined && current?.settings?.aiProvider) settings.aiProvider = current.settings.aiProvider;
    await writeState(env.DB, String(change.guildId), settings, change.geminiSecret, change.openaiSecret ?? current?.openaiSecret, "oracle");
  }
  const knownVersions = body.knownVersions && typeof body.knownVersions === "object" ? body.knownVersions : {};
  const states = (await statesForGuilds(env.DB, installedIds)).filter((state) => state.version > Number(knownVersions[state.guildId] || 0));
  const checkpointRows = await env.DB.prepare("SELECT guild_id,destination_id,channel_id,video_id,sent_at FROM youtube_push_deliveries WHERE sent_at>0 ORDER BY sent_at DESC LIMIT 1000").all();
  const youtubeCheckpoints = (checkpointRows.results || []).filter((row) => installedIds.includes(row.guild_id));
  if (String(env.YOUTUBE_WEBHOOK_SECRET || "").length >= 32) {
    const task = maintainYouTubeSubscriptions(env).catch((error) => console.warn("YouTube subscription maintenance failed:", error.message));
    if (context?.waitUntil) context.waitUntil(task); else await task;
  }
  return json({ states, youtubeCheckpoints, syncedAt: Date.now() });
}
