import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// POST /v1/identities — register an external credential REFERENCE only.
// secretRef must be a vault:// URI; plaintext credentials are rejected.

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "identity:write");
    const rows = await db.identity.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 50 });
    return withRequestId({ data: rows.map((i) => ({ ...i, secret_ref: i.secretRef })) }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const schema = z.object({
  program_id: z.string().optional(),
  role_label: z.string().min(2).max(60),
  tenant_label: z.string().max(60).default(""),
  kind: z.enum(["RESEARCHER_OWNED", "CUSTOMER_PROVISIONED"]).default("RESEARCHER_OWNED"),
  secret_ref: z.string().regex(/^vault:\/\//, "secret_ref must be a vault:// reference"),
});

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "identity:write");
    requestId = ctx.requestId;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid identity payload", parsed.error.issues[0]?.message);
    if (parsed.data.program_id) {
      const program = await db.program.findFirst({ where: { id: parsed.data.program_id, orgId: ctx.orgId } });
      if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found in tenant");
    }
    const identity = await db.identity.create({
      data: {
        id: newId("idt"),
        orgId: ctx.orgId,
        programId: parsed.data.program_id,
        roleLabel: parsed.data.role_label,
        tenantLabel: parsed.data.tenant_label,
        kind: parsed.data.kind,
        secretRef: parsed.data.secret_ref,
      },
    });
    await audit({
      orgId: ctx.orgId, actorId: ctx.principal.userId, action: "identity.registered",
      resourceType: "Identity", resourceId: identity.id, decision: "ALLOW",
      metadata: { role: identity.roleLabel, kind: identity.kind }, requestRef: ctx.requestId,
    });
    return withRequestId(identity, 201, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
