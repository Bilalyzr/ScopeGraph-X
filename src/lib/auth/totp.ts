import { createHmac, randomBytes } from "crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30s step) implemented on node:crypto —
// no external dependency. Used for MFA on user accounts.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("INVALID_BASE32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): { secretBase32: string } {
  const secret = randomBytes(20); // 160 bits, per RFC 4226 §4 R6
  return { secretBase32: base32Encode(secret) };
}

export function totpAt(secretBase32: string, timestampMs: number, step = 30, digits = 6): string {
  const counter = Math.floor(timestampMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

/** Verify with ±1 step clock skew tolerance. */
export function verifyTotp(secretBase32: string, token: string, nowMs = Date.now()): boolean {
  const clean = token.replace(/\D/g, "");
  if (clean.length !== 6) return false;
  for (const skew of [-30_000, 0, 30_000]) {
    if (totpAt(secretBase32, nowMs + skew) === clean) return true;
  }
  return false;
}

export function otpauthUri(secretBase32: string, email: string, issuer = "ScopeGraph X"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
