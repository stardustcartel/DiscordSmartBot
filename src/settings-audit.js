const fs = require("node:fs");
const path = require("node:path");

class SettingsAuditMirror {
  constructor(dataDirectory) {
    this.directory = path.join(dataDirectory, "settings-audit");
  }

  save(event) {
    const guildId = String(event.guild_id || "");
    if (!/^\d{15,25}$/.test(guildId) || !Number.isSafeInteger(event.id) || event.id <= 0) throw new Error("Invalid settings audit event.");
    const snapshot = JSON.parse(event.snapshot_json);
    const record = {
      id: event.id,
      guildId,
      at: new Date(event.created_at).toISOString(),
      action: event.action,
      actorId: event.actor_id || null,
      source: event.source,
      settings: snapshot,
    };
    const guildDirectory = path.join(this.directory, guildId);
    fs.mkdirSync(guildDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(guildDirectory, 0o700);
    const historyPath = path.join(guildDirectory, "history.jsonl");
    const currentPath = path.join(guildDirectory, "current.json");
    // A repeated sync after a crash must not duplicate an already mirrored event.
    let lastId = 0;
    try { lastId = JSON.parse(fs.readFileSync(currentPath, "utf8")).id || 0; } catch { /* no mirror yet */ }
    if (lastId >= event.id) return;
    fs.appendFileSync(historyPath, JSON.stringify(record) + "\n", { mode: 0o600 });
    fs.chmodSync(historyPath, 0o600);
    fs.writeFileSync(currentPath, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.chmodSync(currentPath, 0o600);
  }
}

module.exports = { SettingsAuditMirror };
