import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { triggerEmergencyStop, liftEmergencyStop } from "@/lib/safety";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// Emergency stop controls (UF-06): visible, fast, and audit-logged.

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "campaign:read");
    const stops = await db.emergencyStop.findMany({
      where: { OR: [{ scope: "GLOBAL" }, { orgId: ctx.orgId }] },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return withRequestId({ data: stops, any_active: stops.some((s) => s.active) }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "campaign:stop");
    requestId = ctx.requestId;
    const parsed = z
      .object({
        scope: z.enum(["ORG", "PROGRAM"]).default("ORG"),
        program_id: z.string().optional(),
        reason: z.string().min(3),
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "reason required");
    if (parsed.data.scope === "PROGRAM" && !parsed.data.program_id) {
      throw new ApiError(422, "VALIDATION_ERROR", "program_id required for PROGRAM scope");
    }
    const result = await triggerEmergencyStop({
      scope: parsed.data.scope,
      orgId: ctx.orgId,
      programId: parsed.data.program_id,
      reason: parsed.data.reason,
      createdBy: ctx.principal.userId,
    });
    return withRequestId(
      { id: result.stop.id, active: true, campaigns_stopped: result.campaigns, jobs_cancelled: result.cancelledJobs },
      201, ctx.requestId
    );
  } catch (e) {
    return handleApiError(e, requestId);
  }
}

export async function DELETE(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "campaign:stop");
    requestId = ctx.requestId;
    const url = new URL(req.url);
    const stopId = url.searchParams.get("id");
    if (!stopId) throw new ApiError(422, "VALIDATION_ERROR", "id query parameter required");
    const stop = await db.emergencyStop.findFirst({ where: { id: stopId, OR: [{ orgId: ctx.orgId }, { scope: "GLOBAL" }] } });
    if (!stop) throw new ApiError(404, "NOT_FOUND", "Emergency stop not found");
    await liftEmergencyStop(stopId, ctx.principal.userId);
    return withRequestId({ id: stopId, active: false }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
