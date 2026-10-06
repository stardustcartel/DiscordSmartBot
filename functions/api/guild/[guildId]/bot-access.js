import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { mutateState } from "../../../_lib/db.js";

const snowflake = /^\d{15,25}$/;

function uniqueIds(value) {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.map((id) => String(id || "").trim()).filter((id) => snowflake.test(id)))];
  return ids.length === value.length && ids.length <= 100 ? ids : null;
}

export async function onRequestPut({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Choose the channels and roles to save." }, 400); }
  const channelIds = uniqueIds(body.channelIds);
  const roleIds = uniqueIds(body.roleIds);
  if (!channelIds || !roleIds) return json({ error: "Choose valid channels and roles." }, 400);
  const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
  const [channelResponse, roleResponse] = await Promise.all([
    fetch(`https://discord.com/api/guilds/${params.guildId}/channels`, { headers }),
    fetch(`https://discord.com/api/guilds/${params.guildId}/roles`, { headers }),
  ]);
  if (!channelResponse.ok || !roleResponse.ok) return json({ error: "The bot could not validate this server's channels and roles." }, 502);
  const channelSet = new Set((await channelResponse.json()).filter((channel) => channel.type === 0 || channel.type === 15).map((channel) => String(channel.id)));
  const roleSet = new Set((await roleResponse.json()).filter((role) => String(role.id) !== String(params.guildId) && !role.managed).map((role) => String(role.id)));
  if (channelIds.some((id) => !channelSet.has(id)) || roleIds.some((id) => !roleSet.has(id))) return json({ error: "One of those channels or roles is no longer available." }, 400);
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, botResponseChannelIds: channelIds, botAccessRoleIds: roleIds } }));
  return json({ ok: true, channelIds, roleIds });
}
