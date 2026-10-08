import { decryptGuildKey } from "./gemini-secret.js";

export const initialOpenAiModels = [
  "gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol",
  "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4-mini",
];

// Newer generations first. Within a generation use provider creation metadata;
// deterministic name ordering is only a fallback, never a claim about model strength.
export function sortOpenAiModels(models, created = new Map()) {
  const version = (id) => (/^gpt-(\d+)(?:\.(\d+))?/.exec(id) || []).slice(1).map((part) => Number(part || 0));
  return [...new Set(models)].sort((a, b) => {
    const av = version(a), bv = version(b);
    return (bv[0] || 0) - (av[0] || 0) || (bv[1] || 0) - (av[1] || 0) ||
      (created.get(b) || 0) - (created.get(a) || 0) || a.localeCompare(b, "en", { numeric: true });
  });
}

export function botDefaultReasoning(model) {
  return model === "gpt-5.5-pro" ? "high"
    : /^(gpt-5\.5|gpt-5\.4-mini|gpt-6-luna|gpt-6-sol|gpt-5\.6-(?:sol|terra|luna))$/.test(model) ? "none" : "low";
}

export function reasoningEffortsForModel(model) {
  if (model === "gpt-5.5-pro") return ["medium", "high", "xhigh"];
  const values = ["low", "medium", "high"];
  if (["gpt-5.5", "gpt-5.4-mini", "gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(model)) values.unshift("none");
  if (["gpt-5.5", "gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6-sol"].includes(model)) values.push("xhigh");
  if (["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6-sol"].includes(model)) values.push("max");
  return values;
}

function isFutureTextModel(id) {
  const match = /^gpt-(\d+)(?:\.(\d+))?(?:-([a-z]+(?:-[a-z]+)*))?$/.exec(id);
  if (!match) return false;
  if ((match[3] || "").split("-").some((part) => ["audio", "image", "realtime", "transcribe", "search", "codex", "tts", "live", "vision", "embedding", "moderation"].includes(part))) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  return major >= 6 || (major === 5 && minor >= 6);
}

export async function availableOpenAiModels(secret, encryptionKey, currentModel = "") {
  const models = new Set(initialOpenAiModels);
  if (isFutureTextModel(currentModel)) models.add(currentModel);
  const created = new Map();
  if (!secret) return sortOpenAiModels(models);
  const apiKey = await decryptGuildKey(secret, encryptionKey);
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return sortOpenAiModels(models);
    const body = await response.json();
    for (const item of body.data || []) {
      if (typeof item.id === "string" && isFutureTextModel(item.id)) models.add(item.id);
      if (models.has(item.id) && Number.isFinite(item.created) && item.created > 0) created.set(item.id, item.created);
    }
  } catch {
    // Keep the curated choices available if model discovery is temporarily down.
  }
  return sortOpenAiModels(models, created);
}
