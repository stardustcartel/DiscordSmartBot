// A DM never inherits a server implicitly when more than one opted-in server qualifies.
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
    const eligible = await this.eligible(userId);
    if (!eligible.length) { this.selections.delete(userId); this.pending.delete(userId); return { status: 'unavailable' }; }
    if (eligible.length === 1) { this.selections.set(userId, { id: eligible[0].guild.id, explicit: false }); this.pending.delete(userId); return { status: 'ready', guildId: eligible[0].guild.id, text: /^change server$/i.test(text.trim()) ? '' : text }; }
    const choice = this.pending.get(userId);
    if (choice && Date.now() - choice.at < 600000 && /^\d+$/.test(text.trim())) {
      const guildId = choice.ids[Number(text.trim()) - 1];
      if (eligible.some(item => item.guild.id === guildId)) {
        this.selections.set(userId, { id: guildId, explicit: true }); this.pending.delete(userId);
        return { status: 'ready', guildId, text: choice.text };
      }
    }
    const switching = /^change server$/i.test(text.trim());
    if (switching) this.selections.delete(userId);
    const selected = this.selections.get(userId);
    if (selected?.explicit && eligible.some(item => item.guild.id === selected.id)) return { status: 'ready', guildId: selected.id, text };
    this.pending.set(userId, { ids: eligible.map(item => item.guild.id), text: switching ? '' : text, at: Date.now() });
    return { status: 'choose', guilds: eligible.map(item => item.guild.name) };
  }
}
module.exports = { DmRouter };
