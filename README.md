# Discord Smart Bot

One shared Discord bot powered by each server's choice of Gemini or OpenAI, with its own identity
and settings. A server manager can customize the bot's nickname, avatar,
banner, bio, AI personality, knowledge channels, reminder time zone, and AI
usage limit without creating a Discord bot application or supplying a bot token.

## What is shared and what is isolated

The Discord bot application, its global username, and its global
presence/status belong to the service operator. Each customer/server supplies
and pays for its own Gemini or OpenAI API key.

Each server receives isolated settings and data:

- Server-specific bot nickname, avatar, banner, and bio
- AI personality and per-user AI response limit
- Knowledge channels and knowledge-search results
- Reminder time-zone default
- Stored profile images and configuration
- Encrypted customer Gemini or OpenAI API key (or both)

The global bot status cannot differ by server because Discord presence belongs to
the bot account. A fully custom status or global username requires a dedicated
bot application/token and is a future white-label tier.

## Server-manager setup

After inviting the bot, a member with Manage Server can run:

    /setup profile nickname:My Server Bot avatar:upload.png banner:upload.png bio:Helpful assistant
    /setup personality instructions:You are a warm and concise helper for our community.
    /setup knowledge-add channel:#rules
    /setup knowledge-add channel:#faq
    /setup limits ai-responses-per-hour:30 reminder-time-zone:America/Los_Angeles
    /setup ai-key-status
    /knowledge-sync

The profile command applies the custom profile only inside that server. The
bot needs the Change Nickname permission to set the server nickname.

## Commands

- /chat: chat with the AI
- /setup: server-manager configuration for profile, personality, knowledge, and limits
- /knowledge-search, /knowledge-status, /knowledge-sync
- /remind: private DM reminder
- /update role: generic role assignment for members with Manage Roles
- /restart: restricted to service-owner Discord IDs in BOT_OWNER_IDS

AI requests are available in servers only, because each provider key is tied to
one server. Direct messages cannot be safely attributed to a customer's key.

## Oracle deployment

On the Oracle VM, install Node.js 20 or newer and clone the repository:

    git clone https://github.com/stardustcartel/DiscordSmartBot.git /home/ubuntu/discord-smart-bot
    cd /home/ubuntu/discord-smart-bot
    npm ci
    cp .env.example .env

Generate the encryption key once:

    npm run generate:secrets-key

Put the printed value in GUILD_SECRETS_KEY in .env, alongside the shared
Discord bot token, application ID, and your Discord user ID in BOT_OWNER_IDS.
Keep .env private and back up GUILD_SECRETS_KEY: it is required to decrypt
customer AI keys after a server migration or recovery.

In the Discord Developer Portal, enable the Message Content privileged intent.
Then generate the install link:

    npm run invite

Install the bot in a server using the generated URL. It requests the permissions
needed for the current commands, including Change Nickname and Manage Roles.

Install and start the service:

    sudo install -m 644 deploy/discord-smart-bot.service /etc/systemd/system/discord-smart-bot.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now discord-smart-bot
    sudo journalctl -u discord-smart-bot -f

If your Oracle login is not ubuntu, update the User, WorkingDirectory, and
EnvironmentFile fields in the service file before installing it.

## Security and product direction

Server managers can use `/setup api-key` to open a private Discord modal and
save or replace their server's Gemini API key. The bot does not echo or log the
key; it encrypts the value with AES-256-GCM in `data/guild-secrets.json`.

For an operator-managed alternative, the key can be set from the server after
the bot is installed with:

    npm run set:gemini-key -- --guild CUSTOMER_GUILD_ID

The command uses a hidden terminal prompt and stores the key encrypted with
AES-256-GCM in `data/guild-secrets.json`. A future dashboard can replace the
Discord modal with an authenticated HTTPS onboarding form.

Server configuration is stored under data, which is excluded from Git. Each
server's knowledge search is filtered by server ID and configured channels, so
one server cannot search another server's content.

## YouTube announcements

Server managers can create an announcement subscription without a YouTube API
key:

    /youtube channel-new-video-notification source:https://www.youtube.com/@YouTubeCreators destination:#announcements

The bot records the latest existing upload when the subscription is added, then
checks YouTube's public channel feed every five minutes and announces future
uploads. Use `/youtube list-new-video-notification` to see the channel IDs and
`/youtube remove-new-video-notification` to stop a subscription. The bot needs
permission to View Channel and Send Messages in the selected destination.

## Customer dashboard

The Permissions tab lets a server manager grant dashboard editing access to a
specific server member or a server role. Members sign in with their own Discord
account and see the server in their server chooser. Server owners and people
with Discord's Manage Server or Administrator permission retain access; only
they can change dashboard permissions. Delegated editors can change bot
settings but cannot grant access to others. Membership and roles are checked
again on each dashboard request, so removed permissions take effect without
waiting for a new sign-in. The bot must already be installed in the server.

