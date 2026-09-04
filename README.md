# Discord Smart Bot

One shared Gemini-powered Discord bot that gives every server its own identity
and settings. A server manager can customize the bot's nickname, avatar,
banner, bio, AI personality, knowledge channels, reminder time zone, and AI
usage limit without creating a Discord bot application or supplying a bot token.

## What is shared and what is isolated

The Discord bot application, its global username, and its global
presence/status belong to the service operator. Each customer/server supplies
and pays for its own Gemini API key.

Each server receives isolated settings and data:

- Server-specific bot nickname, avatar, banner, and bio
- AI personality and per-user AI response limit
- Knowledge channels and knowledge-search results
- Reminder time-zone default
- Stored profile images and configuration
- Encrypted customer Gemini API key

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

AI requests are available in servers only, because each Gemini key is tied to
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
customer Gemini keys after a server migration or recovery.

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

## Gemini model fallback

`GEMINI_MODEL_LADDER` is an optional comma-separated list of Gemini model IDs.
For each response, the bot tries the models in order and moves to the next one
when Gemini reports quota, model-availability, or temporary service errors.
Each customer key must have access to the configured models. A project-level
permission denial is reported as an error and is not bypassed by the ladder.
