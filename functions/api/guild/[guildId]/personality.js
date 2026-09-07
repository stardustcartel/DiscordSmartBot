import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";

export async function onRequestPut({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  const body = await request.json();
  const personality = String(body.personality || "").trim().slice(0, 12000);
  if (!personality) return json({ error: "Personality instructions cannot be empty." }, 400);
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, personality } }));
  return json({ ok: true });
}
