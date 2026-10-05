import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";
import { encryptGuildKey } from "../../../_lib/gemini-secret.js";

export async function onRequestPut({ env, request, params }) {
  const access = await authorizedGuild(env, request, params.guildId);
  if (!access) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Enter an OpenAI API key." }, 400); }
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) return json({ error: "Enter an OpenAI API key." }, 400);
  let validation;
  try {
    validation = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    return json({ error: "OpenAI could not be reached to verify this key. Try again later." }, 502);
  }
  if (!validation.ok) return json({ error: "That OpenAI key could not be verified. Check the key and project access, then try again." }, 400);
  const encrypted = await encryptGuildKey(apiKey, env.GUILD_SECRETS_KEY);
  const current = { at: new Date().toISOString(), byId: String(access.user.id), byName: String(access.user.username || "Discord member").slice(0, 100) };
  await mutateState(env.DB, params.guildId, (state) => ({
    ...state,
    openaiSecret: {
      ...encrypted,
      keyHistory: {
        current,
        previous: state.openaiSecret ? state.openaiSecret.keyHistory?.current || { at: null, byId: null, byName: null } : null,
      },
    },
  }));
  return json({ valid: true, message: "OpenAI key verified, encrypted, and saved. Select OpenAI below to use it." });
}
