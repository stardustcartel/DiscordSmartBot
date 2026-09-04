const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");
const { config } = require("./config");
const { GeminiChat } = require("./ai");
const { KnowledgeBase } = require("./knowledge");
const { ReminderStore } = require("./reminders");

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

const ai = new GeminiChat(config);
const knowledge = new KnowledgeBase(config);
const reminders = new ReminderStore(config);

const commands = [
  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Chat with the AI")
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("What would you like to say?")
        .setRequired(true)
        .setMaxLength(2_000),
    ),
  new SlashCommandBuilder()
    .setName("knowledge-search")
    .setDescription("Search the local server knowledge base")
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
    .setDescription("Show the knowledge-base status")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("knowledge-sync")
    .setDescription("Backfill the configured knowledge channels")
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
        .setName("time-zone")
        .setDescription("PST, EST, UTC, or an IANA time zone")
        .setRequired(true)
        .setMaxLength(50),
    )
    .addStringOption((option) =>
      option
        .setName("when")
        .setDescription("30 mins, in 2 hrs, or tomorrow at noon PST")
        .setRequired(true)
        .setMaxLength(100),
    ),
  new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Restart this bot instance")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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

function aiErrorMessage(error) {
  if (error.code === "AI_NOT_CONFIGURED") {
    return "Gemini is not configured for this bot instance. Add GEMINI_API_KEY to its private .env file.";
  }
  if (error.code === "AI_RATE_LIMITED") {
    return "This bot instance has reached its configured AI response limit for the hour.";
  }
  return "I could not reach Gemini right now. Please try again later.";
}

async function handleChatInteraction(interaction) {
  const text = interaction.options.getString("message", true).trim();
  await interaction.deferReply();
  try {
    const response = await ai.respond(interaction.user.id, text);
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
    await interaction.reply({
      content: [
        "Indexed messages: " + knowledge.messages.size.toLocaleString(),
        "Configured channels: " +
          (knowledge.channelIds.length > 0
            ? knowledge.channelIds.join(", ")
            : "none"),
      ].join("\n"),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "search") {
    const query = interaction.options.getString("query", true);
    const results = knowledge.search(query);
    if (results.length === 0) {
      await interaction.reply({
        content: "I could not find anything matching that in the knowledge base.",
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
    const result = await knowledge.sync(client);
    await interaction.editReply(
      "Knowledge sync complete. Fetched " +
        result.fetched.toLocaleString() +
        " message(s); " +
        result.indexed.toLocaleString() +
        " message(s) are indexed.",
    );
  } catch (error) {
    console.error("Knowledge sync failed:", error.message);
    await interaction.editReply("Knowledge sync failed: " + error.message);
  }
}

async function handleReminderInteraction(interaction) {
  const reminder = reminders.add({
    userId: interaction.user.id,
    text: interaction.options.getString("message", true).trim(),
    timeZone: interaction.options.getString("time-zone", true).trim(),
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
  if (!hasPermission(interaction, PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server managers can restart this bot instance.",
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({
    content: "Restarting this bot instance now.",
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

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "chat") {
    await handleChatInteraction(interaction);
  } else if (interaction.commandName.startsWith("knowledge-")) {
    await handleKnowledgeInteraction(interaction);
  } else if (interaction.commandName === "remind") {
    await handleReminderInteraction(interaction);
  } else if (interaction.commandName === "restart") {
    await handleRestartInteraction(interaction);
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
      content: "*Oink.* Send me a question or message and I will do my best to help.",
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  try {
    const response = await ai.respond(message.author.id, text);
    await sendMessageChunks(message.channel, response, message);
  } catch (error) {
    console.error("Message chat failed:", error.message);
    await message.reply({
      content: aiErrorMessage(error),
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
}

async function applyBotProfile(user) {
  if (config.botName && user.username !== config.botName) {
    try {
      await user.setUsername(config.botName);
    } catch (error) {
      console.warn("Could not set configured bot name:", error.message);
    }
  }
  if (config.botAvatarPath && fs.existsSync(config.botAvatarPath)) {
    try {
      const extension = path.extname(config.botAvatarPath).toLowerCase();
      const mimeType = extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : "image/png";
      const image = fs.readFileSync(config.botAvatarPath).toString("base64");
      await user.setAvatar("data:" + mimeType + ";base64," + image);
    } catch (error) {
      console.warn("Could not set configured bot avatar:", error.message);
    }
  }
}

client.once(Events.ClientReady, (readyClient) => {
  (async () => {
    console.log("Logged in as " + readyClient.user.tag);
    await applyBotProfile(readyClient.user);
    await readyClient.application.commands.set(
      commands,
      config.discordGuildId || undefined,
    );
    console.log(
      "Registered " +
        commands.length +
        (config.discordGuildId
          ? " server slash commands."
          : " global slash commands."),
    );
    reminders.start(client);
  })().catch((error) => {
    console.error("Bot startup failed:", error.message);
    client.destroy();
    process.exit(1);
  });
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
  isReplyToBot(message).then((replied) => {
    if (mentioned || replied) {
      return handleTextChat(message, text);
    }
    return null;
  }).catch((error) => console.error("Message handling failed:", error.message));
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
