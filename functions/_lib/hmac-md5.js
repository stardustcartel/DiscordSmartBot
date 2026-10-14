const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);
const rotate = (value, amount) => (value << amount) | (value >>> (32 - amount));

function md5(input) {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input); padded[input.length] = 0x80;
  new DataView(padded.buffer).setBigUint64(paddedLength - 8, BigInt(input.length) * 8n, true);
  let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const word = view.getInt32(offset + g * 4, true);
      const sum = (a + f + constants[i] + word) | 0;
      [a, d, c, b] = [d, c, b, (b + rotate(sum, shifts[i])) | 0];
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const digest = new Uint8Array(16), output = new DataView(digest.buffer);
  [a0, b0, c0, d0].forEach((word, i) => output.setInt32(i * 4, word, true));
  return digest;
}

export function hmacMd5(message, secret) {
  let key = new TextEncoder().encode(secret);
  if (key.length > 64) key = md5(key);
  const innerPad = new Uint8Array(64), outerPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { innerPad[i] = (key[i] || 0) ^ 0x36; outerPad[i] = (key[i] || 0) ^ 0x5c; }
  const body = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const inner = new Uint8Array(innerPad.length + body.length); inner.set(innerPad); inner.set(body, innerPad.length);
  const innerHash = md5(inner), outer = new Uint8Array(outerPad.length + innerHash.length); outer.set(outerPad); outer.set(innerHash, outerPad.length);
  return [...md5(outer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
