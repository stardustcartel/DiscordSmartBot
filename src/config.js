const path = require("node:path");
require("dotenv").config();

const projectRoot = path.join(__dirname, "..");

function resolveProjectPath(value, fallback) {
  const configuredPath = String(value || fallback || "").trim();
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(projectRoot, configuredPath);
}

function parseIdList(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\s,]+/)
        .map((part) => part.trim())
        .filter((part) => /^\d{15,25}$/.test(part)),
    ),
  ];
}

const configuredAiResponsesPerHour = Number.parseInt(
  process.env.AI_RESPONSES_PER_HOUR || "30",
  10,
);

const config = {
  projectRoot,
  discordToken: process.env.DISCORD_TOKEN || "",
  discordApplicationId: process.env.DISCORD_APPLICATION_ID || "",
  botName: String(process.env.BOT_NAME || "").trim(),
  botAvatarPath: process.env.BOT_AVATAR_PATH
    ? resolveProjectPath(process.env.BOT_AVATAR_PATH, "")
    : "",
  personalityFile: resolveProjectPath(
    process.env.PERSONALITY_FILE,
    "config/personality.txt",
  ),
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  aiResponsesPerHour:
    Number.isFinite(configuredAiResponsesPerHour) &&
    configuredAiResponsesPerHour > 0
      ? configuredAiResponsesPerHour
      : 30,
  knowledgeChannelIds: parseIdList(process.env.KNOWLEDGE_CHANNEL_IDS),
  reminderDefaultTimeZone:
    process.env.REMINDER_TIME_ZONE || "America/Los_Angeles",
  dataDirectory: resolveProjectPath(process.env.DATA_DIRECTORY, "data"),
};

module.exports = { config, parseIdList, resolveProjectPath };
