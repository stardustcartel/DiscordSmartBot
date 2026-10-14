# Project preferences and release workflow

- The user authorizes deploying completed, verified changes to both the production dashboard and the SmartBot Oracle service. Bouncer Lechonk is a separate service and is out of scope.
- Every deployment with new features, bug fixes, UI changes, or other noteworthy user-facing behavior must include a concise entry in `functions/_lib/releases.js`, shown in the dashboard's Version History. Write client-facing descriptions, assign a new semantic version, and record the actual release/deployment time in UTC. Use a major version for a substantial product change; the UI groups releases by major version.
- Do not present Git timestamps as verified deployment times. Historical entries are explicitly marked `historical: true` and retain that label.
- Release IDs/version strings are permanent. Never reuse one or remove `hidden_releases` records: the owner's deletion must persist across deployments. Only Discord user ID `1079143480988799046` may delete entries; enforce this on the server.
- Personality, Rules, and Approved answers are separate settings. Do not reorganize or delete existing customer personality text without a specific request. The user is doing that migration themselves.
- Use the existing purple UI, custom dropdown styling, and disabled-until-changed save behavior. Multiselect menus stay open until dismissed; single-select menus close on selection.
- Keep per-server configuration and retrieval isolated. Approved answers are intentionally available in that server's response channels and must be identified separately from archive messages. Never manufacture Discord citations for approved answers.
- Preserve unrelated work and never read or commit credentials, `.env`, private SSH keys, or downloaded customer data.
- For changes to settings, update dashboard persistence, bot normalization/sync, settings audit, and appropriate response/review paths together. Verify behavior and authorization boundaries before deploying.
