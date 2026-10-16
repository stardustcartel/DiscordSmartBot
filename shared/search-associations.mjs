export const associationLimits = { entries: 40, total: 12000 };
const list = (value) => [...new Set((Array.isArray(value) ? value : []).map(v => String(v).trim()).filter(Boolean))].slice(0, 20);
export function normalizeAssociations(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(); let total = 0;
  return value.slice(0, associationLimits.entries).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,64}$/.test(item.id) || seen.has(item.id)) return [];
    const entry = { id: item.id, name: String(item.name || '').trim().slice(0, 120), aliases: list(item.aliases).map(s => s.slice(0, 120)), related: list(item.related).map(s => s.slice(0, 120)), userId: /^\d{15,25}$/.test(String(item.userId || '')) ? String(item.userId) : '', context: String(item.context || '').trim().slice(0, 500) };
    total += JSON.stringify(entry).length;
    if (!entry.name || total > associationLimits.total) return [];
    seen.add(entry.id); return [entry];
  });
}
export function validAssociations(value) {
  return Array.isArray(value) && value.length <= associationLimits.entries && value.every(x => x && typeof x.name === 'string' && x.name.trim() && x.name.length <= 120 && ['aliases','related'].every(k => Array.isArray(x[k]) && x[k].length <= 20 && x[k].every(s => typeof s === 'string' && s.trim() && s.length <= 120)) && typeof x.context === 'string' && x.context.length <= 500 && typeof x.userId === 'string' && (!x.userId || /^\d{15,25}$/.test(x.userId))) && normalizeAssociations(value).length === value.length;
}
export function matchingAssociations(value, text) {
  const normalized = ' ' + String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
  return normalizeAssociations(value).filter(item => [item.name, ...item.aliases, ...(item.userId ? [item.userId] : [])].some(alias => normalized.includes(' ' + alias.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ')));
}
