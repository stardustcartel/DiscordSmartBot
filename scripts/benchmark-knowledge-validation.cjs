// Compares old/new source validation against private SQLite snapshots and live
// Discord reads. No AI requests, Discord messages, or production archive writes.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { Client, GatewayIntentBits } = require('discord.js');
const { config } = require(path.join(process.cwd(), 'src/config'));
const { GuildSettingsStore } = require('../src/guild-settings');
const { KnowledgeBase } = require('../src/knowledge');
const { KnowledgeRetrieval } = require('../src/knowledge-retrieval');
const [guildId, channelId, userId, traceId, baselineRef] = process.argv.slice(2);
if (![guildId, channelId, userId].every(id => /^\d{15,25}$/.test(id || '')) || !/^[0-9a-f]{7,40}$/.test(baselineRef || '')) throw Error('Usage: node scripts/benchmark-knowledge-validation.cjs <guild> <channel> <user> <search-trace-id> <baseline-commit>');
function legacy(file) {
  const filename = path.resolve(__dirname, '..', file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(execFileSync('git', ['show', `${baselineRef}:${file}`], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 }), filename);
  return mod.exports;
}
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async () => {
  let store;
  try {
    const lines = fs.readFileSync(path.join(config.dataDirectory, 'knowledge-search', guildId, 'history.jsonl'), 'utf8').trim().split('\n');
    const trace = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(item => item.id === traceId);
    if (!trace?.researchReuse?.cachedGroupIds?.length) throw Error('Trace has no cached group IDs');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'smartbot-validation-benchmark-'));
    const original = new DatabaseSync(path.join(config.dataDirectory, 'knowledge.sqlite'), { readOnly: true });
    const dirs = ['baseline', 'optimized'].map(name => { const dir = path.join(temporary, name); fs.mkdirSync(dir, { mode: 0o700 }); return dir; });
    try { for (const dir of dirs) await backup(original, path.join(dir, 'knowledge.sqlite')); } finally { original.close(); }
    const settings = new GuildSettingsStore(config), guild = client.guilds.cache.get(guildId);
    let counters = {}, watched = new WeakSet();
    const watch = channel => {
      if (!channel?.messages || watched.has(channel.messages)) return;
      watched.add(channel.messages);
      const fetch = channel.messages.fetch.bind(channel.messages);
      channel.messages.fetch = async options => { counters.historyFetches = (counters.historyFetches || 0) + 1; return fetch(options); };
    };
    const fetchChannel = guild.channels.fetch.bind(guild.channels);
    guild.channels.fetch = async (...args) => {
      counters.channelFetches = (counters.channelFetches || 0) + 1;
      const result = await fetchChannel(...args);
      if (result?.values && !result.messages) for (const channel of result.values()) watch(channel); else watch(result);
      return result;
    };
    const old = { ...legacy('src/knowledge.js'), ...legacy('src/knowledge-retrieval.js') };
    const runs = [];
    for (const [index, classes] of [old, { KnowledgeBase, KnowledgeRetrieval }].entries()) {
      store = new classes.KnowledgeBase({ ...config, dataDirectory: dirs[index] }, settings);
      const retrieval = new classes.KnowledgeRetrieval(store, {}, {});
      const access = await retrieval.access(client, guildId, channelId, userId);
      const groups = trace.researchReuse.cachedGroupIds.map(id => store.groups.forMessage({ id, guildId, channelId: store.db.prepare('SELECT channelId FROM conversation_groups WHERE id=?').get(id)?.channelId })).filter(Boolean);
      const measured = {}, started = Date.now(); counters = {};
      console.log(JSON.stringify({ stage: index ? 'optimized_started' : 'baseline_started', groups: groups.length }));
      const valid = await retrieval.validateGroups(client, access, groups, { trace: measured });
      const fingerprint = createHash('sha256').update(JSON.stringify(valid.map(group => [group.id, group.members.map(m => [m.id, m.content])]))).digest('hex');
      runs.push({ stage: index ? 'optimized' : 'baseline', milliseconds: Date.now() - started, inputGroups: groups.length, validGroups: valid.length, ...counters, batch: measured.liveGroupTiming, fingerprint });
      console.log(JSON.stringify(runs.at(-1)));
      store.close(); store = null;
    }
    const sameEvidence = runs[0].fingerprint === runs[1].fingerprint;
    console.log(JSON.stringify({ sameEvidence, savedMilliseconds: runs[0].milliseconds - runs[1].milliseconds, snapshots: temporary }));
    if (!sameEvidence) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { store?.close(); client.destroy(); }
});
client.login(config.discordToken).catch(error => { console.error(error.message); process.exitCode = 1; client.destroy(); });
