export const fileLimits = Object.freeze({ bytes: 10 * 1024 * 1024, count: 50, guildBytes: 100 * 1024 * 1024, globalBytes: 2 * 1024 * 1024 * 1024, textCharacters: 750000, description: 2000 });
export const fileExtensions = ['txt', 'md', 'csv', 'docx', 'xlsx', 'pdf'];
export const validFileId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function fileName(value) { return String(value || '').replace(/[/\\\x00-\x1f\x7f]/g, '_').trim().slice(0, 180); }
export function extension(name) { return String(name).split('.').pop().toLowerCase(); }
export function fileChannels(value) {
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string' || !/^\d{15,25}$/.test(id))) throw Error('Invalid channel selection.');
  return [...new Set(value)];
}
export function filesPermitted(ids, channel) { return !ids.length || ids.includes(channel.id) || Boolean(channel.isThread?.() && ids.includes(channel.parentId)); }
export async function limitedBytes(response, maximum = fileLimits.bytes) {
  if (Number(response.headers.get('Content-Length')) > maximum) throw Error('File exceeds the 10 MB limit.');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > maximum) throw Error('File exceeds the size limit.');
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