The dashboard is served from the top-level `dashboard` directory and its
Cloudflare Pages Functions use Discord OAuth. A person can only manage a server
when they have Manage Server permission. Configure these private Cloudflare
variables before enabling sign-in:

    DASHBOARD_PUBLIC_URL=https://discordsmartbot.pages.dev
    DISCORD_APPLICATION_ID=your_discord_application_id
    DISCORD_BOT_TOKEN=your_shared_bot_token
    DISCORD_CLIENT_SECRET=your_discord_application_client_secret
    DASHBOARD_SESSION_SECRET=a_long_random_secret

In the Discord Developer Portal, add this exact OAuth2 Redirect URL:

    https://discordsmartbot.pages.dev/auth/callback

The OAuth Functions establish a signed session and return the signed-in user's
manageable servers. Durable settings storage and the bot synchronization API
use these Cloudflare bindings and shared secrets:

    D1 binding: DB
    R2 binding: BOT_ASSETS
    Cloudflare secret: GUILD_SECRETS_KEY (same value as Oracle)
    Cloudflare secret: BOT_SYNC_SECRET (same value as Oracle)

Create the D1 database, bind it as `DB`, and run
`migrations/0001_dashboard.sql`. The OpenAI column is added automatically on
existing D1 databases; `migrations/0003_openai.sql` is available for manual
migration if needed. Create an R2 bucket and bind it as
`BOT_ASSETS`. On Oracle, configure:

    DASHBOARD_SYNC_URL=https://discordsmartbot.pages.dev
    BOT_SYNC_SECRET=the_same_long_random_secret
    DASHBOARD_SYNC_INTERVAL_MS=30000

The bot bootstraps existing local settings into D1, keeps local JSON as an
offline cache, sends Discord command changes to D1, and pulls dashboard changes
back to the bot.

## OpenAI integration

In the dashboard's AI integration tab, a server manager can add and verify an
OpenAI API key. It is encrypted with the same per-installation
`GUILD_SECRETS_KEY` as Gemini keys, but stored separately. Replacing a key
replaces only that provider's key and records who changed it. After saving a
key, select OpenAI as the active provider and save that choice. Existing
servers continue using Gemini until explicitly switched. OpenAI chat uses the
Responses API with `OPENAI_MODEL` (default `gpt-6-luna`); OpenAI usage is
billed to the key owner's OpenAI account. The Gemini model ladder applies only
when Gemini is selected. There is no automatic fallback between providers.

The model picker lists newer GPT generations first (numeric version order).
Within the same generation it uses OpenAI's model `created` metadata when
available, then a stable name order; creation time is not a guarantee of public
release date or model strength. The list refreshes from the saved key's models
endpoint when the server workspace loads and includes new eligible GPT text
model IDs. Known audio/image/realtime/search/coding-specific variants and dated
snapshots are excluded. Curated choices remain available when discovery fails;
listing a model does not guarantee that the key can make a paid request to it.

## Gemini model fallback

