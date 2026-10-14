// Offline migration/verification helper. Never calls Discord or an AI provider.
// Run with the bot stopped, or against a SQLite backup (not a plain live file copy).
const fs = require("node:fs"), path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { KnowledgeBase, terms } = require("../src/knowledge");
const directory = process.argv[2];
if (!directory || !fs.existsSync(path.join(directory, "knowledge.sqlite"))) throw new Error("Usage: node scripts/rebuild-knowledge-groups.js <data-directory> [message-id]");
const before = new DatabaseSync(path.join(directory, "knowledge.sqlite"), { readOnly: true });
const roots = new Map();
for (const row of before.prepare("SELECT DISTINCT guildId,rootId FROM messages").all()) {
  if (!roots.has(row.guildId)) roots.set(row.guildId, []);
  roots.get(row.guildId).push(row.rootId);
}
const originalCount = before.prepare("SELECT count(*) AS n FROM messages").get().n;
before.close();
const started = Date.now();
const store = new KnowledgeBase({ dataDirectory: directory }, { get: (id) => ({ knowledgeChannelIds: roots.get(id) || [] }) });
try {
  for (const id of roots.keys()) store.groups.flush(id);
  const count = store.db.prepare("SELECT count(*) AS n FROM messages").get().n;
  const members = store.db.prepare("SELECT count(*) AS n FROM conversation_group_members").get().n;
  if (count !== originalCount || members !== count) throw new Error("Message count or group coverage mismatch");
  const integrity = store.db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integrity !== "ok" || store.db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("SQLite integrity check failed");
  console.log(JSON.stringify({ messages: count, groups: store.db.prepare("SELECT count(*) AS n FROM conversation_groups").get().n,
    multiMessageGroups: store.db.prepare("SELECT count(*) AS n FROM conversation_groups WHERE json_array_length(memberIds)>1").get().n,
    integrity, durationMs: Date.now() - started, peakMemoryMB: Math.round(process.resourceUsage().maxRSS / 1024) }));
  if (process.argv[3]) {
    const message = store.db.prepare("SELECT * FROM messages WHERE id=?").get(process.argv[3]);
    if (!message) throw new Error("Requested message was not found");
    const group = store.groups.forMessage(message);
    const query = terms(message.content).slice(0, 3).join(" ");
    const search = store.groups.search(query, terms(query), message.guildId, [message.channelId]);
    console.log(JSON.stringify({ inspectedGroup: group.id, memberIds: group.memberIds, query, matchingGroups: search.totalMatches,
      groupFound: search.matches.some((r) => r.message.memberIds.includes(message.id)), members: group.members.map((m) => ({ id: m.id, authorId: m.authorId, content: m.content })) }));
  }
} finally { store.close(); }
