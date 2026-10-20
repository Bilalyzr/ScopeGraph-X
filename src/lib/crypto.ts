import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";

// Application crypto helpers: AES-256-GCM envelope encryption for secrets and
// evidence at rest (NFR-08 dev posture: strong at-rest encryption with a key
// from the environment; production rotates via KMS).

function loadKey(): Buffer {
  const raw = process.env.EVIDENCE_ENCRYPTION_KEY || process.env.APP_ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (raw) {
    const derived = createHash("sha256").update(raw).digest();
    return derived;
  }
  // Dev-only deterministic fallback so seeds/tests are reproducible. Never use in production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("EVIDENCE_ENCRYPTION_KEY (64 hex chars) is required in production");
  }
  return createHash("sha256").update("scopegraph-dev-only-key").digest();
}

export interface Sealed {
  v: 1;
  iv: string; // hex
  tag: string; // hex
  ct: string; // hex ciphertext
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ct: ct.toString("hex") };
}

export function unseal(sealed: Sealed): string {
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(sealed.iv, "hex"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "hex")), decipher.final()]).toString("utf8");
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
