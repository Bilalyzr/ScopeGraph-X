import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "campaign:read");
    const url = new URL(req.url);
    const programId = url.searchParams.get("program_id");
    const rows = await db.hypothesis.findMany({
      where: { orgId: ctx.orgId, ...(programId ? { programId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return withRequestId({
      data: rows.map((h) => ({
        ...h,
        assumptions: JSON.parse(h.assumptionsJson),
        evidence_refs: JSON.parse(h.evidenceRefsJson),
        alternative_explanations: JSON.parse(h.alternativeExplanationsJson),
        required_approvals: JSON.parse(h.requiredApprovalsJson),
      })),
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}
