import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";

export async function onRequestPut({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Choose Gemini or OpenAI." }, 400); }
  if (!["gemini", "openai"].includes(body.provider)) return json({ error: "Choose Gemini or OpenAI." }, 400);
  try {
    await mutateState(env.DB, params.guildId, (state) => {
      if (!state[body.provider === "openai" ? "openaiSecret" : "geminiSecret"]) throw new Error(`Add a ${body.provider === "openai" ? "OpenAI" : "Gemini"} key before selecting it.`);
      return { ...state, settings: { ...state.settings, aiProvider: body.provider } };
    });
  } catch (error) {
    if (/^Add a (OpenAI|Gemini) key/.test(error.message)) return json({ error: error.message }, 400);
    throw error;
  }
  return json({ message: `${body.provider === "openai" ? "OpenAI" : "Gemini"} is now the active AI provider.` });
}
