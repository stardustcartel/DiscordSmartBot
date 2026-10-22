// Discord text only: never fetch linked pages or interpret images/attachments.
// Use exactly the same extraction during ingestion and live revalidation.
const SOURCE_POLICY_VERSION = 2;
function knowledgeText(message) {
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  if (!message?.author?.bot && !message?.webhookId) return content;
  const selfId = message.client?.user?.id || message.guild?.members?.me?.id || message.channel?.guild?.members?.me?.id;
  // Our delivery receipts attest the body, not embed contents edited afterward.
  if (selfId && message.author?.id === selfId) return content;
  const parts = content ? [content] : [];
  const seen = new Set(parts);
  for (const embed of (message.embeds || []).slice(0, 10)) {
    // Link/video previews are not authored message text. Rich embeds are the
    // normal text payload of bots/integrations, including embed-only messages.
    if (embed.type && embed.type !== 'rich') continue;
    for (const value of [embed.title, embed.description,
      ...(embed.fields || []).slice(0, 25).map(field => [field.name, field.value].filter(Boolean).join(': '))]) {
      if (typeof value !== 'string' || !value.trim() || seen.has(value.trim())) continue;
      seen.add(value.trim());
      parts.push(value.trim());
    }
  }
  return parts.join('\n').slice(0, 10000);
}
module.exports = { knowledgeText, SOURCE_POLICY_VERSION };
