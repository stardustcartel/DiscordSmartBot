const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AiChat } = require("../src/ai");
const { GuildSecretsStore } = require("../src/guild-secrets");
const { GuildSettingsStore } = require("../src/guild-settings");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smartbot-ai-providers-"));
const config = {
  dataDirectory,
  guildSecretsKey: crypto.randomBytes(32).toString("base64"),
  defaultPersonalityFile: path.join(dataDirectory, "personality.txt"),
  defaultReminderTimeZone: "UTC",
  defaultAiResponsesPerHour: 30,
  geminiModels: ["gemini-test"],
  openAiModel: "gpt-6-luna",
};
const guildId = "1545533279766319215";
const originalFetch = globalThis.fetch;
fs.writeFileSync(config.defaultPersonalityFile, "Be helpful.");

async function main() {
  const secrets = new GuildSecretsStore(config);
  const settings = new GuildSettingsStore(config);
  assert.equal(settings.get(guildId).aiProvider, "gemini");
  secrets.setGeminiKey(guildId, "gemini-test-key");
  secrets.replaceEncryptedOpenAiFromSync(guildId, secrets.encrypt("first-openai-key"));
  assert.equal(secrets.getGeminiKey(guildId), "gemini-test-key");
  assert.equal(secrets.getOpenAiKey(guildId), "first-openai-key");
  secrets.replaceEncryptedOpenAiFromSync(guildId, { ...secrets.encrypt("second-openai-key"), keyHistory: { current: { byName: "Owner" } } });
  const reloaded = new GuildSecretsStore(config);
  assert.equal(reloaded.getOpenAiKey(guildId), "second-openai-key");
  assert.equal(reloaded.getGeminiKey(guildId), "gemini-test-key");
  assert.equal(reloaded.getOpenAiKeyHistory(guildId).current.byName, "Owner");
  settings.setLimits(guildId, { aiProvider: "openai" });
  assert.equal(new GuildSettingsStore(config).get(guildId).aiProvider, "openai");

  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: "Hello from OpenAI" }] }] }) };
  };
  const ai = new AiChat(config);
  const args = { provider: "openai", apiKey: reloaded.getOpenAiKey(guildId), scopeId: guildId, userId: "user", personality: "Be cheerful.", responseLimit: 30 };
  assert.equal(await ai.respond({ ...args, text: "Hi" }), "Hello from OpenAI");
  assert.equal(requests[0].body.model, "gpt-6-luna");
  assert.equal(requests[0].body.instructions, "Be cheerful.");
  assert.equal(requests[0].body.store, false);
  assert.equal(requests[0].options.headers.Authorization, "Bearer second-openai-key");
  await ai.respond({ ...args, text: "Again" });
  assert.deepEqual(requests[1].body.input.map((entry) => entry.role), ["user", "assistant", "user"]);
  assert.ok(!JSON.stringify(requests[1].body).includes("gemini-test-key"));
  console.log("AI provider storage and OpenAI chat checks passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});
