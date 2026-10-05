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
      openai_secret_json: JSON.stringify({ ciphertext: "encrypted-openai-key" }),
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
      async all() { return sql.startsWith("PRAGMA table_info") ? { results: [{ name: "openai_secret_json" }] } : { results: [] }; },
      async first() { return sql.startsWith("SELECT guild_id") ? { ...database.row } : null; },
      async run() {
        if (sql.startsWith("INSERT INTO guild_state")) {
          const [rowGuildId, settingsJson, geminiJson, openaiJson, updatedAt, updatedBy] = this.args;
          database.row = {
            guild_id: rowGuildId,
            settings_json: settingsJson,
            gemini_secret_json: geminiJson,
            openai_secret_json: openaiJson,
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
  DISCORD_BOT_TOKEN: "bot-token",
};
const managerId = "100000000000000001";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  const data = url.endsWith(`/guilds/${guildId}`) ? { owner_id: managerId }
    : url.endsWith(`/guilds/${guildId}/roles`) ? [{ id: guildId, permissions: "0" }]
    : url.endsWith(`/guilds/${guildId}/members/${managerId}`) ? { user: { id: managerId }, roles: [] }
    : null;
  if (!data) throw new Error(`Unexpected Discord request: ${url}`);
  return new Response(JSON.stringify(data), { status: 200 });
};
const session = await seal({
  user: { id: managerId, username: "Manager" },
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
if (JSON.parse(env.DB.row.openai_secret_json).ciphertext !== "encrypted-openai-key") {
  throw new Error("Editing an unrelated setting removed the OpenAI key.");
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
globalThis.fetch = originalFetch;
