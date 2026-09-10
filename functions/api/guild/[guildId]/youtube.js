import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";
import { resolveYouTubeChannel } from "../../../_lib/youtube.js";

export async function onRequestPost({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const body = await request.json();
  const destinationChannelId = String(body.destinationChannelId || "");
  const announcementTemplate = String(body.announcementTemplate || "").trim().slice(0, 1500) || "📺 **{channel} uploaded a new video:**\n**{title}**";
  if (!/^\d{15,25}$/.test(destinationChannelId)) return json({ error: "Select an announcement channel." }, 400);
  let resolved;
  try { resolved = await resolveYouTubeChannel(body.source); } catch (error) { return json({ error: error.message }, 400); }
  const subscription = { ...resolved, destinationChannelId, announcementTemplate };
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, youtubeSubscriptions: [...(state.settings.youtubeSubscriptions || []).filter((item) => item.youtubeChannelId !== subscription.youtubeChannelId || item.destinationChannelId !== destinationChannelId), subscription] } }));
  return json({ ok: true, name: resolved.sourceName });
}

export async function onRequestPut({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const body = await request.json();
  const youtubeChannelId = String(body.youtubeChannelId || "");
  const destinationChannelId = String(body.destinationChannelId || "");
  const announcementTemplate = String(body.announcementTemplate || "").trim().slice(0, 1500) || "📺 **{channel} uploaded a new video:**\n**{title}**";
  if (!/^UC[\w-]{20,}$/.test(youtubeChannelId) || !/^\d{15,25}$/.test(destinationChannelId)) {
    return json({ error: "That YouTube notification could not be identified." }, 400);
  }

  try {
    let found = false;
    await mutateState(env.DB, params.guildId, (state) => {
      const youtubeSubscriptions = (state.settings.youtubeSubscriptions || []).map((item) => {
        if (item.youtubeChannelId !== youtubeChannelId || item.destinationChannelId !== destinationChannelId) return item;
        found = true;
        return { ...item, announcementTemplate };
      });
      if (!found) throw new Error("YouTube notification not found.");
      return { ...state, settings: { ...state.settings, youtubeSubscriptions } };
    });
  } catch (error) {
    if (error.message === "YouTube notification not found.") return json({ error: error.message }, 404);
    throw error;
  }
  return json({ ok: true, announcementTemplate });
}

export async function onRequestDelete({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const body = await request.json();
  const youtubeChannelId = String(body.youtubeChannelId || "");
  const destinationChannelId = String(body.destinationChannelId || "");
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, youtubeSubscriptions: (state.settings.youtubeSubscriptions || []).filter((item) => item.youtubeChannelId !== youtubeChannelId || (destinationChannelId && item.destinationChannelId !== destinationChannelId)) } }));
  return json({ ok: true });
}
