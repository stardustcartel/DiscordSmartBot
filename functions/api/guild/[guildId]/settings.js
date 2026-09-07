import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { createStateIfMissing } from "../../../_lib/db.js";

export async function onRequestGet({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  if (!env.DISCORD_BOT_TOKEN) return json({ error: "The bot connection is not configured yet." }, 503);
  const response = await fetch(`https://discord.com/api/guilds/${params.guildId}/channels`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (!response.ok) return json({ error: "The bot could not load this server's channels." }, 502);
  const channels = (await response.json()).filter((channel) => channel.type === 0).map((channel) => ({ id: channel.id, name: channel.name }));
  const state = await createStateIfMissing(env.DB, params.guildId);
  const settings = structuredClone(state.settings);
  settings.profile = settings.profile || {};
  delete settings.profile.avatarPath;
  delete settings.profile.bannerPath;
  settings.profile.avatarUrl = settings.profile.avatarKey ? `/api/guild/${params.guildId}/asset/avatar` : "";
  settings.profile.bannerUrl = settings.profile.bannerKey ? `/api/guild/${params.guildId}/asset/banner` : "";
  return json({ settings, hasGeminiKey: Boolean(state.geminiSecret), channels, version: state.version });
}
