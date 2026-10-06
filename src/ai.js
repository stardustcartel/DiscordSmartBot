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

class AiChat {
  constructor(config) {
    this.config = config;
    this.conversations = new Map();
    this.usage = new Map();
  }

  getClient(apiKey) {
    return new GoogleGenAI({ apiKey });
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
    provider = "gemini",
    model,
    scopeId,
    userId,
    text,
    personality,
    responseLimit,
  }) {
    if (!apiKey) {
      const error = new Error(`No ${provider} API key is configured for this server`);
      error.code = "AI_NOT_CONFIGURED";
      error.provider = provider;
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

    const conversationKey = provider + ":" + scopeId + ":" + userId;
    const previous = this.conversations.get(conversationKey) || [];
    const conversation = [...previous, { role: "user", text }];
    if (provider === "openai") {
      const selectedModel = model || this.config.openAiModel || "gpt-6-luna";
      const supportsNoReasoning = /^(gpt-5\.5|gpt-5\.4-mini|gpt-6-luna|gpt-6-sol|gpt-5\.6-(?:sol|terra|luna))$/.test(selectedModel);
      const reasoningEffort = selectedModel === "gpt-5.5-pro" ? "high" : supportsNoReasoning ? "none" : "low";
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          instructions: String(personality || "").trim() || fallbackPersonality,
          input: conversation.map((message) => ({ role: message.role, content: message.text })),
          reasoning: { effort: reasoningEffort },
          max_output_tokens: selectedModel === "gpt-5.5-pro" ? 4000 : 1200,
          store: false,
        }),
        signal: AbortSignal.timeout(selectedModel === "gpt-5.5-pro" ? 180000 : 45000),
      });
      if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}.`);
      const result = await response.json();
      const responseText = String(result.output_text || result.output?.flatMap((item) => item.content || []).filter((part) => part.type === "output_text").map((part) => part.text).join("") || "").trim();
      if (!responseText) throw new Error("OpenAI returned an empty response.");
      this.conversations.set(conversationKey, [...conversation, { role: "assistant", text: responseText }].slice(-maxConversationMessages));
      return responseText;
    }
    const geminiConversation = conversation.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.text }] }));
    let response;
    let lastError;
    const models = this.config.geminiModels || [this.config.geminiModel];
    for (const [index, model] of models.entries()) {
      try {
        response = await this.getClient(apiKey).models.generateContent({
          model,
          contents: geminiConversation,
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
      [...conversation, { role: "assistant", text: responseText }].slice(
        -maxConversationMessages,
      ),
    );
    return responseText;
  }
}

module.exports = { AiChat };
