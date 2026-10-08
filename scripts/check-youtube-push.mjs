import assert from "node:assert/strict";
import { callbackToken, deliverySecret, parseYouTubePush, topicUrl, validHubSignature } from "../functions/_lib/youtube-push.js";
import { onRequestGet, onRequestPost } from "../functions/api/youtube/webhook.js";

const channel = "UC1234567890123456789012";
const destination = "1545533280588144853";
const guild = "1545533279766319215";
const secret = "test-only-dedicated-youtube-secret-not-a-sync-token";
const entry = `<feed><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channel}</yt:channelId><title>A &amp; B</title><author><name>Creator</name></author></entry></feed>`;
assert.deepEqual(parseYouTubePush(entry), [{ channelId: channel, videoId: "abcdefghijk", title: "A & B", channelName: "Creator" }]);

const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await deliverySecret(secret, channel)), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
const bytes = new TextEncoder().encode(entry);
const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
assert.equal(await validHubSignature(await deliverySecret(secret, channel), bytes, `sha1=${hex}`), true);
assert.equal(await validHubSignature(await deliverySecret(secret + "wrong", channel), bytes, `sha1=${hex}`), false);

class FakeD1 {
  constructor() {
    this.topic = { channel_id: channel, requested_at: Date.now(), lease_expires_at: 0, created_at: Date.now() };
    this.deliveries = new Map();
    this.state = { guild_id: guild, settings_json: JSON.stringify({ youtubeSubscriptions: [{ youtubeChannelId: channel, destinationChannelId: destination, lastVideoId: "previous123", sourceName: "Creator" }] }) };
  }
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return sql.includes("youtube_push_topics") ? db.topic : null; },
      async all() { return sql.startsWith("PRAGMA") ? { results: [{ name: "openai_secret_json" }] } : { results: sql.includes("FROM guild_state") ? [db.state] : [] }; },
      async run() {
        if (sql.startsWith("UPDATE youtube_push_topics")) { db.topic.lease_expires_at = this.args[0]; db.topic.requested_at = 0; }
        if (sql.startsWith("INSERT OR IGNORE INTO youtube_push_deliveries")) {
          const id = this.args.join(":");
          if (db.deliveries.has(id)) return { meta: { changes: 0 } };
          db.deliveries.set(id, 0);
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE youtube_push_deliveries")) db.deliveries.set(this.args.slice(1).join(":") , this.args[0]);
        if (sql.startsWith("DELETE FROM youtube_push_deliveries")) db.deliveries.delete(this.args.slice(0, 4).join(":"));
        return { meta: { changes: 1 } };
      },
    };
  }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

const DB = new FakeD1();
const env = { DB, YOUTUBE_WEBHOOK_SECRET: secret, DISCORD_BOT_TOKEN: "fake-token" };
const callback = new URL("https://discordsmartbot.pages.dev/api/youtube/webhook");
callback.searchParams.set("channel", channel);
callback.searchParams.set("token", await callbackToken(secret, channel));
const challenge = new URL(callback);
challenge.searchParams.set("hub.mode", "subscribe");
challenge.searchParams.set("hub.topic", topicUrl(channel));
challenge.searchParams.set("hub.challenge", "test-challenge");
challenge.searchParams.set("hub.lease_seconds", "86400");
assert.equal((await onRequestGet({ env, request: new Request(challenge) })).status, 200);
assert.equal(DB.topic.lease_expires_at > Date.now(), true);

let sent = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), `https://discord.com/api/v10/channels/${destination}/messages`);
  const body = JSON.parse(options.body);
  assert.equal(body.allowed_mentions.parse.length, 0);
  assert.match(body.content, /A & B/);
  sent++;
  return new Response("{}", { status: 200 });
};
try {
  const request = (signature) => new Request(callback, { method: "POST", body: entry, headers: { "X-Hub-Signature": signature } });
  assert.equal((await onRequestPost({ env, request: request("sha1=0000000000000000000000000000000000000000") })).status, 401);
  assert.equal((await onRequestPost({ env, request: request(`sha1=${hex}`) })).status, 200);
  assert.equal((await onRequestPost({ env, request: request(`sha1=${hex}`) })).status, 200);
  assert.equal(sent, 1);
} finally { globalThis.fetch = originalFetch; }
console.log("YouTube push signature, challenge, and deduplication checks passed.");
