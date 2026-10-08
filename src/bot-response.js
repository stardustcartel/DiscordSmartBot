function shouldAutoRespond(settings, channelId, parentChannelId) {
  const channels = settings?.botAutoResponseChannelIds || [];
  return channels.includes(String(channelId)) || Boolean(parentChannelId && channels.includes(String(parentChannelId)));
}

module.exports = { shouldAutoRespond };
