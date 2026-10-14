import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";
import { behaviorLimits, safeResourceUrl, normalizeApprovedAnswers } from "../../../../shared/behavior.mjs";

export async function onRequestPut({ env, request, params }) {
  const access = await authorizedGuild(env, request, params.guildId);
  if (!access) return json({ error: "You do not have access to this server." }, 403);
  if (request.headers.get("Origin") && request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "Invalid request origin." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const hasRules = Object.hasOwn(body || {}, "rules"), hasAnswers = Object.hasOwn(body || {}, "approvedAnswers");
  if (hasRules === hasAnswers) return json({ error: "Save one Behavior section at a time." }, 400);
  if (hasRules && (typeof body.rules !== "string" || body.rules.length > behaviorLimits.rules)) return json({ error: "Rules must be 12,000 characters or fewer." }, 400);
  if (hasAnswers) {
    if (!Array.isArray(body.approvedAnswers) || body.approvedAnswers.length > behaviorLimits.entries) return json({ error: "You can save up to 40 approved answers." }, 400);
    const ids = new Set(); let total = 0;
    for (const item of body.approvedAnswers) {
      if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) || typeof item.question !== "string" || !item.question.trim() || item.question.length > behaviorLimits.question || typeof item.answer !== "string" || !item.answer.trim() || item.answer.length > behaviorLimits.answer || typeof item.url !== "string" || item.url.length > 1500 || (item.url && !safeResourceUrl(item.url))) return json({ error: "Each answer needs a unique ID, a question/topic (up to 500 characters), an answer (up to 4,000 characters), and an optional HTTPS link." }, 400);
      ids.add(item.id); total += item.question.trim().length + item.answer.trim().length;
    }
    if (total > behaviorLimits.total) return json({ error: "Approved answers must total 24,000 characters or fewer." }, 400);
  }
  const state = await mutateState(env.DB, params.guildId, (current) => {
    if (hasRules) return { ...current, settings: { ...current.settings, rules: body.rules.trim() } };
    const previous = new Map(normalizeApprovedAnswers(current.settings.approvedAnswers).map((item) => [item.id, item]));
    const answers = normalizeApprovedAnswers(body.approvedAnswers).map((item) => {
      const old = previous.get(item.id);
      return old && old.question === item.question && old.answer === item.answer && old.url === item.url ? old : { ...item, updatedAt: Date.now(), updatedBy: access.user.id };
    });
    return { ...current, settings: { ...current.settings, approvedAnswers: answers } };
  }, access.user.id);
  return json({ ok: true, ...(hasRules ? { rules: state.settings.rules } : { approvedAnswers: state.settings.approvedAnswers }) }, 200, { "Cache-Control": "no-store" });
}
