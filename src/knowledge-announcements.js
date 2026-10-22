// Delivery receipts distinguish notification facts from the bot's generated answers.
class AnnouncementEvidence {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS youtube_knowledge_deliveries (
      guildId TEXT NOT NULL, channelId TEXT NOT NULL, videoId TEXT NOT NULL,
      youtubeChannelId TEXT NOT NULL, sentAt INTEGER NOT NULL,
      messageId TEXT, content TEXT, method TEXT NOT NULL,
      PRIMARY KEY(guildId,channelId,videoId,sentAt))`);
  }
  record({ guildId, channelId, videoId, youtubeChannelId, sentAt, messageId = null, content = null, method }) {
    if (!guildId || !channelId || !/^[\w-]{11}$/.test(videoId || '') || !Number.isFinite(sentAt) || sentAt <= 0) return;
    const added = this.db.prepare('INSERT OR IGNORE INTO youtube_knowledge_deliveries VALUES(?,?,?,?,?,?,?,?)')
      .run(guildId, channelId, videoId, youtubeChannelId, sentAt, messageId, content, method).changes;
    // A bounded historical rescan recovers announcements skipped by the old bot filter.
    if (added && sentAt < Date.now() - 300000 && this.store.guildSettings.get(guildId).knowledgeChannelIds.includes(channelId)) {
      this.store.checkpoint(`youtube-rescan:${channelId}`, true);
    }
  }
  importSettings(guildId) {
    for (const sub of this.store.guildSettings.get(guildId).youtubeSubscriptions || []) {
      this.record({ guildId, channelId: sub.destinationChannelId, videoId: sub.lastVideoId,
        youtubeChannelId: sub.youtubeChannelId, sentAt: Number(sub.lastVideoUpdatedAt), method: 'saved-delivery-checkpoint' });
    }
  }
  identify(message) {
    const self = message.client?.user?.id || message.guild?.members?.me?.id;
    if (!self || message.author?.id !== self || !message.author?.bot || message.webhookId) return null;
    const videoId = message.content?.trim().match(/(?:^|\n)https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})$/)?.[1];
    if (!videoId) return null;
    const receipts = this.db.prepare('SELECT * FROM youtube_knowledge_deliveries WHERE guildId=? AND channelId=? AND videoId=?')
      .all(message.guildId, message.channelId, videoId);
    if (receipts.some(r => r.messageId === message.id && r.content !== message.content)) return null;
    const receipt = receipts.find(r => r.messageId === message.id && r.content === message.content)
      || receipts.find(r => !r.messageId && r.sentAt >= message.createdTimestamp && r.sentAt - message.createdTimestamp <= 30000 && this.matchesLegacyTemplate(message, r));
    if (!receipt) return null;
    if (!receipt.messageId) this.db.prepare('UPDATE youtube_knowledge_deliveries SET messageId=?,content=? WHERE guildId=? AND channelId=? AND videoId=? AND sentAt=?')
      .run(message.id, message.content, receipt.guildId, receipt.channelId, videoId, receipt.sentAt);
    return { sourceType: 'youtube_announcement', videoId, youtubeChannelId: receipt.youtubeChannelId, verification: receipt.method };
  }
  matchesLegacyTemplate(message, receipt) {
    const subscription = (this.store.guildSettings.get(message.guildId).youtubeSubscriptions || [])
      .find(s => s.destinationChannelId === message.channelId && s.youtubeChannelId === receipt.youtubeChannelId);
    if (!subscription?.sourceName) return false;
    const template = String(subscription.announcementTemplate || '📺 **{channel} uploaded a new video:**\n**{title}**')
      .replaceAll('{channel}', subscription.sourceName).trim();
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = template.split('{title}').map(escape).join('[\\s\\S]+');
    return new RegExp('^' + pattern + '\\n' + escape(`https://www.youtube.com/watch?v=${receipt.videoId}`) + '$').test(message.content);
  }
}
module.exports = { AnnouncementEvidence };
