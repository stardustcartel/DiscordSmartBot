// Read-only permission diagnostic; does not register commands or post messages.
const { Client, GatewayIntentBits } = require("discord.js");
const { config } = require("../src/config");
const { GuildSettingsStore } = require("../src/guild-settings");
const { canRead, audienceDecision, loadAudienceMembers } = require("../src/knowledge-permissions");
const [guildId, channelId, userId] = process.argv.slice(2);
if (![guildId, channelId, userId].every((id) => /^\d{15,25}$/.test(id || ""))) throw new Error("Usage: node scripts/inspect-knowledge-access.js <guild> <destination-channel> <user>");
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("clientReady", async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
    const destination = await guild.channels.fetch(channelId);
    const [member, bot] = await Promise.all([guild.members.fetch(userId), guild.members.fetchMe()]);
    const settings = new GuildSettingsStore(config).get(guildId);
    const verifiedMembers = await loadAudienceMembers(guild, [destination, ...settings.knowledgeChannelIds.map((id) => guild.channels.cache.get(id))]);
    const roots = settings.knowledgeChannelIds.map((id) => {
      const ch = guild.channels.cache.get(id), decision = audienceDecision(ch, destination, verifiedMembers);
      return { id, name: ch?.name, requesterCanRead: canRead(ch, member), botCanRead: canRead(ch, bot), ...decision,
        counterexampleRoleNames: decision.roleIds?.map((rid) => guild.roles.cache.get(rid)?.name || rid) };
    });
    console.log(JSON.stringify({ destination: destination.name, roots }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { client.destroy(); }
});
client.login(config.discordToken).catch((error) => { console.error(error.message); process.exitCode = 1; client.destroy(); });
