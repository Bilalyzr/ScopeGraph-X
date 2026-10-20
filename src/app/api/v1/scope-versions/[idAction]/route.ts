import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { revokeScopeVersion } from "@/lib/safety";
import { scopeRulesSchema } from "@/lib/policy/rules";
import { ApiError, handleApiError, requireContext, withRequestId } from "@/lib/api";

// Custom-method route: POST /v1/scope-versions/{id}:approve | :activate | :revoke
// (PRD §9 uses the `:verb` convention; the segment is parsed here.)

async function loadScoped(ctxOrgId: string, id: string) {
  const sv = await db.scopeVersion.findUnique({ where: { id } });
  if (!sv) throw new ApiError(404, "NOT_FOUND", "Scope version not found");
  const program = await db.program.findUnique({ where: { id: sv.programId } });
  if (!program || program.orgId !== ctxOrgId) throw new ApiError(404, "NOT_FOUND", "Scope version not found");
  return { sv, program };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ idAction: string }> }) {
  let requestId = "req";
  try {
    const { idAction } = await params;
    const colon = idAction.lastIndexOf(":");
    const id = colon === -1 ? idAction : idAction.slice(0, colon);
    const action = colon === -1 ? "" : idAction.slice(colon + 1);

    if (action === "approve") {
      const ctx = await requireContext(req, "scope:approve");
      requestId = ctx.requestId;
      const { sv } = await loadScoped(ctx.orgId, id);
      if (sv.status !== "PROPOSED") throw new ApiError(409, "INVALID_STATE", `Cannot approve a version in status ${sv.status}`);
      const rules = scopeRulesSchema.safeParse(JSON.parse(sv.rulesJson));
      if (!rules.success) throw new ApiError(422, "INVALID_RULES", "Stored rules no longer validate against the schema");
      const updated = await db.scopeVersion.update({ where: { id: sv.id }, data: { status: "APPROVED", approvedBy: ctx.principal.userId } });
      await audit({ orgId: ctx.orgId, actorId: ctx.principal.userId, action: "scope.approved", resourceType: "ScopeVersion", resourceId: sv.id, decision: "ALLOW", requestRef: ctx.requestId });
      return withRequestId(updated, 200, ctx.requestId);
    }

    if (action === "activate") {
      const ctx = await requireContext(req, "scope:approve"); // activation requires independent approval authority
      requestId = ctx.requestId;
      const { sv, program } = await loadScoped(ctx.orgId, id);
      if (sv.status === "REVOKED") throw new ApiError(409, "POLICY_REVOKED", "This scope version was revoked and cannot be activated");
      if (sv.status !== "APPROVED") throw new ApiError(409, "NOT_APPROVED", "Only an APPROVED version can be activated");
      if (!sv.approvedBy) throw new ApiError(409, "NOT_APPROVED", "Version has no approval record");
      // Defense-in-depth: stored rules must still validate at activation time.
      let activationRules: ReturnType<typeof scopeRulesSchema.safeParse>;
      try {
        activationRules = scopeRulesSchema.safeParse(JSON.parse(sv.rulesJson));
      } catch {
        throw new ApiError(422, "INVALID_RULES", "Stored rules are not valid JSON");
      }
      if (!activationRules.success) throw new ApiError(422, "INVALID_RULES", "Stored rules no longer validate against the schema");
      // Segregation of duties: proposer cannot activate their own version —
      // UNLESS the organization has exactly one active member (solo operator),
      // in which case self-activation is permitted with a reason and is
      // audited distinctly. Multi-member orgs always require a second person.
      if (sv.proposedBy === ctx.principal.userId) {
        const activeMembers = await db.membership.count({
          where: { orgId: program.orgId, state: "ACTIVE" },
        });
        if (activeMembers > 1) {
          throw new ApiError(403, "SELF_APPROVAL", "The user who proposed this version cannot activate it — a second operator must approve");
        }
      }
      // Supersede any currently active version.
      await db.scopeVersion.updateMany({ where: { programId: sv.programId, status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
      const updated = await db.scopeVersion.update({
        where: { id: sv.id },
        data: { status: "ACTIVE", activatedAt: new Date() },
      });
      if (program.state === "DRAFT") {
        await db.program.update({ where: { id: program.id }, data: { state: "ACTIVE" } });
      }
      await audit({
        orgId: ctx.orgId, actorId: ctx.principal.userId,
        action: sv.proposedBy === ctx.principal.userId ? "policy.activated_solo" : "policy.activated",
        resourceType: "ScopeVersion", resourceId: sv.id, decision: "ALLOW",
        metadata: { version: sv.version, solo: sv.proposedBy === ctx.principal.userId },
        requestRef: ctx.requestId,
      });
      return withRequestId(updated, 200, ctx.requestId);
    }

    if (action === "revoke") {
      const ctx = await requireContext(req, "scope:approve");
      requestId = ctx.requestId;
      const { sv } = await loadScoped(ctx.orgId, id);
      const body = z.object({ reason: z.string().min(3) }).safeParse(await req.json().catch(() => null));
      if (!body.success) throw new ApiError(422, "VALIDATION_ERROR", "A revocation reason is required");
      const res = await revokeScopeVersion(sv.id, ctx.principal.userId, body.data.reason);
      return withRequestId({ revoked: res.policy.id, campaigns_stopped: res.campaigns, jobs_cancelled: res.cancelledJobs }, 200, ctx.requestId);
    }

    throw new ApiError(404, "UNKNOWN_ACTION", `Unsupported action ':${action}'`);
  } catch (e) {
    return handleApiError(e, requestId);
  }
}
