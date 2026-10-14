const { createHash } = require("node:crypto");

// Deterministic, bounded conversation units. Original messages remain the evidence.
const limits = { gapMs: 120000, spanMs: 600000, messages: 8, characters: 8000 };
const pause = () => new Promise((resolve) => setImmediate(resolve));
function partition(rows) {
  const groups = [];
  let current = [];
  const finish = () => { if (current.length) groups.push(current); current = []; };
  for (const row of rows) {
    if (!row.content?.trim()) { finish(); continue; }
    const first = current[0], last = current.at(-1);
    const chars = current.reduce((n, m) => n + m.content.length + 1, 0);
    if (last && (!row.authorId || row.authorId !== last.authorId || row.rootId !== last.rootId || row.channelId !== last.channelId || row.guildId !== last.guildId ||
      row.createdTimestamp - last.createdTimestamp > limits.gapMs || row.createdTimestamp - first.createdTimestamp > limits.spanMs ||
      current.length >= limits.messages || chars + row.content.length > limits.characters ||
      (row.replyToId && row.replyToId !== first.replyToId && !current.some((m) => m.id === row.replyToId)))) finish();
    current.push(row);
  }
  finish();
  return groups;
}

class KnowledgeGroups {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_sequence(id TEXT PRIMARY KEY,guildId TEXT NOT NULL,channelId TEXT NOT NULL,rootId TEXT NOT NULL,authorId TEXT,createdTimestamp INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS knowledge_sequence_scope ON knowledge_sequence(guildId,channelId,createdTimestamp,id);
      CREATE TABLE IF NOT EXISTS knowledge_group_dirty(guildId TEXT NOT NULL,channelId TEXT NOT NULL,PRIMARY KEY(guildId,channelId));
      CREATE TABLE IF NOT EXISTS conversation_groups(id TEXT PRIMARY KEY,guildId TEXT NOT NULL,channelId TEXT NOT NULL,rootId TEXT NOT NULL,channelName TEXT NOT NULL,authorId TEXT,content TEXT NOT NULL,createdTimestamp INTEGER,lastTimestamp INTEGER,memberIds TEXT NOT NULL,fingerprint TEXT NOT NULL,vector BLOB,vectorModel TEXT);
      CREATE INDEX IF NOT EXISTS conversation_groups_scope ON conversation_groups(guildId,channelId,createdTimestamp);
      CREATE TABLE IF NOT EXISTS conversation_group_members(messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,groupId TEXT NOT NULL REFERENCES conversation_groups(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS conversation_group_members_group ON conversation_group_members(groupId);
      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(content,channelName,content='conversation_groups',content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS cg_insert AFTER INSERT ON conversation_groups BEGIN INSERT INTO conversation_search(rowid,content,channelName) VALUES(new.rowid,new.content,new.channelName); END;
      CREATE TRIGGER IF NOT EXISTS cg_delete AFTER DELETE ON conversation_groups BEGIN INSERT INTO conversation_search(conversation_search,rowid,content,channelName) VALUES('delete',old.rowid,old.content,old.channelName); END;
      CREATE TRIGGER IF NOT EXISTS cg_update AFTER UPDATE OF content,channelName ON conversation_groups BEGIN
        INSERT INTO conversation_search(conversation_search,rowid,content,channelName) VALUES('delete',old.rowid,old.content,old.channelName);
        INSERT INTO conversation_search(rowid,content,channelName) VALUES(new.rowid,new.content,new.channelName); END;
      CREATE TRIGGER IF NOT EXISTS seq_insert AFTER INSERT ON knowledge_sequence BEGIN INSERT INTO knowledge_group_dirty VALUES(new.guildId,new.channelId) ON CONFLICT DO NOTHING; END;
      CREATE TRIGGER IF NOT EXISTS seq_delete AFTER DELETE ON knowledge_sequence BEGIN INSERT INTO knowledge_group_dirty VALUES(old.guildId,old.channelId) ON CONFLICT DO NOTHING; END;
      CREATE TRIGGER IF NOT EXISTS seq_update AFTER UPDATE ON knowledge_sequence BEGIN INSERT INTO knowledge_group_dirty VALUES(new.guildId,new.channelId) ON CONFLICT DO NOTHING; END;
      CREATE TRIGGER IF NOT EXISTS msg_group_insert AFTER INSERT ON messages BEGIN
        INSERT INTO knowledge_sequence VALUES(new.id,new.guildId,new.channelId,new.rootId,new.authorId,new.createdTimestamp) ON CONFLICT(id) DO UPDATE SET authorId=excluded.authorId,rootId=excluded.rootId;
        INSERT INTO knowledge_group_dirty VALUES(new.guildId,new.channelId) ON CONFLICT DO NOTHING; END;
      CREATE TRIGGER IF NOT EXISTS msg_group_update AFTER UPDATE OF content,channelName,authorId,rootId,replyToId,editedTimestamp ON messages
      WHEN old.content IS NOT new.content OR old.channelName IS NOT new.channelName OR old.authorId IS NOT new.authorId OR old.rootId IS NOT new.rootId OR old.replyToId IS NOT new.replyToId OR old.editedTimestamp IS NOT new.editedTimestamp BEGIN
        INSERT INTO knowledge_sequence VALUES(new.id,new.guildId,new.channelId,new.rootId,new.authorId,new.createdTimestamp) ON CONFLICT(id) DO UPDATE SET authorId=excluded.authorId,rootId=excluded.rootId;
        INSERT INTO knowledge_group_dirty VALUES(new.guildId,new.channelId) ON CONFLICT DO NOTHING; END;
      CREATE TRIGGER IF NOT EXISTS msg_group_delete AFTER DELETE ON messages BEGIN
        DELETE FROM knowledge_sequence WHERE id=old.id;
        INSERT INTO knowledge_group_dirty VALUES(old.guildId,old.channelId) ON CONFLICT DO NOTHING; END;`);
    if (!store.checkpoint("conversation-groups-v1")) store.transaction(() => {
      this.db.exec("INSERT OR IGNORE INTO knowledge_sequence SELECT id,guildId,channelId,rootId,authorId,createdTimestamp FROM messages; INSERT OR IGNORE INTO knowledge_group_dirty SELECT DISTINCT guildId,channelId FROM messages");
      store.checkpoint("conversation-groups-v1", true);
    });
  }
  boundary(message) {
    if (!message?.id || !message.guildId || !message.channelId) return;
    this.db.prepare(`INSERT INTO knowledge_sequence VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET authorId=excluded.authorId,rootId=excluded.rootId
      WHERE authorId IS NOT excluded.authorId OR rootId IS NOT excluded.rootId`).run(message.id,message.guildId,message.channelId,message.channel?.isThread?.() ? message.channel.parentId : message.channelId,message.author?.id || "",message.createdTimestamp || Date.now());
  }
  flush(guildId, channels) {
    const dirty = this.db.prepare("SELECT * FROM knowledge_group_dirty WHERE guildId=?").all(guildId).filter((r) => !channels || channels.includes(r.channelId));
    for (const { channelId } of dirty) this.rebuild(guildId, channelId);
  }
  rebuild(guildId, channelId) {
    const rows = this.db.prepare(`SELECT s.id,s.authorId,s.createdTimestamp,s.rootId,m.guildId,m.channelId,m.channelName,m.content,m.replyToId,m.editedTimestamp
      FROM knowledge_sequence s LEFT JOIN messages m ON m.id=s.id WHERE s.guildId=? AND s.channelId=? ORDER BY s.createdTimestamp,length(s.id),s.id`).all(guildId,channelId);
    const previous = new Map(this.db.prepare("SELECT id,fingerprint FROM conversation_groups WHERE guildId=? AND channelId=?").all(guildId,channelId).map((r) => [r.id,r.fingerprint]));
    const groups = partition(rows);
    this.store.transaction(() => {
      const ids = new Set(groups.map((g) => g[0].id));
      for (const id of previous.keys()) if (!ids.has(id)) this.db.prepare("DELETE FROM conversation_groups WHERE id=?").run(id);
      for (const members of groups) {
        const first = members[0], content = members.map((m) => m.content).join("\n"), memberIds = JSON.stringify(members.map((m) => m.id));
        const fingerprint = createHash("sha256").update(JSON.stringify(members.map((m) => [m.id,m.content,m.authorId,m.rootId,m.channelName,m.replyToId,m.editedTimestamp]))).digest("hex");
        if (previous.get(first.id) === fingerprint) continue;
        const single = members.length === 1;
        const legacy = single ? this.db.prepare("SELECT vector,vectorModel FROM messages WHERE id=?").get(first.id) : null;
        this.db.prepare(`INSERT INTO conversation_groups VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          rootId=excluded.rootId,channelName=excluded.channelName,authorId=excluded.authorId,content=excluded.content,lastTimestamp=excluded.lastTimestamp,memberIds=excluded.memberIds,fingerprint=excluded.fingerprint,vector=excluded.vector,vectorModel=excluded.vectorModel`).run(
          first.id,guildId,channelId,first.rootId,first.channelName,first.authorId,content,first.createdTimestamp,members.at(-1).createdTimestamp,memberIds,fingerprint,legacy?.vector || null,legacy?.vectorModel || null);
        this.db.prepare("DELETE FROM conversation_group_members WHERE groupId=?").run(first.id);
        for (const m of members) this.db.prepare("INSERT INTO conversation_group_members VALUES(?,?) ON CONFLICT(messageId) DO UPDATE SET groupId=excluded.groupId").run(m.id,first.id);
      }
      this.db.prepare("DELETE FROM knowledge_group_dirty WHERE guildId=? AND channelId=?").run(guildId,channelId);
    });
  }
  hydrate(row) {
    if (!row) return null;
    const memberIds = JSON.parse(row.memberIds);
    const members = this.db.prepare("SELECT id,guildId,channelId,rootId,channelName,authorId,content,createdTimestamp,editedTimestamp,url,pinned,replyToId FROM messages WHERE id IN (SELECT value FROM json_each(?)) ORDER BY createdTimestamp,length(id),id").all(row.memberIds);
    return { ...row, vector: undefined, memberIds, members, url: members[0]?.url };
  }
  forMessage(message) {
    this.flush(message.guildId,[message.channelId]);
    return this.hydrate(this.db.prepare("SELECT g.* FROM conversation_group_members cm JOIN conversation_groups g ON g.id=cm.groupId WHERE cm.messageId=?").get(message.id));
  }
  search(query, tokens, guildId, allowedIds, { limit=48,offset=0,matchAll=true,contentOnly=true }={}) {
    if (!tokens.length || !allowedIds.length) return { query,tokens,totalMatches:0,distinctMatches:0,matches:[] };
    this.flush(guildId,allowedIds);
    const expression = `${contentOnly ? "content : " : ""}(${tokens.slice(0,12).map((t) => `"${t}"`).join(matchAll ? " AND " : " OR ")})`;
    const args = [expression,guildId,JSON.stringify(allowedIds),JSON.stringify(this.store.guildSettings.get(guildId).knowledgeChannelIds)];
    const scope = `FROM conversation_search CROSS JOIN conversation_groups g ON g.rowid=conversation_search.rowid WHERE conversation_search MATCH ? AND g.guildId=? AND g.channelId IN (SELECT value FROM json_each(?)) AND g.rootId IN (SELECT value FROM json_each(?))`;
    const totalMatches = this.db.prepare(`SELECT count(*) AS n ${scope}`).get(...args).n;
    const rows = this.db.prepare(`WITH hits AS MATERIALIZED (SELECT g.id,g.guildId,g.channelId,g.rootId,g.channelName,g.authorId,g.content,g.createdTimestamp,g.lastTimestamp,g.memberIds,g.fingerprint,bm25(conversation_search,1.0,0.08) AS rank ${scope}),
      unique_hits AS (SELECT *,row_number() OVER (PARTITION BY lower(trim(content)),lower(trim(channelName)) ORDER BY rank,id) AS duplicate FROM hits)
      SELECT *,count(*) OVER() AS distinctCount FROM unique_hits WHERE duplicate=1 ORDER BY rank,id LIMIT ? OFFSET ?`).all(...args,limit,offset);
    const distinctMatches = rows[0]?.distinctCount ?? (totalMatches ? this.db.prepare(`SELECT count(*) AS n FROM (SELECT 1 ${scope} GROUP BY lower(trim(g.content)),lower(trim(g.channelName)))`).get(...args).n : 0);
    return { query,tokens,matchAll,contentOnly,offset,totalMatches,distinctMatches,unit:"conversation_group",matches:rows.map((r) => ({ message:this.hydrate(r),score:-r.rank })) };
  }
  pending(guildId,model,limit,rootIds) {
    this.flush(guildId);
    return this.db.prepare("SELECT * FROM conversation_groups WHERE guildId=? AND rootId IN (SELECT value FROM json_each(?)) AND (vector IS NULL OR vectorModel IS NOT ?) ORDER BY createdTimestamp DESC LIMIT ?").all(guildId,JSON.stringify(rootIds),model,limit).map((r) => this.hydrate(r));
  }
  putVector(group,model,vector) {
    this.flush(group.guildId,[group.channelId]);
    this.db.prepare("UPDATE conversation_groups SET vector=?,vectorModel=? WHERE id=? AND fingerprint=?").run(Buffer.from(new Float32Array(vector).buffer),model,group.id,group.fingerprint);
  }
  embedded(guildId,model) { return this.db.prepare("SELECT coalesce(sum(json_array_length(memberIds)),0) AS n FROM conversation_groups WHERE guildId=? AND vectorModel=?").get(guildId,model).n; }
  async semantic(vector,model,guildId,allowedIds,limit=48) {
    if (!allowedIds.length) return [];
    this.flush(guildId,allowedIds);
    const best=[];
    let count=0;
    // Materialize IDs, not an open iterator, before yielding to other SQLite work.
    const ids=this.db.prepare("SELECT id FROM conversation_groups WHERE guildId=? AND vectorModel=? AND channelId IN (SELECT value FROM json_each(?)) AND rootId IN (SELECT value FROM json_each(?))").all(guildId,model,JSON.stringify(allowedIds),JSON.stringify(this.store.guildSettings.get(guildId).knowledgeChannelIds));
    for (const {id} of ids) {
      const row=this.db.prepare("SELECT * FROM conversation_groups WHERE id=? AND vectorModel=?").get(id,model);
      if (!row?.vector) continue;
      const v=new Float32Array(Uint8Array.from(row.vector).buffer);
      if (v.length!==vector.length) continue;
      let score=0; for(let i=0;i<v.length;i++) score+=v[i]*vector[i];
      if(score>0.2){best.push({message:row,score});best.sort((a,b)=>b.score-a.score);best.length=Math.min(best.length,limit);}
      if(++count%500===0) await pause();
    }
    return best.map(({message,score})=>({message:this.hydrate(message),score}));
  }
}
module.exports={KnowledgeGroups,partition,limits};
