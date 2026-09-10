import { cookie, cookies, json, managedGuilds, publicUrl, seal, unseal } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const dashboardUrl = `${publicUrl(env, request)}/dashboard`;
  if (url.searchParams.has("error")) {
    const responseHeaders = new Headers({ Location: dashboardUrl });
    responseHeaders.append("Set-Cookie", cookie("dashboard_oauth_state", "", 0));
    return new Response(null, { status: 302, headers: responseHeaders });
  }
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
  const managed = managedGuilds(await guildResponse.json());
  const confirmedInstalledGuildId = String(token.guild?.id || "");
  const hintedInstalledGuildId = String(url.searchParams.get("guild_id") || "");
  let installedIds = new Set();
  if (env.DISCORD_BOT_TOKEN) {
    const installedResponse = await fetch("https://discord.com/api/users/@me/guilds", { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    if (installedResponse.ok) installedIds = new Set((await installedResponse.json()).map((guild) => guild.id));
  }
  const installedGuildId = confirmedInstalledGuildId || (installedIds.has(hintedInstalledGuildId) ? hintedInstalledGuildId : "");
  const guilds = managed.filter((guild) => installedIds.has(guild.id) || guild.id === installedGuildId);
  const inviteUrl = `${publicUrl(env, request)}/auth/invite`;
  const session = await seal({
    user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar },
    guilds,
    inviteUrl,
    recentlyInstalledGuildId: confirmedInstalledGuildId || undefined,
    installCompletedAt: confirmedInstalledGuildId ? Date.now() : undefined,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  }, env.DASHBOARD_SESSION_SECRET);
  const responseHeaders = new Headers({ Location: dashboardUrl });
  responseHeaders.append("Set-Cookie", cookie("dashboard_session", session, 43200));
  responseHeaders.append("Set-Cookie", cookie("dashboard_oauth_state", "", 0));
  return new Response(null, { status: 302, headers: responseHeaders });
}
