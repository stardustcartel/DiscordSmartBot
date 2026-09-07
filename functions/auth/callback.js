import { cookie, cookies, json, managedGuilds, publicUrl, seal, unseal } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const stateCookie = cookies(request).dashboard_oauth_state;
  const verifiedState = await unseal(stateCookie, env.DASHBOARD_SESSION_SECRET);
  if (!state || !code || !verifiedState || verifiedState.expiresAt < Date.now() || stateCookie !== state) return json({ error: "The Discord sign-in session expired. Please try again." }, 400);
  const redirectUri = `${publicUrl(env, request)}/auth/callback`;
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.DISCORD_APPLICATION_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri }) });
  if (!tokenResponse.ok) return json({ error: "Discord rejected the sign-in request." }, 502);
  const token = await tokenResponse.json();
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const [userResponse, guildResponse] = await Promise.all([fetch("https://discord.com/api/users/@me", { headers }), fetch("https://discord.com/api/users/@me/guilds", { headers })]);
  if (!userResponse.ok || !guildResponse.ok) return json({ error: "Discord account information could not be loaded." }, 502);
  const user = await userResponse.json();
  const guilds = managedGuilds(await guildResponse.json());
  const session = await seal({ user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar }, guilds, expiresAt: Date.now() + 12 * 60 * 60 * 1000 }, env.DASHBOARD_SESSION_SECRET);
  const responseHeaders = new Headers({ Location: `${publicUrl(env, request)}/dashboard` });
  responseHeaders.append("Set-Cookie", cookie("dashboard_session", session, 43200));
  responseHeaders.append("Set-Cookie", cookie("dashboard_oauth_state", "", 0));
  return new Response(null, { status: 302, headers: responseHeaders });
}
