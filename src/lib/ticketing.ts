import { db } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import type { Finding } from "@prisma/client";

// Jira-style ticketing sync (FR-ENT-02). When a finding reaches REPORTED, a
// ticket is created in the configured tracker and linked (TicketLink); later
// status changes post a comment so the tracker stays in sync.
//
// Providers: "none" (default — no sync), "recorder" (records payloads for
// verification, performs no network I/O), "jira" (Jira Cloud REST, requires
// JIRA_BASE_URL + JIRA_EMAIL + JIRA_API_TOKEN — operator-configured infra,
// never a target). Every attempt is audited.

export type TicketingMode = "none" | "recorder" | "jira";

export function ticketingMode(): TicketingMode {
  const m = process.env.TICKETING_PROVIDER ?? "none";
  if (m === "jira" && process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) return "jira";
  if (m === "recorder") return "recorder";
  return "none";
}

type FetchLike = typeof fetch;

function getTicketingFetch(): FetchLike | null {
  return fetch; // swap point for tests
}

export interface TicketPayload {
  summary: string;
  description: string;
  severity: string;
  labels: string[];
  findingUrl?: string;
}

export function buildTicketPayload(finding: Finding, baseOrigin: string): TicketPayload {
  return {
    summary: `[${finding.severity}] ${finding.title}`.slice(0, 250),
    description: [
      `ScopeGraph X finding ${finding.id}`,
      `Severity: ${finding.severity} · Confidence: ${finding.confidence}`,
      `Validation: ${finding.validationStatus}`,
      "",
      finding.description,
      "",
      `Remediation: ${finding.remediation || "—"}`,
      `Limitations: ${finding.limitations || "—"}`,
    ].join("\n"),
    severity: finding.severity,
    labels: ["scopegraph-x", `severity-${finding.severity.toLowerCase()}`, finding.category.split(":")[0].toLowerCase()].slice(0, 5),
    findingUrl: `${baseOrigin}/findings/${finding.id}`,
  };
}

/** Create (or reuse) the tracker ticket for a REPORTED finding. */
export async function syncFindingToTicket(
  finding: Finding,
  opts: { fetchFn?: FetchLike; baseOrigin?: string } = {}
): Promise<{ created: boolean; issueKey?: string; issueUrl?: string; error?: string }> {
  const mode = ticketingMode();
  if (mode === "none") return { created: false, error: "TICKETING_DISABLED" };

  const existing = await db.ticketLink.findUnique({ where: { findingId_system: { findingId: finding.id, system: "jira" } } });
  if (existing) return { created: false, issueKey: existing.issueKey, issueUrl: existing.issueUrl };

  const payload = buildTicketPayload(finding, opts.baseOrigin ?? "http://127.0.0.1:3000");

  if (mode === "recorder") {
    const key = `REC-${newId("t").slice(-6).toUpperCase()}`;
    await audit({
      orgId: finding.orgId,
      actorType: "SERVICE",
      actorId: "ticketing:recorder",
      action: "ticket.recorded",
      resourceType: "Finding",
      resourceId: finding.id,
      metadata: { summary: payload.summary, labels: payload.labels },
    });
    const link = await db.ticketLink.create({
      data: { id: newId("tkt"), orgId: finding.orgId, findingId: finding.id, system: "jira", issueKey: key, issueUrl: "" },
    });
    return { created: true, issueKey: link.issueKey };
  }

  // mode === "jira" — Jira Cloud REST v3
  const fetchFn = opts.fetchFn ?? getTicketingFetch()!;
  try {
    const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
    const projectKey = process.env.JIRA_PROJECT_KEY ?? "SGX";
    const res = await fetchFn(`${process.env.JIRA_BASE_URL}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: payload.summary,
          issuetype: { name: process.env.JIRA_ISSUE_TYPE ?? "Bug" },
          labels: payload.labels,
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: payload.description }] }],
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const err = `JIRA_HTTP_${res.status}`;
      await audit({ orgId: finding.orgId, actorType: "SERVICE", actorId: "ticketing:jira", action: "ticket.failed", resourceType: "Finding", resourceId: finding.id, decision: "DENY", reason: err });
      return { created: false, error: err };
    }
    const created = (await res.json()) as { key: string; self?: string };
    const link = await db.ticketLink.create({
      data: {
        id: newId("tkt"),
        orgId: finding.orgId,
        findingId: finding.id,
        system: "jira",
        issueKey: created.key,
        issueUrl: `${process.env.JIRA_BASE_URL}/browse/${created.key}`,
      },
    });
    await audit({ orgId: finding.orgId, actorType: "SERVICE", actorId: "ticketing:jira", action: "ticket.created", resourceType: "Finding", resourceId: finding.id, decision: "ALLOW", metadata: { key: created.key } });
    return { created: true, issueKey: link.issueKey, issueUrl: link.issueUrl };
  } catch (e) {
    const err = e instanceof Error ? e.message : "JIRA_ERROR";
    await audit({ orgId: finding.orgId, actorType: "SERVICE", actorId: "ticketing:jira", action: "ticket.failed", resourceType: "Finding", resourceId: finding.id, decision: "DENY", reason: err });
    return { created: false, error: err };
  }
}
