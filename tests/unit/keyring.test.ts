import { afterAll, describe, expect, it } from "vitest";

// Key-rotation window tests — manipulate env keys locally and restore.
const ORIGINAL_KEY = process.env.EVIDENCE_ENCRYPTION_KEY;
const NEW_KEY = "11".repeat(32);
const OLD_KEY = "22".repeat(32);

describe("keyring rotation window (KMS parity)", () => {
  afterAll(() => {
    process.env.EVIDENCE_ENCRYPTION_KEY = ORIGINAL_KEY;
    delete process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS;
  });

  it("unseals with the previous key during the rotation window", async () => {
    process.env.EVIDENCE_ENCRYPTION_KEY = OLD_KEY;
    delete process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS;
    const { seal, unseal } = await import("@/lib/crypto");
    const sealed = seal("artifact-sealed-under-old-key");

    // Rotate: new current, old kept as previous — reads still work.
    process.env.EVIDENCE_ENCRYPTION_KEY = NEW_KEY;
    process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS = OLD_KEY;
    const { unseal: unsealAfterRotation } = await import("@/lib/crypto");
    expect(unsealAfterRotation(sealed)).toBe("artifact-sealed-under-old-key");

    // Re-seal under the new key, then previous can be destroyed.
    const { seal: sealNew, unseal: unsealNew } = await import("@/lib/crypto");
    const resealed = sealNew("artifact-sealed-under-old-key");
    delete process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS;
    expect(unsealNew(resealed)).toBe("artifact-sealed-under-old-key");
  });

  it("fails closed when neither current nor previous key fits", async () => {
    process.env.EVIDENCE_ENCRYPTION_KEY = NEW_KEY;
    delete process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS;
    const { seal, unseal } = await import("@/lib/crypto");
    const sealed = seal("some-artifact");
    process.env.EVIDENCE_ENCRYPTION_KEY = "33".repeat(32); // wrong key entirely
    process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS = "44".repeat(32);
    const { unseal: unsealWrong } = await import("@/lib/crypto");
    expect(() => unsealWrong(sealed)).toThrow();
  });

  it("keyInfo reports version and window state", async () => {
    process.env.EVIDENCE_ENCRYPTION_KEY = NEW_KEY;
    process.env.EVIDENCE_ENCRYPTION_KEY_PREVIOUS = OLD_KEY;
    const { keyInfo } = await import("@/lib/crypto");
    expect(keyInfo().isFallback).toBe(false);
    expect(keyInfo().hasPrevious).toBe(true);
    expect(keyInfo().version).toHaveLength(12);
  });
});
