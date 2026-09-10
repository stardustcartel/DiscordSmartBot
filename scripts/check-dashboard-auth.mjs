import { onRequestGet as invite } from "../functions/auth/invite.js";
import { onRequestGet as callback } from "../functions/auth/callback.js";
import { seal, unseal } from "../functions/_lib/auth.js";

const env = {
  DISCORD_APPLICATION_ID: "123",
  DISCORD_CLIENT_SECRET: "client-secret",
  DASHBOARD_SESSION_SECRET: "session-secret",
  DASHBOARD_PUBLIC_URL: "https://discordsmartbot.pages.dev",
  DISCORD_BOT_TOKEN: "bot-token",
};

const inviteResponse = await invite({
  env,
  request: new Request("https://discordsmartbot.pages.dev/auth/invite"),
});
const authorization = new URL(inviteResponse.headers.get("Location"));
const expectedParameters = {
  response_type: "code",
  redirect_uri: "https://discordsmartbot.pages.dev/auth/callback",
  scope: "identify guilds bot applications.commands",
  integration_type: "0",
};

for (const [name, value] of Object.entries(expectedParameters)) {
  if (authorization.searchParams.get(name) !== value) throw new Error(`Unexpected ${name}.`);
}
if (!inviteResponse.headers.get("Set-Cookie")?.includes("dashboard_oauth_state=")) {
  throw new Error("The install flow did not create an OAuth state cookie.");
}

const state = await seal(
  { nonce: "test", flow: "install", expiresAt: Date.now() + 600_000 },
  env.DASHBOARD_SESSION_SECRET,
);
const originalFetch = globalThis.fetch;
const replies = [
  { access_token: "access", guild: { id: "456" } },
  { id: "789", username: "Tester", global_name: "Tester" },
  [{ id: "456", name: "New Server", icon: null, permissions: "32" }],
  [],
];
globalThis.fetch = async () => new Response(JSON.stringify(replies.shift()), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

try {
  const callbackResponse = await callback({
    env,
    request: new Request(
      `https://discordsmartbot.pages.dev/auth/callback?code=abc&state=${encodeURIComponent(state)}&guild_id=456`,
      { headers: { Cookie: `dashboard_oauth_state=${state}` } },
    ),
  });
  if (callbackResponse.status !== 302 || callbackResponse.headers.get("Location") !== "https://discordsmartbot.pages.dev/dashboard") {
    throw new Error("The completed install did not return to the dashboard.");
  }

  const sessionCookie = callbackResponse.headers.getSetCookie().find((value) => value.startsWith("dashboard_session="));
  const sealedSession = sessionCookie.split(";")[0].slice("dashboard_session=".length);
  const session = await unseal(sealedSession, env.DASHBOARD_SESSION_SECRET);
  if (session.guilds?.[0]?.id !== "456") throw new Error("The installed server was missing from the refreshed session.");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Dashboard install redirect checks passed.");
