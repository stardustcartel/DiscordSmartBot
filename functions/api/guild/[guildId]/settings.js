import { json } from "../../../_lib/auth.js";
import { authorizedGuild } from "../../../_lib/authorize.js";
import { createStateIfMissing } from "../../../_lib/db.js";

function cdnAsset(path, hash, size) {
  if (!hash) return "";
  const animation = String(hash).startsWith("a_") ? "&animated=true" : "";
  return `https://cdn.discordapp.com/${path}/${hash}.webp?size=${size}${animation}`;
}

export async function onRequestGet({ env, request, params }) {
  if (!(await authorizedGuild(env, request, params.guildId))) return json({ error: "You do not have access to this server." }, 403);
  if (!env.DISCORD_BOT_TOKEN) return json({ error: "The bot connection is not configured yet." }, 503);
  const discordHeaders = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
  const [channelResponse, roleResponse, botUserResponse] = await Promise.all([
    fetch(`https://discord.com/api/guilds/${params.guildId}/channels`, { headers: discordHeaders }),
    fetch(`https://discord.com/api/guilds/${params.guildId}/roles`, { headers: discordHeaders }),
    fetch("https://discord.com/api/users/@me", { headers: discordHeaders }),
  ]);
  if (!channelResponse.ok) return json({ error: "The bot could not load this server's channels." }, 502);
  const channels = (await channelResponse.json()).filter((channel) => [0, 5, 15].includes(channel.type)).map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));
  const roles = roleResponse.ok
    ? (await roleResponse.json()).filter((role) => String(role.id) !== String(params.guildId) && !role.managed).map((role) => ({ id: role.id, name: role.name, color: role.color }))
    : [];
  let botUser = {};
  if (botUserResponse.ok) {
    try { botUser = await botUserResponse.json(); } catch { botUser = {}; }
  }
  const botId = botUser.id || env.DISCORD_APPLICATION_ID;
  let discordMember = null;
  const memberResponse = botId
    ? await fetch(`https://discord.com/api/guilds/${params.guildId}/members/${botId}`, { headers: discordHeaders })
    : null;
  if (memberResponse?.ok) {
    try { discordMember = await memberResponse.json(); } catch { discordMember = null; }
  }
  const state = await createStateIfMissing(env.DB, params.guildId);
  const openAiRuntimeRow = await env.DB.prepare("SELECT runtime_json FROM openai_runtime WHERE guild_id=?").bind(params.guildId).first();
  const openAiRuntime = openAiRuntimeRow ? JSON.parse(openAiRuntimeRow.runtime_json) : null;
  const settings = structuredClone(state.settings);
  settings.profile = settings.profile || {};
  delete settings.profile.avatarPath;
  delete settings.profile.bannerPath;
  const memberUser = discordMember?.user || botUser;
  const memberId = memberUser.id || botId;
  const storedAvatarUrl = settings.profile.avatarKey ? `/api/guild/${params.guildId}/asset/avatar` : "";
  const storedBannerUrl = settings.profile.bannerKey ? `/api/guild/${params.guildId}/asset/banner` : "";
  const discordAvatarUrl = discordMember?.avatar
    ? cdnAsset(`guilds/${params.guildId}/users/${memberId}/avatars`, discordMember.avatar, 256)
    : cdnAsset(`avatars/${memberId}`, memberUser.avatar, 256);
  const discordBannerUrl = cdnAsset(`guilds/${params.guildId}/users/${memberId}/banners`, discordMember?.banner, 512);
  const preferStoredAssets = state.updatedBy === "dashboard";
  settings.profile.avatarUrl = preferStoredAssets ? storedAvatarUrl || discordAvatarUrl : discordAvatarUrl || storedAvatarUrl;
  settings.profile.bannerUrl = preferStoredAssets ? storedBannerUrl || discordBannerUrl : discordBannerUrl || storedBannerUrl;
  settings.profile.avatarUrls = [...new Set([settings.profile.avatarUrl, discordAvatarUrl, storedAvatarUrl].filter(Boolean))];
  settings.profile.bannerUrls = [...new Set([settings.profile.bannerUrl, discordBannerUrl, storedBannerUrl].filter(Boolean))];
  return json(
    { settings, hasGeminiKey: Boolean(state.geminiSecret), geminiKeyHistory: state.geminiSecret?.keyHistory || null, hasOpenAiKey: Boolean(state.openaiSecret), openAiKeyHistory: state.openaiSecret?.keyHistory || null, openAiRuntime, channels, roles, version: state.version },
    200,
    { "Cache-Control": "no-store" },
  );
}
