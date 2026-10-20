import { createHash } from "crypto";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { syncFindingToTicket, ticketingMode } from "@/lib/ticketing";
import type { Role } from "@/lib/rbac";

// Finding lifecycle (FR-FND-01): permission-checked, immutable event-audited
// status transitions. Lifecycle: PROPOSED → OBSERVED → REPRODUCED → REVIEWED →
// REPORTED → ACCEPTED → CLOSED, plus REJECTED / DUPLICATE / FALSE_POSITIVE.

export const FINDING_STATUSES = [
  "PROPOSED", "OBSERVED", "REPRODUCED", "REVIEWED", "REPORTED", "ACCEPTED", "CLOSED",
  "REJECTED", "DUPLICATE", "FALSE_POSITIVE",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** Allowed transitions — anything not listed is a 422. */
const TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  PROPOSED: ["OBSERVED", "REJECTED", "DUPLICATE", "FALSE_POSITIVE"],
  OBSERVED: ["REPRODUCED", "REJECTED", "DUPLICATE", "FALSE_POSITIVE"],
  REPRODUCED: ["REVIEWED", "REJECTED", "FALSE_POSITIVE"],
  REVIEWED: ["REPORTED", "REJECTED"],
  REPORTED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
  DUPLICATE: [],
  FALSE_POSITIVE: [],
};

