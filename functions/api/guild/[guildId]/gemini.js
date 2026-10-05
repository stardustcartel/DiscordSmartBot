import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";
import { encryptGeminiKey } from "../../../_lib/gemini-secret.js";

export async function onRequestPut({ env, request, params }) {
  const access = await authorizedGuild(env, request, params.guildId);
  if (!access) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Enter a Gemini API key." }, 400); }
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) return json({ error: "Enter a Gemini API key." }, 400);
  const validation = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!validation.ok) return json({ error: "That Gemini key could not be verified. Check the key and try again." }, 400);
  const encrypted = await encryptGeminiKey(apiKey, env.GUILD_SECRETS_KEY);
  const current = {
    at: new Date().toISOString(),
    byId: String(access.user.id),
    byName: String(access.user.username || "Discord member").slice(0, 100),
  };
  await mutateState(env.DB, params.guildId, (state) => ({
    ...state,
    geminiSecret: {
      ...encrypted,
      keyHistory: {
        current,
        previous: state.geminiSecret
          ? state.geminiSecret.keyHistory?.current || { at: null, byId: null, byName: null }
          : null,
      },
    },
  }));
  return json({ valid: true, message: "Gemini key verified, encrypted, and saved." });
}
