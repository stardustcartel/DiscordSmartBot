const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, writeJson } = require("./storage");

const observationWindowMs = 30 * 60 * 1000;

function errorStatus(error) {
  const direct = Number(error?.status || error?.code);
  if (Number.isFinite(direct)) return direct;
  const match = String(error?.message || error || "").match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : 0;
}

function failureKind(error) {
  const status = errorStatus(error);
  const message = String(error?.message || error || "").toLowerCase();
  if (status === 429 || /resource[_ ]exhausted|quota exceeded|rate[_ ]limit|daily limit/.test(message)) return "limit";
  if ([404, 500, 502, 503, 504].includes(status) || /unavailable|overloaded|deadline exceeded/.test(message)) return "unavailable";
  return "error";
}

function retryDelay(error, outcome) {
  if (outcome === 'success' || outcome === 'error') return 0;
  const message = String(error?.message || '');
  const header = error?.response?.headers?.get?.('retry-after');
  const seconds = Number(header || /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(message)?.[1] || /retry (?:in|after)\s+([\d.]+)s/i.exec(message)?.[1]);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(1800000, Math.max(1000, seconds * 1000));
  if (errorStatus(error) === 404 || /daily|per.?day|requestsperday/i.test(message)) return 300000;
  return outcome === 'limit' ? 60000 : 15000;
}

class GeminiModelStatus {
  constructor(dataDirectory) {
    this.filePath = dataDirectory ? path.join(dataDirectory, "gemini-model-status.json") : null;
    this.data = this.filePath ? readJson(this.filePath, { guilds: {} }) : { guilds: {} };
    if (!this.data?.guilds || typeof this.data.guilds !== "object") this.data = { guilds: {} };
  }

  fingerprint(apiKey) { return crypto.createHash("sha256").update(String(apiKey)).digest("hex"); }

  state(guildId, apiKey) {
    if (!guildId || !/^\d{15,25}$/.test(guildId) || !apiKey) return null;
    const current = this.data.guilds[guildId];
    return current?.fingerprint === this.fingerprint(apiKey) ? current : null;
  }

  observe(guildId, apiKey, model, outcome, error = null) {
    if (!guildId || !/^\d{15,25}$/.test(guildId) || !apiKey || !model) return;
    const previous = this.state(guildId, apiKey);
    const now = Date.now();
    const entry = { outcome, observedAt: now, retryUntil: now + retryDelay(error, outcome) };
    this.data.guilds[guildId] = {
      fingerprint: this.fingerprint(apiKey),
      models: { ...(previous?.models || {}), [model]: entry },
      lastUsed: outcome === "success" ? { model, observedAt: now } : previous?.lastUsed || null,
    };
    if (this.filePath) {
      try { writeJson(this.filePath, this.data); fs.chmodSync(this.filePath, 0o600); }
      catch (error) { console.warn("Could not save Gemini model status:", error.code || error.message); }
    }
  }

  retryUntil(guildId, apiKey, model) {
    return this.state(guildId, apiKey)?.models?.[model]?.retryUntil || 0;
  }

  snapshot(guildId, apiKey, models, now = Date.now()) {
    const state = this.state(guildId, apiKey);
    return {
      models: models.map((model) => {
        const observation = state?.models?.[model];
        return { model, outcome: observation && now - observation.observedAt < observationWindowMs && now >= observation.observedAt ? observation.outcome : "unknown", observedAt: observation?.observedAt || null };
      }),
      lastUsed: state?.lastUsed || null,
    };
  }
}

module.exports = { GeminiModelStatus, failureKind, errorStatus, retryDelay };
