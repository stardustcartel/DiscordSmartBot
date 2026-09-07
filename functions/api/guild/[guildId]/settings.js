import { cookies, json, unseal } from "../../../_lib/auth.js";

export async function onRequestGet({ env, request, params }) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  const guild = session?.guilds?.find((item) => item.id === params.guildId);
  if (!guild) return json({ error: "You do not have access to this server." }, 403);
  if (!env.DISCORD_BOT_TOKEN) return json({ error: "The bot connection is not configured yet." }, 503);
  const response = await fetch(`https://discord.com/api/guilds/${params.guildId}/channels`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (!response.ok) return json({ error: "The bot could not load this server's channels." }, 502);
  const channels = (await response.json()).filter((channel) => channel.type === 0).map((channel) => ({ id: channel.id, name: channel.name }));
  return json({ settings: { profile: { nickname: "", bio: "", avatarUrl: "" }, personality: "", youtubeSubscriptions: [] }, hasGeminiKey: false, channels });
}
