import { cookie, publicUrl, seal } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_CLIENT_SECRET || !env.DASHBOARD_SESSION_SECRET) {
    return new Response("Discord installation is not configured yet.", { status: 503 });
  }

  const state = await seal(
    { nonce: crypto.randomUUID(), flow: "install", expiresAt: Date.now() + 10 * 60 * 1000 },
    env.DASHBOARD_SESSION_SECRET,
  );
  const redirectUri = `${publicUrl(env, request)}/auth/callback`;
  const invite = new URL("https://discord.com/oauth2/authorize");
  invite.search = new URLSearchParams({
    client_id: env.DISCORD_APPLICATION_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "identify guilds bot applications.commands",
    permissions: "84992",
    integration_type: "0",
    state,
  }).toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: invite.toString(),
      "Set-Cookie": cookie("dashboard_oauth_state", state, 600),
    },
  });
}
