import { cookies, json, unseal } from "../_lib/auth.js";
import { installedGuilds } from "../_lib/authorize.js";

export async function onRequestGet({ env, request }) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now()) return json(
    { user: null, guilds: [], inviteUrl: `/auth/invite` },
    200,
    { "Cache-Control": "no-store" },
  );
  const currentInstallations = await installedGuilds(env);
  const installedById = new Map(currentInstallations.map((guild) => [guild.id, guild]));
  const recentInstallIsActive = session.recentlyInstalledGuildId
    && Number(session.installCompletedAt) > Date.now() - 2 * 60 * 1000;
  const guilds = (session.guilds || [])
    .filter((guild) => installedById.has(String(guild.id)) || (recentInstallIsActive && String(guild.id) === session.recentlyInstalledGuildId))
    .map((guild) => {
      const current = installedById.get(String(guild.id));
      return {
        ...guild,
        name: current?.name || guild.name,
        icon: current ? current.icon : guild.icon,
      };
    });
  return json(
    { user: session.user, guilds, inviteUrl: session.inviteUrl || `/auth/invite` },
    200,
    { "Cache-Control": "no-store" },
  );
}
