import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { importExternalFindings } from "@/lib/detection/sast";
import { ApiError, handleApiError, requireContext, withIdempotency, withRequestId } from "@/lib/api";

// SAST/SCA ↔ runtime correlation (FR-DET-04). GET lists imported external
// findings; POST imports a batch. Correlation NEVER auto-confirms anything —
// linked pairs stay CORRELATED_UNCONFIRMED for a human validator.

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "finding:read");
    const url = new URL(req.url);
    const programId = url.searchParams.get("program_id");
    const rows = await db.externalFinding.findMany({
      where: { orgId: ctx.orgId, ...(programId ? { programId } : {}) },
      orderBy: { importedAt: "desc" },
      take: 100,
    });
    return withRequestId({ data: rows }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const itemSchema = z.object({
  tool: z.enum(["sast", "sca"]),
  rule: z.string().min(1).max(200),
  locator: z.string().max(500).optional(),
  cwe: z.string().max(20).optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]).optional(),
  description: z.string().max(2000).optional(),
  asset_locator: z.string().max(253).optional(),
});

const importSchema = z.object({
  program_id: z.string().min(1),
  findings: z.array(itemSchema).min(1).max(200),
});

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "finding:review");
    requestId = ctx.requestId;
    const body = await req.json().catch(() => null);
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid import payload", parsed.error.issues[0]?.message);
    const result = await withIdempotency(ctx, body, async () => {
      const program = await db.program.findFirst({ where: { id: parsed.data.program_id, orgId: ctx.orgId } });
      if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");
      const res = await importExternalFindings(program.id, ctx.orgId, ctx.principal.userId, parsed.data.findings);
      return { status: 201 as const, body: res };
    });
    return withRequestId(result.body, result.status, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
