const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Collection, PermissionsBitField } = require('discord.js');
const { KnowledgeBase } = require('../src/knowledge');
const { KnowledgeIndexer } = require('../src/knowledge-indexer');
const { KnowledgeRetrieval, cite } = require('../src/knowledge-retrieval');
const { knowledgeText, SOURCE_POLICY_VERSION } = require('../src/knowledge-message');
const { lookupMessages } = require('../src/knowledge-lookup');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-automated-'));
const guildId = '100000000000000001', channelId = '100000000000000002';
const self = { id: '100000000000000003', bot: true }, member = { id: '100000000000000004' };
const settings = { knowledgeChannelIds: [channelId] };
const store = new KnowledgeBase({ dataDirectory: directory }, { get: id => id === guildId ? settings : { knowledgeChannelIds: [] } });
const guild = { id: guildId, members: { me: self } }, live = new Map();
let readable = true;
const channel = { id: channelId, guildId, guild, name: 'general', type: 0, isThread: () => false,
  permissionsFor: () => new PermissionsBitField(readable ? 66560n : 0n),
  messages: { fetch: async opts => {
    if (opts.message) {
      if (!live.has(opts.message)) throw Object.assign(new Error('deleted'), { code: 10008 });
      return live.get(opts.message);
    }
    const rows = [...live.values()].filter(m => (!opts.before || BigInt(m.id) < BigInt(opts.before)) && (!opts.after || BigInt(m.id) > BigInt(opts.after)));
    rows.sort((a,b) => opts.after ? Number(a.id) - Number(b.id) : Number(b.id) - Number(a.id));
    return new Collection(rows.slice(0,opts.limit).map(m => [m.id,m]));
  } } };
guild.channels = { fetch: async () => channel };
const message = (id, content, extra = {}) => ({ id: String(id), guildId, guild, channelId, channel, author: member, content, createdTimestamp: Number(id) * 1000, ...extra });
const indexer = new KnowledgeIndexer(store, store.guildSettings, {});
const retrieval = new KnowledgeRetrieval(store, indexer, {});
const access = { guild, member, bot: self, destination: { isServerDm: true }, allowedIds: [channelId] };
(async () => {
  // Completed old checkpoints must not permanently hide older automated messages.
  for (let id = 1000; id < 1240; id++) {
    const m = message(id, id < 1140 ? 'Workshop starts Friday at noon' : 'Member conversation',
      id < 1140 ? { author: { id: 'external-scheduler', bot: true } } : {});
    live.set(m.id, m);
    if (id >= 1140) store.upsert(m);
  }
  const human = store.db.prepare('SELECT * FROM messages WHERE id=?').get('1239');
  store.putVector(human, 'existing-model', [1,0]);
  store.checkpoint(`channel:${channelId}`, { guildId, rootId: channelId, id: channelId, latest: '1239', before: '1000', complete: true, checkedAt: 1 });
  const first = await indexer.scan(channel);
  assert.equal(first.policyBackfillStarted, true);
  assert.ok(first.sourceTypes.discord_bot > 0);
  assert.equal(first.historicalImportComplete, false);
  const second = await indexer.scan(channel);
  assert.equal(second.policyBackfillStarted, false);
  assert.equal(store.count(guildId), 240);
  assert.equal(store.checkpoint(`channel:${channelId}`).sourcePolicyVersion, SOURCE_POLICY_VERSION);
  assert.equal(store.checkpoint(`channel:${channelId}`).complete, true);
  assert.equal(store.db.prepare('SELECT vectorModel FROM messages WHERE id=?').get(human.id).vectorModel, 'existing-model', 'Unchanged human embeddings are preserved');

  const embed = message(2000, '', { webhookId: 'integration', author: { id: 'external-feed', bot: true }, embeds: [
    { type: 'rich', title: 'Studio booking', description: 'Reserved Tuesday', fields: [{ name: 'Room', value: 'Blue studio' }] },
    { type: 'video', title: 'Do not index preview or fetch URL', url: 'https://invalid.example' },
  ] });
  live.set(embed.id, embed);
  assert.equal(store.upsert(embed), true);
  const found = store.searchDetailed('Blue studio', guildId, [channelId]).matches[0].message;
  assert.equal(found.sourceType, 'discord_webhook');
  assert.equal(found.content, 'Studio booking\nReserved Tuesday\nRoom: Blue studio');
  assert.equal((await retrieval.validate(null, access, [found]))[0].content, found.content, 'Embed-only text survives live validation');
  assert.equal(store.groups.forMessage(found).members[0].sourceType, 'discord_webhook');
  assert.match(cite('Reserved Tuesday [S1]', [found]), /discord.com\/channels/);
  assert.ok(knowledgeText({ ...embed, embeds: [{ description: 'a'.repeat(20000) }] }).length <= 10000);
  assert.equal(knowledgeText(message(2001, 'human body', { embeds: embed.embeds })), 'human body');

  const trace = {};
  const latest = await lookupMessages({ retrieval, access, guildId, trace, lookup: { mode: 'latest', authorIds: [], channelIds: [], topicQueries: [['workshop']], start: null, end: null, limit: 1 } });
  assert.equal(latest[0].id, '1139', 'Topic-independent chronological search includes automated text');
  assert.equal(latest[0].sourceType, 'discord_bot');
  assert.equal(store.search('workshop', 'other-guild', 5, [channelId]).length, 0);
  assert.equal(store.search('workshop', guildId, 5, []).length, 0);
  assert.equal(store.shouldIndex({ ...embed, channelId: 'unselected', channel: { ...channel, id: 'unselected' } }), false);
  assert.equal(store.shouldIndex({ ...embed, channel: { ...channel, type: 12 } }), false);
  assert.equal(store.shouldIndex({ ...embed, system: true }), false);
  assert.equal(store.shouldIndex({ ...embed, author: self, content: 'Earlier assistant answer' }), false);
  assert.equal(store.shouldIndex({ ...embed, author: self }), false, 'Embed-only assistant answers cannot become evidence');
  assert.equal(store.shouldIndex({ ...embed, guild: null, channel: { ...channel, guild: null } }), false, 'Fail closed without bot identity');
  readable = false;
  assert.deepEqual(await retrieval.validate(null, access, [found]), [], 'DM permissions still enforced');
  readable = true;
  channel.nsfw = true;
  assert.deepEqual(await retrieval.validate(null, access, [found]), [], 'NSFW source does not leak into DM');
  channel.nsfw = false;
  store.putVector(found, 'existing-model', [1,0]);
  embed.embeds[0].description = 'Reserved Wednesday';
  const edited = (await retrieval.validate(null, access, [found]))[0];
  assert.match(edited.content, /Wednesday/);
  assert.equal(store.db.prepare('SELECT vector FROM messages WHERE id=?').get(found.id).vector, null);
  live.delete(embed.id);
  assert.deepEqual(await retrieval.validate(null, access, [edited]), [], 'Deleted integration messages are removed');
  assert.equal(store.search('Blue studio', guildId, 5, [channelId]).length, 0);
  settings.knowledgeChannelIds = [];
  store.prune(guildId);
  assert.equal(store.count(guildId), 0);
  console.log('General automated knowledge: historical backfill, preserved embeddings, rich text, chronology, provenance, citations, self-exclusion, permissions, edits and deletions passed (no AI calls).');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => store.close());
