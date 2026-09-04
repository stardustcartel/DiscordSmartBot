# Discord Smart Bot

An independently hosted, configurable Discord bot for one customer/server at a
time. Each customer instance has its own Discord application, bot token,
Gemini API key, personality file, avatar, data directory, and process.

## MVP scope

- Gemini-powered chat through /chat, direct messages, mentions, and replies
- Customer-supplied personality prompt
- Customer-supplied bot name and avatar
- /knowledge-search, /knowledge-status, and /knowledge-sync
- /remind for private DM reminders
- /restart for an instance restart through systemd
- /update role for a generic role assignment
- Operator-run provisioning for isolated customer instances

This repository intentionally does not include the personal bot's hard-coded
personality, roles, server IDs, social/news features, or personal assets.

## Important Discord setup limitation

Discord requires a Discord application and bot user to be created in the
Developer Portal. There is no normal public API for this project to silently
create arbitrary customer bot applications. For this MVP, either:

1. the customer creates the application and bot, then gives the operator the
   application ID and bot token through a trusted private process; or
2. the operator creates and manages the application for the customer.

Never collect Discord bot tokens or Gemini keys in a Discord channel or DM.
The current provisioning script is intended to be run by the operator on the
Oracle host or another trusted machine.

## Oracle MVP setup

On the Oracle VM, install Node.js 20 or newer, then clone and install the
product repository:

    git clone https://github.com/stardustcartel/DiscordSmartBot.git
    cd DiscordSmartBot
    npm ci

For each customer, have the customer create their Discord application/bot,
enable the Message Content privileged intent in the Developer Portal, and
create a Gemini API key. Then run:

    node scripts/provision-instance.js \
      --output /home/ubuntu/discord-smart-bots \
      --slug customer-1

The wizard asks for the bot token, application ID, optional customer server ID,
Gemini key, display name, avatar path, personality file path, knowledge channel
IDs, and reminder time zone. Providing the server ID makes slash commands
available immediately after installation. Without it, commands are registered
globally and may take longer to appear. The wizard validates the Discord token,
copies the product source into an isolated instance directory, creates a
private .env, and writes INSTALL_URL.txt.

Send the customer the install URL from that file. The URL requests the
permissions needed by the current MVP, including Manage Roles for the
update role command.

Finish the instance setup on the Oracle VM:

    cd /home/ubuntu/discord-smart-bots/customer-1
    npm ci --omit=dev
    sudo install -m 644 discord-smart-bot@.service \
      /etc/systemd/system/discord-smart-bot@.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now discord-smart-bot@customer-1
    sudo journalctl -u discord-smart-bot@customer-1 -f

The service restarts the instance when the restart command is used or when
the process exits unexpectedly.

## Configuration

The generated instance .env contains the customer-specific secrets and
settings. The personality prompt is stored at
config/personality.txt; replacing that file and restarting the instance
changes the bot's behavior. The avatar is copied into the instance's assets
directory.

Knowledge channels are configured with Discord channel IDs, separated by
commas. The bot indexes configured channels during knowledge-sync and keeps
new, edited, and deleted messages synchronized while it is online.

## Current boundaries

This is an operator-run MVP, not yet a customer-facing web dashboard. The
next product stage should replace manual secret exchange with a secured
provisioning portal using Discord OAuth2, encrypted secrets, authenticated
file uploads, and an instance database.
