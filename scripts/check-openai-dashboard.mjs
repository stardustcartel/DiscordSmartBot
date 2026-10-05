import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { onRequestPut as saveOpenAiKey } from "../functions/api/guild/[guildId]/openai.js";
import { onRequestPut as selectProvider } from "../functions/api/guild/[guildId]/ai-provider.js";
import { seal } from "../functions/_lib/auth.js";

const guildId = "1545533279766319215";
const managerId = "100000000000000001";
class FakeD1 {
  row = null;
  hasOpenAiColumn = false;
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async all() { return { results: db.hasOpenAiColumn ? [{ name: "openai_secret_json" }] : [] }; },
      async first() { return sql.startsWith("SELECT guild_id") ? db.row && { ...db.row } : null; },
      async run() {
        if (sql.startsWith("ALTER TABLE guild_state")) db.hasOpenAiColumn = true;
        if (sql.startsWith("INSERT OR IGNORE INTO guild_state") && !db.row) {
          db.row = { guild_id: this.args[0], settings_json: this.args[1], gemini_secret_json: this.args[2], openai_secret_json: null, version: 1, updated_at: this.args[3], updated_by: this.args[4] };
        }
        if (sql.startsWith("INSERT INTO guild_state")) {
          db.row = { guild_id: this.args[0], settings_json: this.args[1], gemini_secret_json: this.args[2], openai_secret_json: this.args[3], version: (db.row?.version || 0) + 1, updated_at: this.args[4], updated_by: this.args[5] };
        }
        return { success: true };
      },
    };
  }
  async batch(statements) { for (const statement of statements) await statement.run(); }
}

const env = {
  DB: new FakeD1(),
  DISCORD_BOT_TOKEN: "bot-token",
  DASHBOARD_SESSION_SECRET: "session-secret",
  GUILD_SECRETS_KEY: randomBytes(32).toString("base64"),
};
const session = await seal({ user: { id: managerId, username: "Manager" }, guilds: [{ id: guildId }], expiresAt: Date.now() + 60_000 }, env.DASHBOARD_SESSION_SECRET);
const requestFor = (path, body) => new Request(`https://discordsmartbot.pages.dev/api/guild/${guildId}/${path}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: `dashboard_session=${session}` },
  body: JSON.stringify(body),
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ owner_id: managerId });
  if (url.endsWith(`/guilds/${guildId}/roles`)) return Response.json([{ id: guildId, permissions: "0" }]);
  if (url.endsWith(`/guilds/${guildId}/members/${managerId}`)) return Response.json({ user: { id: managerId }, roles: [] });
  if (url === "https://api.openai.com/v1/models") return new Response("{}", { status: options.headers.Authorization === "Bearer invalid-key" ? 401 : 200 });
  throw new Error(`Unexpected request: ${url}`);
};

try {
  let response = await selectProvider({ env, params: { guildId }, request: requestFor("ai-provider", { provider: "openai" }) });
  assert.equal(response.status, 400, "Cannot select OpenAI before adding a key");
  response = await saveOpenAiKey({ env, params: { guildId }, request: requestFor("openai", { apiKey: "invalid-key" }) });
  assert.equal(response.status, 400, "Invalid keys are rejected");
  assert.equal(env.DB.row.openai_secret_json, null);
  response = await saveOpenAiKey({ env, params: { guildId }, request: requestFor("openai", { apiKey: "first-test-key" }) });
  assert.equal(response.status, 200);
  assert.ok(!JSON.stringify(env.DB.row).includes("first-test-key"), "Plaintext key must not be stored");
  const first = JSON.parse(env.DB.row.openai_secret_json);
  assert.equal(first.keyHistory.current.byName, "Manager");
  assert.ok(first.ciphertext && first.iv && first.tag);
  response = await saveOpenAiKey({ env, params: { guildId }, request: requestFor("openai", { apiKey: "second-test-key" }) });
  assert.equal(response.status, 200);
  const second = JSON.parse(env.DB.row.openai_secret_json);
  assert.equal(second.keyHistory.previous.byName, "Manager");
  response = await selectProvider({ env, params: { guildId }, request: requestFor("ai-provider", { provider: "openai" }) });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(env.DB.row.settings_json).aiProvider, "openai");
  assert.equal(JSON.parse(env.DB.row.openai_secret_json).ciphertext, second.ciphertext, "Provider switch must preserve key");
  console.log("OpenAI dashboard encryption, key history, and provider selection checks passed.");
} finally {
  globalThis.fetch = originalFetch;
}
