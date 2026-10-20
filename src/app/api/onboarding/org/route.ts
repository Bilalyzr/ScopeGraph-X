import { NextRequest } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { currentPrincipal, switchOrg, SESSION_COOKIE } from "@/lib/auth/session";
import { problem, requestIdOf } from "@/lib/api";
import { audit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(3).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "lowercase letters, digits, dashes"),
  region: z.string().max(40).default("eu-central"),
});

/** Onboarding: an authenticated user without an organization creates one and
 *  becomes its TENANT_ADMIN. */
export async function POST(req: NextRequest) {
  const requestId = requestIdOf(req);
  const principal = await currentPrincipal();
  if (!principal) return problem(401, "UNAUTHENTICATED", "Authentication required");
  if (principal.orgId) return problem(409, "ALREADY_IN_ORG", "You already have an active organization");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "VALIDATION_ERROR", "Invalid organization details", parsed.error.issues[0]?.message);

  const existing = await db.organization.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return problem(409, "SLUG_TAKEN", "That organization slug is already in use");

  const org = await db.organization.create({
    data: { id: newId("org"), slug: parsed.data.slug, name: parsed.data.name, region: parsed.data.region },
  });
  await db.membership.create({
    data: { id: newId("mem"), orgId: org.id, principalId: principal.userId, role: "TENANT_ADMIN" },
  });
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await switchOrg(token, principal.userId, org.id);
  await audit({
    orgId: org.id,
    actorId: principal.userId,
    action: "org.created",
    resourceType: "Organization",
    resourceId: org.id,
    decision: "ALLOW",
    metadata: { slug: org.slug, first_admin: principal.userId },
    requestRef: requestId,
  });
  return Response.json({ org_id: org.id, slug: org.slug, role: "TENANT_ADMIN" }, {
    status: 201,
    headers: { "x-request-id": requestId },
  });
}
