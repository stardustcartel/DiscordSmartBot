const { EmbedBuilder } = require('discord.js');

function dmIdentity(guild, settings, bot) {
  const name = settings.profile?.nickname?.trim() || guild.members.me?.displayName || bot.displayName || bot.username;
  return {
    name,
    server: guild.name,
    botAvatar: guild.members.me?.displayAvatarURL?.() || bot.displayAvatarURL?.(),
    serverIcon: guild.iconURL?.() || null,
  };
}

function dmEmbed(identity, answer) {
  const embed = new EmbedBuilder()
    .setColor(0x9b65db)
    .setAuthor({ name: `Responding as ${identity.name} for ${identity.server}`, ...(identity.botAvatar ? { iconURL: identity.botAvatar } : {}) })
    .setDescription(answer)
    .setFooter({ text: `Using ${identity.server}'s bot settings · Say “change server” to switch` });
  if (identity.serverIcon) embed.setThumbnail(identity.serverIcon);
  return embed;
}

module.exports = { dmIdentity, dmEmbed };
