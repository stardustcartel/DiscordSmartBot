const { PermissionFlagsBits: P } = require("discord.js");
const read = P.ViewChannel | P.ReadMessageHistory;
const canRead = (channel, member) => Boolean(member && channel?.permissionsFor(member)?.has(read));
function signature(channel) {
  return [...(channel.permissionOverwrites?.cache?.values() || [])]
    .map((o) => `${o.id}:${o.type}:${o.allow.bitfield & read}:${o.deny.bitfield & read}`).sort().join("|");
}
function safeAudience(source, destination) {
  if (!source || !destination || source.guildId !== destination.guildId || source.type === 12) return false;
  const src = source.isThread?.() ? source.parent : source;
  const dst = destination.isThread?.() ? destination.parent : destination;
  if (!src || !dst) return false;
  if (src.nsfw && !dst.nsfw) return false;
  if (src.id === dst.id || signature(src) === signature(dst)) return true;
  // Otherwise only globally readable sources can be quoted in a different audience.
  const everyone = src.guild.roles.everyone;
  return canRead(src, everyone) && ![...(src.permissionOverwrites?.cache?.values() || [])].some((o) => (o.deny.bitfield & read) !== 0n);
}
module.exports = { canRead, safeAudience };
