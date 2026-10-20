import { NextRequest } from "next/server";
import { neighbors } from "@/lib/graph/projection";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// GET /v1/assets/{id}/relationships — graph neighbors with evidence (FR-GRF-01),
// tenant-filtered inside the projection itself.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req, "asset:read");
    const { id } = await params;
    const url = new URL(req.url);
    const depth = Math.min(Number(url.searchParams.get("depth") ?? 1), 2);
    const result = await neighbors(ctx.orgId, "Asset", id, depth);
    if (result.nodes.length === 0) throw new ApiError(404, "NOT_FOUND", "Asset not found in tenant");
    return withRequestId({
      node: result.nodes[0],
      nodes: result.nodes,
      edges: result.edges,
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}