export function canTransition(from: FindingStatus, to: FindingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Roles permitted to move a finding into each state. */
const TRANSITION_ROLES: Record<string, Role[]> = {
  OBSERVED: ["RESEARCHER", "APPSEC_LEAD", "TENANT_ADMIN"],
  REPRODUCED: ["VALIDATOR", "APPSEC_LEAD", "TENANT_ADMIN"], // independent reproduction required
  REVIEWED: ["VALIDATOR", "APPSEC_LEAD", "TENANT_ADMIN"],
  REPORTED: ["RESEARCHER", "APPSEC_LEAD", "VALIDATOR", "TENANT_ADMIN"],
  ACCEPTED: ["PROGRAM_OWNER", "TENANT_ADMIN"],
  CLOSED: ["PROGRAM_OWNER", "TENANT_ADMIN"],
  REJECTED: ["VALIDATOR", "PROGRAM_OWNER", "APPSEC_LEAD", "TENANT_ADMIN"],
  DUPLICATE: ["VALIDATOR", "APPSEC_LEAD", "TENANT_ADMIN"],
  FALSE_POSITIVE: ["VALIDATOR", "APPSEC_LEAD", "TENANT_ADMIN"],
};

export function roleCanSetStatus(role: Role, to: FindingStatus): boolean {
  return TRANSITION_ROLES[to]?.includes(role) ?? false;
}

export interface CreateFindingInput {
  orgId: string;
  programId: string;
  assetId?: string;
  hypothesisId?: string;
  category: string;
  title: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  confidence: number;
  expectedBehavior?: string;
  observedBehavior?: string;
  impact?: string;
  limitations?: string;
  remediation?: string;
  evidenceRefs?: Array<{ evidenceId: string; role: string }>;
  reproductionSteps?: string[];
  actorId: string;
  sourceDetector?: string;
}

export function fingerprintOf(input: { programId: string; category: string; assetId?: string; title: string }): string {
  return createHash("sha256")
    .update(`${input.programId}|${input.category}|${input.assetId ?? ""}|${input.title.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

export async function createFinding(input: CreateFindingInput) {
  if (input.assetId) {
    const asset = await db.asset.findFirst({
      where: { id: input.assetId, orgId: input.orgId, programId: input.programId },
    });
    if (!asset) {
      throw new ApiError(422, "INVALID_ASSET_REF", `Asset ${input.assetId} not found in tenant program`);
    }
  }
  const fingerprint = fingerprintOf(input);
  const existing = await db.finding.findUnique({
    where: { programId_fingerprint: { programId: input.programId, fingerprint } },
  });
  if (existing) {
    throw new ApiError(409, "DUPLICATE_FINDING", "An active finding with the same fingerprint exists", undefined, {
      finding_id: existing.id,
    });
  }
  const finding = await db.finding.create({
    data: {
      id: newId("fnd"),
      orgId: input.orgId,
      programId: input.programId,
      assetId: input.assetId,
      hypothesisId: input.hypothesisId,
      fingerprint,
      category: input.category,
      title: input.title,
      description: input.description,
      severity: input.severity,
      confidence: input.confidence,
      status: "PROPOSED",
      expectedBehavior: input.expectedBehavior ?? "",
      observedBehavior: input.observedBehavior ?? "",
      impact: input.impact ?? "",
      limitations: input.limitations ?? "",
      remediation: input.remediation ?? "",
      reproductionJson: JSON.stringify(input.reproductionSteps ?? []),
      assignedTo: input.actorId,
      sourceDetector: input.sourceDetector ?? "manual",
    },
  });
  for (const ref of input.evidenceRefs ?? []) {
    const ev = await db.evidence.findFirst({ where: { id: ref.evidenceId, orgId: input.orgId } });
    if (!ev) throw new ApiError(422, "INVALID_EVIDENCE_REF", `Evidence ${ref.evidenceId} not found in tenant`);
    await db.findingEvidence.create({ data: { findingId: finding.id, evidenceId: ref.evidenceId, role: ref.role } });
  }
  await db.findingStatusEvent.create({
    data: {
      id: newId("fse"),
      findingId: finding.id,
      fromStatus: "",
      toStatus: "PROPOSED",
      actorId: input.actorId,
      reason: "Finding created",
    },
  });
  await audit({
    orgId: input.orgId,
    actorId: input.actorId,
    action: "finding.created",
    resourceType: "Finding",
    resourceId: finding.id,
    metadata: { category: input.category, severity: input.severity },
  });
  return finding;
}

export async function transitionFinding(params: {
  findingId: string;
  orgId: string;
  to: FindingStatus;
  role: Role;
  actorId: string;
  reason?: string;
}) {
  const finding = await db.finding.findFirst({ where: { id: params.findingId, orgId: params.orgId } });
  if (!finding) throw new ApiError(404, "NOT_FOUND", "Finding not found");
  const from = finding.status as FindingStatus;
  if (from === params.to) throw new ApiError(422, "INVALID_TRANSITION", "Finding is already in that status");
  if (!canTransition(from, params.to)) {
    throw new ApiError(422, "INVALID_TRANSITION", `Transition ${from} → ${params.to} is not permitted`, undefined, {
      from, to: params.to, allowed: TRANSITIONS[from],
    });
  }
  if (!roleCanSetStatus(params.role, params.to)) {
    throw new ApiError(403, "FORBIDDEN", `Role ${params.role} cannot set status ${params.to}`);
  }
  // A finding may only be REPORTED after independent validation (validator decision).
  if (params.to === "REPORTED" && finding.validationStatus !== "VALIDATED") {
    throw new ApiError(422, "VALIDATION_REQUIRED", "Findings require an independent validator decision before reporting");
  }
  await db.finding.update({ where: { id: finding.id }, data: { status: params.to } });
  await db.findingStatusEvent.create({
    data: {
      id: newId("fse"),
      findingId: finding.id,
      fromStatus: from,
      toStatus: params.to,
      actorId: params.actorId,
      reason: params.reason ?? "",
    },
  });
  await audit({
    orgId: params.orgId,
    actorId: params.actorId,
    action: "finding.status_changed",
    resourceType: "Finding",
    resourceId: finding.id,
    decision: "ALLOW",
    reason: `${from} → ${params.to}: ${params.reason ?? ""}`,
    metadata: { from, to: params.to },
  });
  // Signed webhook fan-out (FR-ENT-02); delivery itself is worker-processed.
  await dispatchWebhookEvent(params.orgId, "finding.status_changed", {
    finding_id: finding.id,
    old_status: from,
    new_status: params.to,
    actor: params.actorId,
    reason: params.reason ?? "",
  });
  // Ticketing sync: creating the tracker ticket when the finding is REPORTED.
  // Failures never block the transition — the ticket can be retried later.
  if (params.to === "REPORTED" && ticketingMode() !== "none") {
    try {
      await syncFindingToTicket({ ...finding, status: "REPORTED" });
    } catch {
      // recorded in audit by the ticketing module on failure paths
    }
  }
  return { ...finding, status: params.to };
}

/** Record an independent validation decision (validator role gates REPORTED). */
export async function recordValidation(params: {
  findingId: string;
  orgId: string;
  actorId: string;
  outcome: "VALIDATED" | "UNVALIDATED" | "REFUTED";
  notes: string;
}) {
  const finding = await db.finding.findFirst({ where: { id: params.findingId, orgId: params.orgId } });
  if (!finding) throw new ApiError(404, "NOT_FOUND", "Finding not found");
  await db.finding.update({
    where: { id: finding.id },
    data: {
      validationStatus: params.outcome,
      validatedBy: params.actorId,
      limitations: params.outcome === "REFUTED" ? `Refuted by validator: ${params.notes}` : finding.limitations,
    },
  });
  await audit({
    orgId: params.orgId,
    actorId: params.actorId,
    action: "finding.validation_recorded",
    resourceType: "Finding",
    resourceId: finding.id,
    decision: params.outcome === "REFUTED" ? "DENY" : "ALLOW",
    reason: params.notes,
  });
  return db.finding.findUnique({ where: { id: finding.id } });
}
