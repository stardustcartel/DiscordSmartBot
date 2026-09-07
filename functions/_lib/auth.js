const textEncoder = new TextEncoder();

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function signature(value, secret) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}

export async function seal(payload, secret) {
  const body = base64url(textEncoder.encode(JSON.stringify(payload)));
  return `${body}.${await signature(body, secret)}`;
}

export async function unseal(value, secret) {
  if (!value) return null;
  const [body, expected] = value.split(".");
  if (!body || !expected) return null;
  const actual = await signature(body, secret);
  if (actual.length !== expected.length) return null;
  const actualBytes = textEncoder.encode(actual);
  const expectedBytes = textEncoder.encode(expected);
  let different = 0;
  for (let index = 0; index < actualBytes.length; index += 1) different |= actualBytes[index] ^ expectedBytes[index];
  if (different !== 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  } catch {
    return null;
  }
}

export function cookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "").split(";").map((part) => part.trim().split("=")).filter(([name, value]) => name && value).map(([name, ...value]) => [name, value.join("=")]));
}

export function cookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers }});
}

export function publicUrl(env, request) {
  return String(env.DASHBOARD_PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export function managedGuilds(guilds) {
  const manageGuild = 0x20n;
  return guilds.filter((guild) => (BigInt(guild.permissions || "0") & manageGuild) !== 0n).map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon }));
}
