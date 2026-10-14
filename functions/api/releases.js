import { cookies, unseal, json } from "../_lib/auth.js";
import { releases } from "../_lib/releases.js";

export const releaseOwnerId = "1079143480988799046";
const headers = { "Cache-Control": "no-store" };
async function sessionFor(env, request) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  return session?.user?.id && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() ? session : null;
}
async function schema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS hidden_releases (version TEXT PRIMARY KEY, hidden_at INTEGER NOT NULL, hidden_by TEXT NOT NULL)").run();
}
export async function onRequestGet({ env, request }) {
  const session = await sessionFor(env, request);
  if (!session) return json({ error: "Sign in to view version history." }, 401, headers);
  await schema(env.DB);
  const rows = await env.DB.prepare("SELECT version FROM hidden_releases").all();
  const hidden = new Set((rows.results || []).map((row) => row.version));
  return json({ releases: releases.filter((item) => !hidden.has(item.version)), canDelete: session.user.id === releaseOwnerId }, 200, headers);
}
export async function onRequestDelete({ env, request }) {
  const session = await sessionFor(env, request);
  if (!session || session.user.id !== releaseOwnerId) return json({ error: "Only the service owner can remove release entries." }, 403, headers);
  if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "Invalid request origin." }, 403, headers);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400, headers); }
  if (!releases.some((item) => item.version === body?.version)) return json({ error: "Release not found." }, 404, headers);
  await schema(env.DB);
  await env.DB.prepare("INSERT OR IGNORE INTO hidden_releases(version,hidden_at,hidden_by) VALUES (?,?,?)").bind(body.version, Date.now(), session.user.id).run();
  return json({ ok: true }, 200, headers);
}
