import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { onRequestPut as saveOpenAiKey } from "../functions/api/guild/[guildId]/openai.js";
import { onRequestPut as selectProvider } from "../functions/api/guild/[guildId]/ai-provider.js";
import { onRequestGet as listModels, onRequestPut as saveModel } from "../functions/api/guild/[guildId]/openai-model.js";
import { onRequestPut as saveOptions } from "../functions/api/guild/[guildId]/openai-options.js";
import { seal } from "../functions/_lib/auth.js";
import { availableOpenAiModels, sortOpenAiModels } from "../functions/_lib/openai-models.js";

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
  if (url === "https://api.openai.com/v1/models") return Response.json({ data: [{ id: "gpt-6.2-luna" }, { id: "gpt-7-orbit" }, { id: "gpt-6-realtime" }, { id: "gpt-image-2" }, { id: "gpt-6-luna-2026-05-18" }] }, { status: options.headers.Authorization === "Bearer invalid-key" ? 401 : 200 });
  throw new Error(`Unexpected request: ${url}`);
};

try {
  assert.deepEqual(sortOpenAiModels(["gpt-5.5-pro", "gpt-7.2", "gpt-6.1-sol", "gpt-7.10", "gpt-5.4-mini"]), ["gpt-7.10", "gpt-7.2", "gpt-6.1-sol", "gpt-5.5-pro", "gpt-5.4-mini"]);
  assert.deepEqual(sortOpenAiModels(["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"], new Map([["gpt-6-sol", 20], ["gpt-6-luna", 30], ["gpt-6-astra", 10]])), ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"]);
  assert.equal((await availableOpenAiModels(null, null))[0], "gpt-6.1-sol", "No-key fallback is newest generation first");
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
  const modelList = await listModels({ env, params: { guildId }, request: requestFor("openai-model", {}) });
  const models = (await modelList.json()).models;
  assert.equal(models[0], "gpt-7-orbit");
  assert.ok(models.indexOf("gpt-6.1-sol") < models.indexOf("gpt-5.5-pro"));
  assert.ok(models.includes("gpt-5.5-pro") && models.includes("gpt-6.2-luna") && models.includes("gpt-7-orbit"));
  assert.ok(!models.includes("gpt-image-2") && !models.includes("gpt-6-realtime") && !models.includes("gpt-6-luna-2026-05-18"));
  response = await saveModel({ env, params: { guildId }, request: requestFor("openai-model", { model: "gpt-image-2" }) });
  assert.equal(response.status, 400);
  response = await saveModel({ env, params: { guildId }, request: requestFor("openai-model", { model: "gpt-6.2-luna" }) });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(env.DB.row.settings_json).openAiModel, "gpt-6.2-luna");
  response = await saveOptions({ env, params: { guildId }, request: requestFor("openai-options", { speed: "fast", reasoning: "medium" }) });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(env.DB.row.settings_json).openAiSpeed, "fast");
  assert.equal(JSON.parse(env.DB.row.settings_json).openAiReasoning, "medium");
  response = await saveOptions({ env, params: { guildId }, request: requestFor("openai-options", { speed: "fast", reasoning: "none" }) });
  assert.equal(response.status, 400, "Unknown future models cannot use unverified reasoning levels");
  response = await saveModel({ env, params: { guildId }, request: requestFor("openai-model", { model: "gpt-5.5-pro" }) });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(env.DB.row.settings_json).openAiReasoning, "medium");
  response = await saveOptions({ env, params: { guildId }, request: requestFor("openai-options", { speed: "default", reasoning: "none" }) });
  assert.equal(response.status, 400, "Pro model does not support no reasoning");
  console.log("OpenAI dashboard encryption, key history, and provider selection checks passed.");
} finally {
  globalThis.fetch = originalFetch;
}
