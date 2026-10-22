import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DmRouter } = require('../src/dm-routing.js');
const { dmIdentity, dmEmbed } = require('../src/dm-presentation.js');
const { KnowledgeRetrieval } = require('../src/knowledge-retrieval.js');
const guilds = new Map();
const configurations = new Map();
const user = '100000000000000001', role = '100000000000000002';
function guild(id, name, memberRoles = []) {
  const member = { id: user, roles: { cache: new Map(memberRoles.map(id => [id, {}])) } };
  const bot = { id: 'bot' };
  const sourceId = id + '1', restrictedId = id + '2', ageRestrictedId = id + '3';
  const source = (channelId, readable, nsfw = false) => ({ id: channelId, guildId: id, name: 'source', type: 0, nsfw,
    permissionsFor: identity => ({ has: () => identity === bot || readable && identity === member }) });
  const channels = new Map([[sourceId, source(sourceId, true)], [restrictedId, source(restrictedId, false)], [ageRestrictedId, source(ageRestrictedId, true, true)]]);
  const result = { id, name, roles: { fetch: async () => {} }, channels: { cache: channels, fetch: async channelId => channelId ? channels.get(channelId) : null },
    members: { fetch: async ({ user: requested }) => { if (requested !== user) throw Error('not a member'); return member; }, fetchMe: async () => bot } };
  guilds.set(id, result);
  configurations.set(id, { dmEnabled: true, botAccessRoleIds: [role], knowledgeChannelIds: [sourceId, restrictedId, ageRestrictedId] });
  return { result, sourceId, restrictedId, ageRestrictedId };
}
const a = guild('100000000000000010', 'Alpha', [role]);
const b = guild('100000000000000020', 'Beta', []);
const client = { guilds: { cache: guilds } }, settings = { get: id => configurations.get(id) };
const router = new DmRouter(client, settings);
assert.deepEqual((await router.resolve(user, 'hello')).status, 'ready');
assert.equal((await router.resolve(user, 'hello')).guildId, a.result.id);
configurations.get(b.result.id).botAccessRoleIds = [];
let selected = await router.resolve(user, 'question about my channel');
assert.equal(selected.status, 'choose');
assert.deepEqual(selected.guilds, ['Alpha', 'Beta']);
assert.deepEqual(selected.guildIds, [a.result.id, b.result.id]);
const identity = dmIdentity({ name: 'Alpha', members: { me: { displayAvatarURL: () => 'https://example.com/alpha-bot.png' } }, iconURL: () => 'https://example.com/alpha.png' }, { profile: { nickname: 'Alpha Helper' } }, { username: 'SharedBot' });
assert.equal(identity.name, 'Alpha Helper');
assert.equal(dmEmbed(identity, 'Hello').toJSON().author.name, 'Responding as Alpha Helper for Alpha');
assert.equal(dmEmbed(identity, 'Hello').toJSON().thumbnail.url, 'https://example.com/alpha.png');
selected = await router.resolve(user, '2');
assert.deepEqual({ status: selected.status, guildId: selected.guildId, text: selected.text }, { status: 'ready', guildId: b.result.id, text: 'question about my channel' });
assert.equal((await router.resolve(user, 'followup')).guildId, b.result.id);
configurations.get(b.result.id).dmEnabled = false;
assert.equal((await router.resolve(user, 'followup')).guildId, a.result.id, 'DM opt-out invalidates the former selection');
configurations.get(a.result.id).dmEnabled = false;
assert.equal((await router.resolve(user, 'followup')).status, 'unavailable');
configurations.get(a.result.id).dmEnabled = true;
const store = { guildSettings: settings, db: { exec() {}, prepare: () => ({ all: () => [{channelId:a.sourceId,rootId:a.sourceId},{channelId:a.restrictedId,rootId:a.restrictedId},{channelId:a.ageRestrictedId,rootId:a.ageRestrictedId}] }) } };
const retrieval = new KnowledgeRetrieval(store, {}, {}, null);
const access = await retrieval.access(client, a.result.id, 'dm', user);
assert.deepEqual(access.allowedIds, [a.sourceId], 'DM retrieval excludes unreadable and age-restricted channels');
assert.equal(access.destination.isServerDm, true);
for (const id of [a.restrictedId, a.ageRestrictedId]) {
  assert.deepEqual(await retrieval.validate(client, access, [{ id:'100000000000000099', rootId:id, channelId:id, content:'private' }], { refreshMessages:false }), [], 'Live validation must reject inaccessible DM sources');
}
configurations.get(a.result.id).dmEnabled = false;
await assert.rejects(retrieval.access(client, a.result.id, 'dm', user), /not enabled for this member/);
configurations.get(a.result.id).dmEnabled = true;
configurations.get(a.result.id).botAccessRoleIds = ['other-role'];
await assert.rejects(retrieval.access(client, a.result.id, 'dm', user), /not enabled for this member/);
console.log('DM selection, membership, role access, opt-out, and source permissions passed.');
