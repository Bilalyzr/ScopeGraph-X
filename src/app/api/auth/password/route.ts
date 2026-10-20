import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { problem, requestIdOf } from "@/lib/api";
import { audit } from "@/lib/audit";
import { isMfaEnabled, verifyLoginMfa } from "@/lib/auth/mfa";

const schema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(10).regex(/[A-Za-z]/).regex(/[0-9]/),
  mfa_code: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return problem(422, "VALIDATION_ERROR", "New password must be 10+ chars with letters and digits", parsed.error.issues[0]?.message);
  }
  const user = await db.user.findUnique({ where: { id: principal.userId } });
  if (!user || !verifyPassword(parsed.data.current_password, user.passwordHash)) {
    return problem(401, "INVALID_CREDENTIALS", "Current password is incorrect");
  }
  if (await isMfaEnabled(principal.userId)) {
    if (!parsed.data.mfa_code) return problem(401, "MFA_REQUIRED", "MFA code required to change password");
    if (!(await verifyLoginMfa(principal.userId, parsed.data.mfa_code))) {
      return problem(401, "INVALID_MFA", "Invalid MFA code");
    }
  }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(parsed.data.new_password) } });
  // Security posture: a password rotation revokes ALL sessions — the user
  // signs in again with the new password (and MFA if enabled).
  const revoked = await db.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit({
    orgId: principal.orgId ?? "system",
    actorId: user.id,
    action: "auth.password_changed",
    resourceType: "User",
    resourceId: user.id,
    decision: "ALLOW",
    reason: `Password rotated; ${revoked.count} session(s) revoked`,
  });
  return Response.json({ ok: true, sessions_revoked: revoked.count, relogin_required: true }, {
    headers: { "x-request-id": requestId },
  });
}
