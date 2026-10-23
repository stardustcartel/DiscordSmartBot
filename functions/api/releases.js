import { cookies, unseal, json } from "../_lib/auth.js";
import { releases } from "../_lib/releases.js";

export const releaseOwnerId = "1079143480988799046";
const headers = { "Cache-Control": "no-store" };
// Explicit service-level grants only; server dashboard permissions never grant
// access to editing the shared changelog. Deletion remains owner-only.
function canEdit(env, id) {
  return id === releaseOwnerId || String(env.VERSION_HISTORY_EDITOR_IDS || "").split(/[,\s]+/).filter(value => /^\d{15,25}$/.test(value)).includes(id);
}
async function sessionFor(env, request) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  return session?.user?.id && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() ? session : null;
}
async function schema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS hidden_releases (version TEXT PRIMARY KEY, hidden_at INTEGER NOT NULL, hidden_by TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS release_overrides (version TEXT PRIMARY KEY, changes_json TEXT, highlighted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS release_history_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL, changed_at INTEGER NOT NULL, changed_by TEXT NOT NULL)").run();
}
export async function onRequestGet({ env, request }) {
  const session = await sessionFor(env, request);
  if (!session) return json({ error: "Sign in to view version history." }, 401, headers);
  await schema(env.DB);
  const rows = await env.DB.prepare("SELECT version FROM hidden_releases").all();
  const hidden = new Set((rows.results || []).map((row) => row.version));
  const overrides = await env.DB.prepare("SELECT version,changes_json,highlighted FROM release_overrides").all();
  const saved = new Map((overrides.results || []).map(row => [row.version, row]));
  const visible = releases.filter(item => !hidden.has(item.version)).map(item => {
    const override = saved.get(item.version);
    return { ...item, changes: override?.changes_json ? JSON.parse(override.changes_json) : item.changes, highlighted: Boolean(override?.highlighted) };
  });
  return json({ releases: visible, canDelete: session.user.id === releaseOwnerId, canEdit: canEdit(env, session.user.id) }, 200, headers);
}
export async function onRequestPatch({ env, request }) {
  const session = await sessionFor(env, request);
  if (!session || !canEdit(env, session.user.id)) return json({ error: "Only authorized release editors can change version history." }, 403, headers);
  if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ error: "Invalid request origin." }, 403, headers);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400, headers); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["version", "changes", "highlighted"].includes(key))) return json({ error: "Only release text and highlighting can be changed." }, 400, headers);
  if (!releases.some(item => item.version === body.version)) return json({ error: "Release not found." }, 404, headers);
  const editing = Object.hasOwn(body, "changes"), highlighting = Object.hasOwn(body, "highlighted");
  if (editing === highlighting) return json({ error: "Change either release text or highlighting in one request." }, 400, headers);
  let changes;
  if (editing) {
    if (!Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > 12 || body.changes.some(line => typeof line !== "string" || !line.trim() || line.length > 1500) || body.changes.join("\n").length > 6000) return json({ error: "Enter 1–12 nonempty lines, up to 1,500 characters each and 6,000 characters total." }, 400, headers);
    changes = body.changes.map(line => line.trim());
  } else if (typeof body.highlighted !== "boolean") return json({ error: "Highlight must be on or off." }, 400, headers);
  await schema(env.DB);
  if (await env.DB.prepare("SELECT version FROM hidden_releases WHERE version=?").bind(body.version).first()) return json({ error: "Release not found." }, 404, headers);
  const now = Date.now(), action = editing ? "edit" : "highlight", details = editing ? { changes } : { highlighted: body.highlighted };
  const mutation = editing
    ? env.DB.prepare("INSERT INTO release_overrides(version,changes_json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(version) DO UPDATE SET changes_json=excluded.changes_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(body.version, JSON.stringify(changes), now, session.user.id)
    : env.DB.prepare("INSERT INTO release_overrides(version,highlighted,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(version) DO UPDATE SET highlighted=excluded.highlighted,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(body.version, Number(body.highlighted), now, session.user.id);
  await env.DB.batch([mutation, env.DB.prepare("INSERT INTO release_history_audit(version,action,details_json,changed_at,changed_by) VALUES (?,?,?,?,?)").bind(body.version, action, JSON.stringify(details), now, session.user.id)]);
  return json({ ok: true, ...details }, 200, headers);
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
