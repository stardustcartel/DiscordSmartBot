// Add a release for every deployed user-visible change. See AGENTS.md.
// Earlier version labels were assigned when Version History was introduced;
// their timestamps are Git records, not confirmed deployment times.
export const releases = [
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
