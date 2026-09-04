const path = require("node:path");
const { readJson, writeJson } = require("./storage");

const stopWords = new Set([
  "about", "after", "again", "also", "been", "can", "does", "from",
  "have", "how", "into", "that", "the", "their", "there", "they",
  "this", "what", "when", "where", "which", "will", "with", "would",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

class KnowledgeBase {
  constructor(config, guildSettings) {
    this.guildSettings = guildSettings;
    this.filePath = path.join(config.dataDirectory, "knowledge-base.json");
    this.messages = new Map();
    this.load();
  }

  load() {
    const saved = readJson(this.filePath, { messages: [] });
    if (!Array.isArray(saved.messages)) return;
    for (const message of saved.messages) {
      if (
        message?.id &&
        message.guildId &&
        typeof message.content === "string" &&
        message.content.trim()
      ) {
        this.messages.set(message.id, message);
      }
    }
  }

  save() {
    writeJson(this.filePath, {
      version: 2,
      updatedAt: new Date().toISOString(),
      messages: [...this.messages.values()],
    });
  }

  shouldIndex(message) {
    if (!message?.guildId || message.author?.bot) return false;
    const settings = this.guildSettings.get(message.guildId);
    return settings.knowledgeChannelIds.includes(message.channelId);
  }

  upsert(message) {
    if (
      !this.shouldIndex(message) ||
      typeof message.content !== "string" ||
      !message.content.trim()
    ) {
      return false;
    }
    this.messages.set(message.id, {
      id: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      channelName: message.channel?.name || message.channelId,
      authorId: message.author?.id || null,
      content: message.content.trim(),
      createdTimestamp: message.createdTimestamp || Date.now(),
      editedTimestamp: message.editedTimestamp || null,
      url: message.url || null,
    });
    return true;
  }

  remove(message) {
    if (!message?.id || !this.messages.has(message.id)) return false;
    this.messages.delete(message.id);
    return true;
  }

  count(guildId) {
    const settings = this.guildSettings.get(guildId);
    return [...this.messages.values()].filter(
      (message) =>
        message.guildId === guildId &&
        settings.knowledgeChannelIds.includes(message.channelId),
    ).length;
  }

  search(query, guildId, limit = 5) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const settings = this.guildSettings.get(guildId);
    const results = [];
    for (const message of this.messages.values()) {
      if (
        message.guildId !== guildId ||
        !settings.knowledgeChannelIds.includes(message.channelId)
      ) {
        continue;
      }
      const messageTerms = tokenize(message.channelName + " " + message.content);
      const score = terms.reduce(
        (total, term) =>
          total + messageTerms.filter((item) => item === term).length,
        0,
      );
      if (score > 0) results.push({ message, score });
    }
    return results
      .sort(
        (left, right) =>
          right.score - left.score ||
          (right.message.createdTimestamp || 0) -
            (left.message.createdTimestamp || 0),
      )
      .slice(0, limit);
  }

  async sync(client, guildId) {
    const settings = this.guildSettings.get(guildId);
    let fetched = 0;
    for (const channelId of settings.knowledgeChannelIds) {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.messages?.fetch || channel.guildId !== guildId) continue;
      let before;
      while (true) {
        const options = { limit: 100 };
        if (before) options.before = before;
        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;
        for (const message of batch.values()) this.upsert(message);
        fetched += batch.size;
        before = batch.last().id;
        if (batch.size < 100) break;
      }
    }
    this.save();
    return {
      channels: settings.knowledgeChannelIds.length,
      fetched,
      indexed: this.count(guildId),
    };
  }
}

module.exports = { KnowledgeBase };
