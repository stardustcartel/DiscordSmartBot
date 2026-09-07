import { cookies, json, unseal } from "../../../_lib/auth.js";

export async function onRequestPut({ env, request, params }) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session?.guilds?.some((guild) => guild.id === params.guildId)) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Enter a Gemini API key." }, 400); }
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) return json({ error: "Enter a Gemini API key." }, 400);
  const validation = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!validation.ok) return json({ error: "That Gemini key could not be verified. Check the key and try again." }, 400);
  return json({ valid: true, message: "Gemini key verified. Encrypted storage will be enabled in the next settings update." });
}
