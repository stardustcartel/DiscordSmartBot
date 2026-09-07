import { cookies, json, unseal } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now()) return json({ user: null, guilds: [], inviteUrl: `/auth/invite` });
  return json({ user: session.user, guilds: session.guilds, inviteUrl: session.inviteUrl || `/auth/invite` });
}
