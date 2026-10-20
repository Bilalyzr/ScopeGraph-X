import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { currentPrincipal, SESSION_COOKIE } from "@/lib/auth/session";
import { problem, requestIdOf } from "@/lib/api";

export async function GET(req: NextRequest) {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  const jar = await cookies();
  const currentId = `ses_${createHash("sha256").update(jar.get(SESSION_COOKIE)!.value).digest("hex")}`;
  const sessions = await db.session.findMany({
    where: { userId: principal.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return Response.json({
    data: sessions.map((s) => ({
      id: s.id.slice(0, 12) + "…",
      current: s.id === currentId,
      created_at: s.createdAt,
      expires_at: s.expiresAt,
      revoked: s.revokedAt != null,
    })),
  }, { headers: { "x-request-id": requestId } });
}

/** Revoke all OTHER sessions (keep the current one). */
export async function DELETE(req: NextRequest) {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  const jar = await cookies();
  const currentId = `ses_${createHash("sha256").update(jar.get(SESSION_COOKIE)!.value).digest("hex")}`;
  const revoked = await db.session.updateMany({
    where: { userId: principal.userId, revokedAt: null, id: { not: currentId } },
    data: { revokedAt: new Date() },
  });
  return Response.json({ ok: true, revoked: revoked.count }, { headers: { "x-request-id": requestId } });
}
