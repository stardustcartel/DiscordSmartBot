// Context is collected before relevance review. No punctuation or grammar gate.
const limits = { adjacent: 4, gapMs: 5 * 60000, spanMs: 20 * 60000, replies: 12, messages: 24 };
function conversationContext(store, group) {
  const members = group.members || [group], found = new Map(), edges = [];
  const add = (message, relation, from) => {
    if (!message || members.some(m => m.id === message.id)) return;
    if (!found.has(message.id) && found.size >= limits.messages) return;
    found.set(message.id, message);
    if (!edges.some(e => e.from === from && e.to === message.id && e.relation === relation)) edges.push({ from, to: message.id, relation });
  };
  for (const member of members) {
    if (member.replyToId) add(store.db.prepare('SELECT * FROM messages WHERE guildId=? AND channelId=? AND id=?').get(member.guildId,member.channelId,member.replyToId), 'reply_parent', member.id);
    for (const reply of store.db.prepare('SELECT * FROM messages WHERE guildId=? AND channelId=? AND replyToId=? ORDER BY createdTimestamp,id LIMIT ?').all(member.guildId,member.channelId,member.id,limits.replies)) add(reply,'direct_reply',member.id);
  }
  for (const [boundary, direction] of [[members[0],-1],[members.at(-1),1]]) {
    const op = direction < 0 ? '<' : '>', order = direction < 0 ? 'DESC' : 'ASC';
    const rows = store.db.prepare(`SELECT s.id,s.createdTimestamp,m.content,m.guildId,m.channelId,m.rootId,m.authorId,m.replyToId,m.channelName,m.url FROM knowledge_sequence s LEFT JOIN messages m ON m.id=s.id WHERE s.guildId=? AND s.channelId=? AND (s.createdTimestamp ${op} ? OR (s.createdTimestamp=? AND s.id ${op} ?)) ORDER BY s.createdTimestamp ${order},s.id ${order} LIMIT ?`).all(group.guildId,group.channelId,boundary.createdTimestamp,boundary.createdTimestamp,boundary.id,limits.adjacent);
    let last = boundary;
    for (const row of rows) {
      if (!row.content || Math.abs(row.createdTimestamp-last.createdTimestamp)>limits.gapMs || Math.abs(row.createdTimestamp-boundary.createdTimestamp)>limits.spanMs) break;
      add(row, 'nearby_context', boundary.id); last = row;
    }
  }
  // Preserve an explicit parent of a nearby short answer as well.
  for (const message of [...found.values()]) if (message.replyToId) add(store.db.prepare('SELECT * FROM messages WHERE guildId=? AND channelId=? AND id=?').get(message.guildId,message.channelId,message.replyToId),'reply_parent',message.id);
  return { messages: [...found.values()], edges };
}
module.exports = { conversationContext, conversationLimits: limits };
