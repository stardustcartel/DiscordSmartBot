import { cookies, json, unseal } from "../_lib/auth.js";
import { guildAccess } from "../_lib/authorize.js";

export async function onRequestGet({ env, request }) {
  const session = await unseal(cookies(request).dashboard_session, env.DASHBOARD_SESSION_SECRET);
  if (!session || session.expiresAt < Date.now()) return json(
    { user: null, guilds: [], inviteUrl: `/auth/invite` },
    200,
    { "Cache-Control": "no-store" },
  );
  const candidates = session.guilds || [];
  const accessResults = await Promise.all(candidates.map((guild) => guildAccess(env, String(guild.id), String(session.user.id)).catch(() => null)));
  const guilds = candidates.flatMap((guild, index) => {
    const current = accessResults[index]?.data?.guild;
    return accessResults[index] ? [{
      ...guild,
      name: current?.name || guild.name,
      icon: current?.icon ?? guild.icon,
    }] : [];
  });
  return json(
    { user: session.user, guilds, inviteUrl: session.inviteUrl || `/auth/invite` },
    200,
    { "Cache-Control": "no-store" },
  );
}
