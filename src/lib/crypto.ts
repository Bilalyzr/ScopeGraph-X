import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";

// Application crypto helpers: AES-256-GCM envelope encryption for secrets and
// evidence at rest (NFR-08). Key rotation (KMS parity): a two-key window is
// supported — EVIDENCE_ENCRYPTION_KEY (current) and
// EVIDENCE_ENCRYPTION_KEY_PREVIOUS (retired). Unsealing tries the current key
// then the previous one; scripts/rotate-key.ts re-seals every stored artifact
// under the new key so the previous key can be destroyed.

function deriveKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

function devFallbackKey(): Buffer {
  // Dev-only deterministic fallback so seeds/tests are reproducible. Never use in production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("EVIDENCE_ENCRYPTION_KEY (64 hex chars) is required in production");
  }
  return createHash("sha256").update("scopegraph-dev-only-key").digest();
}

export interface KeyInfo {
  version: string; // fingerprint of the key material
  isFallback: boolean;
  hasPrevious: boolean;
}

export function keyInfo(): KeyInfo {
  const cur = process.env.EVIDENCE_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY;
  const prev = process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS;
  return {
    version: cur ? deriveKey(cur).toString("hex").slice(0, 12) : "dev-fallback",
    isFallback: !cur,
    hasPrevious: Boolean(prev),
  };
}

function currentKey(): Buffer {
  const raw = process.env.EVIDENCE_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY;
  return raw ? deriveKey(raw) : devFallbackKey();
}

function previousKey(): Buffer | null {
  const raw = process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS;
  return raw ? deriveKey(raw) : null;
}

export interface Sealed {
  v: 1;
  iv: string; // hex
  tag: string; // hex
  ct: string; // hex ciphertext
}

function sealWith(key: Buffer, plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ct: ct.toString("hex") };
}

function unsealWith(key: Buffer, sealed: Sealed): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "hex"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "hex")), decipher.final()]).toString("utf8");
}

/** Seal with the CURRENT key. */
export function seal(plaintext: string): Sealed {
  return sealWith(currentKey(), plaintext);
}

/** Unseal with the current key, falling back to the previous rotation key. */
export function unseal(sealed: Sealed): string {
  try {
    return unsealWith(currentKey(), sealed);
  } catch (err) {
    const prev = previousKey();
    if (!prev) throw err;
    return unsealWith(prev, sealed); // throws again if neither key fits (tamper)
  }
}

export function sealJson(value: unknown): string {
  return JSON.stringify(seal(JSON.stringify(value)));
}

export function unsealJson<T>(sealedJson: string): T {
  return JSON.parse(unseal(JSON.parse(sealedJson))) as T;
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
