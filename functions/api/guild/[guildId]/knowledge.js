import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { ensureSchema, mutateState, createStateIfMissing, defaults } from "../../../_lib/db.js";

function validIds(ids) {
  return Array.isArray(ids) && ids.length <= 100 && ids.every((id) => typeof id === "string" && /^\d{15,25}$/.test(id)) && new Set(ids).size === ids.length;
}
export function validKnowledgePolicy(policy) {
  return policy && typeof policy === "object" && !Array.isArray(policy) &&
    typeof policy.knowledgeOnly === "boolean" && typeof policy.requireCitations === "boolean" &&
    Number.isInteger(policy.citationCount) && policy.citationCount >= 1 && policy.citationCount <= 5 &&
    validIds(policy.generalChannels) && validIds(policy.uncitedChannels);
}

// Evaluate the configuring member's actual channel permissions, not dashboard access alone.
export function memberCanRead(channel, data) {
  if (data.guild.owner_id === data.member.user.id) return true;
  const ids = new Set([data.guild.id, ...data.member.roles]);
  let permissions = data.roles.filter((r) => ids.has(r.id)).reduce((p, r) => p | BigInt(r.permissions), 0n);
  if (permissions & 8n) return true;
  const overrides = channel.permission_overwrites || [];
  const apply = (deny, allow) => { permissions = (permissions & ~deny) | allow; };
  const everyone = overrides.find((o) => o.id === data.guild.id);
  if (everyone) apply(BigInt(everyone.deny), BigInt(everyone.allow));
  const roles = overrides.filter((o) => o.type === 0 && o.id !== data.guild.id && ids.has(o.id));
  apply(roles.reduce((p, o) => p | BigInt(o.deny), 0n), roles.reduce((p, o) => p | BigInt(o.allow), 0n));
  const member = overrides.find((o) => o.type === 1 && o.id === data.member.user.id);
  if (member) apply(BigInt(member.deny), BigInt(member.allow));
  return (permissions & 66560n) === 66560n; // VIEW_CHANNEL | READ_MESSAGE_HISTORY
}
export async function onRequestGet({ env, request, params }) {
  const session = await authorizedGuild(env, request, params.guildId);
  if (!session) return json({ error: "You do not have access to this server." }, 403);
  await ensureSchema(env.DB);
  const state = await createStateIfMissing(env.DB, params.guildId);
  const row = await env.DB.prepare("SELECT status_json, updated_at FROM knowledge_status WHERE guild_id=?").bind(params.guildId).first();
  const response = await fetch(`https://discord.com/api/v10/guilds/${params.guildId}/channels`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (!response.ok) return json({ error: "Could not load knowledge channels." }, 502);
  const channels = (await response.json()).filter((c) => [0, 5, 15].includes(c.type) && memberCanRead(c, session.access.data)).map(({ id, name, type }) => ({ id, name, type }));
  return json({ channelIds: state.settings.knowledgeChannelIds || [], policy: { ...defaults().knowledgePolicy, ...state.settings.knowledgePolicy }, channels, status: row ? JSON.parse(row.status_json) : null, reportedAt: row?.updated_at || null }, 200, { "Cache-Control": "no-store" });
}
export async function onRequestPut({ env, request, params }) {
  const session = await authorizedGuild(env, request, params.guildId);
  if (!session) return json({ error: "You do not have access to this server." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Choose the channels to save." }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Choose settings to save." }, 400);
  const ids = body.channelIds;
  const policy = body.policy;
  if (ids === undefined && policy === undefined) return json({ error: "Choose settings to save." }, 400);
  if (ids !== undefined && !validIds(ids)) return json({ error: "Choose up to 100 valid channels." }, 400);
  if (policy !== undefined && !validKnowledgePolicy(policy)) return json({ error: "Choose valid knowledge controls, 1–5 citations, and up to 100 channels per exception." }, 400);
  const response = await fetch(`https://discord.com/api/v10/guilds/${params.guildId}/channels`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (!response.ok) return json({ error: "Could not verify those channels." }, 502);
  const channels = await response.json();
  const current = await createStateIfMissing(env.DB, params.guildId);
  // Existing selections can be kept/removed by a dashboard editor; new sources need read access.
  const eligible = new Set(channels.filter((c) => [0, 5, 15].includes(c.type) && (memberCanRead(c, session.access.data) || current.settings.knowledgeChannelIds?.includes(c.id))).map((c) => c.id));
  if (ids?.some((id) => !eligible.has(id))) return json({ error: "Choose channels in this server that you can read." }, 400);
  if (policy) {
    for (const key of ["generalChannels", "uncitedChannels"]) {
      const allowed = new Set(channels.filter((c) => [0, 5, 15].includes(c.type) && (memberCanRead(c, session.access.data) || current.settings.knowledgePolicy?.[key]?.includes(c.id))).map((c) => c.id));
      if (policy[key].some((id) => !allowed.has(id))) return json({ error: "Choose exception channels in this server that you can read." }, 400);
    }
  }
  const cleanPolicy = policy && { knowledgeOnly: policy.knowledgeOnly, requireCitations: policy.requireCitations, citationCount: policy.citationCount, generalChannels: policy.generalChannels, uncitedChannels: policy.uncitedChannels };
  await mutateState(env.DB, params.guildId, (state) => ({ ...state, settings: { ...state.settings, ...(ids !== undefined ? { knowledgeChannelIds: ids } : {}), ...(cleanPolicy ? { knowledgePolicy: cleanPolicy } : {}) } }), session.user.id);
  return json({ ok: true, message: policy ? "Knowledge answer controls saved. The bot will pick them up on its next sync." : "Knowledge channels saved. Indexing will update shortly." });
}
