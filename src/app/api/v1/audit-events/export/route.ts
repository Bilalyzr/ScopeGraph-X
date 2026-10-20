import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { handleApiError, requireContext } from "@/lib/api";

// Authorized audit export (FR-ENT-02): CSV of tenant audit events.
// The export action itself is audited.

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "audit:read");
    const rows = await db.auditEvent.findMany({
      where: { OR: [{ orgId: ctx.orgId }, ...(ctx.role === "PLATFORM_OPERATOR" ? [{ orgId: "system" }] : [])] },
      orderBy: { timestamp: "asc" },
      take: 5000,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.principal.userId,
      action: "audit.exported",
      resourceType: "AuditEvent",
      resourceId: "export",
      decision: "ALLOW",
      metadata: { rows: rows.length },
      requestRef: ctx.requestId,
    });
    const header = "id,timestamp,actor_type,actor,action,resource_type,resource_id,decision,reason,prev_digest,digest";
    const lines = rows.map((e) =>
      [e.id, e.timestamp.toISOString(), e.actorType, e.actorId, e.action, e.resourceType, e.resourceId, e.decision, csvEscape(e.reason), e.prevDigest, e.digest].join(",")
    );
    return new Response([header, ...lines].join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="scopegraph-audit-${ctx.orgId}.csv"`,
        "x-request-id": ctx.requestId,
      },
    });
  } catch (e) {
    return handleApiError(e, "req");
  }
}
