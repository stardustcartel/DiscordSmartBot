function decodeXml(value) { return String(value || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }
function tagValue(xml, tag) { return decodeXml(String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1]); }
function channelIdFromUrl(value) { try { return new URL(value).pathname.match(/\/channel\/(UC[\w-]{20,})/i)?.[1] || ""; } catch { return ""; } }

export async function resolveYouTubeChannel(source) {
  let url;
  try { url = new URL(String(source || "").trim()); } catch { throw new Error("Enter a full YouTube channel URL."); }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) throw new Error("Enter a YouTube channel URL.");
  let channelId = channelIdFromUrl(url.toString());
  if (!channelId) {
    const response = await fetch(url, { headers: { "User-Agent": "DiscordSmartBot/0.1" } });
    if (!response.ok) throw new Error("Could not load that YouTube channel.");
    const html = await response.text();
    channelId = html.match(/"externalId":"(UC[\w-]{20,})"/)?.[1] || html.match(/\/channel\/(UC[\w-]{20,})/)?.[1] || "";
  }
  if (!channelId) throw new Error("Could not identify that YouTube channel.");
  const feedResponse = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  if (!feedResponse.ok) throw new Error("Could not read that channel's upload feed.");
  const feed = await feedResponse.text();
  return { youtubeChannelId: channelId, sourceUrl: url.toString(), sourceName: tagValue(feed, "name") || "YouTube channel", lastVideoId: tagValue(feed, "yt:videoId") };
}
