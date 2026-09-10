import { cookies, unseal } from "./auth.js";

export async function installedGuilds(env) {
  if (!env.DISCORD_BOT_TOKEN) return [];
  try {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (!response.ok) return [];
    return (await response.json()).map((guild) => ({ id: String(guild.id), name: guild.name, icon: guild.icon }));
  } catch {
    return [];
  }
}

export async function installedGuildIds(env) {
  return new Set((await installedGuilds(env)).map((guild) => guild.id));
}

export async function authorizedGuild(env, request, guildId) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now()) return null;
  if (!session.guilds?.some((guild) => guild.id === guildId)) return null;
  if ((await installedGuildIds(env)).has(String(guildId))) return session;
  const recentInstallIsActive = session.recentlyInstalledGuildId === String(guildId)
    && Number(session.installCompletedAt) > Date.now() - 2 * 60 * 1000;
  return recentInstallIsActive ? session : null;
}
