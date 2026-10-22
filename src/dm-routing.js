// A DM never inherits a server implicitly when more than one opted-in server qualifies.
const { dmIdentity } = require('./dm-presentation');

const normalize = value => String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const switchRequest = value => /^(?:change|switch)(?:\s+(?:the|my))?\s+servers?(?:\s+(?:for|you)(?:\s+to)?\s+use)?[.!?]?$/i.test(value)
  || /^(?:how (?:do|can) i|can i|please|i want to|i'd like to)\s+(?:change|switch)\s+servers?\b/i.test(value);
function requestedGuildId(input, options, client, settings) {
  const value = normalize(input);
  const number = value.match(/^(\d+)\.?$/)?.[1];
  if (number) return options[Number(number) - 1]?.guild.id || null;
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ordinal = value.match(/^(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+(?:one|server))?\.?$/)?.[1];
  if (ordinal) return options[ordinals.indexOf(ordinal)]?.guild.id || null;
  const named = options.filter(({ guild }) => {
    const server = normalize(guild.name);
    const botName = normalize(dmIdentity(guild, settings.get(guild.id), client.user || {}).name);
    return value === server || value === `${server} ${botName}` || value === `${server} — ${botName}`;
  });
  return named.length === 1 ? named[0].guild.id : null;
}
class DmRouter {
  constructor(client, settings) { this.client = client; this.settings = settings; this.selections = new Map(); this.pending = new Map(); }
  async eligible(userId) {
    const results = [];
    const guilds = [...this.client.guilds.cache.values()].filter(guild => this.settings.get(guild.id).dmEnabled);
    for (let offset = 0; offset < guilds.length; offset += 5) {
      await Promise.all(guilds.slice(offset, offset + 5).map(async guild => {
        try {
          const member = await guild.members.fetch({ user: userId, force: true });
          const roles = this.settings.get(guild.id).botAccessRoleIds;
          if (!roles.length || roles.some(id => member.roles.cache.has(id))) results.push({ guild, member });
        } catch (error) { if (Number(error.code) !== 10007) throw error; }
      }));
    }
    return results.sort((a,b) => a.guild.name.localeCompare(b.guild.name) || a.guild.id.localeCompare(b.guild.id));
  }
  async resolve(userId, text) {
    const input = String(text || '').trim();
    const eligible = await this.eligible(userId);
    if (!eligible.length) { this.selections.delete(userId); this.pending.delete(userId); return { status: 'unavailable' }; }
    const switching = switchRequest(input);
    if (eligible.length === 1) { this.selections.set(userId, { id: eligible[0].guild.id, explicit: false }); this.pending.delete(userId); return { status: 'ready', guildId: eligible[0].guild.id, text: switching ? '' : text }; }
    if (switching) { this.selections.delete(userId); this.pending.delete(userId); }
    const choice = this.pending.get(userId);
    if (choice && Date.now() - choice.at < 600000) {
      const ordered = choice.ids.map(id => eligible.find(item => item.guild.id === id)).filter(Boolean);
      const guildId = requestedGuildId(input, ordered, this.client, this.settings);
      if (eligible.some(item => item.guild.id === guildId)) {
        this.selections.set(userId, { id: guildId, explicit: true }); this.pending.delete(userId);
        return { status: 'ready', guildId, text: choice.text };
      }
      // Keep the original question if a reply did not select an eligible server.
      return { status: 'choose', guilds: ordered.map(item => item.guild.name), guildIds: ordered.map(item => item.guild.id) };
    }
    if (choice) this.pending.delete(userId);
    const directName = input.replace(/^(?:switch to|use)\s+/i, '');
    if (!switching && !/^(?:\d+\.?|(?:the\s+)?(?:first|second|third|fourth|fifth)(?:\s+(?:one|server))?\.?)$/i.test(directName)) {
      const namedId = requestedGuildId(directName, eligible, this.client, this.settings);
      if (namedId) {
        this.selections.set(userId, { id: namedId, explicit: true });
        return { status: 'ready', guildId: namedId, text: '' };
      }
    }
    const selected = this.selections.get(userId);
    if (selected?.explicit && eligible.some(item => item.guild.id === selected.id)) return { status: 'ready', guildId: selected.id, text };
    const looksLikeChoice = /^(?:\d+\.?|(?:the\s+)?(?:first|second|third|fourth|fifth)(?:\s+(?:one|server))?\.?)$/i.test(input);
    this.pending.set(userId, { ids: eligible.map(item => item.guild.id), text: switching || looksLikeChoice ? '' : text, at: Date.now() });
    return { status: 'choose', guilds: eligible.map(item => item.guild.name), guildIds: eligible.map(item => item.guild.id) };
  }
}
module.exports = { DmRouter };
