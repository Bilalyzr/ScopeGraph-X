import { NextRequest } from "next/server";
import { z } from "zod";
import { recordValidation, transitionFinding, FINDING_STATUSES, type FindingStatus } from "@/lib/findings/lifecycle";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// POST /v1/findings/{id}:review (status transition) and :validate (validator decision).

export async function POST(req: NextRequest, { params }: { params: Promise<{ idAction: string }> }) {
  let requestId = "req";
  try {
    const { idAction } = await params;
    const colon = idAction.lastIndexOf(":");
    const id = colon === -1 ? idAction : idAction.slice(0, colon);
    const action = colon === -1 ? "" : idAction.slice(colon + 1);
    const body = await req.json().catch(() => ({}));

    if (action === "review") {
      const ctx = await requireContext(req, "finding:review");
      requestId = ctx.requestId;
      const parsed = z.object({ to: z.enum(FINDING_STATUSES), reason: z.string().default("") }).safeParse(body);
      if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "`to` must be a valid finding status");
      const updated = await transitionFinding({
        findingId: id,
        orgId: ctx.orgId,
        to: parsed.data.to as FindingStatus,
        role: ctx.role,
        actorId: ctx.principal.userId,
        reason: parsed.data.reason,
      });
      return withRequestId(updated, 200, ctx.requestId);
    }

    if (action === "validate") {
      const ctx = await requireContext(req, "finding:review");
      requestId = ctx.requestId;
      if (ctx.role !== "VALIDATOR" && ctx.role !== "APPSEC_LEAD" && ctx.role !== "TENANT_ADMIN") {
        throw new ApiError(403, "FORBIDDEN", "Only validators may record independent validation decisions");
      }
      const parsed = z.object({
        outcome: z.enum(["VALIDATED", "UNVALIDATED", "REFUTED"]),
        notes: z.string().min(3),
      }).safeParse(body);
      if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "outcome and notes are required");
      const updated = await recordValidation({
        findingId: id, orgId: ctx.orgId, actorId: ctx.principal.userId,
        outcome: parsed.data.outcome, notes: parsed.data.notes,
      });
      return withRequestId(updated, 200, ctx.requestId);
    }

    throw new ApiError(404, "UNKNOWN_ACTION", `Unsupported action ':${action}'`);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
