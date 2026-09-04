const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Events,
  GatewayIntentBits,
  ActionRowBuilder,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { config } = require("./config");
const { GeminiChat } = require("./ai");
const { GuildSettingsStore, normalizeTimeZone } = require("./guild-settings");
const { GuildSecretsStore } = require("./guild-secrets");
const { KnowledgeBase } = require("./knowledge");
const { ReminderStore } = require("./reminders");
const { ensureParentDirectory } = require("./storage");

if (!config.discordToken) {
  throw new Error("DISCORD_TOKEN is missing from .env");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const guildSettings = new GuildSettingsStore(config);
const guildSecrets = new GuildSecretsStore(config);
const ai = new GeminiChat(config);
const knowledge = new KnowledgeBase(config, guildSettings);
const reminders = new ReminderStore({
  ...config,
  reminderDefaultTimeZone: config.defaultReminderTimeZone,
});

const chatCommand = new SlashCommandBuilder()
  .setName("chat")
  .setDescription("Chat with the AI")
  .setDMPermission(true)
  .addStringOption((option) =>
    option
      .setName("message")
      .setDescription("What would you like to say?")
      .setRequired(true)
      .setMaxLength(2_000),
  );

const serverCommands = [
  chatCommand,
  new SlashCommandBuilder()
    .setName("knowledge-search")
    .setDescription("Search this server's local knowledge base")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("What should I search for?")
        .setRequired(true)
        .setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("knowledge-status")
    .setDescription("Show this server's knowledge-base status")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("knowledge-sync")
    .setDescription("Backfill this server's configured knowledge channels")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Create a private DM reminder")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("What should I remind you about?")
        .setRequired(true)
        .setMaxLength(1_000),
    )
    .addStringOption((option) =>
      option
        .setName("when")
        .setDescription("30 mins, in 2 hrs, or tomorrow at noon PST")
        .setRequired(true)
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName("time-zone")
        .setDescription("Optional: PST, EST, UTC, or an IANA time zone")
        .setRequired(false)
        .setMaxLength(50),
    ),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure this server's bot profile and settings")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("profile")
        .setDescription("Set this server's bot nickname, avatar, banner, or bio")
        .addStringOption((option) =>
          option
            .setName("nickname")
            .setDescription("Visible bot name in this server")
            .setRequired(false)
            .setMaxLength(32),
        )
        .addStringOption((option) =>
          option
            .setName("bio")
            .setDescription("Bot profile bio in this server")
            .setRequired(false)
            .setMaxLength(190),
        )
        .addAttachmentOption((option) =>
          option
            .setName("avatar")
            .setDescription("Server-specific bot avatar image")
            .setRequired(false),
        )
        .addAttachmentOption((option) =>
          option
            .setName("banner")
            .setDescription("Server-specific bot banner image")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("personality")
        .setDescription("Set the AI personality for this server")
        .addStringOption((option) =>
          option
            .setName("instructions")
            .setDescription("Instructions that guide the AI in this server")
            .setRequired(true)
            .setMaxLength(4_000),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("knowledge-add")
        .setDescription("Add a text channel to this server's knowledge base")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to index")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("knowledge-remove")
        .setDescription("Remove a text channel from this server's knowledge base")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to stop indexing")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("limits")
        .setDescription("Set this server's AI and reminder defaults")
        .addIntegerOption((option) =>
          option
            .setName("ai-responses-per-hour")
            .setDescription("Per-user hourly AI response limit")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(500),
        )
        .addStringOption((option) =>
          option
            .setName("reminder-time-zone")
            .setDescription("PST, EST, UTC, or an IANA time zone")
            .setRequired(false)
            .setMaxLength(50),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ai-key-status")
        .setDescription("Check whether this server's Gemini key is configured"),
    ),
    .addSubcommand((subcommand) =>
      subcommand
        .setName("api-key")
        .setDescription("Securely save or replace this server's Gemini API key"),
    ),
  new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Restart the shared bot service")
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("update")
    .setDescription("Manage server roles")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("role")
        .setDescription("Assign a role to a server member")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The member whose role should change")
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("The role to assign")
            .setRequired(true),
        ),
    ),
].map((command) => command.toJSON());

const directMessageCommands = [chatCommand.toJSON()];

