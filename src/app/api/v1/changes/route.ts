import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { decodeCursor, encodeCursor, handleApiError, parsePagination, requireContext, withRequestId, ApiError } from "@/lib/api";

// Change feed (FR-REC-03 / UF-02): prioritized asset-change stream with
// before/after evidence. POST snapshot+diffs a single asset.

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "asset:read");
    const url = new URL(req.url);
    const { cursor, limit } = parsePagination(url);
    const programId = url.searchParams.get("program_id");
    const rows = await db.assetChange.findMany({
      where: {
        orgId: ctx.orgId,
        ...(programId ? { programId } : {}),
        ...(cursor ? { id: { lt: decodeCursor(cursor) ?? cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return withRequestId({
      data: data.map((c) => ({
        ...c,
        before: JSON.parse(c.beforeJson),
        after: JSON.parse(c.afterJson),
      })),
      pagination: hasMore ? { next_cursor: encodeCursor(data[data.length - 1].id) } : undefined,
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

/** Capture a snapshot + diff for one asset (idempotent when nothing changed). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "asset:write");
    const body = await req.json().catch(() => ({}));
    const assetId = typeof (body as { asset_id?: string }).asset_id === "string" ? (body as { asset_id: string }).asset_id : "";
    if (!assetId) throw new ApiError(422, "VALIDATION_ERROR", "asset_id required");
    const asset = await db.asset.findFirst({ where: { id: assetId, orgId: ctx.orgId } });
    if (!asset) throw new ApiError(404, "NOT_FOUND", "Asset not found");
    const { recordAssetChanges } = await import("@/lib/discovery/changes");
    const result = await recordAssetChanges(assetId);
    return withRequestId(result, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}
