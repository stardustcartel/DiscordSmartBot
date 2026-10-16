// An explicit allowlist keeps encrypted keys, asset paths, and future private
// settings out of diagnostic history. The full personality is intentional.
export function settingsAuditSnapshot(settings = {}, geminiSecret = null, openaiSecret = null, permissions = []) {
  const profile = settings.profile || {};
  const keyStatus = (secret) => ({
    configured: Boolean(secret),
    addedAt: secret?.keyHistory?.current?.at || null,
    addedById: secret?.keyHistory?.current?.byId || null,
    addedByName: secret?.keyHistory?.current?.byName || null,
  });
  return {
    profile: {
      nickname: profile.nickname || "",
      bio: profile.bio || "",
      avatarConfigured: Boolean(profile.avatarKey || profile.avatarPath),
      bannerConfigured: Boolean(profile.bannerKey || profile.bannerPath),
    },
    personality: settings.personality || "",
    rules: settings.rules || "",
    approvedAnswers: settings.approvedAnswers || [],
    searchAssociations: settings.searchAssociations || [],
    aiProvider: settings.aiProvider || "gemini",
    openAiModel: settings.openAiModel || "",
    openAiSpeed: settings.openAiSpeed || "auto",
    openAiReasoning: settings.openAiReasoning || "auto",
    geminiKey: keyStatus(geminiSecret),
    openAiKey: keyStatus(openaiSecret),
    knowledgeChannelIds: settings.knowledgeChannelIds || [],
    patreonChannelIds: settings.patreonChannelIds || [],
    knowledgePolicy: settings.knowledgePolicy || {},
    botResponseChannelIds: settings.botResponseChannelIds || [],
    botAutoResponseChannelIds: settings.botAutoResponseChannelIds || [],
    botAccessRoleIds: settings.botAccessRoleIds || [],
    youtubeSubscriptions: (settings.youtubeSubscriptions || []).map((item) => ({
      youtubeChannelId: item.youtubeChannelId,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      destinationChannelId: item.destinationChannelId,
      announcementTemplate: item.announcementTemplate,
      addedAt: item.addedAt,
    })),
    reminderTimeZone: settings.reminderTimeZone || "",
    aiResponsesPerHour: settings.aiResponsesPerHour ?? null,
    dashboardPermissions: permissions.map((item) => ({
      type: item.subject_type,
      id: item.subject_id,
      label: item.label,
    })),
  };
}

export async function auditPermissions(db, guildId) {
  const rows = await db.prepare("SELECT subject_type, subject_id, label FROM dashboard_permissions WHERE guild_id = ? ORDER BY subject_type, subject_id").bind(guildId).all();
  return rows.results || [];
}

export async function recordSettingsAudit(db, guildId, settings, geminiSecret, openaiSecret, { action, actorId = null, source = "dashboard", permissions } = {}) {
  const grants = permissions || await auditPermissions(db, guildId);
  const snapshot = settingsAuditSnapshot(settings, geminiSecret, openaiSecret, grants);
  await prepareAuditInsert(db, guildId, snapshot, { action, actorId, source }).run();
  return snapshot;
}

export function prepareAuditInsert(db, guildId, snapshot, { action, actorId = null, source = "dashboard" } = {}) {
  return db.prepare("INSERT INTO guild_settings_audit (guild_id, action, actor_id, source, created_at, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(guildId, action || "settings_saved", actorId, source, Date.now(), JSON.stringify(snapshot));
}

export async function ensureAuditBaseline(db, state) {
  const existing = await db.prepare("SELECT id FROM guild_settings_audit WHERE guild_id = ? LIMIT 1").bind(state.guildId).first();
  if (!existing) await recordSettingsAudit(db, state.guildId, state.settings, state.geminiSecret, state.openaiSecret, { action: "baseline", source: "migration" });
}
