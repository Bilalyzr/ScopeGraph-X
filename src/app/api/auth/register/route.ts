import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { problem, requestIdOf } from "@/lib/api";
import { audit } from "@/lib/audit";

// Self-service operator registration. Creates an account with NO organization;
// the user then lands on /onboarding to create (or be added to) an org.
// Controls: REGISTRATION_ENABLED gate, strong-password policy, per-IP throttle,
// duplicate-email 409, full audit trail. Set REGISTRATION_ENABLED=false for
// invite-only deployments.

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().max(200),
  password: z
    .string()
    .min(10, "At least 10 characters")
    .max(200)
    .regex(/[A-Za-z]/, "Must contain a letter")
    .regex(/[0-9]/, "Must contain a digit"),
});

const attempts = new Map<string, { count: number; windowStart: number }>();
const MAX_PER_HOUR = 5;

function throttled(ip: string): boolean {
  const now = Date.now();
  const st = attempts.get(ip);
  if (!st || now - st.windowStart > 3600_000) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  st.count += 1;
  return st.count > MAX_PER_HOUR;
}

export async function POST(req: NextRequest) {
  const requestId = requestIdOf(req);
  if (process.env.REGISTRATION_ENABLED === "false") {
    return problem(403, "REGISTRATION_DISABLED", "Self-service registration is disabled on this deployment");
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (throttled(ip)) {
    return problem(429, "REGISTRATION_THROTTLED", "Too many registration attempts from this address — try again later");
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return problem(422, "VALIDATION_ERROR", "Invalid registration details", parsed.error.issues[0]?.message);
  }
  const email = parsed.data.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return problem(409, "EMAIL_TAKEN", "An account with this email already exists — try signing in instead");
  }

  const user = await db.user.create({
    data: {
      id: newId("usr"),
      email,
      name: parsed.data.name,
      passwordHash: hashPassword(parsed.data.password),
    },
  });
  const token = await createSession(user.id, null); // no org yet → onboarding
  await audit({
    orgId: "system",
    actorId: user.id,
    action: "auth.registered",
    resourceType: "User",
    resourceId: user.id,
    decision: "ALLOW",
    metadata: { email },
    requestRef: requestId,
  });

  const res = NextResponse.json(
    { user: { id: user.id, email: user.email, name: user.name }, active_org_id: null, next: "/onboarding" },
    { status: 201 }
  );
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
