import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { onRequestGet, onRequestPut, memberCanRead } from "../functions/api/guild/[guildId]/knowledge.js";
import { onRequestPost as sync } from "../functions/api/internal/sync.js";
import { createStateIfMissing, getState } from "../functions/_lib/db.js";
import { seal } from "../functions/_lib/auth.js";

const sqlite = new DatabaseSync(":memory:");
const DB = { prepare(sql) {
  return { args: [], bind(...args) { this.args = args; return this; }, async run() { return sqlite.prepare(sql).run(...this.args); }, async first() { return sqlite.prepare(sql).get(...this.args) || null; }, async all() { return { results: sqlite.prepare(sql).all(...this.args) }; } };
}, async batch(statements) { return Promise.all(statements.map((s) => s.run())); } };
const guildId = "100000000000000001", userId = "100000000000000002", channelId = "100000000000000003", roleId = "100000000000000004";
const data = { guild: { id: guildId, owner_id: "someone-else" }, roles: [{ id: guildId, permissions: "66560" }, { id: roleId, permissions: "32" }], member: { user: { id: userId }, roles: [roleId] } };
const publicChannel = { id: channelId, name: "forum", type: 15, permission_overwrites: [] };
const restricted = { id: "100000000000000009", type: 0, name: "private", permission_overwrites: [{ id: guildId, type: 0, deny: "1024", allow: "0" }] };
const env = { DB, DISCORD_BOT_TOKEN: "fake", DASHBOARD_SESSION_SECRET: "test-session", BOT_SYNC_SECRET: "test-sync" };
const originalFetch = globalThis.fetch;
try {
  assert.equal(memberCanRead(publicChannel, data), true);
  assert.equal(memberCanRead(restricted, data), false, "Manage Server is not permission to read every channel");
  assert.equal(memberCanRead(restricted, { ...data, roles: [{ id: guildId, permissions: "8" }] }), true);
  globalThis.fetch = async (input) => {
    const url = String(input);
    const value = url.endsWith("/channels") ? [publicChannel, restricted]
      : url.endsWith("/roles") ? data.roles : url.includes("/members/") ? data.member : data.guild;
    return new Response(JSON.stringify(value));
  };
  const session = await seal({ user: { id: userId }, guilds: [{ id: guildId }], expiresAt: Date.now() + 60000 }, env.DASHBOARD_SESSION_SECRET);
  const request = (method, body, cookie = true) => new Request(`https://test/api/guild/${guildId}/knowledge`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `dashboard_session=${session}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const args = { env, params: { guildId } };
  assert.equal((await onRequestGet({ ...args, request: request("GET", null, false) })).status, 403);
  assert.equal((await onRequestPut({ ...args, request: request("PUT", { channelIds: [restricted.id] }) })).status, 400);
  assert.equal((await onRequestPut({ ...args, request: request("PUT", { channelIds: [channelId, channelId] }) })).status, 400);
  await createStateIfMissing(DB, guildId);
  assert.equal((await onRequestPut({ ...args, request: request("PUT", { channelIds: [channelId] }) })).status, 200);
  assert.deepEqual((await getState(DB, guildId)).settings.knowledgeChannelIds, [channelId]);
  const version = (await getState(DB, guildId)).version;
  const response = await sync({ env, request: new Request("https://test/api/internal/sync", { method: "POST", headers: { Authorization: "Bearer test-sync", "Content-Type": "application/json" }, body: JSON.stringify({ installedGuilds: [{ id: guildId, name: "Test" }], knowledgeStatus: { [guildId]: { indexed: 40, state: "indexing" } }, knownVersions: {} }) }) });
  assert.equal(response.status, 200);
  assert.equal((await getState(DB, guildId)).version, version, "Progress must not modify settings or cause sync conflicts");
  const result = await (await onRequestGet({ ...args, request: request("GET") })).json();
  assert.equal(result.status.indexed, 40);
  assert.equal(result.channels.length, 1);
  assert.equal((await onRequestPut({ ...args, request: request("PUT", { channelIds: [] }) })).status, 200);
  console.log("Knowledge dashboard authorization, channel validation, persistence, status synchronization, and disabling passed.");
} finally { globalThis.fetch = originalFetch; sqlite.close(); }
