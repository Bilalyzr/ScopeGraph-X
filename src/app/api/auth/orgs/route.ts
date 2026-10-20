import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { currentPrincipal, switchOrg, SESSION_COOKIE } from "@/lib/auth/session";
import { problem } from "@/lib/api";

export async function GET() {
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  const memberships = await db.membership.findMany({ where: { principalId: principal.userId, state: "ACTIVE" } });
  const orgs = await Promise.all(
    memberships.map(async (m) => {
      const org = await db.organization.findUnique({ where: { id: m.orgId } });
      return { id: m.orgId, name: org?.name ?? m.orgId, slug: org?.slug ?? "", role: m.role };
    })
  );
  return NextResponse.json({ active_org_id: principal.orgId, organizations: orgs });
}

const bodySchema = z.object({ org_id: z.string().min(1) });

export async function POST(req: NextRequest) {
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "VALIDATION_ERROR", "org_id required");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return problem(401, "UNAUTHENTICATED", "No session cookie");
  try {
    await switchOrg(token, principal.userId, parsed.data.org_id);
  } catch {
    return problem(403, "NOT_A_MEMBER", "You are not an active member of that organization");
  }
  return NextResponse.json({ ok: true, active_org_id: parsed.data.org_id });
}
