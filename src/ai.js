const { GoogleGenAI } = require("@google/genai");

const maxConversationMessages = 12;
const fallbackPersonality = "You are a helpful, friendly Discord assistant.";

function geminiErrorStatus(error) {
  const directStatus = Number(error?.status || error?.code);
  if (Number.isFinite(directStatus)) return directStatus;
  const match = String(error?.message || error || "").match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : 0;
}

function canTryNextModel(error) {
  const status = geminiErrorStatus(error);
  const message = String(error?.message || error || "").toLowerCase();
  return (
    [404, 429, 500, 502, 503, 504].includes(status) ||
    /quota|resource[_ ]exhausted|rate[_ ]limit|model[_ ]not[_ ]found|unavailable|temporarily|high demand|overloaded|internal server error|deadline exceeded/.test(
      message,
    )
  );
}

class GeminiChat {
  constructor(config) {
    this.config = config;
    this.clients = new Map();
    this.conversations = new Map();
    this.usage = new Map();
  }

  getClient(apiKey) {
    if (!this.clients.has(apiKey)) {
      this.clients.set(apiKey, new GoogleGenAI({ apiKey }));
    }
    return this.clients.get(apiKey);
  }

  reserveResponse(scopeId, userId, responseLimit) {
    const key = scopeId + ":" + userId;
    const now = Date.now();
    const recent = (this.usage.get(key) || []).filter(
      (timestamp) => now - timestamp < 60 * 60 * 1000,
    );
    if (recent.length >= responseLimit) {
      this.usage.set(key, recent);
      return false;
    }
    recent.push(now);
    this.usage.set(key, recent);
    return true;
  }

  async respond({
    apiKey,
    scopeId,
    userId,
    text,
    personality,
    responseLimit,
  }) {
    if (!apiKey) {
      const error = new Error("No Gemini API key is configured for this server");
      error.code = "AI_NOT_CONFIGURED";
      throw error;
    }
    const limit =
      Number.isFinite(responseLimit) && responseLimit > 0
        ? responseLimit
        : this.config.defaultAiResponsesPerHour;
    if (!this.reserveResponse(scopeId, userId, limit)) {
      const error = new Error("AI response rate limit reached");
      error.code = "AI_RATE_LIMITED";
      throw error;
    }

    const conversationKey = scopeId + ":" + userId;
    const previous = this.conversations.get(conversationKey) || [];
    const conversation = [
      ...previous,
      { role: "user", parts: [{ text }] },
    ];
    let response;
    let lastError;
    const models = this.config.geminiModels || [this.config.geminiModel];
    for (const [index, model] of models.entries()) {
      try {
        response = await this.getClient(apiKey).models.generateContent({
          model,
          contents: conversation,
          config: {
            systemInstruction:
              String(personality || "").trim() || fallbackPersonality,
            maxOutputTokens: 1200,
            temperature: 0.8,
          },
        });
        break;
      } catch (error) {
        lastError = error;
        if (index === models.length - 1 || !canTryNextModel(error)) throw error;
        console.warn(
          "Gemini model " + model + " failed; trying the next configured model.",
        );
      }
    }
    if (!response) throw lastError || new Error("Gemini did not return a response.");
    const responseText = String(response.text || "").trim();
    if (!responseText) {
      throw new Error("Gemini returned an empty response");
    }
    this.conversations.set(
      conversationKey,
      [...conversation, { role: "model", parts: [{ text: responseText }] }].slice(
        -maxConversationMessages,
      ),
    );
    return responseText;
  }
}

module.exports = { GeminiChat };
