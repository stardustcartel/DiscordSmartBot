import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";

function decodeImage(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Use a PNG, JPEG, or WebP image.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("Images must be 8 MB or smaller.");
  return { bytes, contentType: match[1], extension: match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1] };
}

export async function onRequestPut({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const body = await request.json();
  const profileChanges = { nickname: String(body.nickname || "").trim().slice(0, 32), bio: String(body.bio || "").trim().slice(0, 190) };
  if ((body.avatarData || body.bannerData) && !env.BOT_ASSETS) return json({ error: "R2 binding BOT_ASSETS is not configured." }, 503);
  for (const kind of ["avatar", "banner"]) {
    if (!body[`${kind}Data`]) continue;
    const image = decodeImage(body[`${kind}Data`]);
    const key = `guilds/${params.guildId}/${kind}.${image.extension}`;
    await env.BOT_ASSETS.put(key, image.bytes, { httpMetadata: { contentType: image.contentType } });
    profileChanges[`${kind}Key`] = key;
  }
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, profile: { ...state.settings.profile, ...profileChanges } } }));
  return json({ ok: true });
}
