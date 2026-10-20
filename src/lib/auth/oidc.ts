import { createHash, createPublicKey, createVerify, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { createSession } from "./session";

// OIDC relying party (FR-ENT-01 completion): authorization-code flow with
// state + nonce CSRF protection and RS256 ID-token verification against the
// provider's JWKS. Fully config-driven and OFF by default:
//   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET,
//   OIDC_REDIRECT_URI (optional), OIDJ_DEFAULT_ORG_ID (JIT membership).

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function oidcEnabled(): boolean {
  return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);
}

export function oidcConfig(baseOrigin: string): OidcConfig {
  return {
    issuer: process.env.OIDC_ISSUER!.replace(/\/+$/, ""),
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
    redirectUri: process.env.OIDC_REDIRECT_URI || `${baseOrigin}/api/auth/oidc/callback`,
  };
}

export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveryCache = new Map<string, { doc: OidcDiscovery; fetchedAt: number }>();

export async function discover(cfg: OidcConfig, fetchFn: typeof fetch = fetch): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(cfg.issuer);
  if (cached && Date.now() - cached.fetchedAt < 3600_000) return cached.doc;
  const res = await fetchFn(`${cfg.issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OIDC_DISCOVERY_FAILED_${res.status}`);
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error("OIDC_DISCOVERY_INCOMPLETE");
  }
  discoveryCache.set(cfg.issuer, { doc, fetchedAt: Date.now() });
  return doc;
}

// ---- state / nonce CSRF store -------------------------------------------

export async function issueState(): Promise<{ state: string; nonce: string }> {
  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  await db.oidcState.create({
    data: {
      id: `oid_${createHash("sha256").update(state).digest("hex")}`,
      nonce,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  return { state, nonce };
}

export async function consumeState(state: string): Promise<string | null> {
  const id = `oid_${createHash("sha256").update(state).digest("hex")}`;
  const row = await db.oidcState.findUnique({ where: { id } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  await db.oidcState.update({ where: { id }, data: { usedAt: new Date() } });
  return row.nonce;
}

// ---- RS256 ID-token verification ------------------------------------------

interface Jwk { kty: string; kid?: string; n?: string; e?: string; alg?: string }
interface Jwks { keys: Jwk[] }

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
}

export function decodeJwtSegments(jwt: string): { header: { alg: string; kid?: string }; payload: Record<string, unknown>; signingInput: string; signature: Buffer } {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("MALFORMED_ID_TOKEN");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg: string; kid?: string };
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
  };
}

export function verifyRs256(jwt: string, jwk: Jwk, signingInput?: string, signature?: Buffer): void {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new Error("UNSUPPORTED_JWK");
  const seg = decodeJwtSegments(jwt);
  const input = signingInput ?? seg.signingInput;
  const sig = signature ?? seg.signature;
  if (seg.header.alg !== "RS256") throw new Error("UNSUPPORTED_ALG");
  const keyObject = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  const ok = createVerify("RSA-SHA256").update(input).verify(keyObject, sig);
  if (!ok) throw new Error("SIGNATURE_INVALID");
}

export function validateIdToken(jwt: string, jwks: Jwks, cfg: OidcConfig, expectedNonce: string): IdTokenClaims {
  const seg = decodeJwtSegments(jwt);
  const jwk =
    (seg.header.kid ? jwks.keys.find((k) => k.kid === seg.header.kid) : undefined) ??
    jwks.keys.find((k) => k.kty === "RSA") ?? null;
  if (!jwk) throw new Error("NO_MATCHING_JWK");
  verifyRs256(jwt, jwk, seg.signingInput, seg.signature);
  const c = seg.payload as unknown as IdTokenClaims;
  if (c.iss !== cfg.issuer) throw new Error("ISSUER_MISMATCH");
  if (c.aud !== cfg.clientId) throw new Error("AUDIENCE_MISMATCH");
  if (typeof c.exp !== "number" || c.exp * 1000 < Date.now() - 30_000) throw new Error("TOKEN_EXPIRED");
  if (c.nonce !== expectedNonce) throw new Error("NONCE_MISMATCH");
  if (!c.sub) throw new Error("NO_SUBJECT");
  return c;
}

// ---- session provisioning --------------------------------------------------

/**
 * Provision-or-link the local user for a verified OIDC identity and create a
 * session. Link precedence: oidcSubject, then verified email; otherwise JIT
 * create (password unusable — random) and, when OIDC_DEFAULT_ORG_ID is set,
 * add a RESEARCHER membership to that org.
 */
export async function provisionFromOidc(claims: IdTokenClaims): Promise<{ sessionToken: string; userId: string; email: string }> {
  let user = await db.user.findUnique({ where: { oidcSubject: claims.sub } });
  if (!user && claims.email && claims.email_verified !== false) {
    const byEmail = await db.user.findUnique({ where: { email: claims.email.toLowerCase() } });
    if (byEmail && !byEmail.oidcSubject) {
      user = await db.user.update({ where: { id: byEmail.id }, data: { oidcSubject: claims.sub } }); // account link
    }
  }
  if (!user) {
    const email = (claims.email ?? `${claims.sub.replace(/[^a-z0-9]/gi, "")}@oidc.local`).toLowerCase();
    user = await db.user.create({
      data: {
        id: newId("usr"),
        email,
        name: claims.name ?? claims.preferred_username ?? email,
        passwordHash: `oidc!${randomBytes(24).toString("hex")}`, // not a scrypt hash: password login disabled
        oidcSubject: claims.sub,
      },
    });
    const defaultOrg = process.env.OIDC_DEFAULT_ORG_ID;
    if (defaultOrg) {
      const org = await db.organization.findUnique({ where: { id: defaultOrg } });
      if (org) {
        await db.membership.upsert({
          where: { orgId_principalId: { orgId: org.id, principalId: user.id } },
          update: {},
          create: { id: newId("mem"), orgId: org.id, principalId: user.id, role: "RESEARCHER" },
        });
      }
    }
  }
  const firstOrg = (await db.membership.findFirst({ where: { principalId: user.id, state: "ACTIVE" } }))?.orgId ?? null;
  const sessionToken = await createSession(user.id, firstOrg);
  return { sessionToken, userId: user.id, email: user.email };
}
