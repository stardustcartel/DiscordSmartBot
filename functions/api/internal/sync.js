import { json } from "../../_lib/auth.js";
import { getState, registerInstallations, statesForGuilds, writeState } from "../../_lib/db.js";

function authorized(request, env) {
  const supplied = request.headers.get("Authorization") || "";
  return Boolean(env.BOT_SYNC_SECRET && supplied === `Bearer ${env.BOT_SYNC_SECRET}`);
}

async function storeAssets(env, snapshot) {
  const settings = structuredClone(snapshot.settings || {});
  settings.profile = settings.profile || {};
  if (!env.BOT_ASSETS) return settings;
  for (const kind of ["avatar", "banner"]) {
    const asset = snapshot.assets?.[kind];
    if (!asset?.base64 || !/^image\/(png|jpeg|webp)$/.test(asset.contentType || "")) continue;
    const extension = asset.contentType === "image/jpeg" ? "jpg" : asset.contentType.split("/")[1];
    const key = `guilds/${snapshot.guildId}/${kind}.${extension}`;
    const bytes = Uint8Array.from(atob(asset.base64), (character) => character.charCodeAt(0));
    await env.BOT_ASSETS.put(key, bytes, { httpMetadata: { contentType: asset.contentType } });
    settings.profile[`${kind}Key`] = key;
  }
  return settings;
}

export async function onRequestPost({ env, request }) {
  if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid sync payload." }, 400); }
  const installedGuilds = Array.isArray(body.installedGuilds) ? body.installedGuilds.filter((guild) => /^\d{15,25}$/.test(String(guild.id || ""))) : [];
  await registerInstallations(env.DB, installedGuilds);
  const installedIds = installedGuilds.map((guild) => String(guild.id));
  for (const snapshot of Array.isArray(body.bootstrap) ? body.bootstrap : []) {
    if (!installedIds.includes(String(snapshot.guildId))) continue;
    const current = await getState(env.DB, String(snapshot.guildId));
    if (!current || current.updatedBy === "bootstrap") await writeState(env.DB, String(snapshot.guildId), await storeAssets(env, snapshot), snapshot.geminiSecret, "oracle-bootstrap");
  }
  for (const change of Array.isArray(body.changes) ? body.changes : []) {
    if (installedIds.includes(String(change.guildId))) await writeState(env.DB, String(change.guildId), await storeAssets(env, change), change.geminiSecret, "oracle");
  }
  const knownVersions = body.knownVersions && typeof body.knownVersions === "object" ? body.knownVersions : {};
  const states = (await statesForGuilds(env.DB, installedIds)).filter((state) => state.version > Number(knownVersions[state.guildId] || 0));
  return json({ states, syncedAt: Date.now() });
}
