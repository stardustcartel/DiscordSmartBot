function bytesToBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function base64ToBytes(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }

export async function encryptGeminiKey(apiKey, encodedKey) {
  const keyBytes = base64ToBytes(String(encodedKey || "").trim());
  if (keyBytes.length !== 32) throw new Error("GUILD_SECRETS_KEY must contain a base64-encoded 32-byte key.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const combined = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, new TextEncoder().encode(apiKey)));
  const tag = combined.slice(combined.length - 16);
  const ciphertext = combined.slice(0, combined.length - 16);
  return { iv: bytesToBase64(iv), tag: bytesToBase64(tag), ciphertext: bytesToBase64(ciphertext) };
}
