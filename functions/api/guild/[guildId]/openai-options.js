import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { createStateIfMissing, mutateState } from "../../../_lib/db.js";
import { reasoningEffortsForModel } from "../../../_lib/openai-models.js";

export async function onRequestPut({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Choose speed and reasoning settings." }, 400); }
  const state = await createStateIfMissing(env.DB, params.guildId);
  if (!state.openaiSecret) return json({ error: "Add an OpenAI API key before changing its settings." }, 400);
  const speed = String(body.speed || "");
  const reasoning = String(body.reasoning || "");
  if (!["auto", "default", "fast"].includes(speed)) return json({ error: "Choose a valid speed." }, 400);
  if (reasoning !== "auto" && !reasoningEffortsForModel(state.settings.openAiModel || "gpt-6-luna").includes(reasoning)) return json({ error: "That reasoning level is not supported by this model." }, 400);
  await mutateState(env.DB, params.guildId, (current) => ({ ...current, settings: { ...current.settings, openAiSpeed: speed, openAiReasoning: reasoning } }));
  return json({ message: "OpenAI speed and reasoning updated." });
}
