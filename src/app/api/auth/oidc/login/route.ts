import { NextRequest, NextResponse } from "next/server";
import { oidcConfig, oidcEnabled, discover, issueState } from "@/lib/auth/oidc";

export async function GET(req: NextRequest) {
  if (!oidcEnabled()) {
    return NextResponse.json(
      { type: "https://scopegraphx.dev/problems/OIDC_DISABLED", title: "SSO is not configured", status: 503, code: "OIDC_DISABLED" },
      { status: 503, headers: { "content-type": "application/problem+json" } }
    );
  }
  const origin = new URL(req.url).origin;
  const cfg = oidcConfig(origin);
  try {
    const doc = await discover(cfg);
    const { state, nonce } = await issueState();
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    return NextResponse.redirect(url.toString());
  } catch (e) {
    return NextResponse.json(
      { title: "SSO discovery failed", status: 502, code: "OIDC_DISCOVERY_FAILED", detail: e instanceof Error ? e.message : undefined },
      { status: 502, headers: { "content-type": "application/problem+json" } }
    );
  }
}
