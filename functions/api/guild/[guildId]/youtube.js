import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";
import { resolveYouTubeChannel } from "../../../_lib/youtube.js";

export async function onRequestPost({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const body = await request.json();
  const destinationChannelId = String(body.destinationChannelId || "");
  if (!/^\d{15,25}$/.test(destinationChannelId)) return json({ error: "Select an announcement channel." }, 400);
  let resolved;
  try { resolved = await resolveYouTubeChannel(body.source); } catch (error) { return json({ error: error.message }, 400); }
  const subscription = { ...resolved, destinationChannelId };
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, youtubeSubscriptions: [...(state.settings.youtubeSubscriptions || []).filter((item) => item.youtubeChannelId !== subscription.youtubeChannelId || item.destinationChannelId !== destinationChannelId), subscription] } }));
  return json({ ok: true, name: resolved.sourceName });
}

export async function onRequestDelete({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const body = await request.json();
  const youtubeChannelId = String(body.youtubeChannelId || "");
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, youtubeSubscriptions: (state.settings.youtubeSubscriptions || []).filter((item) => item.youtubeChannelId !== youtubeChannelId) } }));
  return json({ ok: true });
}
