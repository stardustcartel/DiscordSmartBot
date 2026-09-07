import { cookies, unseal } from "./auth.js";

export async function installedGuildIds(env) {
  if (!env.DISCORD_BOT_TOKEN) return new Set();
  try {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (!response.ok) return new Set();
    return new Set((await response.json()).map((guild) => String(guild.id)));
  } catch {
    return new Set();
  }
}

export async function authorizedGuild(env, request, guildId) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now()) return null;
  if (!session.guilds?.some((guild) => guild.id === guildId)) return null;
  return (await installedGuildIds(env)).has(String(guildId)) ? session : null;
}
