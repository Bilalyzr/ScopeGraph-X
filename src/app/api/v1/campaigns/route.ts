import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { ApiError, decodeCursor, encodeCursor, handleApiError, parsePagination, requireContext, withIdempotency, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "campaign:read");
    const url = new URL(req.url);
    const { cursor, limit } = parsePagination(url);
    const programId = url.searchParams.get("program_id");
    const rows = await db.campaign.findMany({
      where: {
        program: { orgId: ctx.orgId },
        ...(programId ? { programId } : {}),
        ...(cursor ? { id: { lt: decodeCursor(cursor) ?? cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return withRequestId({
      data: data.map((c) => ({ ...c, budget: JSON.parse(c.budgetJson) })),
      pagination: hasMore ? { next_cursor: encodeCursor(data[data.length - 1].id) } : undefined,
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const budgetSchema = z.object({
  max_requests: z.number().int().positive().max(100000),
  max_rps: z.number().positive().max(50),
  max_concurrency: z.number().int().positive().max(16),
});

const createSchema = z.object({
  program_id: z.string().min(1),
  policy_version_id: z.string().min(1),
  name: z.string().min(3).max(120),
  mode: z.enum(["PASSIVE_ONLY", "PASSIVE_THEN_APPROVED_ACTIVE"]),
  asset_ids: z.array(z.string()).default([]),
  budget: budgetSchema,
});

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "campaign:write");
    requestId = ctx.requestId;
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid campaign payload", parsed.error.issues[0]?.message);
    const result = await withIdempotency(ctx, body, async () => {
      const program = await db.program.findFirst({ where: { id: parsed.data.program_id, orgId: ctx.orgId } });
      if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");
      const policy = await db.scopeVersion.findFirst({ where: { id: parsed.data.policy_version_id, programId: program.id } });
      if (!policy) throw new ApiError(404, "NOT_FOUND", "Policy version not found for this program");
      // A revoked policy must conflict, never silently fall back (PRD §9.1).
      if (policy.status === "REVOKED") throw new ApiError(409, "POLICY_REVOKED", "The selected scope version was revoked; select the active policy");
      if (policy.status !== "ACTIVE") throw new ApiError(409, "POLICY_NOT_ACTIVE", "Campaigns may only reference an ACTIVE policy version");
      const campaign = await db.campaign.create({
        data: {
          id: newId("cmp"),
          orgId: ctx.orgId,
          programId: program.id,
          policyVersionId: policy.id,
          name: parsed.data.name,
          mode: parsed.data.mode,
          budgetJson: JSON.stringify(parsed.data.budget),
          state: "DRAFT",
          createdBy: ctx.principal.userId,
        },
      });
      await audit({
        orgId: ctx.orgId, actorId: ctx.principal.userId, action: "campaign.created",
        resourceType: "Campaign", resourceId: campaign.id, decision: "ALLOW",
        metadata: { program: program.id, policy: policy.id, mode: campaign.mode }, requestRef: ctx.requestId,
      });
      return { status: 201 as const, body: { id: campaign.id, state: campaign.state, policy_version_id: campaign.policyVersionId } };
    });
    return withRequestId(result.body, result.status, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
