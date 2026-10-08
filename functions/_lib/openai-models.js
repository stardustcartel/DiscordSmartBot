import { decryptGuildKey } from "./gemini-secret.js";

export const initialOpenAiModels = [
  "gpt-5.5", "gpt-5.5-pro", "gpt-5.4-mini", "gpt-6-astra", "gpt-6.1-sol",
  "gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
];

export function reasoningEffortsForModel(model) {
  if (model === "gpt-5.5-pro") return ["medium", "high", "xhigh"];
  const values = ["low", "medium", "high"];
  if (["gpt-5.5", "gpt-5.4-mini", "gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(model)) values.unshift("none");
  if (["gpt-5.5", "gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6-sol"].includes(model)) values.push("xhigh");
  if (["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6-sol"].includes(model)) values.push("max");
  return values;
}

function isFutureTextModel(id) {
  const match = /^gpt-(\d+)(?:\.(\d+))?(?:-([a-z]+))?$/.exec(id);
  if (!match) return false;
  if (["audio", "image", "realtime", "transcribe", "search", "codex", "tts", "live", "vision"].includes(match[3])) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  return major > 6 || (major === 6 && minor >= 1) || (major === 5 && minor > 6);
}

export async function availableOpenAiModels(secret, encryptionKey) {
  const models = new Set(initialOpenAiModels);
  if (!secret) return [...models];
  const apiKey = await decryptGuildKey(secret, encryptionKey);
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [...models];
    const body = await response.json();
    for (const item of body.data || []) {
      if (typeof item.id === "string" && isFutureTextModel(item.id)) models.add(item.id);
    }
  } catch {
    // Keep the curated choices available if model discovery is temporarily down.
  }
  return [...models];
}
