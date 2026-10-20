import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { scopeRulesSchema } from "@/lib/policy/rules";
import { ApiError, handleApiError, requireContext, withIdempotency, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req, "scope:read");
    const { id } = await params;
    const program = await db.program.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");
    const rows = await db.scopeVersion.findMany({ where: { programId: id }, orderBy: { version: "desc" } });
    return withRequestId({ data: rows.map((v) => ({ ...v, rules: JSON.parse(v.rulesJson) })) }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const proposeSchema = z.object({
  rules: scopeRulesSchema,
  note: z.string().max(1000).default(""),
  provenance: z.string().max(500).default("manual"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "scope:write");
    requestId = ctx.requestId;
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = proposeSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid scope rules", parsed.error.issues[0]?.message);
    const result = await withIdempotency(ctx, body, async () => {
      const program = await db.program.findFirst({ where: { id, orgId: ctx.orgId } });
      if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");
      const last = await db.scopeVersion.findFirst({ where: { programId: id }, orderBy: { version: "desc" } });
      const version = (last?.version ?? 0) + 1;
      const sv = await db.scopeVersion.create({
        data: {
          id: newId("spv"),
          programId: id,
          version,
          rulesJson: JSON.stringify(parsed.data.rules),
          note: parsed.data.note,
          provenance: parsed.data.provenance,
          status: "PROPOSED",
          proposedBy: ctx.principal.userId,
        },
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.principal.userId,
        action: "scope.proposed",
        resourceType: "ScopeVersion",
        resourceId: sv.id,
        decision: "ALLOW",
        metadata: { program: id, version, allow_rules: parsed.data.rules.allow.length, deny_rules: parsed.data.rules.deny.length },
        requestRef: ctx.requestId,
      });
      return { status: 201 as const, body: { ...sv, rules: parsed.data.rules } };
    });
    return withRequestId(result.body, result.status, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
