import { createHash } from "crypto";
import { db } from "@/lib/db";
import { newId } from "@/lib/ids";

// Append-only audit log with tamper-evident digest chaining (PRD §8.2).
// Each event's digest = sha256(prevDigest | canonical event fields), so any
// modification or deletion of a historical row breaks every later digest.

export interface AuditInput {
  orgId: string;
  actorType?: "USER" | "SERVICE" | "SYSTEM";
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  decision?: "ALLOW" | "DENY" | "N/A";
  reason?: string;
  metadata?: Record<string, unknown>;
  requestRef?: string;
}

function canonical(input: AuditInput, prevDigest: string, timestamp: Date): string {
  return JSON.stringify({
    orgId: input.orgId,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    decision: input.decision ?? "N/A",
    reason: input.reason ?? "",
    metadata: input.metadata ?? {},
    prevDigest,
    timestamp: timestamp.toISOString(),
  });
}

export async function audit(input: AuditInput): Promise<void> {
  const last = await db.auditEvent.findFirst({ orderBy: { seq: "desc" } });
  // The chain is global (covers all tenants) — stronger tamper evidence, and
  // tenant rows still carry orgId for scoped reads/exports.
  const prevDigest = last?.digest ?? "GENESIS";
  const timestamp = new Date();
  const digest = createHash("sha256").update(canonical(input, prevDigest, timestamp)).digest("hex");
  await db.auditEvent.create({
    data: {
      id: newId("aud"),
      orgId: input.orgId,
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      decision: input.decision ?? "N/A",
      reason: input.reason ?? "",
      metadataJson: JSON.stringify(input.metadata ?? {}),
      requestRef: input.requestRef ?? "",
      prevDigest,
      digest,
      timestamp,
    },
  });
}

/** Verify the full digest chain (used by tests and the admin integrity screen). */
export async function verifyAuditChain(limit = 5000): Promise<{ ok: boolean; brokenAt?: string }> {
  const events = await db.auditEvent.findMany({ orderBy: { seq: "asc" }, take: limit });
  let prev = "GENESIS";
  for (const e of events) {
    if (e.prevDigest !== prev) return { ok: false, brokenAt: e.id };
    const recomputed = createHash("sha256")
      .update(
        canonical(
          {
            orgId: e.orgId,
            actorId: e.actorId,
            action: e.action,
            resourceType: e.resourceType,
            resourceId: e.resourceId,
            decision: e.decision as AuditInput["decision"],
            reason: e.reason,
            metadata: JSON.parse(e.metadataJson),
          },
          prev,
          e.timestamp
        )
      )
      .digest("hex");
    if (recomputed !== e.digest) return { ok: false, brokenAt: e.id };
    prev = e.digest;
  }
  return { ok: true };
}
