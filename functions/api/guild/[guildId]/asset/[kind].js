import { json } from "../../../../_lib/auth.js";
import { authorizedGuild } from "../../../../_lib/authorize.js";
import { getState } from "../../../../_lib/db.js";

export async function onRequestGet({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  if (!env.BOT_ASSETS || !["avatar", "banner"].includes(params.kind)) return new Response("Not found", { status: 404 });
  const state = await getState(env.DB, params.guildId);
  const key = state?.settings?.profile?.[`${params.kind}Key`];
  if (!key) return new Response("Not found", { status: 404 });
  const object = await env.BOT_ASSETS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("Cache-Control", "private, max-age=300");
  return new Response(object.body, { headers });
}
