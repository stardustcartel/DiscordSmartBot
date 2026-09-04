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

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
  projectRoot,
  discordToken: process.env.DISCORD_TOKEN || "",
  discordApplicationId: process.env.DISCORD_APPLICATION_ID || "",
  botOwnerIds: parseIdList(process.env.BOT_OWNER_IDS),
  guildSecretsKey: process.env.GUILD_SECRETS_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  defaultAiResponsesPerHour: positiveInteger(
    process.env.DEFAULT_AI_RESPONSES_PER_HOUR,
    30,
  ),
  defaultReminderTimeZone:
    process.env.DEFAULT_REMINDER_TIME_ZONE || "America/Los_Angeles",
  defaultPersonalityFile: resolveProjectPath(
    process.env.DEFAULT_PERSONALITY_FILE,
    "config/personality.example.txt",
  ),
  dataDirectory: resolveProjectPath(process.env.DATA_DIRECTORY, "data"),
};

module.exports = { config, parseIdList, resolveProjectPath };
