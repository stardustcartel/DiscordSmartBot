CREATE TABLE IF NOT EXISTS youtube_push_topics (
  channel_id TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS youtube_push_deliveries (
  guild_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(guild_id,destination_id,channel_id,video_id)
);
