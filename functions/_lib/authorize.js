import { cookies, unseal } from "./auth.js";

export async function authorizedGuild(env, request, guildId) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now()) return null;
  return session.guilds?.some((guild) => guild.id === guildId) ? session : null;
}
