import { cookies, unseal } from "./auth.js";
import { ensureSchema } from "./db.js";

const discordApi = "https://discord.com/api/v10";
const manageGuild = 0x20n;
const administrator = 0x8n;

export async function installedGuilds(env) {
  if (!env.DISCORD_BOT_TOKEN) return [];
  try {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (!response.ok) return [];
    return (await response.json()).map((guild) => ({ id: String(guild.id), name: guild.name, icon: guild.icon }));
  } catch {
    return [];
  }
}

export async function installedGuildIds(env) {
  return new Set((await installedGuilds(env)).map((guild) => guild.id));
}

export async function discordGuildData(env, guildId, userId) {
  if (!env.DISCORD_BOT_TOKEN || !/^\d{15,25}$/.test(String(guildId)) || !/^\d{15,25}$/.test(String(userId))) return null;
  const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
  const [guildResponse, rolesResponse, memberResponse] = await Promise.all([
    fetch(`${discordApi}/guilds/${guildId}`, { headers }),
    fetch(`${discordApi}/guilds/${guildId}/roles`, { headers }),
    fetch(`${discordApi}/guilds/${guildId}/members/${userId}`, { headers }),
  ]);
  if (!guildResponse.ok || !rolesResponse.ok || !memberResponse.ok) return null;
  const [guild, roles, member] = await Promise.all([guildResponse.json(), rolesResponse.json(), memberResponse.json()]);
  return { guild, roles, member };
}

export async function guildAccess(env, guildId, userId, discordData = null) {
  const data = discordData || await discordGuildData(env, guildId, userId);
  if (!data) return null;
  const memberRoleIds = new Set([String(guildId), ...(data.member.roles || []).map(String)]);
  const canManagePermissions = String(data.guild.owner_id) === String(userId) || data.roles.some((role) => {
    if (!memberRoleIds.has(String(role.id))) return false;
    const permissions = BigInt(role.permissions || "0");
    return (permissions & (manageGuild | administrator)) !== 0n;
  });
  if (canManagePermissions) return { canManagePermissions: true, canEdit: true, data };
  await ensureSchema(env.DB);
  const grants = await env.DB.prepare("SELECT subject_type, subject_id FROM dashboard_permissions WHERE guild_id = ? AND (subject_id = ? OR subject_type = 'role')").bind(guildId, userId).all();
  const canEdit = (grants.results || []).some((grant) => grant.subject_type === "user"
    ? String(grant.subject_id) === String(userId)
    : memberRoleIds.has(String(grant.subject_id)));
  return canEdit ? { canManagePermissions: false, canEdit: true, data } : null;
}

export async function authorizedGuild(env, request, guildId) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now() || !session.user?.id) return null;
  if (!session.guilds?.some((guild) => String(guild.id) === String(guildId))) return null;
  const access = await guildAccess(env, String(guildId), String(session.user.id));
  return access ? { ...session, access } : null;
}
