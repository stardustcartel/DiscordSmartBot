const { canRead } = require("./knowledge-permissions");
const { embed, modelFor } = require("./knowledge-embeddings");

class KnowledgeIndexer {
  constructor(store, guildSettings, guildSecrets) {
    this.store = store;
    this.settings = guildSettings;
    this.secrets = guildSecrets;
    this.running = false;
    this.statuses = {};
    this.cooldowns = new Map();
    this.locks = new Map();
  }
  credentials(guildId) {
    const settings = this.settings.get(guildId);
    const provider = settings.aiProvider === "openai" ? "openai" : "gemini";
    return { provider, apiKey: provider === "openai" ? this.secrets.getOpenAiKey(guildId) : this.secrets.getGeminiKey(guildId), model: settings.openAiModel };
  }
  remember(channel, rootId) {
    const key = `channel:${channel.id}`;
    if (!this.store.checkpoint(key)) this.store.checkpoint(key, { guildId: channel.guildId, rootId, id: channel.id, before: null, latest: null, complete: false, checkedAt: 0 });
  }
  async scan(channel, recentOnly = false) {
    if (!channel?.messages || channel.type === 12 || !canRead(channel, channel.guild.members.me)) return;
    if (this.locks.has(channel.id)) return this.locks.get(channel.id);
    const work = this.scanUnlocked(channel, recentOnly);
    this.locks.set(channel.id, work);
    try { return await work; } finally { this.locks.delete(channel.id); }
  }
  async scanUnlocked(channel, recentOnly) {
    const key = `channel:${channel.id}`;
    const rootId = channel.isThread() ? channel.parentId : channel.id;
    this.remember(channel, rootId);
    const state = this.store.checkpoint(key);
    const consume = (batch) => {
      if (!this.settings.get(channel.guildId).knowledgeChannelIds.includes(rootId)) return false;
      this.store.transaction(() => { for (const message of batch.values()) this.store.upsert(message); });
      return true;
    };
    const latest = await channel.messages.fetch({ limit: 100, cache: false });
    if (!consume(latest)) return;
    const ids = [...latest.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    if (!state.latest) { state.latest = ids.at(-1) || null; state.before = ids[0] || null; state.complete = ids.length < 100; state.caughtUp = true; }
    else {
      // Walk forward from the last checkpoint, so busy/offline periods cannot skip messages.
      const batch = await channel.messages.fetch({ limit: 100, after: state.latest, cache: false });
      if (!consume(batch)) return;
      const next = [...batch.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      if (next.length) state.latest = next.at(-1);
      state.caughtUp = !ids.length || !state.latest || BigInt(state.latest) >= BigInt(ids.at(-1));
    }
    if (!recentOnly && !state.complete && state.before) {
      const batch = await channel.messages.fetch({ limit: 100, before: state.before, cache: false });
      if (!consume(batch)) return;
      const older = [...batch.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      state.before = older[0] || state.before;
      state.complete = batch.size < 100;
    }
    state.checkedAt = Date.now();
    this.store.checkpoint(key, state);
  }
  async discover(guild, roots) {
    const active = await guild.channels.fetchActiveThreads();
    for (const thread of active.threads.values()) if (roots.includes(thread.parentId) && thread.type !== 12) this.remember(thread, thread.parentId);
    const warnings = [];
    for (const rootId of roots) {
      try {
        const root = await guild.channels.fetch(rootId);
        if (!root || ![0, 5, 15].includes(root.type) || !canRead(root, guild.members.me)) { warnings.push(`Cannot read channel ${rootId}. Check View Channel and Read Message History.`); continue; }
        if (root.messages) this.remember(root, root.id);
        const key = `archive:${rootId}`;
        const state = this.store.checkpoint(key) || { guildId: guild.id, rootId, before: null, complete: false };
        if (state.complete && Date.now() - state.checkedAt < 300000) continue;
        const page = await root.threads.fetchArchived({ type: "public", limit: 100, ...(state.before && !state.complete ? { before: new Date(state.before) } : {}) });
        for (const thread of page.threads.values()) this.remember(thread, rootId);
        const dates = [...page.threads.values()].map((t) => t.archiveTimestamp).filter(Boolean);
        state.before = dates.length ? Math.min(...dates) : null;
        state.complete = !page.hasMore;
        state.checkedAt = Date.now();
        this.store.checkpoint(key, state);
      } catch { warnings.push(`Could not scan channel ${rootId}; check bot permissions.`); }
    }
    return warnings;
  }
  async tick(client) {
    if (this.running) return;
    this.running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        const roots = this.settings.get(guild.id).knowledgeChannelIds;
        this.store.prune(guild.id);
        const status = { channelIds: roots, indexed: this.store.count(guild.id), embedded: 0, pendingChannels: 0, state: roots.length ? "indexing" : "disabled", updatedAt: Date.now(), warnings: [] };
        this.statuses[guild.id] = status;
        if (!roots.length) continue;
        try {
          status.warnings = await this.discover(guild, roots);
          const channels = this.store.db.prepare("SELECT value FROM checkpoints WHERE key LIKE 'channel:%'").all().map((r) => JSON.parse(r.value)).filter((r) => r.guildId === guild.id && roots.includes(r.rootId));
          const ordered = channels.sort((a, b) => a.checkedAt - b.checkedAt);
          for (const entry of ordered.slice(0, 8)) {
            try { await this.scan(await guild.channels.fetch(entry.id)); }
            catch (error) {
              if ([10003, 10008].includes(Number(error.code))) this.store.removeChannel(entry.id);
              else status.warnings.push(`Could not read posts in channel ${entry.id}.`);
              const saved = this.store.checkpoint(`channel:${entry.id}`);
              if (saved) this.store.checkpoint(`channel:${entry.id}`, { ...saved, checkedAt: Date.now() });
            }
          }
          const credentials = this.credentials(guild.id);
          const model = modelFor(credentials.provider);
          if (credentials.apiKey && Date.now() >= (this.cooldowns.get(guild.id) || 0)) {
            const readableRoots = roots.filter((id) => canRead(guild.channels.cache.get(id), guild.members.me));
            const candidates = this.store.pendingVectors(guild.id, model, 32, readableRoots);
            const batch = [];
            for (const saved of candidates) {
              try {
                const channel = await guild.channels.fetch(saved.channelId, { force: true });
                if (!canRead(channel, guild.members.me)) continue;
                const message = await channel.messages.fetch({ message: saved.id, cache: false, force: true });
                this.store.upsert(message);
                if (this.store.shouldIndex(message) && message.content?.trim()) batch.push({ ...saved, content: message.content.trim(), channelName: channel.name });
              } catch (error) { if ([10003, 10008].includes(Number(error.code))) this.store.remove(saved); }
            }
            if (batch.length) {
              try {
                const vectors = await embed({ ...credentials, texts: batch.map((m) => m.channelName + "\n" + m.content) });
                batch.forEach((m, i) => this.store.putVector(m, model, vectors[i]));
              } catch (error) { this.cooldowns.set(guild.id, Date.now() + 300000); status.warnings.push(error.message); }
            }
          } else if (!credentials.apiKey) status.warnings.push("Add a key for the selected AI provider to enable semantic search.");
          else status.warnings.push("Semantic indexing is cooling down after an API error; keyword search is available.");
          status.indexed = this.store.count(guild.id);
          status.embedded = this.store.db.prepare("SELECT count(*) AS n FROM messages WHERE guildId=? AND vectorModel=?").get(guild.id, model).n;
          status.pendingChannels = channels.filter((c) => { const saved = this.store.checkpoint(`channel:${c.id}`); return saved && (!saved.complete || saved.caughtUp === false); }).length;
          const archivePending = roots.some((id) => !this.store.checkpoint(`archive:${id}`)?.complete);
          status.state = status.pendingChannels || archivePending || status.embedded < status.indexed ? "indexing" : status.warnings.length ? "partial" : "ready";
        } catch { status.state = "retrying"; status.warnings.push("Discord indexing could not finish. Retrying automatically."); }
        status.updatedAt = Date.now();
        status.warnings = [...new Set(status.warnings)].slice(0, 5);
      }
    } finally { this.running = false; }
  }
  start(client) {
    this.tick(client).catch((error) => console.warn("Knowledge indexing:", error.message));
    this.timer = setInterval(() => this.tick(client).catch((error) => console.warn("Knowledge indexing:", error.message)), 30000);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }
}
module.exports = { KnowledgeIndexer };
