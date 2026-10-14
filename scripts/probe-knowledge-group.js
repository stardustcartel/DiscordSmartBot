// Verify one group against live Discord on a temporary database copy.
// No AI calls, messages posted, settings edits or writes to the live archive.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { Client, GatewayIntentBits } = require("discord.js");
const { config } = require("../src/config");
const { GuildSettingsStore } = require("../src/guild-settings");
const { KnowledgeBase } = require("../src/knowledge");
const { KnowledgeRetrieval } = require("../src/knowledge-retrieval");
const { errorDetails } = require("../src/knowledge-errors");
const [guildId, channelId, userId, messageId] = process.argv.slice(2);
if (![guildId, channelId, userId, messageId].every((id) => /^\d{15,25}$/.test(id || ""))) throw new Error("Usage: node scripts/probe-knowledge-group.js <guild-id> <destination-channel-id> <user-id> <source-message-id>");
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("clientReady", async () => {
  let store, directory;
  try {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartbot-group-probe-"));
    const original = new DatabaseSync(path.join(config.dataDirectory, "knowledge.sqlite"), { readOnly: true });
    try { await backup(original, path.join(directory, "knowledge.sqlite")); } finally { original.close(); }
    store = new KnowledgeBase({ ...config, dataDirectory: directory }, new GuildSettingsStore(config));
    const message = store.db.prepare("SELECT * FROM messages WHERE id=? AND guildId=?").get(messageId, guildId);
    if (!message) throw new Error("Requested source is not indexed");
    const group = store.groups.forMessage(message);
    const retrieval = new KnowledgeRetrieval(store, {}, {});
    const access = await retrieval.access(client, guildId, channelId, userId);
    const trace = {};
    const live = await retrieval.validateGroups(client, access, [group], { trace });
    console.log(JSON.stringify({ sourceMessageId: messageId, archivedMemberIds: group.memberIds, ...trace,
      validGroups: live.map((g) => ({ groupId: g.id, memberIds: g.memberIds, channelId: g.channelId })) }, null, 2));
    if (!live.length) process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify(errorDetails(error, { stage: "live_group_probe" }))); process.exitCode = 1; }
  finally { store?.close(); client.destroy(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); }
});
client.login(config.discordToken).catch((error) => { console.error(JSON.stringify(errorDetails(error, { stage: "discord_login" }))); process.exitCode = 1; client.destroy(); });
