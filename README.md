# Discord Smart Bot

One shared Gemini-powered Discord bot that gives every server its own identity
and settings. A server manager can customize the bot's nickname, avatar,
banner, bio, AI personality, knowledge channels, reminder time zone, and AI
usage limit without creating a Discord bot application or supplying a bot token.

## What is shared and what is isolated

The Discord bot application, its global username, its global presence/status,
and the Gemini API key belong to the service operator.

Each server receives isolated settings and data:

- Server-specific bot nickname, avatar, banner, and bio
- AI personality and per-user AI response limit
- Knowledge channels and knowledge-search results
- Reminder time-zone default
- Stored profile images and configuration

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

Direct messages use the service default personality because a DM is not tied to
one server.

## Oracle deployment

On the Oracle VM, install Node.js 20 or newer and clone the repository:

    git clone https://github.com/stardustcartel/DiscordSmartBot.git /home/ubuntu/discord-smart-bot
    cd /home/ubuntu/discord-smart-bot
    npm ci
    cp .env.example .env

Edit .env with the shared Discord bot token, application ID, your Discord user
ID in BOT_OWNER_IDS, and the service-owned Gemini API key. Keep .env private.

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

This shared-service MVP deliberately does not accept Gemini API keys through
Discord commands. The service operator supplies the Gemini key and uses
per-server response limits to control usage. A future dashboard can add
encrypted bring-your-own-key storage and billing controls.

Server configuration is stored under data, which is excluded from Git. Each
server's knowledge search is filtered by server ID and configured channels, so
one server cannot search another server's content.
