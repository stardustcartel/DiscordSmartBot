const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Routes } = require("discord.js");
const { ensureParentDirectory } = require("./storage");
const { fetchYouTubeFeed, resolveYouTubeChannel } = require("./youtube");

const manageGuildPermission = 0x20n;
const maxBodyBytes = 9 * 1024 * 1024;

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }).filter(([key]) => key));
}

function send(response, status, body, type = "application/json") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("Invalid request data."); }
}

function imageDataUri(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
  return "data:" + mime + ";base64," + fs.readFileSync(filePath).toString("base64");
}

function saveDataImage(config, guildId, kind, dataUrl) {
  if (!dataUrl) return "";
  const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Use a PNG, JPEG, or WebP image.");
  const content = Buffer.from(match[2], "base64");
  if (content.length === 0 || content.length > 8 * 1024 * 1024) throw new Error("Images must be 8 MB or smaller.");
  const extension = match[1] === "image/jpeg" ? ".jpg" : match[1] === "image/webp" ? ".webp" : ".png";
  const destination = path.join(config.dataDirectory, "guild-assets", guildId, kind + extension);
  ensureParentDirectory(destination);
  fs.writeFileSync(destination, content);
  return destination;
}

function publicSettings(settings) {
  return {
    profile: { nickname: settings.profile.nickname, bio: settings.profile.bio, hasAvatar: Boolean(settings.profile.avatarPath), hasBanner: Boolean(settings.profile.bannerPath) },
    personality: settings.personality,
    youtubeSubscriptions: settings.youtubeSubscriptions,
  };
}

