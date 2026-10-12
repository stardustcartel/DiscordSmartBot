const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Collection, PermissionsBitField, PermissionFlagsBits: P } = require("discord.js");
const { KnowledgeBase } = require("../src/knowledge");
const { audienceDecision } = require("../src/knowledge-permissions");
const { searchKnowledge, diverseCandidates } = require("../src/knowledge-search");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartbot-search-test-"));
const guildId = "100000000000000001", channelId = "100000000000000002", otherId = "100000000000000003";
const settings = { get: () => ({ knowledgeChannelIds: [channelId, otherId] }) };
const store = new KnowledgeBase({ dataDirectory: directory }, settings);
function add(id, content, channelName = "discussion", channel = channelId, extra = {}) {
  store.store({ id: String(id), guildId, channelId: channel, rootId: channel, channelName, content, createdTimestamp: Number(id) * 1000, ...extra });
}
async function main() {
  const topics = ["microphone", "lighting", "copyright", "business"];
  for (const [i, topic] of topics.entries()) {
    for (let n = 0; n < 100; n++) add(1000 + i * 200 + n, `What about ${topic}?`, `What about ${topic}?`);
    add(1100 + i * 200, `Our ${topic} setup changed after comparing the options and testing the result.`);
    add(1101 + i * 200, "should I?", `What about ${topic}?`);
    const result = store.searchDetailed(topic, guildId, [channelId], { limit: 48 });
    assert.equal(result.totalMatches, 101, "Count all matching bodies before deduplication/limit");
    assert.equal(result.distinctMatches, 2);
    assert.equal(result.matches.length, 2);
    const candidates = diverseCandidates([result.matches], `What about ${topic}?`);
    assert.equal(candidates[0].message.id, String(1100 + i * 200), "Substantive bodies survive repeated-question floods for unrelated topics");
  }
  assert.equal(store.searchDetailed("microphone", "another-guild", [channelId]).matches.length, 0);
  assert.equal(store.searchDetailed("microphone", guildId, []).matches.length, 0);
  add(2000, "prism question?");
  add(90000, "Try the diffuser above the desk to soften the light.", "equipment", otherId);
  add(180000, "That solved it.", "equipment", otherId, { replyToId: "90000" });
  assert.ok(store.neighbors(store.searchDetailed("diffuser", guildId, [otherId]).matches[0].message).some((m) => m.id === "180000"), "Explicit replies remain linked across long time gaps");
  const access = { safeRoots: new Set([channelId, otherId]), allowedIds: [channelId, otherId], guild: { channels: { cache: new Map() } }, destination: { name: "help", isThread: () => false } };
  const indexer = { credentials: () => ({ provider: "openai", apiKey: "test-secret-never-logged" }), cooldowns: new Map([[guildId, Date.now() + 100000]]) };
  let reviewCalls = 0;
  const retrieval = { store, indexer, validate: async (_, __, candidates) => candidates, ai: { generate: async (args) => {
    if (args.textFormat.name === "knowledge_search_plan") return JSON.stringify({ concepts: ["prism"], queries: [{ query: "prism", channelIds: [], offset: 0 }] });
    const input = JSON.parse(args.conversation[0].text);
    reviewCalls++;
    if (reviewCalls === 1) return JSON.stringify({ sufficient: false, explanation: "Only a question was retrieved", selections: [], queries: [{ query: "diffuser", channelIds: [otherId], offset: 0 }] });
    assert.ok(input.candidates.some((c) => c.id === "90000"));
    return JSON.stringify({ sufficient: true, explanation: "A substantive reply", selections: [{ id: "90000", reason: "Useful explanation" }, { id: "invented", reason: "Must be rejected" }], queries: [] });
  } } };
  const trace = {};
  const result = await searchKnowledge({ retrieval, access, guildId, text: "prism?", recentQuestions: [], trace });
  assert.equal(reviewCalls, 2, "Insufficient evidence triggers follow-up even when matches exist");
  assert.deepEqual(result.map((m) => m.id), ["90000"], "AI cannot inject IDs that were not reviewed");
  assert.equal(trace.searchRounds.length, 2);
  assert.ok(!JSON.stringify(trace).includes("test-secret-never-logged"));
  retrieval.ai.generate = async (args) => args.textFormat.name === "knowledge_search_plan"
    ? JSON.stringify({ concepts: ["diffuser"], queries: [{ query: "diffuser", channelIds: [], offset: 0 }] }) : "{bad JSON";
  const failureTrace = {};
  assert.ok((await searchKnowledge({ retrieval, access, guildId, text: "diffuser", recentQuestions: [], trace: failureTrace })).some((m) => m.id === "90000"));
  assert.equal(failureTrace.searchOutcome, "relevance_review_unavailable");

  // Permission inclusion must match Discord's role aggregation, including role
  // combinations and real member exceptions (the RCA regression).
  const bit = (value) => new PermissionsBitField(value);
  const entry = (id, allow = 0n, deny = 0n, type = 0) => ({ id, type, allow: bit(allow), deny: bit(deny) });
  const everyone = { id: guildId, permissions: bit(P.ViewChannel | P.ReadMessageHistory) };
  const memberRole = { id: "members", permissions: bit(0n) }, adminRole = { id: "admin", permissions: bit(P.Administrator) };
  const guild = { roles: { everyone, cache: new Collection([[guildId, everyone], [memberRole.id, memberRole], [adminRole.id, adminRole]]) } };
  const make = (id, entries) => ({ id, guildId, guild, isThread: () => false, permissionOverwrites: { cache: new Collection(entries.map((e) => [e.id, e])) }, permissionsFor: (member) => member.admin ? bit(P.Administrator | P.ViewChannel | P.ReadMessageHistory) : bit(0n) });
  const source = make(channelId, [entry(guildId, 0n, P.ViewChannel), entry("members", P.ViewChannel)]);
  const destination = make(otherId, [entry(guildId, 0n, P.ViewChannel), entry("members", P.ViewChannel), entry("tester", P.ViewChannel, 0n, 1)]);
  assert.equal(audienceDecision(source, destination, new Map([["tester", { admin: true }]])).allowed, true, "Extra admin-specific destination allowance does not exclude member sources");
  assert.equal(audienceDecision(source, make("public", [])).allowed, false, "Member source cannot leak into public channel");
  const deniedMemberSource = make(channelId, [...source.permissionOverwrites.cache.values(), entry("outsider", 0n, P.ViewChannel, 1)]);
  const deniedMemberDestination = make(otherId, [...destination.permissionOverwrites.cache.values(), entry("outsider", P.ViewChannel, 0n, 1)]);
  deniedMemberDestination.permissionsFor = () => bit(P.ViewChannel | P.ReadMessageHistory);
  assert.equal(audienceDecision(deniedMemberSource, deniedMemberDestination, new Map([["tester", { admin: true }], ["outsider", {}]])).allowed, false);
  // Brute-force role sets against independently evaluated permissions.
  let seed = 7;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  const bits = (n) => (n & 1 ? P.ViewChannel : 0n) | (n & 2 ? P.ReadMessageHistory : 0n);
  for (let run = 0; run < 100; run++) {
    const roles = Array.from({ length: 4 }, (_, i) => ({ id: i ? `role${i}` : guildId, permissions: bit(bits(random() >>> 16)) }));
    guild.roles.everyone = roles[0]; guild.roles.cache = new Collection(roles.map((r) => [r.id, r]));
    const mkEntries = () => roles.map((r) => { const a = bits(random() >>> 16), d = bits(random() >>> 16) & ~a; return entry(r.id, a, d); });
    const s = make(channelId, mkEntries()), d = make(otherId, mkEntries());
    const effective = (ch, selected) => {
      let p = selected.reduce((v, r) => v | r.permissions.bitfield, roles[0].permissions.bitfield);
      const base = ch.permissionOverwrites.cache.get(guildId); p = (p & ~base.deny.bitfield) | base.allow.bitfield;
      let allow = 0n, deny = 0n;
      for (const r of selected) { const o = ch.permissionOverwrites.cache.get(r.id); allow |= o.allow.bitfield; deny |= o.deny.bitfield; }
      return (p & ~deny) | allow;
    };
    let expected = true;
    for (let combination = 0; combination < 8; combination++) {
      const selected = roles.slice(1).filter((_, i) => combination & (1 << i));
      if ((effective(d, selected) & P.ViewChannel) && (effective(s, selected) & (P.ViewChannel | P.ReadMessageHistory)) !== (P.ViewChannel | P.ReadMessageHistory)) expected = false;
    }
    assert.equal(audienceDecision(s, d).allowed, expected, `Permission subset proof ${run}`);
  }
  console.log("Focused search, duplicate floods across four topics, reply context, adaptive retry, provider failure, trace secrecy and 100 permission proofs passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
