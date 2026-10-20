import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { oidcConfig, oidcEnabled, discover, consumeState, validateIdToken, provisionFromOidc } from "@/lib/auth/oidc";

function problem(status: number, code: string, title: string) {
  return NextResponse.json(
    { title, status, code },
    { status, headers: { "content-type": "application/problem+json" } }
  );
}

export async function GET(req: NextRequest) {
  if (!oidcEnabled()) return problem(503, "OIDC_DISABLED", "SSO is not configured");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return problem(400, "OIDC_MISSING_PARAMS", "Missing code/state");

  const nonce = await consumeState(state);
  if (!nonce) return problem(401, "OIDC_STATE_INVALID", "SSO state expired or replayed");

  const cfg = oidcConfig(url.origin);
  try {
    const doc = await discover(cfg);

    // Token exchange
    const tokenRes = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenRes.ok) return problem(502, "OIDC_TOKEN_EXCHANGE_FAILED", "Token exchange failed");
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) return problem(502, "OIDC_NO_ID_TOKEN", "Provider returned no ID token");

    // JWKS fetch + full ID-token verification (signature, iss, aud, exp, nonce)
    const jwksRes = await fetch(doc.jwks_uri, { signal: AbortSignal.timeout(15_000) });
    if (!jwksRes.ok) return problem(502, "OIDC_JWKS_FAILED", "Could not fetch provider keys");
    const jwks = (await jwksRes.json()) as { keys: Array<Record<string, unknown>> };
    const claims = validateIdToken(tokens.id_token, jwks as never, cfg, nonce);

    const { sessionToken, userId, email } = await provisionFromOidc(claims);
    await audit({
      orgId: process.env.OIDC_DEFAULT_ORG_ID ?? "system",
      actorId: userId,
      action: "auth.login_oidc",
      resourceType: "User",
      resourceId: userId,
      decision: "ALLOW",
      metadata: { email, iss: cfg.issuer },
    });

    const res = NextResponse.redirect(new URL("/dashboard", url.origin));
    res.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    return res;
  } catch (e) {
    return problem(401, "OIDC_VERIFICATION_FAILED", e instanceof Error ? e.message : "SSO verification failed");
  }
}
