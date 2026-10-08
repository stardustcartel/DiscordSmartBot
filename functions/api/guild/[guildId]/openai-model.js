import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { createStateIfMissing, mutateState } from "../../../_lib/db.js";
import { availableOpenAiModels, reasoningEffortsForModel } from "../../../_lib/openai-models.js";

export async function onRequestGet({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const state = await createStateIfMissing(env.DB, params.guildId);
  const models = await availableOpenAiModels(state.openaiSecret, env.GUILD_SECRETS_KEY);
  return json({ models, reasoningEfforts: Object.fromEntries(models.map((model) => [model, reasoningEffortsForModel(model)])) }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPut({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Choose an OpenAI model." }, 400); }
  const model = String(body.model || "").trim();
  const state = await createStateIfMissing(env.DB, params.guildId);
  if (!state.openaiSecret) return json({ error: "Add an OpenAI API key before choosing a model." }, 400);
  const models = await availableOpenAiModels(state.openaiSecret, env.GUILD_SECRETS_KEY);
  if (!models.includes(model)) return json({ error: "Choose a model from the available list." }, 400);
  await mutateState(env.DB, params.guildId, (current) => ({ ...current, settings: { ...current.settings, openAiModel: model, openAiReasoning: current.settings.openAiReasoning === "auto" || reasoningEffortsForModel(model).includes(current.settings.openAiReasoning) ? current.settings.openAiReasoning : "auto" } }));
  return json({ model, message: `${model} is now this server's OpenAI model.` });
}
