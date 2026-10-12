// End-to-end diagnostic: uses the configured AI key, but never posts to Discord.
// Uses a consistent SQLite backup so retrieval cannot modify the live archive.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { Client, GatewayIntentBits } = require("discord.js");
const { config } = require("../src/config");
const { GuildSettingsStore } = require("../src/guild-settings");
const { GuildSecretsStore } = require("../src/guild-secrets");
const { KnowledgeBase } = require("../src/knowledge");
const { KnowledgeIndexer } = require("../src/knowledge-indexer");
const { KnowledgeRetrieval } = require("../src/knowledge-retrieval");
const { AiChat } = require("../src/ai");
const { effectivePolicy } = require("../src/knowledge-policy");
const [guildId, channelId, userId, ...words] = process.argv.slice(2);
if (![guildId, channelId, userId].every((id) => /^\d{15,25}$/.test(id || "")) || !words.length) throw new Error("Usage: node scripts/probe-knowledge.js <guild> <channel> <user> <question>");
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("clientReady", async () => {
  let store;
  try {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartbot-probe-"));
    const original = new DatabaseSync(path.join(config.dataDirectory, "knowledge.sqlite"), { readOnly: true });
    try { await backup(original, path.join(directory, "knowledge.sqlite")); } finally { original.close(); }
    console.log(JSON.stringify({ stage: "snapshot_ready" }));
    const settingsStore = new GuildSettingsStore(config), secrets = new GuildSecretsStore(config);
    store = new KnowledgeBase({ ...config, dataDirectory: directory }, settingsStore);
    const indexer = new KnowledgeIndexer(store, settingsStore, secrets), ai = new AiChat(config);
    const retrieval = new KnowledgeRetrieval(store, indexer, ai, directory);
    const originalGenerate = ai.generate.bind(ai);
    ai.generate = async (args) => {
      const started = Date.now(), stage = args.textFormat?.name || "answer_generation";
      console.log(JSON.stringify({ stage, state: "started" }));
      try { return await originalGenerate(args); }
      finally { console.log(JSON.stringify({ stage, state: "finished", seconds: (Date.now() - started) / 1000 })); }
    };
    const text = words.join(" "), started = Date.now();
    const prepared = await retrieval.prepare({ client, guildId, channelId, userId, text });
    const settings = settingsStore.get(guildId), policy = effectivePolicy(settings.knowledgePolicy, prepared.access.destination);
    const trace = JSON.parse(fs.readFileSync(path.join(directory, "knowledge-search", guildId, "history.jsonl"), "utf8").trim());
    console.log(JSON.stringify({ stage: "retrieved", seconds: (Date.now() - started) / 1000, traceFile: path.join(directory, "knowledge-search", guildId, "history.jsonl"),
      eligibleRoots: [...prepared.access.safeRoots], outcome: prepared.searchOutcome, rounds: trace.searchRounds.map((r) => ({ searches: r.searches.map(({ query, totalMatches, returnedMatches }) => ({ query, totalMatches, returnedMatches })), review: r.review })),
      sources: prepared.sources.map((s) => ({ id: s.id, channel: s.channelName, content: s.content.slice(0, 400), url: s.url })) }, null, 2));
    const draft = await ai.respond({ ...indexer.credentials(guildId), openAiSpeed: settings.openAiSpeed, openAiReasoning: settings.openAiReasoning,
      scopeId: guildId, userId, text, personality: settings.personality, context: prepared.context, forgetHistory: true, knowledgePolicy: policy });
    const answer = await retrieval.finish({ client, guildId, channelId, userId, answer: draft, prepared, policy });
    console.log(JSON.stringify({ stage: "answer_checked", seconds: (Date.now() - started) / 1000, answer }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { store?.close(); client.destroy(); }
});
client.login(config.discordToken).catch((error) => { console.error(error.message); process.exitCode = 1; client.destroy(); });
