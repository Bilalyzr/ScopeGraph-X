import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { storeEvidence } from "@/lib/evidence/store";
import { createFinding } from "@/lib/findings/lifecycle";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// POST /v1/tests/{id}:approve — authorize constrained execution (test:approve).
// Execution is SIMULATED: the outcome comes from deterministic fixtures and is
// recorded as evidence; any confirmed candidate still needs a validator.

export async function POST(req: NextRequest, { params }: { params: Promise<{ idAction: string }> }) {
  let requestId = "req";
  try {
    const { idAction } = await params;
    const colon = idAction.lastIndexOf(":");
    const id = colon === -1 ? idAction : idAction.slice(0, colon);
    const action = colon === -1 ? "" : idAction.slice(colon + 1);
    if (action !== "approve") throw new ApiError(404, "UNKNOWN_ACTION", `Unsupported action ':${action}'`);

    const ctx = await requireContext(req, "test:approve");
    requestId = ctx.requestId;
    const body = z.object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().default("") }).safeParse(await req.json().catch(() => ({})));
    if (!body.success) throw new ApiError(422, "VALIDATION_ERROR", "decision required");

    const test = await db.test.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!test) throw new ApiError(404, "NOT_FOUND", "Test not found");
    if (test.status !== "PROPOSED") throw new ApiError(409, "INVALID_STATE", `Test is ${test.status}`);

    if (body.data.decision === "REJECT") {
      await db.test.update({ where: { id: test.id }, data: { status: "REJECTED", approvedBy: ctx.principal.userId } });
      await audit({ orgId: ctx.orgId, actorId: ctx.principal.userId, action: "test.rejected", resourceType: "Test", resourceId: test.id, decision: "DENY", reason: body.data.reason });
      return withRequestId({ id: test.id, status: "REJECTED" }, 200, ctx.requestId);
    }

    // Segregation of duties: proposer cannot approve their own test.
    if (test.proposedBy === ctx.principal.userId) {
      throw new ApiError(403, "SELF_APPROVAL", "The proposing user cannot approve this test");
    }

    // Policy must still be active at approval time.
    if (!test.policyVersionId) throw new ApiError(409, "NO_ACTIVE_POLICY", "Test has no policy binding");
    const policy = await db.scopeVersion.findUnique({ where: { id: test.policyVersionId } });
    if (!policy || policy.status !== "ACTIVE") throw new ApiError(409, "POLICY_REVOKED", "Bound policy version is not active");

    // --- simulated constrained execution against deterministic fixtures ---
    const { analyzeDifferentialAuthorization } = await import("@/lib/detection/fixtures");
    const plan = JSON.parse(test.planJson) as { target_host: string; oracle_id: string };
    const relevant = analyzeDifferentialAuthorization().filter((c) => c.identity.identityId.startsWith("idt"));
    const outcomeForTarget = relevant.filter((c) => plan.target_host.includes("api.demo-target.test")).slice(0, 1);

    const { evidence } = await storeEvidence({
      orgId: ctx.orgId,
      createdBy: ctx.principal.userId,
      source: "simulated-test-execution",
      content: {
        test_id: test.id, oracle: plan.oracle_id, target: plan.target_host,
        execution: "SIMULATED (EGRESS_MODE=simulated; no real network traffic)",
        results: outcomeForTarget,
      },
    });

    await db.test.update({ where: { id: test.id }, data: { status: "EXECUTED", approvedBy: ctx.principal.userId, executedAt: new Date() } });
    await db.observation.create({
      data: { id: newId("obs"), testId: test.id, evidenceId: evidence.id, normalizedJson: JSON.stringify(outcomeForTarget) },
    });
    await audit({
      orgId: ctx.orgId, actorId: ctx.principal.userId, action: "test.approved",
      resourceType: "Test", resourceId: test.id, decision: "ALLOW",
      reason: body.data.reason, metadata: { simulated: true, evidence: evidence.id }, requestRef: ctx.requestId,
    });

    // Observed divergence supports the linked hypothesis -> OBSERVED finding candidate.
    let findingId: string | undefined;
    if (test.hypothesisId && outcomeForTarget.length > 0) {
      const hypothesis = await db.hypothesis.findUnique({ where: { id: test.hypothesisId } });
      if (hypothesis) {
        await db.hypothesis.update({ where: { id: hypothesis.id }, data: { status: "SUPPORTED" } });
        try {
          const f = await createFinding({
            orgId: ctx.orgId, programId: hypothesis.programId, hypothesisId: hypothesis.id,
            category: hypothesis.category,
            title: `${hypothesis.category}: supported by approved test ${test.id} (simulated)`,
            description: `${hypothesis.summary}\n\nEvidence from simulated constrained execution under approved test ${test.id}. Candidate — independent validation still required.`,
            severity: "HIGH", confidence: Math.min(0.9, hypothesis.confidence + 0.2),
            expectedBehavior: "Access denied per approved access matrix",
            observedBehavior: "Divergence observed in simulated execution; see evidence",
            impact: hypothesis.risk, limitations: hypothesis.limitations,
            remediation: "Enforce authorization checks; verify in staging",
            reproductionSteps: [`Review simulated execution evidence ${evidence.id}`, "Re-run approved test against staging with provisioned identities"],
            evidenceRefs: [{ evidenceId: evidence.id, role: "primary" }],
            actorId: ctx.principal.userId, sourceDetector: "approved-test",
          });
          await db.finding.update({ where: { id: f.id }, data: { status: "OBSERVED", policyVersionId: test.policyVersionId } });
          await db.findingStatusEvent.create({
            data: { id: newId("fse"), findingId: f.id, fromStatus: "PROPOSED", toStatus: "OBSERVED", actorId: ctx.principal.userId, reason: "Approved simulated test observed divergence" },
          });
          findingId = f.id;
        } catch {
          // duplicate finding — fine, hypothesis already supported
        }
      }
    }

    return withRequestId({ id: test.id, status: "EXECUTED", simulated: true, evidence_id: evidence.id, finding_id: findingId }, 200, ctx.requestId);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
