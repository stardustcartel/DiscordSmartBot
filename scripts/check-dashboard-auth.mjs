import { onRequestGet as invite } from "../functions/auth/invite.js";
import { onRequestGet as callback } from "../functions/auth/callback.js";
import { onRequestGet as logout } from "../functions/auth/logout.js";
import { onRequestGet as me } from "../functions/api/me.js";
import { onRequestPost as grant, onRequestDelete as revoke } from "../functions/api/guild/[guildId]/permissions.js";
import { seal, unseal } from "../functions/_lib/auth.js";
import { authorizedGuild } from "../functions/_lib/authorize.js";

const guildId = "1545533279766319215";
const managerId = "100000000000000001";
const editorId = "100000000000000002";
const roleEditorId = "100000000000000003";
const strangerId = "100000000000000004";
const managerRoleId = "200000000000000001";
const editorRoleId = "200000000000000002";
const origin = "https://discordsmartbot.pages.dev";
const env = {
  DISCORD_APPLICATION_ID: "123",
  DISCORD_CLIENT_SECRET: "client-secret",
  DASHBOARD_SESSION_SECRET: "session-secret",
  DASHBOARD_PUBLIC_URL: origin,
  DISCORD_BOT_TOKEN: "bot-token",
  DB: {
    async batch() { return []; },
    prepare(sql) {
      return { bind(...args) {
        return {
          async all() {
            if (sql.includes("ORDER BY created_at")) return { results: grants.filter((grant) => grant.guild_id === args[0]) };
            return { results: grants.filter((grant) => grant.guild_id === args[0] && (grant.subject_id === args[1] || grant.subject_type === "role")) };
          },
          async run() {
            if (sql.startsWith("INSERT INTO dashboard_permissions")) {
              const [guild_id, subject_type, subject_id, label, added_by, created_at] = args;
              const existing = grants.findIndex((item) => item.guild_id === guild_id && item.subject_type === subject_type && item.subject_id === subject_id);
              if (existing >= 0) grants.splice(existing, 1);
              grants.push({ guild_id, subject_type, subject_id, label, added_by, created_at });
            }
            if (sql.startsWith("DELETE FROM dashboard_permissions")) {
              const index = grants.findIndex((item) => item.guild_id === args[0] && item.subject_type === args[1] && item.subject_id === args[2]);
              if (index >= 0) grants.splice(index, 1);
            }
            return {};
          },
        };
      } };
    },
  },
};
const grants = [];
const members = new Map([
  [managerId, { user: { id: managerId, username: "Manager" }, roles: [managerRoleId] }],
  [editorId, { user: { id: editorId, username: "Editor" }, roles: [] }],
  [roleEditorId, { user: { id: roleEditorId, username: "RoleEditor" }, roles: [editorRoleId] }],
  [strangerId, { user: { id: strangerId, username: "Stranger" }, roles: [] }],
]);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.endsWith("/oauth2/token")) return json({ access_token: new URLSearchParams(options.body).get("code") });
  if (url.endsWith("/users/@me") && options.headers?.Authorization?.startsWith("Bearer ")) {
    const id = options.headers.Authorization.slice(7);
    return json(members.get(id)?.user || { id, username: "Unknown" });
  }
  if (url.endsWith("/users/@me/guilds")) return json([{ id: guildId, name: "Test server", icon: null, permissions: "0" }]);
  if (url.endsWith(`/guilds/${guildId}`)) return json({ id: guildId, owner_id: "999999999999999999" });
  if (url.endsWith(`/guilds/${guildId}/roles`)) return json([
    { id: guildId, name: "@everyone", permissions: "0" },
    { id: managerRoleId, name: "Manager", permissions: "32" },
    { id: editorRoleId, name: "Editors", permissions: "0", color: 7743267 },
  ]);
  const memberId = url.split("/members/")[1];
  if (memberId) return members.has(memberId) ? json(members.get(memberId)) : json({ error: "Unknown member" }, 404);
  throw new Error(`Unexpected Discord request: ${url}`);
};

async function signIn(userId) {
  const state = await seal({ nonce: "test", expiresAt: Date.now() + 600_000 }, env.DASHBOARD_SESSION_SECRET);
  const response = await callback({ env, request: new Request(`${origin}/auth/callback?code=${userId}&state=${encodeURIComponent(state)}`, { headers: { Cookie: `dashboard_oauth_state=${state}` } }) });
  if (response.status !== 302) throw new Error("Discord sign-in failed.");
  const sealedSession = response.headers.getSetCookie().find((value) => value.startsWith("dashboard_session=")).split(";")[0].slice("dashboard_session=".length);
  const session = await unseal(sealedSession, env.DASHBOARD_SESSION_SECRET);
  return { session, request: new Request(`${origin}/api/me`, { headers: { Cookie: `dashboard_session=${sealedSession}` } }) };
}

