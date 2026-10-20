import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ticketingMode } from "@/lib/ticketing";
import { handleApiError, requireContext, withRequestId } from "@/lib/api";

/** Ticketing sync status + linked tickets (org:admin). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "org:admin");
    const tickets = await db.ticketLink.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return withRequestId(
      {
        mode: ticketingMode(),
        tickets: tickets.map((t) => ({
          findingId: t.findingId, system: t.system, issueKey: t.issueKey,
          issueUrl: t.issueUrl, createdAt: t.createdAt,
        })),
      },
      200,
      ctx.requestId
    );
  } catch (e) {
    return handleApiError(e, "req");
  }
}
