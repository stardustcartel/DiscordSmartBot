import { cookies, json, unseal } from "../_lib/auth.js";
import { installedGuildIds } from "../_lib/authorize.js";

export async function onRequestGet({ env, request }) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now()) return json({ user: null, guilds: [], inviteUrl: `/auth/invite` });
  const installed = await installedGuildIds(env);
  const guilds = (session.guilds || []).filter((guild) => installed.has(String(guild.id)));
  return json({ user: session.user, guilds, inviteUrl: session.inviteUrl || `/auth/invite` });
}
