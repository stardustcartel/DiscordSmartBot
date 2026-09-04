const { GoogleGenAI } = require("@google/genai");

const maxConversationMessages = 12;
const fallbackPersonality = "You are a helpful, friendly Discord assistant.";

class GeminiChat {
  constructor(config) {
    this.config = config;
    this.ai = config.geminiApiKey
      ? new GoogleGenAI({ apiKey: config.geminiApiKey })
      : null;
    this.conversations = new Map();
    this.usage = new Map();
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

  async respond({ scopeId, userId, text, personality, responseLimit }) {
    if (!this.ai) {
      const error = new Error("GEMINI_API_KEY is missing");
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
    const response = await this.ai.models.generateContent({
      model: this.config.geminiModel,
      contents: conversation,
      config: {
        systemInstruction:
          String(personality || "").trim() || fallbackPersonality,
        maxOutputTokens: 1200,
        temperature: 0.8,
      },
    });
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
