import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { problem, requestIdOf } from "@/lib/api";
import { audit } from "@/lib/audit";
import { startEnrollment, confirmEnrollment, disableMfa, isMfaEnabled } from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";

/** Step 1: start enrollment — returns the TOTP secret + otpauth URI (shown once). */
export async function POST(req: NextRequest) {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  if (await isMfaEnabled(principal.userId)) {
    return problem(409, "MFA_ALREADY_ENABLED", "MFA is already enabled on this account");
  }
  const enrollment = await startEnrollment(principal.userId, principal.email);
  await audit({
    orgId: principal.orgId ?? "system", actorId: principal.userId,
    action: "auth.mfa_enrollment_started", resourceType: "User", resourceId: principal.userId,
  });
  return Response.json(enrollment, { headers: { "x-request-id": requestId } });
}

/** Step 2: confirm with a code — enables the factor. Body: { code }. */
export async function PUT(req: NextRequest) {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  const parsed = z.object({ code: z.string().min(6).max(8) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "VALIDATION_ERROR", "code required");
  const ok = await confirmEnrollment(principal.userId, parsed.data.code);
  if (!ok) return problem(401, "INVALID_MFA", "That code did not verify — check the authenticator and clock");
  await audit({
    orgId: principal.orgId ?? "system", actorId: principal.userId,
    action: "auth.mfa_enabled", resourceType: "User", resourceId: principal.userId, decision: "ALLOW",
  });
  return Response.json({ ok: true, enabled: true }, { headers: { "x-request-id": requestId } });
}

/** Disable MFA — requires current password. Body: { password }. */
export async function DELETE(req: NextRequest) {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  const parsed = z.object({ password: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "VALIDATION_ERROR", "password required");
  const user = await db.user.findUnique({ where: { id: principal.userId } });
  const { verifyPassword } = await import("@/lib/auth/password");
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return problem(401, "INVALID_CREDENTIALS", "Password incorrect");
  }
  await disableMfa(principal.userId);
  await audit({
    orgId: principal.orgId ?? "system", actorId: principal.userId,
    action: "auth.mfa_disabled", resourceType: "User", resourceId: principal.userId, decision: "DENY",
    reason: "Disabled by account owner with password confirmation",
  });
  return Response.json({ ok: true, enabled: false }, { headers: { "x-request-id": requestId } });
}
