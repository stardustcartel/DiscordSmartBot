function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tagValue(xml, tag) {
  const match = String(xml).match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "i"));
  return decodeXml(match?.[1]);
}

function parseFeed(xml) {
  const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  return {
    name: tagValue(xml, "name"),
    entries: entries.map((entry) => ({
      id: tagValue(entry, "yt:videoId"),
      title: tagValue(entry, "title"),
      url: "https://www.youtube.com/watch?v=" + tagValue(entry, "yt:videoId"),
    })).filter((entry) => entry.id),
  };
}

async function fetchYouTubeFeed(channelId) {
  const response = await fetch(
    "https://www.youtube.com/feeds/videos.xml?channel_id=" + encodeURIComponent(channelId),
    { headers: { "User-Agent": "DiscordSmartBot/0.1" } },
  );
  if (!response.ok) throw new Error("YouTube feed returned HTTP " + response.status + ".");
  const feed = parseFeed(await response.text());
  if (feed.entries.length === 0) throw new Error("No public uploads were found for that YouTube channel.");
  return feed;
}

function channelIdFromUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const match = url.pathname.match(/\/channel\/(UC[\w-]{20,})/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

async function resolveYouTubeChannel(sourceUrl) {
  const directId = channelIdFromUrl(sourceUrl);
  if (directId) return { channelId: directId, sourceUrl };
  let url;
  try {
    url = new URL(String(sourceUrl || "").trim());
  } catch {
    throw new Error("Enter a full YouTube channel URL, such as https://www.youtube.com/@YouTubeCreators.");
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) {
    throw new Error("Enter a YouTube channel URL.");
  }
  const response = await fetch(url, { headers: { "User-Agent": "DiscordSmartBot/0.1" } });
  if (!response.ok) throw new Error("YouTube channel page returned HTTP " + response.status + ".");
  const html = await response.text();
  const match = html.match(/"channelId":"(UC[\w-]{20,})"/) || html.match(/"externalId":"(UC[\w-]{20,})"/);
  if (!match) throw new Error("Could not identify that YouTube channel. Try its /channel/UC... URL.");
  return { channelId: match[1], sourceUrl: response.url || sourceUrl };
}

class YouTubeNotifier {
  constructor({ guildSettings, pollIntervalMs }) {
    this.guildSettings = guildSettings;
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
    this.polling = false;
  }

  async poll(client) {
    if (this.polling) return;
    this.polling = true;
    try {
      const subscriptions = this.guildSettings.listYouTubeSubscriptions();
      const feeds = new Map();
      for (const subscription of subscriptions) {
        if (!feeds.has(subscription.youtubeChannelId)) {
          try {
            feeds.set(subscription.youtubeChannelId, await fetchYouTubeFeed(subscription.youtubeChannelId));
          } catch (error) {
            console.warn("YouTube feed poll failed for " + subscription.youtubeChannelId + ": " + error.message);
          }
        }
        const feed = feeds.get(subscription.youtubeChannelId);
        if (!feed) continue;
        const lastIndex = feed.entries.findIndex((entry) => entry.id === subscription.lastVideoId);
        const newEntries = lastIndex > 0
          ? feed.entries.slice(0, lastIndex).reverse()
          : lastIndex === -1 && subscription.lastVideoId
            ? [feed.entries[0]]
            : [];
        if (newEntries.length === 0) continue;
        let channel;
        try {
          channel = await client.channels.fetch(subscription.destinationChannelId);
        } catch {
          continue;
        }
        if (!channel?.isTextBased()) continue;
        for (const entry of newEntries) {
          await channel.send({
            content: "📺 **" + (feed.name || subscription.sourceName || "YouTube channel") + " uploaded a new video:**\n**" + entry.title + "**\n" + entry.url,
            allowedMentions: { parse: [] },
          });
        }
        this.guildSettings.addYouTubeSubscription(subscription.guildId, {
          ...subscription,
          sourceName: feed.name || subscription.sourceName,
          lastVideoId: feed.entries[0].id,
        });
      }
    } finally {
      this.polling = false;
    }
  }

  start(client) {
    this.poll(client).catch((error) => console.error("YouTube poll failed:", error.message));
    this.timer = setInterval(() => {
      this.poll(client).catch((error) => console.error("YouTube poll failed:", error.message));
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { YouTubeNotifier, fetchYouTubeFeed, resolveYouTubeChannel };
