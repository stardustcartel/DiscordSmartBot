const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, Routes } = require('discord.js');

function reminderCommand(privateContext = false) {
  const command = new SlashCommandBuilder().setName('remind').setDescription('Schedule private DM reminders for yourself or selected people')
    .addStringOption(option => option.setName('message').setDescription('What should I remind you about?').setRequired(true).setMaxLength(1000))
    .addStringOption(option => option.setName('when').setDescription('30 mins, in 2 hrs, or tomorrow at noon PST').setRequired(true).setMaxLength(100))
    .addStringOption(option => option.setName('time-zone').setDescription('Optional: PST, EST, UTC, or an IANA time zone').setMaxLength(50));
  for (let i = 1; i <= 10; i++) command.addUserOption(option => option.setName(i === 1 ? 'notify' : `notify-${i}`).setDescription(i === 1 ? 'Who gets a private reminder? Leave all notify fields empty for just you.' : `Another person to notify privately (recipient ${i})`));
  if (privateContext) command.setIntegrationTypes(ApplicationIntegrationType.UserInstall).setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel);
  else command.setDMPermission(false);
  return command;
}

// Keep global /remind out of guilds, where the existing guild command lives.
// Do not register global /chat or expose server administration to user installs.
async function registerPrivateReminders(client) {
  const application = await client.rest.get(Routes.currentApplication());
  if (!Object.hasOwn(application.integration_types_config || {}, '1')) {
    await client.rest.patch(Routes.currentApplication(), { body: { integration_types_config: {
      ...(application.integration_types_config || {}),
      '1': { oauth2_install_params: { scopes: ['applications.commands'], permissions: '0' } },
    } } });
  }
  await client.application.commands.set([reminderCommand(true)]);
  console.log('Registered user-installed /remind for DMs and group DMs; /chat remains server-only.');
}

class ReminderCommands {
  constructor(store, settingsForGuild) { this.store = store; this.settingsForGuild = settingsForGuild; }
  async create(interaction) {
    const users = [];
    for (let i = 1; i <= 10; i++) {
      const user = interaction.options.getUser(i === 1 ? 'notify' : `notify-${i}`);
      if (user) users.push(user);
    }
    if (users.some(user => user.bot)) return interaction.reply({ content: 'Choose people, not bot accounts, as reminder recipients.', flags: MessageFlags.Ephemeral });
    const text = interaction.options.getString('message', true).trim();
    if (!text) return interaction.reply({ content: 'Enter a message for the reminder.', flags: MessageFlags.Ephemeral });
    const options = { userId: interaction.user.id, text, when: interaction.options.getString('when', true).trim(),
      timeZone: interaction.options.getString('time-zone')?.trim() || this.settingsForGuild(interaction.guildId).reminderTimeZone };
    await interaction.deferReply();
    let reminder;
    try {
      reminder = users.length ? this.store.addGroup({ ...options, recipientIds: users.map(user => user.id), channelId: interaction.channelId, guildId: interaction.guildId }) : this.store.add(options);
    } catch (error) {
      const known = /^Choose between|^You already have/.test(error.message);
      if (!known) console.error('Reminder creation failed:', error.code || error.name);
      return interaction.editReply({ content: known ? error.message : 'Could not save that reminder. Please try again.', allowedMentions: { parse: [] } });
    }
    if (!reminder) return interaction.editReply('I could not understand that time. Try 30 mins, in 2 hrs, or tomorrow at noon PST.');
    const at = Math.floor(reminder.dueAt / 1000);
    if (!users.length) return interaction.editReply(`Got it. I will DM you <t:${at}:F> (<t:${at}:R>) with that reminder.`);
    const selected = [...new Set(users.map(user => user.id))];
    const others = selected.filter(id => id !== interaction.user.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`reminder:accept:${reminder.id}`).setLabel('Accept private reminder').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`reminder:decline:${reminder.id}`).setLabel('Decline / opt out').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`reminder:cancel:${reminder.id}`).setLabel('Cancel reminder').setStyle(ButtonStyle.Danger),
    );
    try {
      return await interaction.editReply({ content: `Private reminder for ${selected.map(id => `<@${id}>`).join(', ')}\n**When:** <t:${at}:F> (<t:${at}:R>)\n**Reminder:** ${text}\n\n${others.length ? 'Selected recipients other than the creator must click **Accept private reminder** before the scheduled time. Only selected people can accept. ' : ''}Delivery is by individual DM, not in this group. DMs from this bot must be allowed.`,
        components: [row], allowedMentions: { parse: [], users: others } });
    } catch (error) { this.store.cancelGroup(reminder, interaction.user.id); throw error; }
  }
  async button(interaction) {
    const match = /^reminder:(accept|decline|cancel):([a-f0-9-]{36})$/.exec(interaction.customId);
    if (!match) return false;
    const reminder = this.store.group(match[2], interaction.channelId, interaction.guildId);
    if (!reminder) { await interaction.reply({ content: 'This reminder is no longer active here.', flags: MessageFlags.Ephemeral }); return true; }
    let content;
    try {
      if (match[1] === 'cancel') { this.store.cancelGroup(reminder, interaction.user.id); content = 'This reminder has been cancelled for everyone.'; }
      else {
        this.store.consent(reminder, interaction.user.id, match[1] === 'accept');
        content = match[1] === 'accept' ? `You are scheduled for a private reminder <t:${Math.floor(reminder.dueAt / 1000)}:R>. Make sure this bot can DM you. Use Decline / opt out before then to stop your reminder.` : 'You will not receive this reminder.';
      }
    } catch (error) { content = error.message; }
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
}

module.exports = { reminderCommand, registerPrivateReminders, ReminderCommands };
