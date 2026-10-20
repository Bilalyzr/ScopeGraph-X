import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { drainQueue } from "@/lib/jobs/runner";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "job:read");
    const url = new URL(req.url);
    const campaignId = url.searchParams.get("campaign_id");
    const rows = await db.job.findMany({
      where: { campaign: { program: { orgId: ctx.orgId } }, ...(campaignId ? { campaignId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return withRequestId({ data: rows.map((j) => ({ ...j, request: JSON.parse(j.requestJson), result: j.resultJson ? JSON.parse(j.resultJson) : null })) }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

/** Dev maintenance endpoint: drain the durable queue (production uses isolated workers). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "job:read");
    void ctx;
    const result = await drainQueue(25);
    return withRequestId(result, 200, "tick");
  } catch (e) {
    return handleApiError(e, "req");
  }
}
