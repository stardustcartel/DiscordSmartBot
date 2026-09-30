import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { ensureSchema } from "../../../_lib/db.js";

const snowflake = /^\d{15,25}$/;

function avatarUrl(member) {
  const user = member?.user;
  if (!user?.id) return "";
  if (member.avatar) return `https://cdn.discordapp.com/guilds/${member.guildId}/users/${user.id}/avatars/${member.avatar}.webp?size=128`;
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`;
  const legacyIndex = Number.parseInt(user.discriminator || "0", 10);
  const index = legacyIndex > 0 ? legacyIndex % 5 : Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function memberSummary(member, guildId) {
  if (!member?.user) return null;
  return {
    id: String(member.user.id),
    name: member.nick || member.user.global_name || member.user.username || "Discord member",
    username: member.user.username || "",
    avatarUrl: avatarUrl({ ...member, guildId }),
  };
}

async function fetchMember(env, guildId, userId) {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (!response.ok) return null;
  try { return await response.json(); } catch { return null; }
}

async function accessFor({ env, request, params }) {
  return authorizedGuild(env, request, params.guildId);
}

export async function onRequestGet(context) {
  const access = await accessFor(context);
  if (!access) return json({ error: "You do not have access to this server." }, 403);
  const { env, params, request } = context;
  const query = new URL(request.url).searchParams.get("query")?.trim();
  if (query) {
    if (!access.access.canManagePermissions) return json({ error: "Only server managers can add dashboard editors." }, 403);
    if (query.length < 2 || query.length > 32) return json({ error: "Enter at least two characters to find a member." }, 400);
    const response = await fetch(`https://discord.com/api/v10/guilds/${params.guildId}/members/search?query=${encodeURIComponent(query.replace(/^@/, ""))}&limit=20`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    if (!response.ok) return json({ error: "Could not search this server's members. You can paste a member ID instead." }, 502);
    const members = (await response.json()).filter((member) => member.user && !member.user.bot);
    return json({ members: members.map((member) => ({ id: member.user.id, name: member.nick || member.user.global_name || member.user.username, username: member.user.username, avatar: member.user.avatar })) }, 200, { "Cache-Control": "no-store" });
  }
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT subject_type, subject_id, label FROM dashboard_permissions WHERE guild_id = ? ORDER BY created_at, subject_type, subject_id").bind(params.guildId).all();
  const roles = access.access.data.roles.filter((role) => String(role.id) !== String(params.guildId) && !role.managed).map((role) => ({ id: role.id, name: role.name, color: role.color }));
  const grants = rows.results || [];
  const explicitUserIds = grants.filter((grant) => grant.subject_type === "user").map((grant) => String(grant.subject_id));
  const ownerId = String(access.access.data.guild.owner_id || "");
  const memberIds = [...new Set([ownerId, ...explicitUserIds].filter((id) => snowflake.test(id)))];
  const memberResults = await Promise.all(memberIds.map((id) => fetchMember(env, params.guildId, id)));
  const membersById = new Map(memberIds.map((id, index) => [id, memberResults[index]]));
  const currentMember = access.access.data.member;
  const currentUser = memberSummary(currentMember, params.guildId) || { ...access.user, avatarUrl: "" };
  const owner = memberSummary(membersById.get(ownerId), params.guildId);
  const enrichedGrants = grants.map((grant) => {
    if (grant.subject_type === "role") {
      const role = roles.find((item) => String(item.id) === String(grant.subject_id));
      return { ...grant, color: role?.color || 0 };
    }
    const member = memberSummary(membersById.get(String(grant.subject_id)), params.guildId);
    return { ...grant, label: member?.name || grant.label, avatarUrl: member?.avatarUrl || "" };
  });
  return json({ currentUser, owner, canManagePermissions: access.access.canManagePermissions, grants: enrichedGrants, roles }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPost(context) {
  const access = await accessFor(context);
  if (!access?.access.canManagePermissions) return json({ error: "Only server managers can change dashboard permissions." }, 403);
  const { env, params, request } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: "Choose a member or role." }, 400); }
  const type = String(body.type || "");
  const id = String(body.id || "").trim().replace(/^<@!?(\d+)>$/, "$1");
  if (!snowflake.test(id) || (type !== "user" && type !== "role")) return json({ error: "Choose a valid member or role." }, 400);
  let label;
  if (type === "role") {
    const role = access.access.data.roles.find((item) => String(item.id) === id && !item.managed && String(item.id) !== String(params.guildId));
    if (!role) return json({ error: "That role is not available in this server." }, 400);
    label = role.name;
  } else {
    const response = await fetch(`https://discord.com/api/v10/guilds/${params.guildId}/members/${id}`, { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    if (!response.ok) return json({ error: "That member was not found in this server." }, 400);
    const member = await response.json();
    if (member.user?.bot) return json({ error: "Select a person, not a bot." }, 400);
    label = member.nick || member.user?.global_name || member.user?.username || id;
  }
  await ensureSchema(env.DB);
  await env.DB.prepare("INSERT INTO dashboard_permissions (guild_id, subject_type, subject_id, label, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, subject_type, subject_id) DO UPDATE SET label = excluded.label").bind(params.guildId, type, id, label, access.user.id, Date.now()).run();
  return json({ ok: true, label });
}

export async function onRequestDelete(context) {
  const access = await accessFor(context);
  if (!access?.access.canManagePermissions) return json({ error: "Only server managers can change dashboard permissions." }, 403);
  const { env, params, request } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: "Choose a permission to remove." }, 400); }
  const type = String(body.type || "");
  const id = String(body.id || "");
  if (!snowflake.test(id) || (type !== "user" && type !== "role")) return json({ error: "Choose a valid permission to remove." }, 400);
  await ensureSchema(env.DB);
  await env.DB.prepare("DELETE FROM dashboard_permissions WHERE guild_id = ? AND subject_type = ? AND subject_id = ?").bind(params.guildId, type, id).run();
  return json({ ok: true });
}
