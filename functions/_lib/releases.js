// Add a release for every deployed user-visible change. See AGENTS.md.
// Earlier version labels were assigned when Version History was introduced;
// their timestamps are Git records, not confirmed deployment times.
export const releases = [
  { version: "2.6.4", at: "2026-10-22T23:05:42Z", historical: false, changes: [
    "Fixed DM server switching for numbered replies with punctuation, ordinal replies, and pasted server names. Invalid selections now keep the original question while the server chooser stays open.",
    "Natural requests to switch servers open the chooser directly, without using an AI request."
  ] },
  { version: "2.6.3", at: "2026-10-22T07:15:18Z", historical: false, changes: [
    "Broadened Discord knowledge indexing to include other bots and integrations, including rich-embed text, in selected source channels. Older eligible messages are recovered incrementally without rebuilding the database.",
    "Kept existing permission checks, citations, search budgets, and exclusion of this bot's own AI replies. Added source-origin and indexing diagnostics to help distinguish missing data from unsuccessful searches."
  ] },
  { version: "2.6.2", at: "2026-10-22T03:35:48Z", historical: false, changes: [
    "Fixed missing YouTube knowledge in server and DM answers: verified announcements from this bot can now be indexed in selected source channels, with historical recovery and existing permission checks.",
    "Added announcement delivery evidence and indexing diagnostics. Answers distinguish Discord announcement times from actual YouTube publication times. AI-generated replies remain excluded from knowledge sources."
  ] },
  { version: "2.6.1", at: "2026-10-22T02:50:06Z", historical: false, changes: [
    "Direct-message answers now show which server they use and the bot's configured server name, with the server-specific bot avatar and server icon where available.",
    "Server selection lists each bot's server name. Answers still use that server's AI, behavior, and knowledge settings."
  ] },
  { version: "2.6.0", at: "2026-10-22T02:31:42Z", historical: false, changes: [
    "Removed the duplicate DM /chat command; /chat remains available inside servers.",
    "Added optional server-linked direct messages with membership, role-access, and server-selection checks. Each conversation uses the selected server's AI provider and API key.",
    "Knowledge-backed mode and citation requirements now apply in DMs, with separate DM exemptions and source-permission checks."
  ] },
  { version: "2.5.5", at: "2026-10-22T02:11:02Z", historical: false, changes: [
    "Required a description for uploaded files, with a contextual required marker and upload button that activates only when both a file and description are provided."
  ] },
  { version: "2.5.4", at: "2026-10-22T01:55:02Z", historical: false, changes: [
    "Updated the homepage word cloud artwork."
  ] },
  { version: "2.5.3", at: "2026-10-21T23:56:05Z", historical: false, changes: [
    "Updated the homepage word cloud artwork."
  ] },
  { version: "2.5.2", at: "2026-10-21T23:50:16Z", historical: false, changes: [
    "Updated the homepage word cloud artwork."
  ] },
  { version: "2.5.1", at: "2026-10-21T23:38:58Z", historical: false, changes: [
    "Replaced the homepage word cloud with the updated artwork."
  ] },
  { version: "2.5.0", at: "2026-10-21T22:30:21Z", historical: false, changes: [
    "Forum follow-ups now include recent messages from participants and the bot, keeping the latest comment central while preserving the original discussion.",
    "The bot can reuse verified research for additional examples and search for missing details or new questions. Earlier bot answers provide context, not evidence; current knowledge and citation settings still apply.",
    "Added bounded thread research storage, ordered thread replies, and diagnostics showing reused sources, previous examples, new searches, and missing evidence."
  ] },
  { version: "2.4.5", at: "2026-10-21T21:48:40Z", historical: false, changes: [
    "Simplified document cards by hiding internal checksums, storage paths, and revision identifiers while preserving diagnostic tracking.",
    "Renamed the Google Drive parent-folder navigation button to Back."
  ] },
  { version: "2.4.4", at: "2026-10-21T21:25:00Z", historical: false, changes: [
    "Polished Google Drive folder browsing with matching scrollbars, clearer selection states, and improved spacing around folder and disconnect controls.",
    "Add folder now checks Google Drive access and shows inline errors for invalid links. Selected folders have Remove buttons; save to apply selection changes without deleting anything from Drive."
  ] },
  { version: "2.4.3", at: "2026-10-21T19:47:00Z", historical: false, changes: [
    "File and Google Drive citations now use a single moderator-added document notice instead of document names or Drive links; Discord and Patreon citations remain available.",
    "Refreshed Files & Google Drive buttons, combined visibility and indexing into one card, added a clear-files control and Google Drive logo, and show the connected account's email.",
    "Knowledge Base and its subtabs now unlock after an AI key is added. AI Integration can be collapsed by clicking its heading."
  ] },
  { version: "2.4.2", at: "2026-10-20T20:10:52Z", historical: false, changes: [
    "Added breathing room above Save document visibility and renamed the upload context field to File Context."
  ] },
  { version: "2.4.1", at: "2026-10-20T20:07:33Z", historical: false, changes: [
    "Restyled Google Drive and document controls to match the dashboard buttons, and highlighted document visibility and indexing in purple feature cards at the top of the tab."
  ] },
  { version: "2.4.0", at: "2026-10-20T19:05:36Z", historical: false, changes: [
    "Added Files & Google Drive to Knowledge Base, with document uploads, private folder synchronization, per-server indexing and downloadable diagnostics. Connection requires the service owner's storage and Google OAuth setup.",
    "Document excerpts now join Discord and Patreon knowledge searches with source verification and citations. Knowledge-backed answers better preserve the server's configured personality."
  ] },
  { version: "2.3.3", at: "2026-10-18T19:19:00Z", historical: false, changes: [
    "Expanded Patreon link normalization to support creator-prefixed post paths while continuing to reject links outside Patreon."
  ] },
  { version: "2.3.2", at: "2026-10-18T19:18:00Z", historical: false, changes: [
    "Fixed Patreon posts being skipped when Patreon supplies relative post links. Valid links are now normalized to full Patreon URLs, and existing connections automatically rescan.",
    "Empty imports now show helpful guidance. Rejected published posts report an error and preserve existing indexed content instead of silently appearing ready."
  ] },
  { version: "2.3.1", at: "2026-10-18T19:14:00Z", historical: false, changes: [
    "Added safe Patreon import diagnostics to distinguish empty API responses from posts rejected during import, without exposing credentials or post bodies."
  ] },
  { version: "2.3.0", at: "2026-10-17T19:10:30Z", historical: false, changes: [
    "Added structured Discord lookups for latest/earliest messages and date ranges, with validated author and channel filters instead of relying on keyword relevance.",
    "Short replies remain eligible for chronological answers. Lookups recheck source access and message availability, log their filters and results, and explain indexed-archive coverage limits.",
    "Ordinary topic searches retain contextual synonym expansion and conversation-aware retrieval."
  ] },
  { version: "2.2.2", at: "2026-10-17T18:32:00Z", historical: false, changes: [
    "Knowledge searches now automatically expand relevant concepts into contextual synonyms, paraphrases, and alternative wording on every server, without requiring Behavior entries.",
    "Search logs show the generated alternatives, their reasoning, and the additional searches. Expansion reuses the existing AI planning request."
  ] },
  { version: "2.2.1", at: "2026-10-17T17:38:00Z", historical: false, changes: [
    "Patreon Disconnect now uses an inline confirmation instead of a browser popup, with a visible progress indicator and protection against repeated clicks."
  ] },
  { version: "2.2.0", at: "2026-10-16T21:50:30Z", historical: false, changes: [
    "Added Names & Search Associations in Behavior for nicknames, Discord identities, and context-specific related search terms.",
    "Knowledge searches now preserve question-and-answer context across members, including informal questions, pronouns, short replies, and nearby explanations. Linked context stays together through answer verification.",
    "Search logs now show conversation links, selected context, association-based searches, and why context was omitted."
  ] },
  { version: "2.1.6", at: "2026-10-16T20:51:34Z", historical: false, changes: [
    "Newly selected Discord knowledge channels are scanned promptly, and the dashboard's message count now reflects the current archive on each bot sync.",
    "The bot and dashboard now explain when a restricted source cannot be used in a forum visible to a broader audience, without revealing private source content."
  ] },
  { version: "2.1.5", at: "2026-10-15T23:43:43Z", historical: false, changes: [
    "Organized Knowledge Base into separate Discord and Patreon tabs under AI Integration, with each source's settings and indexing status in its own view."
  ] },
  { version: "2.1.4", at: "2026-10-15T23:38:43Z", historical: false, changes: [
    "Shortened and clarified dashboard guidance for Knowledge Base, Patreon, and Behavior settings."
  ] },
  { version: "2.1.3", at: "2026-10-15T21:43:05Z", historical: false, changes: [
    "Improved Patreon campaign connection requests and added safe diagnostics for network, redirect, and response-format failures."
  ] },
  { version: "2.1.2", at: "2026-10-15T21:13:48Z", historical: false, changes: [
    "Corrected Patreon API request formatting and clarified campaign access errors during connection."
  ] },
  { version: "2.1.1", at: "2026-10-15T21:09:03Z", historical: false, changes: [
    "Patreon connection failures now identify whether the app credentials, authorization, campaign lookup, or dashboard storage needs attention."
  ] },
  { version: "2.1.0", at: "2026-10-14T23:45:29Z", historical: false, changes: [
    "Added Connect Patreon in Knowledge Base, with OAuth authorization, separate Discord and Patreon indexing status, and channel visibility controls.",
    "Connected creator post text and resource links can support bot answers and citations. Post notifications and periodic synchronization keep the archive updated; collections do not need to be recreated.",
    "Added Sync now, reconnect, and disconnect controls. A one-time Patreon application setup is required before connecting; media and attachments are not transcribed."
  ] },
  { version: "2.0.0", at: "2026-10-14T20:50:00Z", historical: false, changes: [
    "Added Behavior sections for Personality, Rules, and administrator-approved answers. Approved answers can support replies even in Knowledge-backed mode.",
    "Added Version History under Help & updates, alongside Support. The service owner can remove individual release entries.",
    "Existing personality text is preserved so server admins can reorganize it themselves."
  ] },
  { version: "1.4.0", at: "2026-10-14T00:45:56Z", historical: true, changes: ["Knowledge searches now keep consecutive messages from the same member together, including explanations sent in follow-up messages. Improved search diagnostics and source validation."] },
  { version: "1.3.2", at: "2026-10-13T22:09:03Z", historical: true, changes: ["Removed the slash-command-only waiting notice. Fixed Save personality staying enabled when its text was unchanged or empty."] },
  { version: "1.3.1", at: "2026-10-13T21:31:39Z", historical: true, changes: ["AI status reports Gemini model availability and fallback order. Dashboard save buttons now reflect unsaved changes."] },
  { version: "1.3.0", at: "2026-10-13T20:36:13Z", historical: true, changes: ["Improved answer evidence checks and repair feedback. Diagnostic logs now show how the final response was reviewed."] },
  { version: "1.2.0", at: "2026-10-12T20:29:21Z", historical: true, changes: ["Improved knowledge retrieval with focused searches, relevance review, and additional searches when the first results are insufficient."] },
  { version: "1.1.2", at: "2026-10-12T19:27:35Z", historical: true, changes: ["Added per-server logs of knowledge searches and the sources passed to the answer model."] },
  { version: "1.1.1", at: "2026-10-12T18:51:05Z", historical: true, changes: ["Added /ai-status to inspect the AI settings loaded by the running bot and its last dashboard sync."] },
  { version: "1.1.0", at: "2026-10-12T17:36:12Z", historical: true, changes: ["Added a per-server settings audit history for troubleshooting. Later fixes improved cautious answers when evidence is incomplete."] },
  { version: "1.0.1", at: "2026-10-12T16:25:49Z", historical: true, changes: ["Added YouTube announcement outcome logs with server, source channel, and delivery details."] },
  { version: "1.0.0", at: "2026-10-08T19:47:18Z", historical: true, changes: ["Added YouTube push notifications, with polling retained as a fallback. Subsequent updates introduced independent knowledge grounding and citation controls and clearer dashboard status information."] }
];
