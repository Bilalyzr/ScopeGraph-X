import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createSign, type KeyObject } from "crypto";
import {
  decodeJwtSegments, verifyRs256, validateIdToken, oidcConfig, oidcEnabled,
  type OidcConfig,
} from "@/lib/auth/oidc";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function makeConfig(): OidcConfig {
  process.env.OIDC_ISSUER = "https://idp.example.test";
  process.env.OIDC_CLIENT_ID = "sgx-client";
  process.env.OIDC_CLIENT_SECRET = "sekret";
  return oidcConfig("http://127.0.0.1:3000");
}

function signIdToken(privateKey: KeyObject, claims: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

function baseClaims(cfg: OidcConfig) {
  return {
    iss: cfg.issuer,
    sub: "user-123",
    aud: cfg.clientId,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    nonce: "n0nce-value",
    email: "sso.user@example.test",
    email_verified: true,
    name: "SSO User",
  };
}

describe("OIDC ID-token verification (RS256/JWKS)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwkPub = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string; kid?: string };
  const jwks = { keys: [{ ...jwkPub, kid: "k1", alg: "RS256" }] };

  it("accepts a correctly signed token with matching iss/aud/exp/nonce", () => {
    const cfg = makeConfig();
    const jwt = signIdToken(privateKey, baseClaims(cfg));
    const claims = validateIdToken(jwt, jwks, cfg, "n0nce-value");
    expect(claims.sub).toBe("user-123");
    expect(claims.email).toBe("sso.user@example.test");
  });

  it("rejects tokens signed by a key not in the provider JWKS", () => {
    const cfg = makeConfig();
    // Attacker forges claims and signs with their OWN key (not the IdP's).
    const { privateKey: attackerKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })));
    const payload = b64url(Buffer.from(JSON.stringify(baseClaims(cfg))));
    const sig = b64url(createSign("RSA-SHA256").update(`${header}.${payload}`).sign(attackerKey));
    const attackerJwt = `${header}.${payload}.${sig}`;
    expect(() => validateIdToken(attackerJwt, jwks, cfg, "n0nce-value")).toThrow("SIGNATURE_INVALID");
  });

  it("rejects issuer, audience, expiry and nonce mismatches", () => {
    const cfg = makeConfig();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["ISSUER_MISMATCH", { ...baseClaims(cfg), iss: "https://evil.example.test" }],
      ["AUDIENCE_MISMATCH", { ...baseClaims(cfg), aud: "other-app" }],
      ["TOKEN_EXPIRED", { ...baseClaims(cfg), exp: Math.floor(Date.now() / 1000) - 3600 }],
      ["NONCE_MISMATCH", { ...baseClaims(cfg), nonce: "replayed-or-forged" }],
    ];
    for (const [expected, claims] of cases) {
      const jwt = signIdToken(privateKey, claims);
      try {
        validateIdToken(jwt, jwks, cfg, "n0nce-value");
        expect.fail(`expected ${expected}`);
      } catch (e) {
        expect((e as Error).message).toBe(expected);
      }
    }
  });

  it("rejects malformed tokens and non-RS256 algs", () => {
    const cfg = makeConfig();
    expect(() => decodeJwtSegments("not-a-jwt")).toThrow("MALFORMED_ID_TOKEN");
    const noneJwt = `${b64url(Buffer.from(JSON.stringify({ alg: "none" })))}.${b64url(Buffer.from(JSON.stringify(baseClaims(cfg))))}.`;
    expect(() => validateIdToken(noneJwt, jwks, cfg, "n0nce-value")).toThrow("UNSUPPORTED_ALG");
  });

  it("config guards: disabled unless issuer+client are set", () => {
    delete process.env.OIDC_ISSUER;
    expect(oidcEnabled()).toBe(false);
    makeConfig();
    expect(oidcEnabled()).toBe(true);
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
  });
});
