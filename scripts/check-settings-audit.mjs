import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { defaults, mutateState, writeState } from "../functions/_lib/db.js";
import { ensureAuditBaseline, settingsAuditSnapshot } from "../functions/_lib/settings-audit.js";

const require = createRequire(import.meta.url);
const { SettingsAuditMirror } = require("../src/settings-audit.js");
const guildId = "1545533279766319215";
const actorId = "100000000000000001";
const secretValue = "sk-NEVER-LOG-THIS-KEY";
const rows = new Map();
const audit = [];
const grants = [{ subject_type: "role", subject_id: "200000000000000001", label: "Editors" }];
const db = {
  async batch(statements) { for (const statement of statements) if (statement.run) await statement.run(); return []; },
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async all() {
            if (sql.startsWith("PRAGMA table_info")) return { results: [{ name: "openai_secret_json" }] };
            if (sql.includes("FROM dashboard_permissions")) return { results: grants };
            return { results: [] };
          },
          async first() {
            if (sql.includes("FROM guild_settings_audit")) return audit.find((row) => row.guild_id === args[0]) || null;
            if (sql.includes("FROM guild_state")) return rows.get(args[0]) || null;
            return null;
          },
          async run() {
            if (sql.startsWith("INSERT OR IGNORE INTO guild_state")) {
              if (!rows.has(args[0])) rows.set(args[0], { guild_id: args[0], settings_json: args[1], gemini_secret_json: args[2], openai_secret_json: null, version: 1, updated_at: args[3], updated_by: args[4] });
            } else if (sql.startsWith("INSERT INTO guild_state")) {
              const previous = rows.get(args[0]);
              rows.set(args[0], { guild_id: args[0], settings_json: args[1], gemini_secret_json: args[2], openai_secret_json: args[3], version: (previous?.version || 0) + 1, updated_at: args[4], updated_by: args[5] });
            } else if (sql.startsWith("INSERT INTO guild_settings_audit")) {
              audit.push({ id: audit.length + 1, guild_id: args[0], action: args[1], actor_id: args[2], source: args[3], created_at: args[4], snapshot_json: args[5] });
            }
          },
        };
      },
      async all() { return { results: [{ name: "openai_secret_json" }] }; },
    };
  },
};

const initial = defaults();
initial.profile.avatarPath = "/private/avatar.png";
await writeState(db, guildId, initial, null, null, "oracle-bootstrap");
const baselineState = { guildId, settings: initial, geminiSecret: null, openaiSecret: null };
await ensureAuditBaseline(db, baselineState);
await ensureAuditBaseline(db, baselineState);
assert.equal(audit.length, 1);

await mutateState(db, guildId, (state) => ({
  ...state,
  settings: { ...state.settings, personality: "Answer with care.", aiProvider: "openai" },
  openaiSecret: { ciphertext: secretValue, iv: "secret-iv", keyHistory: { current: { at: "2026-10-12T00:00:00Z", byId: actorId } } },
}), actorId);
assert.equal(audit.length, 2);
const latest = JSON.parse(audit[1].snapshot_json);
assert.equal(latest.personality, "Answer with care.");
assert.equal(latest.aiProvider, "openai");
assert.equal(latest.openAiKey.configured, true);
assert.equal(latest.dashboardPermissions[0].label, "Editors");
assert.equal(latest.profile.avatarConfigured, true);
assert.ok(!audit[1].snapshot_json.includes(secretValue));
assert.ok(!audit[1].snapshot_json.includes("/private/avatar.png"));
assert.equal(audit[1].actor_id, actorId);

const current = rows.get(guildId);
const settings = JSON.parse(current.settings_json);
const key = JSON.parse(current.openai_secret_json);
await writeState(db, guildId, settings, null, key, "oracle");
assert.equal(audit.length, 2, "unchanged bot sync should not be logged");
await writeState(db, guildId, { ...settings, openAiModel: "gpt-5.5" }, null, key, "oracle");
assert.equal(audit.length, 3);
await writeState(db, guildId, { ...settings, openAiModel: "gpt-5.5", youtubeSubscriptions: [{ lastVideoId: "routine-checkpoint" }] }, null, key, "youtube-push");
assert.equal(audit.length, 3, "background YouTube bookkeeping should not be logged");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "smartbot-settings-audit-test-"));
try {
  const mirror = new SettingsAuditMirror(folder);
  mirror.save(audit[0]);
  mirror.save(audit[1]);
  mirror.save(audit[1]);
  const guildFolder = path.join(folder, "settings-audit", guildId);
  const history = fs.readFileSync(path.join(guildFolder, "history.jsonl"), "utf8").trim().split("\n");
  assert.equal(history.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(guildFolder, "current.json"), "utf8")).settings.personality, "Answer with care.");
  fs.unlinkSync(path.join(guildFolder, "history.jsonl"));
  fs.unlinkSync(path.join(guildFolder, "current.json"));
  fs.rmdirSync(guildFolder);
  fs.rmdirSync(path.join(folder, "settings-audit"));
} finally {
  fs.rmdirSync(folder);
}
assert.equal(settingsAuditSnapshot(settings, null, key).openAiKey.configured, true);
console.log("Settings audit privacy, baseline, save, bot sync, and local mirror checks passed.");
