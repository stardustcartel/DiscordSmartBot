const fs = require("node:fs");
const path = require("node:path");
const { Routes } = require("discord.js");
const { ensureParentDirectory, readJson, writeJson } = require("./storage");

class DashboardSync {
  constructor({ config, guildSettings, guildSecrets }) {
    this.config = config;
    this.guildSettings = guildSettings;
    this.guildSecrets = guildSecrets;
    this.pending = new Set();
    this.syncing = false;
    this.timer = null;
    this.statePath = path.join(config.dataDirectory, "dashboard-sync.json");
    this.state = readJson(this.statePath, { initialized: false, knownVersions: {} });
    this.guildSettings.setChangeHandler((guildId) => this.pending.add(guildId));
    this.guildSecrets.setChangeHandler((guildId) => this.pending.add(guildId));
  }

  get enabled() {
    return Boolean(this.config.dashboardSyncUrl && this.config.botSyncSecret);
  }

  snapshot(guildId) {
    const settings = this.guildSettings.get(guildId);
    const assets = {};
    for (const kind of ["avatar", "banner"]) {
      const filePath = settings.profile[`${kind}Path`];
      if (!filePath || !fs.existsSync(filePath)) continue;
      const extension = path.extname(filePath).toLowerCase();
      assets[kind] = { contentType: extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png", base64: fs.readFileSync(filePath).toString("base64") };
    }
    settings.profile = { ...settings.profile, avatarPath: "", bannerPath: "" };
    return { guildId, settings, geminiSecret: this.guildSecrets.getEncryptedGeminiKey(guildId), assets };
  }

  async downloadAsset(guildId, kind) {
    const response = await fetch(`${this.config.dashboardSyncUrl}/api/internal/asset/${guildId}/${kind}`, { headers: { Authorization: `Bearer ${this.config.botSyncSecret}` } });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "image/png";
    const extension = contentType.includes("jpeg") ? ".jpg" : contentType.includes("webp") ? ".webp" : ".png";
    const destination = path.join(this.config.dataDirectory, "guild-assets", guildId, kind + extension);
    ensureParentDirectory(destination);
    fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
    return destination;
  }

  async applyState(client, remote) {
    const current = this.guildSettings.get(remote.guildId);
    const next = remote.settings || current;
    if (next.profile?.avatarKey) next.profile.avatarPath = await this.downloadAsset(remote.guildId, "avatar");
    else next.profile.avatarPath = current.profile.avatarPath;
    if (next.profile?.bannerKey) next.profile.bannerPath = await this.downloadAsset(remote.guildId, "banner");
    else next.profile.bannerPath = current.profile.bannerPath;
    const settings = this.guildSettings.replaceFromSync(remote.guildId, next);
    this.guildSecrets.replaceEncryptedFromSync(remote.guildId, remote.geminiSecret);
    const guild = client.guilds.cache.get(remote.guildId);
    if (guild) {
      const body = { nick: settings.profile.nickname || null, bio: settings.profile.bio || "" };
      if (settings.profile.avatarPath && fs.existsSync(settings.profile.avatarPath)) body.avatar = `data:image/${path.extname(settings.profile.avatarPath).toLowerCase() === ".jpg" ? "jpeg" : path.extname(settings.profile.avatarPath).slice(1)};base64,${fs.readFileSync(settings.profile.avatarPath).toString("base64")}`;
      if (settings.profile.bannerPath && fs.existsSync(settings.profile.bannerPath)) body.banner = `data:image/${path.extname(settings.profile.bannerPath).toLowerCase() === ".jpg" ? "jpeg" : path.extname(settings.profile.bannerPath).slice(1)};base64,${fs.readFileSync(settings.profile.bannerPath).toString("base64")}`;
      await client.rest.patch(Routes.guildMember(remote.guildId, "@me"), { body }).catch((error) => console.warn(`Could not apply dashboard profile for ${remote.guildId}:`, error.message));
    }
    this.state.knownVersions[remote.guildId] = remote.version;
  }

  async synchronize(client) {
    if (!this.enabled || this.syncing) return;
    this.syncing = true;
    const installedGuilds = [...client.guilds.cache.values()].map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon }));
    const changedIds = [...this.pending].filter((guildId) => client.guilds.cache.has(guildId));
    changedIds.forEach((guildId) => this.pending.delete(guildId));
    try {
      const response = await fetch(`${this.config.dashboardSyncUrl}/api/internal/sync`, { method: "POST", headers: { Authorization: `Bearer ${this.config.botSyncSecret}`, "Content-Type": "application/json" }, body: JSON.stringify({ installedGuilds, bootstrap: this.state.initialized ? [] : installedGuilds.map((guild) => this.snapshot(guild.id)), changes: changedIds.map((guildId) => this.snapshot(guildId)), knownVersions: this.state.knownVersions }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const result = await response.json();
      for (const remote of result.states || []) await this.applyState(client, remote);
      this.state.initialized = true;
      writeJson(this.statePath, this.state);
    } catch (error) {
      changedIds.forEach((guildId) => this.pending.add(guildId));
      console.warn("Dashboard synchronization failed:", error.message);
    } finally {
      this.syncing = false;
    }
  }

  start(client) {
    if (!this.enabled) { console.warn("Dashboard synchronization is disabled until DASHBOARD_SYNC_URL and BOT_SYNC_SECRET are configured."); return; }
    this.synchronize(client);
    this.timer = setInterval(() => this.synchronize(client), this.config.dashboardSyncIntervalMs);
    this.timer.unref?.();
  }
}

module.exports = { DashboardSync };
