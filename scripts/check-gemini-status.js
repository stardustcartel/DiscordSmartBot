const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GeminiModelStatus, failureKind } = require("../src/gemini-model-status");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smartbot-gemini-status-"));
try {
  const guild = "1218340601968197712", models = ["gemini-first", "gemini-second"];
  const status = new GeminiModelStatus(dataDirectory);
  assert.deepEqual(status.snapshot(guild, "key-one", models).models.map((entry) => entry.outcome), ["unknown", "unknown"]);
  assert.equal(failureKind({ status: 429 }), "limit");
  assert.equal(failureKind({ status: 503 }), "unavailable");
  status.observe(guild, "key-one", models[0], "limit");
  status.observe(guild, "key-one", models[1], "success");
  assert.deepEqual(status.snapshot(guild, "key-one", models).models.map((entry) => entry.outcome), ["limit", "success"]);
  assert.equal(status.snapshot(guild, "key-one", models).lastUsed.model, models[1]);
  assert.deepEqual(new GeminiModelStatus(dataDirectory).snapshot(guild, "key-one", models).models.map((entry) => entry.outcome), ["limit", "success"], "Provider changes and restarts must retain recent observations");
  assert.deepEqual(status.snapshot(guild, "new-key", models).models.map((entry) => entry.outcome), ["unknown", "unknown"], "A replaced key must never inherit the old key's limits");
  const later = Date.now() + 31 * 60 * 1000;
  assert.deepEqual(status.snapshot(guild, "key-one", models, later).models.map((entry) => entry.outcome), ["unknown", "unknown"], "Stale caps must never look current");
  status.observe(guild, "key-one", models[0], "success");
  assert.equal(status.snapshot(guild, "key-one", models).models[0].outcome, "success", "A successful request clears an observed limit");
  assert.ok(!fs.readFileSync(path.join(dataDirectory, "gemini-model-status.json"), "utf8").includes("key-one"), "Never save the API key");
  console.log("Gemini model status persistence, stale limits, key replacement, and recovery passed.");
} finally {
  fs.rmSync(dataDirectory, { recursive: true, force: true });
}
