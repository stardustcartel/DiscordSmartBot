const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { canRead, audienceDecision, loadAudienceMembers } = require("./knowledge-permissions");
const { searchKnowledge } = require("./knowledge-search");
const { normalizePolicy, inspectEvidenceReview, evidenceReviewFormat, reviewInstructions } = require("./knowledge-policy");

function mergeRankings(lists) {
  const merged = new Map();
  for (const list of lists) list.forEach(({ message }, rank) => {
    const value = merged.get(message.id) || { message, score: 0 };
    value.score += 1 / (60 + rank);
    merged.set(message.id, value);
  });
  return [...merged.values()].sort((a, b) => b.score - a.score);
}
function cite(answer, sources) {
  // Source URLs come from Discord IDs in our database, never from generated output.
  return String(answer).replace(/https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/[^\s)>]+/gi, "[source link omitted]")
    .replace(/\[S(\d+)\]/g, (_, n) => sources[Number(n) - 1] ? `[source ${n}](${sources[Number(n) - 1].url})` : "");
}
class KnowledgeRetrieval {
  constructor(store, indexer, ai, dataDirectory = null) { this.store = store; this.indexer = indexer; this.ai = ai; this.questions = new Map(); this.traceDirectory = dataDirectory && path.join(dataDirectory, "knowledge-search"); }
  writeTrace(guildId, trace) {
    if (!this.traceDirectory || !/^\d{15,25}$/.test(String(guildId))) return;
    try {
      const directory = path.join(this.traceDirectory, String(guildId));
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
      const history = path.join(directory, "history.jsonl");
      fs.appendFileSync(history, JSON.stringify(trace) + "\n", { mode: 0o600 });
      fs.chmodSync(history, 0o600);
    } catch (error) {
      // Observability must never prevent a user from receiving an answer.
      console.warn("Knowledge search trace could not be saved:", JSON.stringify({ guildId, code: error.code || "unknown" }));
    }
  }
  async access(client, guildId, channelId, userId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error("Server is not available.");
    await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
    const [member, bot, destination] = await Promise.all([
      guild.members.fetch({ user: userId, force: true }), guild.members.fetchMe({ force: true }),
      guild.channels.fetch(channelId, { force: true }),
    ]);
    if (!canRead(destination, member) || !canRead(destination, bot)) throw new Error("Cannot verify access to this conversation.");
    const roots = this.store.guildSettings.get(guildId).knowledgeChannelIds;
    const verifiedMembers = await loadAudienceMembers(guild, [destination, ...roots.map((id) => guild.channels.cache.get(id))]);
    const decisions = new Map();
    const safeRoots = new Set(roots.filter((id) => {
      const source = guild.channels.cache.get(id);
      const decision = !canRead(source, member) ? { allowed: false, reason: "requester_cannot_read_source" }
        : !canRead(source, bot) ? { allowed: false, reason: "bot_cannot_read_source" } : audienceDecision(source, destination, verifiedMembers);
      decisions.set(id, decision);
      return decision.allowed;
    }));
    const allowedIds = this.store.db.prepare("SELECT DISTINCT channelId,rootId FROM messages WHERE guildId=?").all(guildId).filter((row) => safeRoots.has(row.rootId)).map((row) => row.channelId);
    return { guild, member, bot, destination, safeRoots, allowedIds, decisions, verifiedMembers };
  }
  async validate(client, access, messages, { refreshMessages = true } = {}) {
    const channels = new Map();
    const selected = this.store.guildSettings.get(access.guild.id).knowledgeChannelIds;
    const valid = [];
    const check = async (stored) => {
      if (!selected.includes(stored.rootId)) return null;
      try {
        if (!channels.has(stored.channelId)) channels.set(stored.channelId, access.guild.channels.fetch(stored.channelId, { force: true }));
        const channel = await channels.get(stored.channelId);
        if (!canRead(channel, access.member) || !canRead(channel, access.bot) || !audienceDecision(channel, access.destination, access.verifiedMembers).allowed) return null;
        if (!refreshMessages) return { ...stored, channelName: channel.name };
        const live = await channel.messages.fetch({ message: stored.id, cache: false, force: true });
        if (!this.store.shouldIndex(live) || !live.content?.trim()) { this.store.remove(stored); return null; }
        this.store.upsert(live);
        return { ...stored, content: live.content, channelName: channel.name, editedTimestamp: live.editedTimestamp, pinned: live.pinned, replyToId: live.reference?.messageId || null };
      } catch (error) { if ([10008, 10003].includes(Number(error.code))) this.store.remove(stored); return null; }
    };
    for (let i = 0; i < messages.length; i += 6) {
      valid.push(...(await Promise.all(messages.slice(i, i + 6).map(check))).filter(Boolean));
    }
    return valid;
  }
  async prepare({ client, guildId, channelId, userId, text, messageId }) {
    const started = Date.now();
    const trace = { id: randomUUID(), at: new Date().toISOString(), guildId, channelId, userId,
      requestMessageId: messageId || null, question: text, status: "started" };
    try {
    const access = await this.access(client, guildId, channelId, userId);
    const rootId = access.destination.isThread() ? access.destination.parentId : channelId;
    const selected = this.store.guildSettings.get(guildId).knowledgeChannelIds;
    trace.scope = {
      destination: { id: channelId, name: access.destination.name, rootId },
      selectedRoots: selected.map((id) => ({ id, name: access.guild.channels.cache.get(id)?.name || null, readableHere: access.safeRoots.has(id), ...access.decisions.get(id) })),
      refreshedChannels: [],
    };
    if (access.safeRoots.has(rootId)) {
      try { await this.indexer.scan(access.destination, true); trace.scope.refreshedChannels.push({ id: channelId, name: access.destination.name, status: "ok" }); }
      catch (error) { trace.scope.refreshedChannels.push({ id: channelId, name: access.destination.name, status: "failed", reason: error.code || error.name }); }
    }
    // Refresh recent content in selected readable roots, bounded so a large server does not stall replies.
    const refresh = [...access.safeRoots].slice(0, 4).map((id) => access.guild.channels.cache.get(id)).filter((c) => c?.messages && c.id !== channelId);
    await Promise.all(refresh.map(async (c) => {
      try { await this.indexer.scan(c, true); trace.scope.refreshedChannels.push({ id: c.id, name: c.name, status: "ok" }); }
      catch (error) { trace.scope.refreshedChannels.push({ id: c.id, name: c.name, status: "failed", reason: error.code || error.name }); }
    }));
    const refreshed = await this.access(client, guildId, channelId, userId);
    trace.scope.searchedChannels = [...new Set(refreshed.allowedIds)].map((id) => ({ id, name: refreshed.guild.channels.cache.get(id)?.name || this.store.db.prepare("SELECT channelName FROM messages WHERE guildId=? AND channelId=? LIMIT 1").get(guildId, id)?.channelName || null }));
    const key = `${guildId}:${channelId}:${userId}`;
    const previous = this.questions.get(key);
    const recentQuestions = previous && Date.now() - previous.at < 900000 ? previous.texts : [];
    this.questions.set(key, { at: Date.now(), texts: [...recentQuestions, text.slice(0, 2000)].slice(-3) });
    if (this.questions.size > 1000) this.questions.delete(this.questions.keys().next().value);
    const sources = await searchKnowledge({ retrieval: this, client, access: refreshed, guildId, text, messageId, recentQuestions, trace });
    trace.validatedMessageIds = sources.map((source) => source.id);
    let remaining = 48000;
    const records = [];
    for (const source of sources) {
      if (remaining <= 0) break;
      const content = source.content.slice(0, Math.min(4000, remaining));
      remaining -= content.length;
      records.push({ id: `S${records.length + 1}`, channel: source.channelName, authorId: source.authorId,
        postedAt: new Date(source.createdTimestamp).toISOString(), editedAt: source.editedTimestamp ? new Date(source.editedTimestamp).toISOString() : null, pinned: Boolean(source.pinned), content });
    }
    const context = JSON.stringify({ forumTitle: access.destination.name, recentQuestions, searchOutcome: trace.searchOutcome, coverage: "Only selected channels permitted for this conversation were searched. Retrieval is bounded, not exhaustive; indexing may still be in progress. Attachments and linked pages are not transcribed. Lack of selected evidence does not establish that no relevant server discussions exist. Explain the limits of these supplied excerpts rather than claiming the server has no information.", sources: records });
    trace.sentToAnswerModel = { sourceMessageIds: sources.slice(0, records.length).map((source) => source.id), context };
    trace.status = "complete";
    return { question: text, forumTitle: access.destination.name, recentQuestions, records, context, sources: sources.slice(0, records.length), access: refreshed, searchOutcome: trace.searchOutcome };
    } catch (error) {
      trace.status = "failed";
      trace.reason = error.code || error.name;
      throw error;
    } finally {
      trace.durationMs = Date.now() - started;
      this.writeTrace(guildId, trace);
    }
  }
  async finish({ client, guildId, channelId, userId, answer, prepared, policy = normalizePolicy() }) {
    const access = await this.access(client, guildId, channelId, userId);
    const valid = await this.validate(client, access, prepared.sources);
    if (valid.length !== prepared.sources.length || valid.some((m, i) => m.content !== prepared.sources[i].content)) return "The source messages or their permissions changed while I was answering. Please ask again so I can use the current information.";
    // A separate evidence review reduces unsupported leaps; code checks citations and exact quotes.
    // Fail closed on review failure, rather than publishing an unverified draft.
    let checked, previousReview, validationFailure;
    const settings = this.store.guildSettings.get(guildId);
    const credentials = this.indexer.credentials(guildId);
    // Repair a format/validation failure once. Never return an unchecked draft or
    // confuse a broken review with an archive that has no relevant information.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.ai.generate({ ...credentials,
          openAiSpeed: settings.openAiSpeed, openAiReasoning: settings.openAiReasoning, scopeId: guildId,
          textFormat: evidenceReviewFormat,
          instructions: reviewInstructions(policy, settings.personality) + (validationFailure ? `\nThe previous review failed code validation: ${validationFailure}. Re-evaluate and return a compliant corrected answer. Do not weaken evidence rules to pass validation. supported must evaluate the corrected answer, not the user's premise.` : ""),
          conversation: [{ role: "user", text: JSON.stringify({ question: prepared.question, forumTitle: prepared.forumTitle, recentQuestions: prepared.recentQuestions, sources: prepared.records, draft: answer, previousReview }) }],
          maxOutputTokens: attempt === 1 ? 2400 : 4800,
        });
        previousReview = JSON.parse(result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
        const inspected = inspectEvidenceReview(previousReview, prepared.records, policy);
        checked = inspected.answer;
        validationFailure = inspected.reason;
        if (checked) break;
      } catch (error) {
        validationFailure = error instanceof SyntaxError ? "invalid_review_json" : error.code === "AI_OUTPUT_INCOMPLETE" ? "incomplete_review" : "review_provider_error";
      }
      // Metadata only: no API keys, source content, personality, or drafts in logs.
      console.warn("Knowledge evidence review rejected:", JSON.stringify({ guildId, channelId, userId, provider: credentials.provider, model: credentials.model, attempt, reason: validationFailure, kind: ["grounded", "general", "abstain", "social"].includes(previousReview?.kind) ? previousReview.kind : "invalid", sourceCount: prepared.records.length }));
      if (validationFailure === "review_provider_error") break;
    }
    if (!checked) return "I couldn't complete the answer check right now. Please try again in a moment.";
    const finalAccess = await this.access(client, guildId, channelId, userId);
    const finalSources = await this.validate(client, finalAccess, prepared.sources);
    if (finalSources.length !== prepared.sources.length || finalSources.some((m, i) => m.content !== prepared.sources[i].content)) return "The source messages or their permissions changed while I was answering. Please ask again so I can use the current information.";
    return cite(checked, prepared.sources);
  }
}
module.exports = { KnowledgeRetrieval, mergeRankings, cite };
