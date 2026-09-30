CREATE TABLE IF NOT EXISTS dashboard_permissions (
  guild_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user','role')),
  subject_id TEXT NOT NULL,
  label TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, subject_type, subject_id)
);
