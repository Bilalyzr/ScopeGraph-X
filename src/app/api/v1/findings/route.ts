import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createFinding } from "@/lib/findings/lifecycle";
import { storeEvidence } from "@/lib/evidence/store";
import { analyzeDifferentialAuthorization } from "@/lib/detection/fixtures";
import { ApiError, decodeCursor, encodeCursor, handleApiError, parsePagination, requireContext, withIdempotency, withRequestId } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, "finding:read");
    const url = new URL(req.url);
    const { cursor, limit } = parsePagination(url);
    const status = url.searchParams.get("status");
    const severity = url.searchParams.get("severity");
    const programId = url.searchParams.get("program_id");
    const rows = await db.finding.findMany({
      where: {
        orgId: ctx.orgId,
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(programId ? { programId } : {}),
        ...(cursor ? { id: { lt: decodeCursor(cursor) ?? cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    return withRequestId({
      data: data.map((f) => ({ ...f, reproduction: JSON.parse(f.reproductionJson) })),
      pagination: hasMore ? { next_cursor: encodeCursor(data[data.length - 1].id) } : undefined,
    }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, "req");
  }
}

const createSchema = z.object({
  program_id: z.string().min(1),
  asset_id: z.string().optional(),
  category: z.string().min(2),
  title: z.string().min(5).max(200),
  description: z.string().min(10),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  confidence: z.number().min(0).max(1),
  expected_behavior: z.string().default(""),
  observed_behavior: z.string().default(""),
  impact: z.string().default(""),
  limitations: z.string().default(""),
  remediation: z.string().default(""),
  reproduction_steps: z.array(z.string()).default([]),
  /** Differential analysis mode: run the seeded BOLA/BFLA fixtures and create candidates. */
  run_differential_fixtures: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  let requestId = "req";
  try {
    const ctx = await requireContext(req, "campaign:write");
    requestId = ctx.requestId;
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Invalid finding payload", parsed.error.issues[0]?.message);
    const result = await withIdempotency<Record<string, unknown>>(ctx, body, async () => {
      const program = await db.program.findFirst({ where: { id: parsed.data.program_id, orgId: ctx.orgId } });
      if (!program) throw new ApiError(404, "NOT_FOUND", "Program not found");

      // Differential authorization analysis (FR-DET-02): candidates from seeded
      // fixtures, each backed by redacted evidence. Stays CANDIDATE (PROPOSED).
      if (parsed.data.run_differential_fixtures) {
        const candidates = analyzeDifferentialAuthorization();
        const created: string[] = [];
        for (const c of candidates) {
          const { evidence } = await storeEvidence({
            orgId: ctx.orgId,
            createdBy: ctx.principal.userId,
            source: "differential-fixture",
            content: {
              resource: `${c.resourceType}/${c.resourceId}`,
              identity: c.identity.identityId,
              expected_access: c.expected,
              observed_status: c.observedStatus,
              ...c.evidence,
            },
          });
          const f = await createFinding({
            orgId: ctx.orgId,
            programId: program.id,
            category: c.category,
            title: `${c.category}: ${c.identity.roleLabel} can access ${c.resourceType} ${c.resourceId} of tenant ${"tenant-b"}`,
            description: `Differential authorization analysis: expected access=${c.expected} but observed HTTP ${c.observedStatus}. Candidate only — independent validation required before confirmation.`,
            severity: c.category === "BOLA" ? "HIGH" : "HIGH",
            confidence: 0.6,
            expectedBehavior: `Access denied for identity ${c.identity.identityId} (${c.identity.roleLabel})`,
            observedBehavior: `HTTP ${c.observedStatus} with data returned`,
            impact: c.category === "BOLA" ? "Potential cross-tenant object access" : "Privilege boundary violation on admin function",
            limitations: "Derived from synthetic fixtures; must be reproduced against an approved live target",
            remediation: "Enforce object-level authorization checks on the resource handler",
            evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
            reproductionSteps: [
              `Provision test identity ${c.identity.identityId}`,
              `Request ${c.resourceType} ${c.resourceId} with that identity`,
              "Compare observed decision with the expected access matrix",
            ],
            actorId: ctx.principal.userId,
            sourceDetector: "differential-auth",
          });
          created.push(f.id);
        }
        return { status: 201 as const, body: { created_from_fixtures: created } };
      }

      const finding = await createFinding({
        orgId: ctx.orgId,
        programId: program.id,
        assetId: parsed.data.asset_id,
        category: parsed.data.category,
        title: parsed.data.title,
        description: parsed.data.description,
        severity: parsed.data.severity,
        confidence: parsed.data.confidence,
        expectedBehavior: parsed.data.expected_behavior,
        observedBehavior: parsed.data.observed_behavior,
        impact: parsed.data.impact,
        limitations: parsed.data.limitations,
        remediation: parsed.data.remediation,
        reproductionSteps: parsed.data.reproduction_steps,
        actorId: ctx.principal.userId,
      });
      return { status: 201 as const, body: finding };
    });
    return withRequestId(result.body, result.status, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
