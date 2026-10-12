CREATE TABLE IF NOT EXISTS guild_settings_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS guild_settings_audit_scope ON guild_settings_audit(guild_id, id);
