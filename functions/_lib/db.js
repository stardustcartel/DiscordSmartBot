const defaultSettings = {
  profile: { nickname: "", bio: "", avatarPath: "", bannerPath: "", avatarKey: "", bannerKey: "" },
  personality: "You are a helpful, friendly Discord assistant.",
  aiProvider: "gemini",
  openAiModel: "gpt-6-luna",
  openAiSpeed: "auto",
  openAiReasoning: "auto",
  knowledgeChannelIds: [],
  knowledgePolicy: { knowledgeOnly: false, requireCitations: false, citationCount: 3, generalChannels: [], uncitedChannels: [] },
  botResponseChannelIds: [],
  botAutoResponseChannelIds: [],
  botAccessRoleIds: [],
  youtubeSubscriptions: [],
  reminderTimeZone: "America/Los_Angeles",
  aiResponsesPerHour: 30,
};

export function defaults() {
  return structuredClone(defaultSettings);
}

export async function ensureSchema(db) {
  if (!db) throw new Error("D1 binding DB is not configured.");
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS knowledge_status (guild_id TEXT PRIMARY KEY, status_json TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS openai_runtime (guild_id TEXT PRIMARY KEY, runtime_json TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS youtube_push_topics (channel_id TEXT PRIMARY KEY, requested_at INTEGER NOT NULL DEFAULT 0, lease_expires_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS youtube_push_deliveries (guild_id TEXT NOT NULL, destination_id TEXT NOT NULL, channel_id TEXT NOT NULL, video_id TEXT NOT NULL, sent_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild_id,destination_id,channel_id,video_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS guild_state (guild_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, gemini_secret_json TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT 'bootstrap')"),
    db.prepare("CREATE TABLE IF NOT EXISTS guild_installations (guild_id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, installed INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS dashboard_permissions (guild_id TEXT NOT NULL, subject_type TEXT NOT NULL CHECK(subject_type IN ('user','role')), subject_id TEXT NOT NULL, label TEXT NOT NULL, added_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, subject_type, subject_id))"),
  ]);
  const columns = await db.prepare("PRAGMA table_info(guild_state)").all();
  if (!(columns.results || []).some((column) => column.name === "openai_secret_json")) {
    try {
      await db.prepare("ALTER TABLE guild_state ADD COLUMN openai_secret_json TEXT").run();
    } catch (error) {
      if (!/duplicate column name/i.test(String(error?.message || error))) throw error;
    }
  }
}

function parse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export async function getState(db, guildId) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT guild_id, settings_json, gemini_secret_json, openai_secret_json, version, updated_at, updated_by FROM guild_state WHERE guild_id = ?").bind(guildId).first();
  if (!row) return null;
  return { guildId: row.guild_id, settings: parse(row.settings_json, defaults()), geminiSecret: parse(row.gemini_secret_json, null), openaiSecret: parse(row.openai_secret_json, null), version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

export async function createStateIfMissing(db, guildId, settings = defaults(), geminiSecret = null, updatedBy = "bootstrap") {
  await ensureSchema(db);
  const now = Date.now();
  await db.prepare("INSERT OR IGNORE INTO guild_state (guild_id, settings_json, gemini_secret_json, version, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?)").bind(guildId, JSON.stringify(settings), geminiSecret ? JSON.stringify(geminiSecret) : null, now, updatedBy).run();
  return getState(db, guildId);
}

export async function writeState(db, guildId, settings, geminiSecret, openaiSecret, updatedBy) {
  await ensureSchema(db);
  const now = Date.now();
  await db.prepare("INSERT INTO guild_state (guild_id, settings_json, gemini_secret_json, openai_secret_json, version, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET settings_json = excluded.settings_json, gemini_secret_json = excluded.gemini_secret_json, openai_secret_json = excluded.openai_secret_json, version = guild_state.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(guildId, JSON.stringify(settings), geminiSecret ? JSON.stringify(geminiSecret) : null, openaiSecret ? JSON.stringify(openaiSecret) : null, now, updatedBy).run();
  return getState(db, guildId);
}

export async function mutateState(db, guildId, updater, updatedBy = "dashboard") {
  const current = await createStateIfMissing(db, guildId);
  const next = await updater(structuredClone(current));
  return writeState(db, guildId, next.settings, next.geminiSecret, next.openaiSecret, updatedBy);
}

export async function registerInstallations(db, guilds) {
  await ensureSchema(db);
  const now = Date.now();
  if (!guilds.length) return;
  await db.batch(guilds.map((guild) => db.prepare("INSERT INTO guild_installations (guild_id, name, icon, installed, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name, icon = excluded.icon, installed = 1, updated_at = excluded.updated_at").bind(guild.id, guild.name || "Discord server", guild.icon || null, now)));
}

export async function statesForGuilds(db, guildIds) {
  await ensureSchema(db);
  const states = [];
  for (const guildId of guildIds) {
    const state = await getState(db, guildId);
    if (state) states.push(state);
  }
  return states;
}
