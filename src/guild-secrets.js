const crypto = require("node:crypto");
const path = require("node:path");
const { readJson, writeJson } = require("./storage");

function getEncryptionKey(value) {
  const key = Buffer.from(String(value || "").trim(), "base64");
  if (key.length !== 32) {
    throw new Error(
      "GUILD_SECRETS_KEY must be a base64-encoded 32-byte encryption key.",
    );
  }
  return key;
}

class GuildSecretsStore {
  constructor(config) {
    this.filePath = path.join(config.dataDirectory, "guild-secrets.json");
    this.key = getEncryptionKey(config.guildSecretsKey);
    this.data = readJson(this.filePath, { version: 1, guilds: {} });
    if (!this.data || typeof this.data !== "object") {
      this.data = { version: 1, guilds: {} };
    }
    if (!this.data.guilds || typeof this.data.guilds !== "object") {
      this.data.guilds = {};
    }
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(String(value), "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  decrypt(payload) {
    if (!payload?.iv || !payload?.tag || !payload?.ciphertext) return "";
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(payload.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      console.error("Could not decrypt a guild Gemini key:", error.message);
      return "";
    }
  }

  hasGeminiKey(guildId) {
    return Boolean(this.getGeminiKey(guildId));
  }

  getGeminiKey(guildId) {
    return this.decrypt(this.data.guilds[guildId]?.geminiApiKey);
  }

  setGeminiKey(guildId, apiKey) {
    const cleanedKey = String(apiKey || "").trim();
    if (!/^\d{15,25}$/.test(guildId)) {
      throw new Error("Guild ID must be a Discord snowflake.");
    }
    if (!cleanedKey) {
      throw new Error("Gemini API key cannot be empty.");
    }
    this.data.guilds[guildId] = {
      ...this.data.guilds[guildId],
      geminiApiKey: this.encrypt(cleanedKey),
      updatedAt: new Date().toISOString(),
    };
    writeJson(this.filePath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      guilds: this.data.guilds,
    });
  }
}

module.exports = { GuildSecretsStore };
