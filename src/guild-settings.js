const fs = require("node:fs");
const path = require("node:path");
const { readJson, writeJson } = require("./storage");

const fixedTimeZones = new Set([
  "UTC", "GMT", "PST", "PDT", "MST", "MDT", "CST", "CDT", "EST", "EDT",
]);

function loadDefaultPersonality(filePath) {
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return value || "You are a helpful, friendly Discord assistant.";
  } catch (error) {
    console.warn("Could not load default personality:", error.message);
    return "You are a helpful, friendly Discord assistant.";
  }
}

function normalizeTimeZone(value, fallback) {
  const candidate = String(value || fallback || "").trim();
  const upper = candidate.toUpperCase();
  if (fixedTimeZones.has(upper)) return upper;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return null;
  }
}

function cleanText(value, maximumLength) {
  return String(value || "").trim().slice(0, maximumLength);
}

function cleanChannelIds(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((channelId) => String(channelId || "").trim())
        .filter((channelId) => /^\d{15,25}$/.test(channelId)),
    ),
  ];
}

class GuildSettingsStore {
  constructor(config) {
    this.config = config;
    this.filePath = path.join(config.dataDirectory, "guild-settings.json");
    this.defaultPersonality = loadDefaultPersonality(
      config.defaultPersonalityFile,
    );
    this.data = readJson(this.filePath, { version: 1, guilds: {} });
    if (!this.data || typeof this.data !== "object") {
      this.data = { version: 1, guilds: {} };
    }
    if (!this.data.guilds || typeof this.data.guilds !== "object") {
      this.data.guilds = {};
    }
  }

  createDefault() {
    return {
      profile: {
        nickname: "",
        bio: "",
        avatarPath: "",
        bannerPath: "",
      },
      personality: this.defaultPersonality,
      knowledgeChannelIds: [],
      reminderTimeZone: this.config.defaultReminderTimeZone,
      aiResponsesPerHour: this.config.defaultAiResponsesPerHour,
    };
  }

  normalize(value) {
    const defaults = this.createDefault();
    const profile = value?.profile || {};
    const timeZone = normalizeTimeZone(
      value?.reminderTimeZone,
      defaults.reminderTimeZone,
    );
    const responseLimit = Number.parseInt(value?.aiResponsesPerHour, 10);
    return {
      profile: {
        nickname: cleanText(profile.nickname, 32),
        bio: cleanText(profile.bio, 190),
        avatarPath: cleanText(profile.avatarPath, 500),
        bannerPath: cleanText(profile.bannerPath, 500),
      },
      personality:
        cleanText(value?.personality, 12_000) || defaults.personality,
      knowledgeChannelIds: cleanChannelIds(value?.knowledgeChannelIds),
      reminderTimeZone: timeZone || defaults.reminderTimeZone,
      aiResponsesPerHour:
        Number.isFinite(responseLimit) && responseLimit > 0
          ? Math.min(responseLimit, 500)
          : defaults.aiResponsesPerHour,
    };
  }

  get(guildId) {
    return this.normalize(this.data.guilds[guildId]);
  }

  getDirectMessageSettings() {
    return this.createDefault();
  }

  update(guildId, updater) {
    const next = this.normalize(updater(this.get(guildId)));
    this.data.guilds[guildId] = next;
    writeJson(this.filePath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      guilds: this.data.guilds,
    });
    return next;
  }

  setProfile(guildId, changes) {
    return this.update(guildId, (current) => ({
      ...current,
      profile: { ...current.profile, ...changes },
    }));
  }

  setPersonality(guildId, personality) {
    return this.update(guildId, (current) => ({
      ...current,
      personality,
    }));
  }

  addKnowledgeChannel(guildId, channelId) {
    return this.update(guildId, (current) => ({
      ...current,
      knowledgeChannelIds: [
        ...new Set([...current.knowledgeChannelIds, channelId]),
      ],
    }));
  }

  removeKnowledgeChannel(guildId, channelId) {
    return this.update(guildId, (current) => ({
      ...current,
      knowledgeChannelIds: current.knowledgeChannelIds.filter(
        (configuredId) => configuredId !== channelId,
      ),
    }));
  }

  setLimits(guildId, changes) {
    return this.update(guildId, (current) => ({ ...current, ...changes }));
  }
}

module.exports = { GuildSettingsStore, normalizeTimeZone };
