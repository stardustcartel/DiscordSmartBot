CREATE TABLE IF NOT EXISTS patreon_connections (guild_id TEXT PRIMARY KEY, generation TEXT NOT NULL, campaign_id TEXT NOT NULL, name TEXT NOT NULL, token_json TEXT NOT NULL, expires_at INTEGER NOT NULL, refresh_until INTEGER NOT NULL DEFAULT 0, webhook_id TEXT, webhook_secret TEXT, hook_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, connected_by TEXT NOT NULL, connected_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS patreon_oauth (nonce TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS patreon_events (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, generation TEXT NOT NULL, post_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS patreon_events_scope ON patreon_events(guild_id,generation,id);
CREATE TABLE IF NOT EXISTS patreon_status (guild_id TEXT PRIMARY KEY, generation TEXT NOT NULL, status_json TEXT NOT NULL, reported_at INTEGER NOT NULL);
