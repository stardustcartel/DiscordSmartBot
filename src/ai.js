const fs = require("node:fs");
const { GoogleGenAI } = require("@google/genai");

const maxConversationMessages = 12;

function loadPersonality(filePath) {
  try {
    const personality = fs.readFileSync(filePath, "utf8").trim();
    return personality || "You are a helpful Discord assistant.";
  } catch (error) {
    console.warn("Could not load personality file " + filePath + ":", error.message);
    return "You are a helpful Discord assistant.";
  }
}

class GeminiChat {
  constructor(config) {
    this.config = config;
    this.ai = config.geminiApiKey
      ? new GoogleGenAI({ apiKey: config.geminiApiKey })
      : null;
    this.personality = loadPersonality(config.personalityFile);
    this.conversations = new Map();
    this.usage = new Map();
  }

  reloadPersonality() {
    this.personality = loadPersonality(this.config.personalityFile);
  }

  reserveResponse(userId) {
    const now = Date.now();
    const recent = (this.usage.get(userId) || []).filter(
      (timestamp) => now - timestamp < 60 * 60 * 1000,
    );
    if (recent.length >= this.config.aiResponsesPerHour) {
      this.usage.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.usage.set(userId, recent);
    return true;
  }

  async respond(userId, text) {
    if (!this.ai) {
      const error = new Error("GEMINI_API_KEY is missing");
      error.code = "AI_NOT_CONFIGURED";
      throw error;
    }
    if (!this.reserveResponse(userId)) {
      const error = new Error("AI response rate limit reached");
      error.code = "AI_RATE_LIMITED";
      throw error;
    }

    const previous = this.conversations.get(userId) || [];
    const conversation = [
      ...previous,
      { role: "user", parts: [{ text }] },
    ];
    const response = await this.ai.models.generateContent({
      model: this.config.geminiModel,
      contents: conversation,
      config: {
        systemInstruction: this.personality,
        maxOutputTokens: 1200,
        temperature: 0.8,
      },
    });
    const responseText = String(response.text || "").trim();
    if (!responseText) {
      throw new Error("Gemini returned an empty response");
    }
    this.conversations.set(
      userId,
      [...conversation, { role: "model", parts: [{ text: responseText }] }].slice(
        -maxConversationMessages,
      ),
    );
    return responseText;
  }
}

module.exports = { GeminiChat };
