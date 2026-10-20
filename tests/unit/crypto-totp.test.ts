import { describe, expect, it } from "vitest";
import { seal, unseal, sealJson, unsealJson } from "@/lib/crypto";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, verifyTotp } from "@/lib/auth/totp";

describe("AES-256-GCM envelope encryption", () => {
  it("round-trips plaintext", () => {
    const s = seal('{"order":"ord_1001","note":"confidential"}');
    expect(s.ct).not.toContain("ord_1001");
    expect(unseal(s)).toBe('{"order":"ord_1001","note":"confidential"}');
  });

  it("detects ciphertext tampering (GCM auth)", () => {
    const s = seal("secret-evidence");
    const flipped = { ...s, ct: (BigInt("0x" + s.ct) ^ 1n).toString(16).padStart(s.ct.length, "0") };
    expect(() => unseal(flipped)).toThrow();
  });

  it("detects tag tampering", () => {
    const s = seal("secret-evidence");
    expect(() => unseal({ ...s, tag: "0".repeat(32) })).toThrow();
  });

  it("json helpers round-trip structured values", () => {
    const value = { a: [1, 2, { b: "c" }] };
    expect(unsealJson(sealJson(value))).toEqual(value);
  });

  it("produces unique IVs per call", () => {
    expect(seal("x").iv).not.toBe(seal("x").iv);
  });
});

describe("RFC 6238 TOTP", () => {
  // Standard test vector secret: base32("12345678901234567890")
  const SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

  it("matches the RFC test vector at T=59 (SHA1, 8-digit known value truncated to 6)", () => {
    // RFC 6238 Appendix B: T=59s → 94287082 (8 digits); 6-digit form is 287082.
    expect(totpAt(SECRET, 59_000)).toBe("287082");
  });

  it("matches the RFC test vector at T=1111111109", () => {
    // 8-digit 07081804 → 6-digit 081804
    expect(totpAt(SECRET, 1_111_111_109_000)).toBe("081804");
  });

  it("verifies current code and tolerates ±1 step skew", () => {
    const { secretBase32 } = generateTotpSecret();
    const now = 1_700_000_000_000; // multiple of 30s
    const code = totpAt(secretBase32, now);
    expect(verifyTotp(secretBase32, code, now)).toBe(true);
    // simulate client 25s ahead/behind — still inside ±30s window
    expect(verifyTotp(secretBase32, code, now + 25_000)).toBe(true);
    expect(verifyTotp(secretBase32, code, now - 25_000)).toBe(true);
    // 2 steps out of window rejected
    expect(verifyTotp(secretBase32, code, now + 90_000)).toBe(false);
  });

  it("rejects malformed tokens and garbage input", () => {
    const { secretBase32 } = generateTotpSecret();
    expect(verifyTotp(secretBase32, "12345")).toBe(false);
    expect(verifyTotp(secretBase32, "abcdef")).toBe(false);
    expect(verifyTotp(secretBase32, "000000000")).toBe(false);
  });

  it("emits an otpauth:// enrollment URI", () => {
    const { secretBase32 } = generateTotpSecret();
    const uri = otpauthUri(secretBase32, "user@demo.test");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(`secret=${secretBase32}`);
    expect(() => base32Decode("1O0I!")).toThrow();
  });
});
