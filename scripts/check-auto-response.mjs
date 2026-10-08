import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { onRequestPut } from "../functions/api/guild/[guildId]/bot-access.js";
import { seal } from "../functions/_lib/auth.js";

const require = createRequire(import.meta.url);
const { shouldAutoRespond } = require("../src/bot-response.js");
const guildId = "1545533279766319215";
const userId = "100000000000000001";
const textId = "100000000000000002";
const forumId = "100000000000000003";
const otherId = "100000000000000004";

assert.equal(shouldAutoRespond({}, textId), false);
assert.equal(shouldAutoRespond({ botAutoResponseChannelIds: [textId, forumId] }, textId), true);
assert.equal(shouldAutoRespond({ botAutoResponseChannelIds: [forumId] }, otherId, forumId), true, "Forum threads inherit their parent forum setting");
assert.equal(shouldAutoRespond({ botAutoResponseChannelIds: [forumId] }, otherId, textId), false);

class FakeD1 {
  row = null;
  prepare(sql) {
    const db = this;
    return {
      bind(...args) { this.args = args; return this; },
      async all() { return { results: [{ name: "openai_secret_json" }] }; },
      async first() { return sql.startsWith("SELECT guild_id") ? db.row && { ...db.row } : null; },
      async run() {
        if (sql.startsWith("INSERT OR IGNORE INTO guild_state") && !db.row) db.row = { guild_id: this.args[0], settings_json: this.args[1], gemini_secret_json: this.args[2], openai_secret_json: null, version: 1, updated_at: this.args[3], updated_by: this.args[4] };
        if (sql.startsWith("INSERT INTO guild_state")) db.row = { guild_id: this.args[0], settings_json: this.args[1], gemini_secret_json: this.args[2], openai_secret_json: this.args[3], version: (db.row?.version || 0) + 1, updated_at: this.args[4], updated_by: this.args[5] };
        return { success: true };
      },
    };
  }
  async batch(statements) { for (const statement of statements) await statement.run(); }
}

const env = { DB: new FakeD1(), DISCORD_BOT_TOKEN: "bot-token", DASHBOARD_SESSION_SECRET: "test-session-secret" };
const session = await seal({ user: { id: userId }, guilds: [{ id: guildId }], expiresAt: Date.now() + 60_000 }, env.DASHBOARD_SESSION_SECRET);
const requestFor = (body) => new Request(`https://discordsmartbot.pages.dev/api/guild/${guildId}/bot-access`, { method: "PUT", headers: { Cookie: `dashboard_session=${session}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ owner_id: userId });
  if (url.endsWith(`/guilds/${guildId}/members/${userId}`)) return Response.json({ roles: [] });
  if (url.endsWith(`/guilds/${guildId}/channels`)) return Response.json([{ id: textId, type: 0 }, { id: forumId, type: 15 }, { id: otherId, type: 5 }]);
  if (url.endsWith(`/guilds/${guildId}/roles`)) return Response.json([{ id: guildId, permissions: "0" }]);
  throw new Error(`Unexpected request: ${url}`);
};

try {
  const params = { guildId };
  let response = await onRequestPut({ env, params, request: requestFor({ channelIds: [textId, forumId], autoChannelIds: [forumId], roleIds: [] }) });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(env.DB.row.settings_json).botAutoResponseChannelIds, [forumId]);
  response = await onRequestPut({ env, params, request: requestFor({ channelIds: [textId], autoChannelIds: [forumId], roleIds: [] }) });
  assert.equal(response.status, 400, "Automatic channels must be response channels");
  response = await onRequestPut({ env, params, request: requestFor({ channelIds: [], autoChannelIds: [otherId], roleIds: [] }) });
  assert.equal(response.status, 400, "Announcement channels cannot be automatic response channels");
  response = await onRequestPut({ env, params, request: requestFor({ channelIds: [], autoChannelIds: [textId], roleIds: [] }) });
  assert.equal(response.status, 200, "An empty response allowlist represents all forum and text channels");
  console.log("Automatic response channel checks passed.");
} finally {
  globalThis.fetch = originalFetch;
}
