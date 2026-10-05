const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GuildSecretsStore } = require("../src/guild-secrets");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smartbot-gemini-key-history-"));
const config = { dataDirectory, guildSecretsKey: crypto.randomBytes(32).toString("base64") };
const guildId = "1545533279766319215";

try {
  const store = new GuildSecretsStore(config);
  store.setGeminiKey(guildId, "first-test-key", { id: "111111111111111111", name: "First admin" });
  assert.equal(store.getGeminiKey(guildId), "first-test-key");
  assert.equal(store.getGeminiKeyHistory(guildId).previous, null);
  store.setGeminiKey(guildId, "second-test-key", { id: "222222222222222222", name: "Second admin" });
  assert.equal(store.getGeminiKey(guildId), "second-test-key");
  assert.equal(store.getGeminiKeyHistory(guildId).current.byName, "Second admin");
  assert.equal(store.getGeminiKeyHistory(guildId).previous.byName, "First admin");
  assert.ok(store.getGeminiKeyHistory(guildId).current.at);

  const reloaded = new GuildSecretsStore(config);
  assert.equal(reloaded.getGeminiKey(guildId), "second-test-key");
  assert.equal(reloaded.getGeminiKeyHistory(guildId).previous.byName, "First admin");

  const oldEncrypted = reloaded.getEncryptedGeminiKey(guildId);
  reloaded.replaceEncryptedFromSync(guildId, oldEncrypted);
  assert.equal(reloaded.getGeminiKeyHistory(guildId).current.byName, "Second admin");

  const legacyGuildId = "1545533279766319216";
  reloaded.replaceEncryptedFromSync(legacyGuildId, reloaded.encrypt("legacy-test-key"));
  reloaded.setGeminiKey(legacyGuildId, "replacement-test-key", { name: "New admin" });
  assert.deepEqual(reloaded.getGeminiKeyHistory(legacyGuildId).previous, { at: null, byId: null, byName: null });
  console.log("Gemini key replacement and history checks passed.");
} finally {
  fs.rmSync(dataDirectory, { recursive: true, force: true });
}