function splitMessage(text, maximumLength = 1_900) {
  const chunks = [];
  let remaining = String(text || "");
  while (remaining.length > maximumLength) {
    let splitAt = remaining.lastIndexOf("\n", maximumLength);
    if (splitAt < Math.floor(maximumLength / 2)) splitAt = maximumLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendMessageChunks(channel, text, sourceMessage = null) {
  const chunks = splitMessage(text);
  if (chunks.length === 0) return;
  if (sourceMessage) {
    await sourceMessage.reply({
      content: chunks[0],
      allowedMentions: { parse: [], repliedUser: false },
    });
  } else {
    await channel.send({ content: chunks[0], allowedMentions: { parse: [] } });
  }
  for (const chunk of chunks.slice(1)) {
    await channel.send({ content: chunk, allowedMentions: { parse: [] } });
  }
}

function hasPermission(interaction, permission) {
  return Boolean(interaction.memberPermissions?.has(permission));
}

function isBotOwner(userId) {
  return config.botOwnerIds.includes(userId);
}

function aiErrorMessage(error) {
  if (error.code === "AI_NOT_CONFIGURED") {
    return "This server does not have a Gemini API key configured yet. A server manager can add one with /setup api-key.";
  }
  if (error.code === "AI_RATE_LIMITED") {
    return "This server has reached its configured AI response limit for the hour.";
  }
  return "I could not reach Gemini right now. Please try again later.";
}

function getSettingsForGuild(guildId) {
  return guildId
    ? guildSettings.get(guildId)
    : guildSettings.getDirectMessageSettings();
}

async function requestAiResponse({ guildId, userId, text }) {
  const settings = getSettingsForGuild(guildId);
  return ai.respond({
    apiKey: guildId ? guildSecrets.getGeminiKey(guildId) : "",
    scopeId: guildId || "direct-messages",
    userId,
    text,
    personality: settings.personality,
    responseLimit: settings.aiResponsesPerHour,
  });
}

async function handleChatInteraction(interaction) {
  const text = interaction.options.getString("message", true).trim();
  await interaction.deferReply();
  try {
    const response = await requestAiResponse({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      text,
    });
    const chunks = splitMessage(response);
    await interaction.editReply({
      content: chunks.shift() || "Gemini returned an empty response.",
      allowedMentions: { parse: [] },
    });
    for (const chunk of chunks) {
      await interaction.followUp({
        content: chunk,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    console.error("Chat command failed:", error.message);
    await interaction.editReply({
      content: aiErrorMessage(error),
      allowedMentions: { parse: [] },
    });
  }
}

async function handleKnowledgeInteraction(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Knowledge-base commands are only available in a server.",
      ephemeral: true,
    });
    return;
  }
  const subcommand = interaction.commandName.replace("knowledge-", "");
  if (
    subcommand !== "search" &&
    !hasPermission(interaction, PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "Only server managers can use this knowledge-base command.",
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "status") {
    const settings = guildSettings.get(interaction.guildId);
    await interaction.reply({
      content: [
        "Indexed messages: " +
          knowledge.count(interaction.guildId).toLocaleString(),
        "Configured channels: " +
          (settings.knowledgeChannelIds.length > 0
            ? settings.knowledgeChannelIds.join(", ")
            : "none"),
      ].join("\n"),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "search") {
    const query = interaction.options.getString("query", true);
    const results = knowledge.search(query, interaction.guildId);
    if (results.length === 0) {
      await interaction.reply({
        content: "I could not find anything matching that in this server's knowledge base.",
        ephemeral: true,
      });
      return;
    }
    const content = results
      .map(
        ({ message, score }, index) =>
          (index + 1) +
          ". #" +
          message.channelName +
          " (score " +
          score +
          ")\n" +
          message.content.slice(0, 700) +
          "\n" +
          (message.url || "No source link available"),
      )
      .join("\n\n");
    await interaction.reply({
      content: content.slice(0, 1_900),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await knowledge.sync(client, interaction.guildId);
    await interaction.editReply(
      "Knowledge sync complete. Fetched " +
        result.fetched.toLocaleString() +
        " message(s); " +
        result.indexed.toLocaleString() +
        " message(s) are indexed for this server.",
    );
  } catch (error) {
    console.error("Knowledge sync failed:", error.message);
    await interaction.editReply("Knowledge sync failed: " + error.message);
  }
}

async function handleReminderInteraction(interaction) {
  const settings = getSettingsForGuild(interaction.guildId);
  const reminder = reminders.add({
    userId: interaction.user.id,
    text: interaction.options.getString("message", true).trim(),
    timeZone:
      interaction.options.getString("time-zone")?.trim() ||
      settings.reminderTimeZone,
    when: interaction.options.getString("when", true).trim(),
  });
  if (!reminder) {
    await interaction.reply({
      content:
        "I could not understand that time. Try 30 mins, in 2 hrs, or tomorrow at noon PST.",
      ephemeral: true,
    });
    return;
  }
  await interaction.reply(
    "Got it. I will DM you <t:" +
      Math.floor(reminder.dueAt / 1_000) +
      ":F> (<t:" +
      Math.floor(reminder.dueAt / 1_000) +
      ":R>) with that reminder.",
  );
}

async function handleRestartInteraction(interaction) {
  if (!isBotOwner(interaction.user.id)) {
    await interaction.reply({
      content: "Only the shared bot owner can restart the service.",
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({
    content: "Restarting the shared bot service now.",
    ephemeral: true,
  });
  setTimeout(() => {
    reminders.stop();
    client.destroy();
    process.exit(0);
  }, 500);
}

async function handleUpdateRoleInteraction(interaction) {
  if (!hasPermission(interaction, PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: "You need Manage Roles to use this command.",
      ephemeral: true,
    });
    return;
  }
  const target = await interaction.guild.members.fetch(
    interaction.options.getUser("user", true).id,
  );
  const role = interaction.options.getRole("role", true);
  const botMember =
    interaction.guild.members.me ||
    (await interaction.guild.members.fetchMe());
  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: "That role must be below my highest role.",
      ephemeral: true,
    });
    return;
  }
  try {
    await target.roles.add(role, "Assigned by " + interaction.user.tag);
    await interaction.reply({
      content: "Assigned " + role + " to " + target + ".",
      allowedMentions: { users: [target.id], roles: [role.id] },
    });
  } catch (error) {
    console.error("Role update failed:", error.message);
    await interaction.reply({
      content: "I could not assign that role. Check my Manage Roles permission.",
      ephemeral: true,
    });
  }
}

function attachmentExtension(attachment) {
  const extension = path.extname(
    new URL(attachment.url).pathname,
  ).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    return extension;
  }
  return ".png";
}

async function saveGuildImage(guildId, kind, attachment) {
  if (
    attachment.contentType &&
    !attachment.contentType.toLowerCase().startsWith("image/")
  ) {
    throw new Error("The " + kind + " attachment must be an image.");
  }
  if (attachment.size && attachment.size > 8 * 1024 * 1024) {
    throw new Error("The " + kind + " image must be 8 MB or smaller.");
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error("Could not download the " + kind + " image.");
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length === 0 || content.length > 8 * 1024 * 1024) {
    throw new Error("The " + kind + " image must be between 1 byte and 8 MB.");
  }
  const destination = path.join(
    config.dataDirectory,
    "guild-assets",
    guildId,
    kind + attachmentExtension(attachment),
  );
  ensureParentDirectory(destination);
  fs.writeFileSync(destination, content);
  return destination;
}

function imageDataUri(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const extension = path.extname(filePath).toLowerCase();
  const mimeType =
    extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : extension === ".gif"
          ? "image/gif"
          : "image/png";
  return "data:" + mimeType + ";base64," +
    fs.readFileSync(filePath).toString("base64");
}

async function applyGuildProfile(guild, profile) {
  const body = {};
  if (profile.nickname) body.nick = profile.nickname;
  if (profile.bio) body.bio = profile.bio;
  const avatar = imageDataUri(profile.avatarPath);
  const banner = imageDataUri(profile.bannerPath);
  if (avatar) body.avatar = avatar;
  if (banner) body.banner = banner;
  if (Object.keys(body).length === 0) return;
  await client.rest.patch(Routes.guildMember(guild.id, "@me"), { body });
}

async function handleSetupProfile(interaction) {
  const nickname = interaction.options.getString("nickname");
  const bio = interaction.options.getString("bio");
  const avatar = interaction.options.getAttachment("avatar");
  const banner = interaction.options.getAttachment("banner");
  if (nickname === null && bio === null && !avatar && !banner) {
    await interaction.reply({
      content: "Provide at least one profile value to update.",
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const changes = {};
    if (nickname !== null) changes.nickname = nickname.trim();
    if (bio !== null) changes.bio = bio.trim();
    if (avatar) {
      changes.avatarPath = await saveGuildImage(
        interaction.guildId,
        "avatar",
        avatar,
      );
    }
    if (banner) {
      changes.bannerPath = await saveGuildImage(
        interaction.guildId,
        "banner",
        banner,
      );
    }
    const settings = guildSettings.setProfile(interaction.guildId, changes);
    await applyGuildProfile(interaction.guild, settings.profile);
    await interaction.editReply(
      "This server's bot profile was updated. Discord may take a moment to show it everywhere.",
    );
  } catch (error) {
    console.error("Guild profile update failed:", error.message);
    await interaction.editReply("Profile update failed: " + error.message);
  }
}

async function handleSetupPersonality(interaction) {
  const personality = interaction.options.getString("instructions", true).trim();
  guildSettings.setPersonality(interaction.guildId, personality);
  await interaction.reply({
    content: "This server's AI personality was updated.",
    ephemeral: true,
  });
}

async function handleSetupKnowledgeChannel(interaction, remove) {
  const channel = interaction.options.getChannel("channel", true);
  if (!channel.isTextBased() || channel.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "Choose a text channel in this server.",
      ephemeral: true,
    });
    return;
  }
  const settings = remove
    ? guildSettings.removeKnowledgeChannel(interaction.guildId, channel.id)
    : guildSettings.addKnowledgeChannel(interaction.guildId, channel.id);
  if (remove) knowledge.save();
  await interaction.reply({
    content:
      (remove ? "Stopped indexing " : "Added ") +
      channel +
      ". Configured knowledge channels: " +
      (settings.knowledgeChannelIds.length || "none") +
      ".",
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function handleSetupLimits(interaction) {
  const responseLimit = interaction.options.getInteger("ai-responses-per-hour");
  const timeZone = interaction.options.getString("reminder-time-zone");
  if (responseLimit === null && timeZone === null) {
    await interaction.reply({
      content: "Provide an AI response limit, a reminder time zone, or both.",
      ephemeral: true,
    });
    return;
  }
  const changes = {};
  if (responseLimit !== null) changes.aiResponsesPerHour = responseLimit;
  if (timeZone !== null) {
    const normalized = normalizeTimeZone(timeZone, "");
    if (!normalized) {
      await interaction.reply({
        content: "That is not a valid time zone. Try PST, EST, UTC, or America/Los_Angeles.",
        ephemeral: true,
      });
      return;
    }
    changes.reminderTimeZone = normalized;
  }
  const settings = guildSettings.setLimits(interaction.guildId, changes);
  await interaction.reply({
    content:
      "Server defaults updated. AI limit: " +
      settings.aiResponsesPerHour +
      " per user/hour. Reminder time zone: " +
      settings.reminderTimeZone +
      ".",
    ephemeral: true,
  });
}

async function handleSetupAiKeyStatus(interaction) {
  await interaction.reply({
    content: guildSecrets.hasGeminiKey(interaction.guildId)
      ? "A Gemini API key is configured for this server."
      : "No Gemini API key is configured for this server. A server manager can add one with /setup api-key.",
    ephemeral: true,
  });
}

async function showSetupGeminiKeyModal(interaction) {
  const keyInput = new TextInputBuilder()
    .setCustomId("gemini-api-key")
    .setLabel("Gemini API key")
    .setPlaceholder("Paste this server's Gemini API key")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(200);
  const modal = new ModalBuilder()
    .setCustomId("setup-gemini-api-key")
    .setTitle("Configure Gemini API key")
    .addComponents(new ActionRowBuilder().addComponents(keyInput));
  await interaction.showModal(modal);
}

async function handleSetupGeminiKeyModal(interaction) {
  if (!interaction.guildId || !hasPermission(interaction, PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server managers can configure this server's Gemini API key.",
      ephemeral: true,
    });
    return;
  }
  const apiKey = interaction.fields.getTextInputValue("gemini-api-key");
  guildSecrets.setGeminiKey(interaction.guildId, apiKey);
  await interaction.reply({
    content: "Gemini API key saved for this server. The key is encrypted and will not be shown again.",
    ephemeral: true,
  });
}

async function handleSetupInteraction(interaction) {
  if (!hasPermission(interaction, PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server managers can configure this server's bot settings.",
      ephemeral: true,
    });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "profile") return handleSetupProfile(interaction);
  if (subcommand === "personality") return handleSetupPersonality(interaction);
  if (subcommand === "knowledge-add") {
    return handleSetupKnowledgeChannel(interaction, false);
  }
  if (subcommand === "knowledge-remove") {
    return handleSetupKnowledgeChannel(interaction, true);
  }
  if (subcommand === "limits") return handleSetupLimits(interaction);
  if (subcommand === "ai-key-status") {
    return handleSetupAiKeyStatus(interaction);
  }
  if (subcommand === "api-key") return showSetupGeminiKeyModal(interaction);
  return null;
}

async function handleInteraction(interaction) {
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "setup-gemini-api-key") {
      return handleSetupGeminiKeyModal(interaction);
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "chat") {
    await handleChatInteraction(interaction);
  } else if (interaction.commandName.startsWith("knowledge-")) {
    await handleKnowledgeInteraction(interaction);
  } else if (interaction.commandName === "remind") {
    await handleReminderInteraction(interaction);
  } else if (interaction.commandName === "restart") {
    await handleRestartInteraction(interaction);
  } else if (interaction.commandName === "setup") {
    await handleSetupInteraction(interaction);
  } else if (
    interaction.commandName === "update" &&
    interaction.options.getSubcommand() === "role"
  ) {
    await handleUpdateRoleInteraction(interaction);
  }
}

async function isReplyToBot(message) {
  if (!message.reference?.messageId) return false;
  if (message.mentions.repliedUser?.id === client.user.id) return true;
  try {
    const referenced = await message.fetchReference();
    return referenced.author?.id === client.user.id;
  } catch {
    return false;
  }
}

async function handleTextChat(message, text) {
  if (!text) {
    await message.reply({
      content: "Send me a question or message and I will do my best to help.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  try {
    const response = await requestAiResponse({
      guildId: message.guildId,
      userId: message.author.id,
      text,
    });
    await sendMessageChunks(message.channel, response, message);
  } catch (error) {
    console.error("Message chat failed:", error.message);
    await message.reply({
      content: aiErrorMessage(error),
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
}

async function registerGuildCommands(guild) {
  await guild.commands.set(serverCommands);
  console.log("Registered server commands for " + guild.name + ".");
}

client.once(Events.ClientReady, (readyClient) => {
  (async () => {
    console.log("Logged in as " + readyClient.user.tag);
    await readyClient.application.commands.set(directMessageCommands);
    console.log("Registered " + directMessageCommands.length + " global DM command.");
    const results = await Promise.allSettled(
      [...client.guilds.cache.values()].map((guild) => registerGuildCommands(guild)),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      console.warn("Could not register commands in " + failures.length + " server(s).");
    }
    reminders.start(client);
  })().catch((error) => {
    console.error("Bot startup failed:", error.message);
    client.destroy();
    process.exit(1);
  });
});

client.on(Events.GuildCreate, (guild) => {
  registerGuildCommands(guild).catch((error) =>
    console.error("Could not register new-server commands:", error.message),
  );
});

client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(interaction).catch((error) => {
    console.error("Interaction handling failed:", error.message);
  });
});

client.on(Events.MessageCreate, (message) => {
  if (knowledge.upsert(message)) knowledge.save();
  if (message.author.bot || message.mentions.everyone) return;
  if (!message.guildId) {
    handleTextChat(message, message.content.trim()).catch((error) =>
      console.error("Direct-message handling failed:", error.message),
    );
    return;
  }
  const mentioned = message.mentions.has(client.user.id);
  const mentionPattern = new RegExp("<@!?" + client.user.id + ">", "g");
  const text = mentioned
    ? message.content.replace(mentionPattern, "").trim()
    : message.content.trim();
  isReplyToBot(message)
    .then((replied) => {
      if (mentioned || replied) return handleTextChat(message, text);
      return null;
    })
    .catch((error) => console.error("Message handling failed:", error.message));
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  if (knowledge.upsert(newMessage)) knowledge.save();
});

client.on(Events.MessageDelete, (message) => {
  if (knowledge.remove(message)) knowledge.save();
});

function shutdown() {
  reminders.stop();
  client.destroy();
}

process.once("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.once("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

client.login(config.discordToken);
