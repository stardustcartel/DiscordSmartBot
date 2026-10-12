const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { readJson } = require("./storage");

const stopWords = new Set("the and this that what when where which who how are was were have has had can could would should will with from about please help tell does did for you your our their there they into also some any its not but an my or it to is as of in on at be am me do im ive".split(" "));
const terms = (text) => [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])].filter((t) => !stopWords.has(t)).slice(0, 40);
const pause = () => new Promise((resolve) => setImmediate(resolve));

class KnowledgeBase {
  constructor(config, guildSettings) {
    this.guildSettings = guildSettings;
    fs.mkdirSync(config.dataDirectory, { recursive: true });
    this.db = new DatabaseSync(path.join(config.dataDirectory, "knowledge.sqlite"));
    fs.chmodSync(path.join(config.dataDirectory, "knowledge.sqlite"), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, guildId TEXT NOT NULL, channelId TEXT NOT NULL, rootId TEXT NOT NULL,
        channelName TEXT NOT NULL, authorId TEXT, content TEXT NOT NULL,
        createdTimestamp INTEGER, editedTimestamp INTEGER, url TEXT NOT NULL, pinned INTEGER DEFAULT 0,
        vector BLOB, vectorModel TEXT);
      CREATE INDEX IF NOT EXISTS messages_scope ON messages(guildId, channelId, createdTimestamp);
      CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(content, channelName, content='messages', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO message_search(rowid,content,channelName) VALUES(new.rowid,new.content,new.channelName); END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO message_search(message_search,rowid,content,channelName) VALUES('delete',old.rowid,old.content,old.channelName); END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content,channelName ON messages BEGIN
        INSERT INTO message_search(message_search,rowid,content,channelName) VALUES('delete',old.rowid,old.content,old.channelName);
        INSERT INTO message_search(rowid,content,channelName) VALUES(new.rowid,new.content,new.channelName); END;
      CREATE TABLE IF NOT EXISTS checkpoints (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    if (!this.db.prepare("PRAGMA table_info(messages)").all().some((column) => column.name === "replyToId")) this.db.exec("ALTER TABLE messages ADD COLUMN replyToId TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS messages_reply ON messages(guildId,channelId,replyToId)");
    // Keep the old JSON intact as a recovery copy; import only once.
    if (!this.checkpoint("migration-v1")) {
      this.transaction(() => {
        for (const message of readJson(path.join(config.dataDirectory, "knowledge-base.json"), { messages: [] }).messages || []) {
          if (message.id && message.guildId && message.channelId && typeof message.content === "string" && message.content.trim()) this.store({ ...message, rootId: message.channelId });
        }
        this.checkpoint("migration-v1", true);
      });
    }
  }

  transaction(work) {
    this.db.exec("BEGIN");
    try { work(); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  checkpoint(key, value) {
    if (value !== undefined) this.db.prepare("INSERT INTO checkpoints VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
    const row = this.db.prepare("SELECT value FROM checkpoints WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : null;
  }
  save() { /* SQLite commits atomically; compatibility with existing slash commands. */ }
  close() { this.db.close(); }
  shouldIndex(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system || message.channel?.type === 12) return false;
    const ids = this.guildSettings.get(message.guildId).knowledgeChannelIds;
    return ids.includes(message.channelId) || ids.includes(message.channel?.parentId);
  }
  store(message) {
    this.db.prepare(`INSERT INTO messages(id,guildId,channelId,rootId,channelName,authorId,content,createdTimestamp,editedTimestamp,url,pinned,replyToId)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      rootId=excluded.rootId, channelName=excluded.channelName, authorId=excluded.authorId,
      vector=CASE WHEN messages.content=excluded.content AND messages.channelName=excluded.channelName THEN messages.vector ELSE NULL END,
      vectorModel=CASE WHEN messages.content=excluded.content AND messages.channelName=excluded.channelName THEN messages.vectorModel ELSE NULL END,
      content=excluded.content, editedTimestamp=excluded.editedTimestamp, pinned=excluded.pinned, replyToId=excluded.replyToId`).run(
      message.id, message.guildId, message.channelId, message.rootId, message.channelName || message.channelId,
      message.authorId || "", message.content, message.createdTimestamp || Date.now(), message.editedTimestamp || null,
      `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`, message.pinned ? 1 : 0, message.replyToId || null);
  }
  upsert(message) {
    if (message.partial) return false;
    if (!this.shouldIndex(message) || !message.content?.trim()) return this.remove(message);
    this.store({ id: message.id, guildId: message.guildId, channelId: message.channelId,
      rootId: message.channel?.isThread?.() ? message.channel.parentId : message.channelId,
      channelName: message.channel?.name, authorId: message.author?.id, content: message.content.trim(),
      createdTimestamp: message.createdTimestamp, editedTimestamp: message.editedTimestamp, pinned: message.pinned, replyToId: message.reference?.messageId || null });
    return true;
  }
  remove(message) { return Boolean(message?.id && this.db.prepare("DELETE FROM messages WHERE id=?").run(message.id).changes); }
  removeChannel(id) {
    this.db.prepare("DELETE FROM messages WHERE channelId=? OR rootId=?").run(id, id);
    this.db.prepare("DELETE FROM checkpoints WHERE key=?").run(`channel:${id}`);
    for (const row of this.db.prepare("SELECT key,value FROM checkpoints WHERE key LIKE 'channel:%' OR key LIKE 'archive:%'").all()) {
      if (JSON.parse(row.value).rootId === id) this.db.prepare("DELETE FROM checkpoints WHERE key=?").run(row.key);
    }
  }
  prune(guildId) {
    const ids = this.guildSettings.get(guildId).knowledgeChannelIds;
    this.db.prepare("DELETE FROM messages WHERE guildId=? AND rootId NOT IN (SELECT value FROM json_each(?))").run(guildId, JSON.stringify(ids));
    for (const row of this.db.prepare("SELECT key,value FROM checkpoints WHERE key LIKE 'channel:%' OR key LIKE 'archive:%'").all()) {
      const value = JSON.parse(row.value);
      if (value.guildId === guildId && !ids.includes(value.rootId)) this.db.prepare("DELETE FROM checkpoints WHERE key=?").run(row.key);
    }
  }
  count(guildId) { return this.db.prepare("SELECT count(*) AS n FROM messages WHERE guildId=? AND rootId IN (SELECT value FROM json_each(?))").get(guildId, JSON.stringify(this.guildSettings.get(guildId).knowledgeChannelIds)).n; }
  channelIds(guildId) { return this.db.prepare("SELECT DISTINCT channelId FROM messages WHERE guildId=? AND rootId IN (SELECT value FROM json_each(?))").all(guildId, JSON.stringify(this.guildSettings.get(guildId).knowledgeChannelIds)).map((r) => r.channelId); }
  search(query, guildId, limit = 20, allowedIds = []) {
    const tokens = terms(query);
    if (!tokens.length || !allowedIds.length) return [];
    return this.db.prepare(`SELECT m.*, bm25(message_search) AS rank FROM message_search CROSS JOIN messages m ON m.rowid=message_search.rowid
      WHERE message_search MATCH ? AND m.guildId=? AND m.channelId IN (SELECT value FROM json_each(?))
      AND m.rootId IN (SELECT value FROM json_each(?)) ORDER BY rank LIMIT ?`).all(
      tokens.map((t) => `"${t}"`).join(" OR "), guildId, JSON.stringify(allowedIds), JSON.stringify(this.guildSettings.get(guildId).knowledgeChannelIds), limit
    ).map((message) => ({ message, score: -message.rank }));
  }
  pendingVectors(guildId, model, limit = 32, rootIds = this.guildSettings.get(guildId).knowledgeChannelIds) {
    return this.db.prepare("SELECT * FROM messages WHERE guildId=? AND rootId IN (SELECT value FROM json_each(?)) AND (vector IS NULL OR vectorModel IS NOT ?) ORDER BY createdTimestamp DESC LIMIT ?").all(guildId, JSON.stringify(rootIds), model, limit);
  }
  searchDetailed(query, guildId, allowedIds, { limit = 48, offset = 0, matchAll = true, contentOnly = true } = {}) {
    const tokens = terms(query).slice(0, 12);
    if (!tokens.length || !allowedIds.length) return { query, tokens, totalMatches: 0, distinctMatches: 0, matches: [] };
    const expression = `${contentOnly ? "content : " : ""}(${tokens.map((t) => `"${t}"`).join(matchAll ? " AND " : " OR ")})`;
    const args = [expression, guildId, JSON.stringify(allowedIds), JSON.stringify(this.guildSettings.get(guildId).knowledgeChannelIds)];
    // Keep FTS as the driving table; letting SQLite drive this join from the guild
    // index can repeat a whole FTS scan once per archived message.
    const scope = `FROM message_search CROSS JOIN messages m ON m.rowid=message_search.rowid WHERE message_search MATCH ? AND m.guildId=?
      AND m.channelId IN (SELECT value FROM json_each(?)) AND m.rootId IN (SELECT value FROM json_each(?))`;
    const totalMatches = this.db.prepare(`SELECT count(*) AS n ${scope}`).get(...args).n;
    const rows = this.db.prepare(`WITH hits AS MATERIALIZED (SELECT m.id,m.guildId,m.channelId,m.rootId,m.channelName,m.authorId,m.content,
      m.createdTimestamp,m.editedTimestamp,m.url,m.pinned,m.replyToId,bm25(message_search,1.0,0.08) AS rank ${scope}),
      unique_hits AS (SELECT *, row_number() OVER (PARTITION BY lower(trim(content)),lower(trim(channelName)) ORDER BY rank,id) AS duplicate FROM hits)
      SELECT *, count(*) OVER () AS distinctCount FROM unique_hits WHERE duplicate=1 ORDER BY rank,id LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const distinctMatches = rows[0]?.distinctCount ?? (totalMatches ? this.db.prepare(`SELECT count(*) AS n FROM (SELECT 1 ${scope} GROUP BY lower(trim(m.content)),lower(trim(m.channelName)))`).get(...args).n : 0);
    return { query, tokens, matchAll, contentOnly, offset, totalMatches, distinctMatches, matches: rows.map((message) => ({ message, score: -message.rank })) };
  }
  putVector(message, model, vector) {
    const data = Buffer.from(new Float32Array(vector).buffer);
    this.db.prepare("UPDATE messages SET vector=?,vectorModel=? WHERE id=? AND content=? AND channelName=?").run(data, model, message.id, message.content, message.channelName);
  }
  async semantic(vector, model, guildId, allowedIds, limit = 20) {
    if (!allowedIds.length) return [];
    const best = [];
    let count = 0;
    for (const message of this.db.prepare("SELECT * FROM messages WHERE guildId=? AND vectorModel=? AND channelId IN (SELECT value FROM json_each(?)) AND rootId IN (SELECT value FROM json_each(?))").iterate(guildId, model, JSON.stringify(allowedIds), JSON.stringify(this.guildSettings.get(guildId).knowledgeChannelIds))) {
      const v = new Float32Array(Uint8Array.from(message.vector).buffer);
      let score = 0;
      if (v.length !== vector.length) continue;
      for (let i = 0; i < v.length; i++) score += vector[i] * v[i];
      if (score > 0.2) { best.push({ message, score }); best.sort((a, b) => b.score - a.score); best.length = Math.min(best.length, limit); }
      if (++count % 500 === 0) await pause();
    }
    return best;
  }
  neighbors(message) {
    const nearby = this.db.prepare(`SELECT * FROM messages WHERE guildId=? AND channelId=? AND createdTimestamp BETWEEN ? AND ?
      ORDER BY abs(createdTimestamp-?) LIMIT 7`).all(message.guildId, message.channelId, message.createdTimestamp - 86400000, message.createdTimestamp + 86400000, message.createdTimestamp);
    const replies = this.db.prepare("SELECT * FROM messages WHERE guildId=? AND channelId=? AND (id=? OR replyToId=?) ORDER BY createdTimestamp LIMIT 8").all(message.guildId, message.channelId, message.replyToId || "", message.id);
    return [...new Map([...replies, ...nearby].map((m) => [m.id, m])).values()].slice(0, 10);
  }
}
module.exports = { KnowledgeBase, terms };
