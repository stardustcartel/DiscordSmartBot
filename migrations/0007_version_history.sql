CREATE TABLE IF NOT EXISTS hidden_releases (
  version TEXT PRIMARY KEY,
  hidden_at INTEGER NOT NULL,
  hidden_by TEXT NOT NULL
);
