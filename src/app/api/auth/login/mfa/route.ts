import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { problem, requestIdOf } from "@/lib/api";
import { audit } from "@/lib/audit";
import { verifyLoginMfa } from "@/lib/auth/mfa";
import { consumeMfaChallenge } from "@/lib/auth/challenge";

const bodySchema = z.object({ challenge_token: z.string().min(1), code: z.string().min(6).max(8) });

/** Step 2 of MFA login: consume the challenge with a valid TOTP code. */
export async function POST(req: NextRequest) {
  const requestId = requestIdOf(req);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "VALIDATION_ERROR", "challenge_token and code required");
  const userId = await consumeMfaChallenge(parsed.data.challenge_token);
  if (!userId) return problem(401, "CHALLENGE_INVALID", "Challenge expired or already used — sign in again");
  if (!(await verifyLoginMfa(userId, parsed.data.code))) {
    await audit({ orgId: "system", actorId: userId, action: "auth.mfa_failed", resourceType: "User", resourceId: userId, decision: "DENY" });
    return problem(401, "INVALID_MFA", "Invalid code");
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return problem(401, "UNAUTHENTICATED", "Account missing");
  const memberships = await db.membership.findMany({ where: { principalId: user.id, state: "ACTIVE" } });
  const firstOrg = memberships[0]?.orgId ?? null;
  const token = await createSession(user.id, firstOrg);
  await audit({
    orgId: firstOrg ?? "system",
    actorId: user.id,
    action: "auth.login_mfa",
    resourceType: "User",
    resourceId: user.id,
    decision: "ALLOW",
  });
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
    active_org_id: firstOrg,
    organizations: await Promise.all(
      memberships.map(async (m) => {
        const org = await db.organization.findUnique({ where: { id: m.orgId } });
        return { id: m.orgId, name: org?.name ?? m.orgId, slug: org?.slug ?? "", role: m.role };
      })
    ),
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 24,
  });
  res.headers.set("x-request-id", requestId);
  return res;
}
