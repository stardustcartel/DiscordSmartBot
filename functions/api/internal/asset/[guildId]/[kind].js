import { json } from "../../../../_lib/auth.js";
import { getState } from "../../../../_lib/db.js";

export async function onRequestGet({ env, request, params }) {
  if (!env.BOT_SYNC_SECRET || request.headers.get("Authorization") !== `Bearer ${env.BOT_SYNC_SECRET}`) return json({ error: "Unauthorized" }, 401);
  if (!env.BOT_ASSETS || !["avatar", "banner"].includes(params.kind)) return new Response("Not found", { status: 404 });
  const state = await getState(env.DB, params.guildId);
  const key = state?.settings?.profile?.[`${params.kind}Key`];
  if (!key) return new Response("Not found", { status: 404 });
  const object = await env.BOT_ASSETS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers(); object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
}