`GEMINI_MODEL_LADDER` is an optional comma-separated list of Gemini model IDs.
For each response, the bot tries the models in order and moves to the next one
when Gemini reports quota, model-availability, or temporary service errors.
The default order is `gemini-3.8-flash`, `gemini-3.7-flash`,
`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, and
`gemini-3.1-flash-lite`. An existing `GEMINI_MODEL_LADDER` in the Oracle
`.env` overrides this default and must be updated separately.
Each customer key must have access to the configured models. A project-level
permission denial is reported as an error and is not bypassed by the ladder.

## Server Knowledge Base

Requires Node 22.13 or newer (Oracle currently runs Node 22). Open **AI Integration → Knowledge Base**, select text/announcement channels or forums, and save. An empty selection disables retrieval. Existing `/setup knowledge-add`, `/setup knowledge-remove`, `/knowledge-sync`, `/knowledge-status`, and `/knowledge-search` commands remain available. Response-channel and role restrictions are still set in **Customize Bot**; selecting knowledge sources does not enable unsolicited replies.

Under **Customize Bot → Bot communication**, choose **Response channels** to limit where the bot may answer. **Automatic responses** offers those selected channels (or every forum/text channel when Response channels is left empty). In automatic-response channels, each nonempty member text message triggers a reply without an @mention; forum threads inherit the setting from their parent forum. The bot ignores bot and webhook messages, and Bot Access roles and per-user AI response limits still apply. Leaving Automatic responses empty preserves mention/reply-only behavior. Automatic responses can consume AI quota or paid API credits quickly.

Messages live in `data/knowledge.sqlite` on Oracle, with SQLite full-text search and compact 768-dimensional vectors. A previous `knowledge-base.json` is imported once and retained unchanged as a recovery copy. To back up a running SQLite archive, use SQLite's backup facility, or stop the bot before copying the database and its WAL files. Do not delete the original JSON until its backup/retention requirements have been reviewed.

The bot indexes human-authored message text, public threads, and archived public forum posts. It skips bot/webhook/system messages and private threads. It does not transcribe attachments, images, audio, video, or linked websites. Gateway events handle new messages, edits, and deletions; a 30-second background sweep resumes historical backfills and catches messages missed while offline. Recent history is refreshed before retrieval where practical; every cited candidate is fetched live, and sources/access are rechecked before posting. Old edits or deletions missed while offline are corrected when those records are revisited, not by continuously rereading the whole server.

The first backfill is incremental (up to eight conversations per sweep); larger servers take longer. Semantic indexing processes up to 32 messages per server per sweep using the **active provider's key**: OpenAI `text-embedding-3-small` or Gemini `gemini-embedding-001`. Provider changes rebuild the vectors gradually; keyword search stays available. API errors trigger a five-minute embedding cooldown. These requests use that provider's quota/billing. No additional operator key is required, and no automatic cross-provider fallback is performed.

For questions, the selected chat model reformulates the query with the forum title/recent user questions. Keyword and semantic results are combined, nearby conversation messages included, and a bounded set of verified excerpts is sent to the AI. Source markers become real Discord message links. The user's Personality remains responsible for server-specific guidance and tone. Archive text is untrusted evidence, not instructions; missing or conflicting evidence must be acknowledged. This cannot guarantee every generated statement is correct, so important answers should be checked against the cited sources.

**Answer sources & citations** contains two independent, opt-in switches:

- **Require knowledge-backed answers** limits factual answers to the available
  permitted server records. Missing evidence produces a clarification/abstention.
  A narrow standalone current-date/time question uses the trusted UTC clock, not
  old posts; greetings and clarifications do not require archive evidence.
- **Require citations** requires up to 1–5 distinct supporting sources for
  knowledge-backed answers. It works without strict mode; clearly labelled
  general knowledge is still allowed when strict mode is off. It does not pad
  citations or cite nonexistent records.
- Separate channel exceptions relax only their respective control. Forum
  selections apply to posts/replies, not to other channels. None of these
  controls override Discord/source permissions or bot-access settings.

Both providers receive a trusted UTC timestamp and explicit rules separating
historical evidence from current facts. No live web-search tool is enabled.
Before publishing a retrieved-knowledge answer, an additional call to the
selected provider/model reviews claims, dates, uncertainty, and sources. Code
validates source IDs, exact quoted evidence, and citation limits, then rechecks
live source permissions/content. Failed verification withholds the draft.
This additional call uses API quota/credits and can add latency; semantic
verification is still model-based, not a guarantee of correctness. Policy is
stored in `settings.knowledgePolicy` in D1 and Oracle's settings cache; existing
servers default to both switches off. No new secret or D1 migration is needed.

Permission checks run outside the model. A source needs current read/history access for both the member and bot. Cross-channel answers use globally readable sources or channels with matching read-permission overwrites; private threads and NSFW-to-non-NSFW disclosure are excluded. This intentionally conservative rule can omit sources that might be safe under more complex role arrangements. Knowledge-answer evidence is not reused as conversation memory across requests. New source selections also require the dashboard editor to have read access. Server-message contents and embeddings never sync to Cloudflare; D1 receives only source selection and progress metadata. `knowledge_status` is created automatically; `migrations/0004_knowledge_status.sql` is the manual equivalent.

Run `npm run check:knowledge` for isolated SQLite, backfill, retrieval, permission, API-fallback, and dashboard-sync checks. These use synthetic messages and mocked providers, not customer data or credits.

## Near-real-time YouTube announcements

The dashboard's existing YouTube notification form also subscribes to YouTube's WebSub push hub. No YouTube channel login or YouTube API key is required. The hub calls `https://discordsmartbot.pages.dev/api/youtube/webhook` when it detects a new upload; delivery is usually much faster than the five-minute feed poll, but YouTube does not guarantee an exact delay. The Oracle feed poll remains enabled to catch missed push notices.

For production, add a new Cloudflare Pages **secret** named `YOUTUBE_WEBHOOK_SECRET` with a long random value (at least 32 random bytes). This must be a dedicated secret; never reuse `BOT_SYNC_SECRET`, `DASHBOARD_SESSION_SECRET`, or a Discord token. `DASHBOARD_PUBLIC_URL` and `DISCORD_BOT_TOKEN` must also be set on Pages as they are for the dashboard. Redeploy Pages after adding the secret. The next Oracle-to-dashboard sync (normally about 30 seconds) will request subscriptions for existing YouTube notifications. New dashboard notifications request a subscription immediately. YouTube validates the callback and renewals are requested before the lease expires. If the secret is absent, push subscription is disabled and the existing polling system continues unchanged. Run `npm run check:dashboard-youtube` for the synthetic webhook and dashboard tests.