try {
  const inviteResponse = await invite({ env, request: new Request(`${origin}/auth/invite`) });
  if (inviteResponse.status !== 302 || !inviteResponse.headers.get("Location")?.includes("bot")) throw new Error("Bot invitation failed.");
  const cancelledState = await seal({ nonce: "cancel", expiresAt: Date.now() + 600_000 }, env.DASHBOARD_SESSION_SECRET);
  const cancelled = await callback({ env, request: new Request(`${origin}/auth/callback?error=access_denied&state=${cancelledState}`) });
  if (cancelled.headers.get("Location") !== `${origin}/dashboard`) throw new Error("Cancelled sign-in did not return to the dashboard.");

  const manager = await signIn(managerId);
  if (manager.session.guilds.length !== 1 || !(await authorizedGuild(env, manager.request, guildId))) throw new Error("A server manager could not open the dashboard.");
  const addUser = await grant({ env, request: new Request(`${origin}/api/guild/${guildId}/permissions`, { method: "POST", headers: { Cookie: manager.request.headers.get("Cookie") }, body: JSON.stringify({ type: "user", id: editorId }) }), params: { guildId } });
  if (addUser.status !== 200) throw new Error("Manager could not add a member.");
  const editor = await signIn(editorId);
  if (editor.session.guilds.length !== 1 || (await me({ env, request: editor.request })).status !== 200 || !(await authorizedGuild(env, editor.request, guildId))) throw new Error("The granted member could not open the dashboard.");
  const deniedGrant = await grant({ env, request: new Request(`${origin}/api/guild/${guildId}/permissions`, { method: "POST", headers: { Cookie: editor.request.headers.get("Cookie") }, body: JSON.stringify({ type: "user", id: strangerId }) }), params: { guildId } });
  if (deniedGrant.status !== 403) throw new Error("A delegated editor could grant additional access.");
  await revoke({ env, request: new Request(`${origin}/api/guild/${guildId}/permissions`, { method: "DELETE", headers: { Cookie: manager.request.headers.get("Cookie") }, body: JSON.stringify({ type: "user", id: editorId }) }), params: { guildId } });
  if (await authorizedGuild(env, editor.request, guildId)) throw new Error("A revoked member retained dashboard access.");

  const addRole = await grant({ env, request: new Request(`${origin}/api/guild/${guildId}/permissions`, { method: "POST", headers: { Cookie: manager.request.headers.get("Cookie") }, body: JSON.stringify({ type: "role", id: editorRoleId }) }), params: { guildId } });
  if (addRole.status !== 200) throw new Error("Manager could not add a role.");
  const roleEditor = await signIn(roleEditorId);
  if (roleEditor.session.guilds.length !== 1 || !(await authorizedGuild(env, roleEditor.request, guildId))) throw new Error("A role member could not open the dashboard.");
  members.get(roleEditorId).roles = [];
  if (await authorizedGuild(env, roleEditor.request, guildId)) throw new Error("Removing the role did not remove access.");
  members.get(roleEditorId).roles = [editorRoleId];
  const stranger = await signIn(strangerId);
  if (stranger.session.guilds.length || (await authorizedGuild(env, stranger.request, guildId))) throw new Error("An ungranted member got access.");

  await revoke({ env, request: new Request(`${origin}/api/guild/${guildId}/permissions`, { method: "DELETE", headers: { Cookie: manager.request.headers.get("Cookie") }, body: JSON.stringify({ type: "role", id: editorRoleId }) }), params: { guildId } });
  if (await authorizedGuild(env, roleEditor.request, guildId)) throw new Error("Removed role access remained active.");
  const afterRevoke = await (await me({ env, request: roleEditor.request })).json();
  if (afterRevoke.guilds.length) throw new Error("A revoked role still appeared in the server chooser.");
  await grant({ env, request: new Request(`${origin}/api/guild/${guildId}/permissions`, { method: "POST", headers: { Cookie: manager.request.headers.get("Cookie") }, body: JSON.stringify({ type: "user", id: editorId }) }), params: { guildId } });
  members.delete(editorId);
  if (await authorizedGuild(env, editor.request, guildId)) throw new Error("A former server member retained access.");

  const logoutResponse = await logout({ env, request: new Request(`${origin}/auth/logout`) });
  if (logoutResponse.status !== 302 || !logoutResponse.headers.getSetCookie().some((value) => value.startsWith("dashboard_session=;"))) throw new Error("Sign-out did not clear the session.");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Dashboard install, delegated access, revocation, and sign-out checks passed.");
