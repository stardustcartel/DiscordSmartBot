import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { createStateIfMissing } from "../../../_lib/db.js";

function cdnAsset(path, hash, size) {
  if (!hash) return "";
  const extension = String(hash).startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/${path}/${hash}.${extension}?size=${size}`;
}

export async function onRequestGet({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  if (!env.DISCORD_BOT_TOKEN) return json({ error: "The bot connection is not configured yet." }, 503);
  const discordHeaders = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
  const [channelResponse, memberResponse] = await Promise.all([
    fetch(`https://discord.com/api/guilds/${params.guildId}/channels`, { headers: discordHeaders }),
    fetch(`https://discord.com/api/guilds/${params.guildId}/members/${env.DISCORD_APPLICATION_ID}`, { headers: discordHeaders }),
  ]);
  if (!channelResponse.ok) return json({ error: "The bot could not load this server's channels." }, 502);
  const channels = (await channelResponse.json()).filter((channel) => channel.type === 0).map((channel) => ({ id: channel.id, name: channel.name }));
  let discordMember = null;
  if (memberResponse.ok) {
    try { discordMember = await memberResponse.json(); } catch { discordMember = null; }
  }
  const state = await createStateIfMissing(env.DB, params.guildId);
  const settings = structuredClone(state.settings);
  settings.profile = settings.profile || {};
  delete settings.profile.avatarPath;
  delete settings.profile.bannerPath;
  const memberUser = discordMember?.user || {};
  const memberId = memberUser.id || env.DISCORD_APPLICATION_ID;
  const storedAvatarUrl = settings.profile.avatarKey ? `/api/guild/${params.guildId}/asset/avatar` : "";
  const storedBannerUrl = settings.profile.bannerKey ? `/api/guild/${params.guildId}/asset/banner` : "";
  const discordAvatarUrl = discordMember?.avatar
    ? cdnAsset(`guilds/${params.guildId}/users/${memberId}/avatars`, discordMember.avatar, 160)
    : cdnAsset(`avatars/${memberId}`, memberUser.avatar, 160);
  const discordBannerUrl = cdnAsset(`guilds/${params.guildId}/users/${memberId}/banners`, discordMember?.banner, 600);
  const preferStoredAssets = state.updatedBy === "dashboard";
  settings.profile.avatarUrl = preferStoredAssets ? storedAvatarUrl || discordAvatarUrl : discordAvatarUrl || storedAvatarUrl;
  settings.profile.bannerUrl = preferStoredAssets ? storedBannerUrl || discordBannerUrl : discordBannerUrl || storedBannerUrl;
  return json(
    { settings, hasGeminiKey: Boolean(state.geminiSecret), channels, version: state.version },
    200,
    { "Cache-Control": "no-store" },
  );
}
