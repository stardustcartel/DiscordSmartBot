import { onRequestDelete, onRequestPut } from "../functions/api/guild/[guildId]/youtube.js";
import { seal } from "../functions/_lib/auth.js";

const guildId = "1545533279766319215";
const youtubeChannelId = "UC1234567890123456789012";
const destinationChannelId = "1545533280588144853";
const otherDestinationChannelId = "1545533280588144999";
const initialSettings = {
  profile: {},
  personality: "Helpful",
  youtubeSubscriptions: [
    { youtubeChannelId, destinationChannelId, sourceName: "Creator", announcementTemplate: "Old message" },
    { youtubeChannelId, destinationChannelId: otherDestinationChannelId, sourceName: "Creator", announcementTemplate: "Other message" },
  ],
};

class FakeD1 {
  constructor(settings) {
    this.row = {
      guild_id: guildId,
      settings_json: JSON.stringify(settings),
      gemini_secret_json: null,
      version: 1,
      updated_at: Date.now(),
      updated_by: "test",
    };
  }

  prepare(sql) {
    const database = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return sql.startsWith("SELECT guild_id") ? { ...database.row } : null; },
      async run() {
        if (sql.startsWith("INSERT INTO guild_state")) {
          const [rowGuildId, settingsJson, geminiJson, updatedAt, updatedBy] = this.args;
          database.row = {
            guild_id: rowGuildId,
            settings_json: settingsJson,
            gemini_secret_json: geminiJson,
            version: database.row.version + 1,
            updated_at: updatedAt,
            updated_by: updatedBy,
          };
        }
        return { success: true };
      },
    };
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
  }
}

const env = {
  DB: new FakeD1(initialSettings),
  DASHBOARD_SESSION_SECRET: "session-secret",
};
const session = await seal({
  guilds: [{ id: guildId, name: "Test Server" }],
  guildsVerifiedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
}, env.DASHBOARD_SESSION_SECRET);
const requestFor = (method, body) => new Request(`https://discordsmartbot.pages.dev/api/guild/${guildId}/youtube`, {
  method,
  headers: { "Content-Type": "application/json", Cookie: `dashboard_session=${session}` },
  body: JSON.stringify(body),
});

const updateResponse = await onRequestPut({
  env,
  params: { guildId },
  request: requestFor("PUT", { youtubeChannelId, destinationChannelId, announcementTemplate: "Updated {title}" }),
});
if (!updateResponse.ok) throw new Error(`Announcement update failed with ${updateResponse.status}.`);
let subscriptions = JSON.parse(env.DB.row.settings_json).youtubeSubscriptions;
if (subscriptions[0].announcementTemplate !== "Updated {title}" || subscriptions[1].announcementTemplate !== "Other message") {
  throw new Error("Announcement editing changed the wrong notification.");
}

const deleteResponse = await onRequestDelete({
  env,
  params: { guildId },
  request: requestFor("DELETE", { youtubeChannelId, destinationChannelId }),
});
if (!deleteResponse.ok) throw new Error(`Notification removal failed with ${deleteResponse.status}.`);
subscriptions = JSON.parse(env.DB.row.settings_json).youtubeSubscriptions;
if (subscriptions.length !== 1 || subscriptions[0].destinationChannelId !== otherDestinationChannelId) {
  throw new Error("Removing one notification also removed another destination.");
}

console.log("Dashboard YouTube announcement update checks passed.");
