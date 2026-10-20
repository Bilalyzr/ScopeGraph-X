import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runInvariantCheck } from "@/lib/detection/invariants";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// POST /v1/resources/{id}:check — run the workflow-invariant engine (FR-DET-03)
// over an analyst-approved state machine with recorded fixture transitions.
// GET returns the resource with its machine definition.

export async function GET(req: NextRequest, { params }: { params: Promise<{ idAction: string }> }) {
  try {
    const ctx = await requireContext(req, "asset:read");
    const { idAction } = await params;
    const id = idAction.includes(":") ? idAction.split(":")[0] : idAction;
    const orgPrograms = await db.program.findMany({ where: { orgId: ctx.orgId }, select: { id: true } });
    const resource = await db.resource.findFirst({
      where: { id, programId: { in: orgPrograms.map((p) => p.id) } },
    });
    if (!resource) throw new ApiError(404, "NOT_FOUND", "Resource not found");
    return withRequestId({ ...resource, invariant: JSON.parse(resource.invariantJson || "null") }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ idAction: string }> }) {
  let requestId = "req";
  try {
    const { idAction } = await params;
    const colon = idAction.lastIndexOf(":");
    const id = colon === -1 ? idAction : idAction.slice(0, colon);
    const action = colon === -1 ? "" : idAction.slice(colon + 1);
    if (action !== "check") throw new ApiError(404, "UNKNOWN_ACTION", `Unsupported action ':${action}'`);

    const ctx = await requireContext(req, "test:propose");
    requestId = ctx.requestId;
    const orgPrograms = await db.program.findMany({ where: { orgId: ctx.orgId }, select: { id: true } });
    const resource = await db.resource.findFirst({ where: { id, programId: { in: orgPrograms.map((p) => p.id) } } });
    if (!resource) throw new ApiError(404, "NOT_FOUND", "Resource not found");

    const result = await runInvariantCheck(resource.id, ctx.principal.userId);
    return withRequestId({
      run_id: result.run.id,
      status: result.run.status,
      violations: result.violations,
      finding_id: result.findingId,
      evidence_id: result.run.evidenceId,
      note: "Fixture replay only (simulated) — violations create CANDIDATE findings pending independent validation.",
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
