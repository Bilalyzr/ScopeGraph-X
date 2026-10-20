import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { decodeCursor, encodeCursor, handleApiError, parsePagination, requireContext, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "audit:read");
    const url = new URL(req.url);
    const { cursor, limit } = parsePagination(url);
    const action = url.searchParams.get("action");
    const rows = await db.auditEvent.findMany({
      where: {
        // Tenant scoping; system-level events only visible to platform operators.
        OR: [{ orgId: ctx.orgId }, ...(ctx.role === "PLATFORM_OPERATOR" ? [{ orgId: "system" }] : [])],
        ...(action ? { action } : {}),
        ...(cursor ? { id: { lt: decodeCursor(cursor) ?? cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return withRequestId({
      data: data.map((e) => ({ ...e, metadata: JSON.parse(e.metadataJson) })),
      pagination: hasMore ? { next_cursor: encodeCursor(data[data.length - 1].id) } : undefined,
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}
