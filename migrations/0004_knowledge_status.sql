CREATE TABLE IF NOT EXISTS knowledge_status (
  guild_id TEXT PRIMARY KEY,
  status_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
