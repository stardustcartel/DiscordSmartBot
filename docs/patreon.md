# Patreon knowledge integration

## One-time operator setup

Register a Patreon API v2 OAuth client at https://www.patreon.com/portal/registration/register-clients.
Use this exact redirect URI for production:

`https://discordsmartbot.pages.dev/auth/patreon/callback`

In Cloudflare Pages → discordsmartbot → Settings → Variables and Secrets, add:

- `PATREON_CLIENT_ID`: Text, your application's client ID.
- `PATREON_CLIENT_SECRET`: Secret, your application's client secret.

The existing `GUILD_SECRETS_KEY`, `DASHBOARD_SESSION_SECRET`, and `BOT_SYNC_SECRET` remain unchanged. Redeploy Pages after setting the variables. No Patreon tokens go in the Oracle environment. Do not paste credentials into chat or commit them.

## Connecting a server

A dashboard manager opens AI Integration → Knowledge Base → Connect Patreon and authorizes the **creator account**. A patron's subscription alone cannot grant access to another creator's campaign posts. One campaign is connected per server. Reconnect renews authorization for the same campaign; disconnect first to switch campaigns.

OAuth scopes: `identity campaigns campaigns.posts w:campaigns.webhook`.
Post text, titles, dates, resource links, public/tier metadata, and original post URLs are imported. Collections are not recreated; images, attachments, audio, video, and linked pages are not transcribed. Searching can locate a recording from its post description but cannot answer from untranscribed recording contents.

## Visibility and storage

By default, anyone allowed to use the bot can receive Patreon-sourced answers in its response channels. This is **not** automatic Patreon membership/tier verification. Set “Use Patreon knowledge in” to restrict destination channels (forums include their posts). Existing Discord access and bot role rules continue to apply. Tier metadata is retained for a future tier-aware policy.

OAuth access/refresh tokens and webhook secrets are encrypted in D1. Post text, search chunks, and embeddings live in the existing Oracle `data/knowledge.sqlite`, partitioned by Discord server and connection generation. Patreon sources are identified separately in search logs and citations.

## Synchronization and limitations

The worker checks for work approximately every 30 seconds, imports up to three pages of 25 posts and embeds up to 16 text sections per pass. Large imports take multiple passes. The open dashboard polls every 15 seconds. Webhooks enqueue publish/update/delete events; a full reconciliation runs every 30 minutes or after “Sync now.” Missed webhooks are recovered by reconciliation. Semantic indexing consumes the selected AI provider's credits; keyword search remains available if embeddings fail.

Search uses focused keyword queries, semantic search, relevance selection, and the existing evidence reviewer. Before publishing cited Patreon information, the selected posts and visibility are revalidated against the live API. Unavailable, changed, deleted, or disconnected sources fail closed. API outages may temporarily prevent Patreon-backed answers.

Disconnect immediately disables live validation and removes credentials. Imported posts are purged on the next successful bot sync. Existing diagnostic logs may still contain excerpts from past answers; disconnect is not retroactive deletion of audit history.

Implementation tests use synthetic fixtures, never customer tokens. A real creator OAuth connection must still be tested after configuring the application.
