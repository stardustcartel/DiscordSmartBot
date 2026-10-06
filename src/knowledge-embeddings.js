const modelFor = (provider) => provider === "openai" ? "openai:text-embedding-3-small:768" : "gemini:gemini-embedding-001:768";
function normalize(vector) {
  if (!Array.isArray(vector) || vector.length !== 768 || vector.some((v) => !Number.isFinite(v))) throw new Error("Invalid embedding response");
  const length = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!length) throw new Error("Empty embedding response");
  return vector.map((v) => v / length);
}
async function embed({ provider, apiKey, texts, query = false }) {
  if (!apiKey) throw new Error("The selected AI provider needs an API key.");
  const input = texts.map((text) => String(text).slice(0, 12000));
  const openai = provider === "openai";
  const model = "models/gemini-embedding-001";
  const response = await fetch(openai ? "https://api.openai.com/v1/embeddings" : `https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(openai ? { Authorization: `Bearer ${apiKey}` } : { "x-goog-api-key": apiKey }) },
    body: JSON.stringify(openai ? { model: "text-embedding-3-small", input, dimensions: 768, encoding_format: "float" } : {
      requests: input.map((text) => ({ model, content: { parts: [{ text }] }, taskType: query ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT", outputDimensionality: 768 })),
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Semantic search unavailable (HTTP ${response.status}); keyword search remains available.`);
  const result = await response.json();
  const vectors = openai ? result.data?.sort((a, b) => a.index - b.index).map((v) => v.embedding) : result.embeddings?.map((v) => v.values);
  if (vectors?.length !== texts.length) throw new Error("Incomplete embedding response");
  return vectors.map(normalize);
}
module.exports = { embed, modelFor };
