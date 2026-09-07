CREATE TABLE IF NOT EXISTS guild_state (
  guild_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  gemini_secret_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'bootstrap'
);

CREATE TABLE IF NOT EXISTS guild_installations (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  installed INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
