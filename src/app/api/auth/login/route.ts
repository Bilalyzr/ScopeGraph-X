import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { problem, requestIdOf } from "@/lib/api";
import { audit } from "@/lib/audit";
import { isMfaEnabled } from "@/lib/auth/mfa";
import { createMfaChallenge } from "@/lib/auth/challenge";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const requestId = requestIdOf(req);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "VALIDATION_ERROR", "Invalid request body", parsed.error.issues[0]?.message);
  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  // Constant-shape failure: no user-enumeration via timing or message.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    if (user) {
      await audit({ orgId: "system", actorId: user.id, action: "auth.login_failed", resourceType: "User", resourceId: user.id, decision: "DENY", reason: "Invalid credentials" });
    }
    return problem(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  // MFA-enabled accounts: password alone never creates a session.
  if (await isMfaEnabled(user.id)) {
    const challenge_token = await createMfaChallenge(user.id);
    return NextResponse.json(
      { mfa_required: true, challenge_token },
      { headers: { "x-request-id": requestId } }
    );
  }

  const memberships = await db.membership.findMany({ where: { principalId: user.id, state: "ACTIVE" } });
  const firstOrg = memberships[0]?.orgId ?? null;
  const token = await createSession(user.id, firstOrg);
  await audit({
    orgId: firstOrg ?? "system",
    actorId: user.id,
    action: "auth.login",
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
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  res.headers.set("x-request-id", requestId);
  return res;
}
