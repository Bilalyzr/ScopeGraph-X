import { oidcEnabled } from "@/lib/auth/oidc";

/** Login page uses this to show/hide the SSO button (no config details leak). */
export async function GET() {
  return Response.json({ enabled: oidcEnabled() });
}
