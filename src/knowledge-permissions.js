const { PermissionFlagsBits: P } = require("discord.js");
const read = P.ViewChannel | P.ReadMessageHistory;
const canRead = (channel, member) => Boolean(member && channel?.permissionsFor(member)?.has(read));
const mask = (bits = 0n) => (bits & P.ViewChannel ? 1 : 0) | (bits & P.ReadMessageHistory ? 2 : 0);
const overwrite = (channel, id) => channel.permissionOverwrites?.cache?.get(id);
const apply = (value, entry) => (value & ~mask(entry?.deny?.bitfield)) | mask(entry?.allow?.bitfield);
function audienceDecision(source, destination, verifiedMembers = new Map()) {
  const deny = (reason, details = {}) => ({ allowed: false, reason, ...details });
  const allow = (reason) => ({ allowed: true, reason });
  if (!source || !destination || source.guildId !== destination.guildId) return deny("missing_or_other_server_channel");
  if (source.type === 12) return deny("private_thread");
  const src = source.isThread?.() ? source.parent : source;
  const dst = destination.isThread?.() ? destination.parent : destination;
  if (!src || !dst) return deny("missing_parent");
  if (src.nsfw && !dst.nsfw) return deny("age_restricted_source");
  if (src.id === dst.id) return allow("same_channel_audience");
  const everyone = src.guild?.roles?.everyone;
  const roles = src.guild?.roles?.cache;
  if (!roles || !everyone?.permissions) {
    return canRead(src, everyone) && ![...(src.permissionOverwrites?.cache?.values() || [])].some((o) => (o.deny.bitfield & read) !== 0n)
      ? allow("globally_readable_source") : deny("audience_permissions_unavailable");
  }
  // Prove destination viewers can read the source for EVERY possible combination
  // of roles, not just currently cached members. Each combination collapses into
  // ten OR-aggregated permission bits, so there are at most 1024 states.
  // Discord applies base roles, @everyone overwrite, combined role denies/allows,
  // then the member overwrite. Administrator/owner can read both channels.
  const states = new Map([[mask(everyone.permissions.bitfield), []]]);
  const seen = new Set();
  for (const role of roles.values()) {
    if (role.id === everyone.id || (role.permissions.bitfield & P.Administrator)) continue;
    const s = overwrite(src, role.id), d = overwrite(dst, role.id);
    const contribution = mask(role.permissions.bitfield) | (mask(s?.deny?.bitfield) << 2) | (mask(s?.allow?.bitfield) << 4)
      | (mask(d?.deny?.bitfield) << 6) | (mask(d?.allow?.bitfield) << 8);
    if (seen.has(contribution)) continue;
    seen.add(contribution);
    for (const [state, ids] of [...states]) if (!states.has(state | contribution)) states.set(state | contribution, [...ids, role.id]);
  }
  const memberIds = new Set([null]);
  for (const ch of [src, dst]) for (const o of ch.permissionOverwrites.cache.values()) if (o.type === 1) memberIds.add(o.id);
  // Individual exceptions belong to real members, whose current roles we refresh.
  // Testing a named administrator with an imaginary empty role set overblocks
  // channels where that administrator has an explicit destination allowance.
  for (const memberId of [...memberIds]) {
    if (memberId && verifiedMembers.has(memberId)) {
      const member = verifiedMembers.get(memberId);
      if (member && dst.permissionsFor(member)?.has(P.ViewChannel) && !canRead(src, member)) return deny("specific_destination_member_cannot_read_source", { memberId });
      memberIds.delete(memberId);
    }
  }
  for (const [state, roleIds] of states) {
    const sourcePermissions = (apply(state & 3, overwrite(src, everyone.id)) & ~((state >> 2) & 3)) | ((state >> 4) & 3);
    const destinationPermissions = (apply(state & 3, overwrite(dst, everyone.id)) & ~((state >> 6) & 3)) | ((state >> 8) & 3);
    for (const memberId of memberIds) {
      const s = apply(sourcePermissions, memberId && overwrite(src, memberId));
      const d = apply(destinationPermissions, memberId && overwrite(dst, memberId));
      // A member can see a newly posted answer with ViewChannel even without history.
      if ((d & 1) && s !== 3) return deny("destination_audience_may_lack_source_access", { roleIds, memberId });
    }
  }
  return allow("destination_audience_is_subset");
}
async function loadAudienceMembers(guild, channels) {
  const ids = [...new Set(channels.flatMap((channel) => [...((channel?.isThread?.() ? channel.parent : channel)?.permissionOverwrites?.cache?.values() || [])].filter((o) => o.type === 1).map((o) => o.id)))];
  const members = new Map();
  for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(async (id) => {
    try { members.set(id, await guild.members.fetch({ user: id, force: true })); }
    catch (error) { if (Number(error.code) === 10007) members.set(id, null); }
  }));
  return members;
}
const safeAudience = (source, destination) => audienceDecision(source, destination).allowed;
module.exports = { canRead, safeAudience, audienceDecision, loadAudienceMembers };
