import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { activeScopeVersion } from "@/lib/policy/gateway";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// POST /v1/hypotheses/{id}/tests — propose a typed, bounded test plan
// (FR-AI-01: "permitted test proposals"). No execution happens here; the plan
// must be approved via /v1/tests/{id}:approve and re-checked by the gateway.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "test:propose");
    requestId = ctx.requestId;
    const { id } = await params;
    const hypothesis = await db.hypothesis.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!hypothesis) throw new ApiError(404, "NOT_FOUND", "Hypothesis not found");

    const schema = z.object({
      oracle_id: z.string().min(2).default("differential-auth-matrix"),
      target_host: z.string().min(3),
      target_path: z.string().startsWith("/").default("/"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      identities: z.array(z.string()).min(1),
      notes: z.string().max(1000).default(""),
    });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid test plan", parsed.error.issues[0]?.message);

    // Reject active tests with no policy (PRD data model constraint on tests).
    const policy = await activeScopeVersion(hypothesis.programId);
    if (!policy) throw new ApiError(409, "NO_ACTIVE_POLICY", "Cannot propose an active test without an active policy version");

    const test = await db.test.create({
      data: {
        id: newId("tst"),
        hypothesisId: hypothesis.id,
        orgId: ctx.orgId,
        programId: hypothesis.programId,
        oracleId: parsed.data.oracle_id,
        policyVersionId: policy.id,
        planJson: JSON.stringify(parsed.data),
        status: "PROPOSED",
        proposedBy: ctx.principal.userId,
      },
    });
    await audit({
      orgId: ctx.orgId, actorId: ctx.principal.userId, action: "test.proposed",
      resourceType: "Test", resourceId: test.id, decision: "ALLOW",
      metadata: { hypothesis: hypothesis.id, target: `${parsed.data.method} ${parsed.data.target_host}${parsed.data.target_path}` },
      requestRef: ctx.requestId,
    });
    return withRequestId(test, 201, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
