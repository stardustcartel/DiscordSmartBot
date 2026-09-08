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
  const guilds = (session.guilds || []).filter((guild) => installedById.has(String(guild.id))).map((guild) => ({
    ...guild,
    name: installedById.get(String(guild.id)).name || guild.name,
    icon: installedById.get(String(guild.id)).icon,
  }));
  return json(
    { user: session.user, guilds, inviteUrl: session.inviteUrl || `/auth/invite` },
    200,
    { "Cache-Control": "no-store" },
  );
}