function createDashboard({ client, config, guildSettings, guildSecrets }) {
  const sessions = new Map();
  const states = new Map();
  const publicDirectory = path.join(config.projectRoot, "dashboard");
  const enabled = Boolean(config.dashboardPublicUrl && config.discordClientSecret && config.dashboardSessionSecret);

  function userGuilds(session) {
    return session.guilds.filter((guild) => (BigInt(guild.permissions || "0") & manageGuildPermission) !== 0n && client.guilds.cache.has(guild.id));
  }
  function sessionFor(request) {
    const session = sessions.get(parseCookies(request).dashboard_session);
    if (!session || session.expiresAt < Date.now()) return null;
    return session;
  }
  function requireGuild(request, guildId) {
    const session = sessionFor(request);
    if (!session || !userGuilds(session).some((guild) => guild.id === guildId)) throw new Error("Unauthorized");
    return session;
  }
  async function oauthCallback(request, response, url) {
    const state = url.searchParams.get("state");
    const saved = states.get(state);
    states.delete(state);
    if (!saved || saved.expiresAt < Date.now()) return send(response, 400, "Sign-in expired. Please try again.", "text/plain");
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.discordApplicationId, client_secret: config.discordClientSecret, grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: config.dashboardPublicUrl + "/auth/callback" }),
    });
    if (!tokenResponse.ok) return send(response, 400, "Discord sign-in failed.", "text/plain");
    const token = await tokenResponse.json();
    const headers = { Authorization: "Bearer " + token.access_token };
    const [userResponse, guildResponse] = await Promise.all([fetch("https://discord.com/api/users/@me", { headers }), fetch("https://discord.com/api/users/@me/guilds", { headers })]);
    if (!userResponse.ok || !guildResponse.ok) return send(response, 400, "Could not read your Discord account.", "text/plain");
    const sessionId = crypto
      .createHmac("sha256", config.dashboardSessionSecret)
      .update(crypto.randomBytes(32))
      .digest("base64url");
    sessions.set(sessionId, { user: await userResponse.json(), guilds: await guildResponse.json(), expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    response.writeHead(302, { Location: "/", "Set-Cookie": "dashboard_session=" + sessionId + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200; Secure" });
    response.end();
  }
  async function api(request, response, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/api/me") {
      const session = sessionFor(request);
      return send(response, 200, session ? { user: session.user, guilds: userGuilds(session) } : { user: null, guilds: [] });
    }
    const guildId = parts[2];
    if (!guildId) return send(response, 404, { error: "Not found" });
    try { requireGuild(request, guildId); } catch { return send(response, 401, { error: "Sign in with Discord and choose a server you manage." }); }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return send(response, 404, { error: "The bot is not installed in that server." });
    if (request.method === "GET" && parts[3] === "settings") return send(response, 200, { settings: publicSettings(guildSettings.get(guildId)), hasGeminiKey: guildSecrets.hasGeminiKey(guildId), channels: [...guild.channels.cache.values()].filter((channel) => channel.isTextBased()).map((channel) => ({ id: channel.id, name: channel.name })) });
    const body = await readJson(request);
    if (request.method === "PUT" && parts[3] === "personality") {
      guildSettings.setPersonality(guildId, String(body.personality || "").trim());
      return send(response, 200, { ok: true });
    }
    if (request.method === "PUT" && parts[3] === "gemini") {
      guildSecrets.setGeminiKey(guildId, String(body.apiKey || "").trim());
      return send(response, 200, { ok: true });
    }
    if (request.method === "PUT" && parts[3] === "profile") {
      const changes = { nickname: String(body.nickname || "").trim(), bio: String(body.bio || "").trim() };
      if (body.avatarData) changes.avatarPath = saveDataImage(config, guildId, "avatar", body.avatarData);
      if (body.bannerData) changes.bannerPath = saveDataImage(config, guildId, "banner", body.bannerData);
      const settings = guildSettings.setProfile(guildId, changes);
      const discordBody = { nick: settings.profile.nickname, bio: settings.profile.bio };
      const avatar = imageDataUri(settings.profile.avatarPath); const banner = imageDataUri(settings.profile.bannerPath);
      if (avatar) discordBody.avatar = avatar; if (banner) discordBody.banner = banner;
      await client.rest.patch(Routes.guildMember(guildId, "@me"), { body: discordBody });
      return send(response, 200, { ok: true });
    }
    if (request.method === "POST" && parts[3] === "youtube") {
      const destination = guild.channels.cache.get(String(body.destinationChannelId || ""));
      if (!destination?.isTextBased()) throw new Error("Choose a text channel in this server.");
      const resolved = await resolveYouTubeChannel(String(body.source || "").trim());
      const feed = await fetchYouTubeFeed(resolved.channelId);
      guildSettings.addYouTubeSubscription(guildId, { youtubeChannelId: resolved.channelId, sourceUrl: resolved.sourceUrl, sourceName: feed.name, destinationChannelId: destination.id, lastVideoId: feed.entries[0].id });
      return send(response, 200, { ok: true, name: feed.name });
    }
    if (request.method === "DELETE" && parts[3] === "youtube") {
      guildSettings.removeYouTubeSubscription(guildId, String(body.youtubeChannelId || ""));
      return send(response, 200, { ok: true });
    }
    return send(response, 404, { error: "Not found" });
  }
  return {
    start() {
      if (!enabled) { console.warn("Dashboard is disabled until DASHBOARD_PUBLIC_URL, DISCORD_CLIENT_SECRET, and DASHBOARD_SESSION_SECRET are configured."); return null; }
      const server = http.createServer((request, response) => (async () => {
        const url = new URL(request.url, config.dashboardPublicUrl);
        if (url.pathname === "/auth/login") { const state = crypto.randomBytes(24).toString("base64url"); states.set(state, { expiresAt: Date.now() + 600_000 }); response.writeHead(302, { Location: "https://discord.com/oauth2/authorize?" + new URLSearchParams({ client_id: config.discordApplicationId, response_type: "code", redirect_uri: config.dashboardPublicUrl + "/auth/callback", scope: "identify guilds", state }) }); return response.end(); }
        if (url.pathname === "/auth/callback") return oauthCallback(request, response, url);
        if (url.pathname.startsWith("/api/")) return api(request, response, url);
        const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
        const fullPath = path.resolve(publicDirectory, file);
        if (!fullPath.startsWith(publicDirectory) || !fs.existsSync(fullPath)) return send(response, 404, "Not found", "text/plain");
        return send(response, 200, fs.readFileSync(fullPath), file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "application/javascript" : "text/html");
      })().catch((error) => { console.error("Dashboard request failed:", error.message); send(response, 500, { error: error.message }); }));
      server.listen(config.dashboardPort, "127.0.0.1", () => console.log("Dashboard listening on localhost:" + config.dashboardPort));
      return server;
    },
  };
}

module.exports = { createDashboard };
