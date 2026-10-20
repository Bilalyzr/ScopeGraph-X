/**
 * PRD §13 — "Product analytics and operational dashboards".
 *
 * Computes the Value / Quality / Operations / AI metric families plus the
 * time series that back the dashboard charts. Every number is derived from
 * stored application records for a single tenant. Metrics that the platform
 * does not instrument yet (e.g. researcher-trust surveys, recall against a
 * ground-truth corpus) are returned as `null` and rendered as "not
 * instrumented" instead of being estimated.
 */
import { db } from "@/lib/db";

const DAY = 86_400_000;
export const WINDOW_DAYS = 14;

export const SEVERITIES = [
  { key: "CRITICAL", color: "var(--red)" },
  { key: "HIGH", color: "var(--orange)" },
  { key: "MEDIUM", color: "#c9a227" },
  { key: "LOW", color: "var(--violet)" },
  { key: "INFO", color: "#9a9a92" },
] as const;

export const SCOPE_STATES = [
  { key: "AUTHORIZED", color: "var(--green)" },
  { key: "OWNERSHIP_VERIFIED", color: "var(--violet)" },
  { key: "ASSOCIATED", color: "#c9a227" },
  { key: "DISCOVERED", color: "#9a9a92" },
  { key: "DENIED", color: "var(--red)" },
] as const;

export const LIFECYCLE = ["PROPOSED", "OBSERVED", "REPRODUCED", "REVIEWED", "REPORTED", "ACCEPTED", "CLOSED"] as const;
const OFF_RAMPS = ["REJECTED", "DUPLICATE", "FALSE_POSITIVE"];
const RANK: Record<string, number> = Object.fromEntries(LIFECYCLE.map((s, i) => [s, i]));

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const tally = <T,>(rows: T[], key: (r: T) => string) =>
  rows.reduce<Record<string, number>>((acc, r) => {
    const k = key(r);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

function buckets(now: number) {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = end.getTime() - (WINDOW_DAYS - 1) * DAY;
  const labels = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const d = new Date(start + i * DAY);
    return `${String(d.getUTCDate()).padStart(2, "0")} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })}`;
  });
  const idx = (t: Date | null | undefined) => {
    if (!t) return -1;
    const i = Math.floor((t.getTime() - start) / DAY);
    return i >= 0 && i < WINDOW_DAYS ? i : -1;
  };
  const series = <T,>(rows: T[], at: (r: T) => Date | null | undefined, keep: (r: T) => boolean = () => true) => {
    const out = Array<number>(WINDOW_DAYS).fill(0);
    for (const r of rows) {
      if (!keep(r)) continue;
      const i = idx(at(r));
      if (i >= 0) out[i]++;
    }
    return out;
  };
  return { labels, series, start };
}

export async function loadPrdMetrics(orgId: string) {
  const now = Date.now();
  const since28 = new Date(now - 28 * DAY);
  const [programs, campaigns, assets, findings, jobs, egress, audit, hypotheses, tests, endpoints, changes, evidence, stop] = await Promise.all([
    db.program.findMany({ where: { orgId }, select: { id: true, state: true } }),
    db.campaign.findMany({ where: { orgId }, select: { id: true, name: true, state: true, startedAt: true, finishedAt: true, emergencyStoppedAt: true } }),
    db.asset.findMany({ where: { orgId }, select: { scopeState: true, assetType: true, firstSeenAt: true } }),
    db.finding.findMany({
      where: { orgId },
      select: { id: true, status: true, severity: true, category: true, validationStatus: true, createdAt: true, sourceDetector: true, confidence: true, _count: { select: { evidenceLinks: true } } },
    }),
    db.job.findMany({ where: { campaign: { orgId } }, select: { status: true, kind: true, attempts: true, createdAt: true, updatedAt: true, finishedAt: true, campaignId: true } }),
    db.egressCheck.findMany({ where: { orgId, timestamp: { gte: since28 } }, select: { decision: true, timestamp: true } }),
    db.auditEvent.findMany({ where: { orgId, timestamp: { gte: since28 } }, select: { decision: true, timestamp: true, action: true } }),
    db.hypothesis.findMany({ where: { orgId }, select: { status: true, origin: true, evidenceRefsJson: true, campaignId: true, createdAt: true } }),
    db.test.findMany({ where: { orgId }, select: { status: true } }),
    db.endpoint.count({ where: { asset: { orgId } } }),
    db.assetChange.findMany({ where: { orgId }, select: { diffKind: true, observedAt: true } }),
    db.evidence.findMany({ where: { orgId }, select: { collectedAt: true, sizeBytes: true, redactionStatus: true } }),
    db.emergencyStop.findFirst({ where: { active: true, OR: [{ scope: "GLOBAL" }, { orgId }] } }),
  ]);

  // FindingStatusEvent has no relation to Finding; scope events to this tenant's findings.
  const events = findings.length
    ? await db.findingStatusEvent.findMany({
        where: { findingId: { in: findings.map((f) => f.id) } },
        select: { findingId: true, fromStatus: true, toStatus: true, createdAt: true },
      })
    : [];

  const { labels, series } = buckets(now);
  const bySeverity = tally(findings, (f) => f.severity);
  const byStatus = tally(findings, (f) => f.status);
  const byScope = tally(assets, (a) => a.scopeState);
  const byJob = tally(jobs, (j) => j.status);
  const byHyp = tally(hypotheses, (h) => h.status);

  /* ---------------------------------------------------------- VALUE */
  const validated = findings.filter((f) => f.validationStatus === "VALIDATED");
  const campaignHours = campaigns.reduce((h, c) => {
    if (!c.startedAt) return h;
    const end = (c.finishedAt ?? c.emergencyStoppedAt ?? (c.state === "RUNNING" ? new Date(now) : c.startedAt)).getTime();
    return h + Math.max(0, end - c.startedAt.getTime()) / 3_600_000;
  }, 0);
  const firstTriage = new Map<string, number>();
  for (const e of events) {
    if (e.fromStatus !== "PROPOSED") continue;
    const t = e.createdAt.getTime();
    const prev = firstTriage.get(e.findingId);
    if (prev == null || t < prev) firstTriage.set(e.findingId, t);
  }
  const triageHours = findings.flatMap((f) => {
    const t = firstTriage.get(f.id);
    return t == null ? [] : [Math.max(0, t - f.createdAt.getTime()) / 3_600_000];
  });
  const reportedOrBeyond = (byStatus.REPORTED ?? 0) + (byStatus.ACCEPTED ?? 0) + (byStatus.CLOSED ?? 0);
  const value = {
    validatedPerCampaignHour: campaignHours > 0 ? validated.length / campaignHours : null,
    campaignHours,
    medianTimeToTriageH: median(triageHours),
    triagedCount: triageHours.length,
    distinctRootCauses: new Set(validated.map((f) => f.category)).size,
    remediationAcceptance: ratio((byStatus.ACCEPTED ?? 0) + (byStatus.CLOSED ?? 0), reportedOrBeyond),
    researcherTrust: null as number | null, // requires survey instrumentation
  };

  /* -------------------------------------------------------- QUALITY */
  const fp = byStatus.FALSE_POSITIVE ?? 0;
  const rejected = byStatus.REJECTED ?? 0;
  const dup = byStatus.DUPLICATE ?? 0;
  const triaged = findings.filter((f) => f.status !== "PROPOSED");
  const pastObserved = findings.filter((f) => (RANK[f.status] ?? -1) >= RANK.OBSERVED);
  const pastReproduced = findings.filter((f) => (RANK[f.status] ?? -1) >= RANK.REPRODUCED);
  const truePositive = validated.length + reportedOrBeyond > 0 ? Math.max(validated.length, reportedOrBeyond) : 0;
  const categories = Object.entries(tally(findings, (f) => f.category))
    .map(([cat, total]) => {
      const fs = findings.filter((f) => f.category === cat);
      const tp = fs.filter((f) => f.validationStatus === "VALIDATED" || (RANK[f.status] ?? -1) >= RANK.REPORTED).length;
      const bad = fs.filter((f) => f.status === "FALSE_POSITIVE" || f.status === "REJECTED").length;
      return { cat, total, tp, bad, precision: ratio(tp, tp + bad) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const quality = {
    precision: ratio(truePositive, truePositive + fp + rejected),
    falsePositiveRate: ratio(fp, triaged.length),
    reproductionRate: ratio(pastReproduced.length, pastObserved.length),
    evidenceCompleteness: ratio(triaged.filter((f) => f._count.evidenceLinks > 0).length, triaged.length),
    duplicateRate: ratio(dup, findings.length),
    recallByClass: null as number | null, // requires a labelled benchmark corpus
    categories,
  };

  /* ----------------------------------------------------- OPERATIONS */
  const queued = jobs.filter((j) => j.status === "QUEUED");
  const running = jobs.filter((j) => j.status === "RUNNING");
  const finished = jobs.filter((j) => j.status === "SUCCEEDED" || j.status === "FAILED");
  const failed = byJob.FAILED ?? 0;
  const ERROR_BUDGET = 0.05; // 95% job success objective
  const failRate = ratio(failed, finished.length);
  const egressDenyNow = egress.filter((e) => e.decision === "DENY" && e.timestamp.getTime() > now - DAY).length;
  const egressDenyPrior = egress.filter((e) => e.decision === "DENY" && e.timestamp.getTime() <= now - DAY && e.timestamp.getTime() > now - 8 * DAY).length / 7;
  const ops = {
    backlog: queued.length,
    running: running.length,
    workerUtilization: ratio(running.length, running.length + queued.length),
    queueLagMin: median(queued.map((j) => (now - j.createdAt.getTime()) / 60_000)),
    errorBudgetRemaining: failRate == null ? null : Math.max(0, 1 - failRate / ERROR_BUDGET),
    failRate,
    policyDenies: egress.filter((e) => e.decision === "DENY").length + audit.filter((a) => a.decision === "DENY").length,
    egressAnomaly: egressDenyNow > Math.max(3, egressDenyPrior * 2),
    egressDenyNow,
    egressDenyPrior,
    jobsPerValidated: ratio(jobs.length, validated.length),
    medianJobMin: median(jobs.filter((j) => j.finishedAt).map((j) => (j.finishedAt!.getTime() - j.createdAt.getTime()) / 60_000)),
    jobKinds: Object.entries(tally(jobs, (j) => j.kind)).sort((a, b) => b[1] - a[1]),
  };

  /* ------------------------------------------------------------- AI */
  const ai = hypotheses.filter((h) => h.origin === "AI");
  const cited = (h: { evidenceRefsJson: string }) => {
    try {
      const v = JSON.parse(h.evidenceRefsJson);
      return Array.isArray(v) && v.length > 0;
    } catch {
      return false;
    }
  };
  const decided = (byHyp.SUPPORTED ?? 0) + (byHyp.REJECTED ?? 0) + (byHyp.DOWNGRADED ?? 0);
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const aiMetrics = {
    hypotheses: hypotheses.length,
    acceptance: ratio(byHyp.SUPPORTED ?? 0, decided),
    citationCoverage: ratio(ai.filter(cited).length, ai.length),
    unsupportedClaimRate: ratio(ai.filter((h) => !cited(h)).length, ai.length),
    testsApproved: tests.filter((t) => t.status === "APPROVED" || t.status === "EXECUTED").length,
    testsTotal: tests.length,
    byCampaign: Object.entries(tally(hypotheses, (h) => (h.campaignId ? campaignName.get(h.campaignId) ?? h.campaignId.slice(0, 10) : "Unassigned")))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    byStatus: byHyp,
    promptInjectionPassRate: null as number | null, // eval harness not wired to tenant data
  };

  /* --------------------------------------------------- time series */
  const trends = {
    labels,
    findingsOpened: series(findings, (f) => f.createdAt),
    transitions: series(events, (e) => e.createdAt),
    validatedEvents: series(events, (e) => e.createdAt, (e) => e.toStatus === "REVIEWED" || e.toStatus === "REPORTED"),
    egressAllow: series(egress, (e) => e.timestamp, (e) => e.decision === "ALLOW"),
    egressDeny: series(egress, (e) => e.timestamp, (e) => e.decision === "DENY"),
    auditAllow: series(audit, (a) => a.timestamp, (a) => a.decision !== "DENY"),
    auditDeny: series(audit, (a) => a.timestamp, (a) => a.decision === "DENY"),
    jobsCreated: series(jobs, (j) => j.createdAt),
    jobsFailed: series(jobs, (j) => j.finishedAt ?? j.updatedAt, (j) => j.status === "FAILED"),
    jobsSucceeded: series(jobs, (j) => j.finishedAt ?? j.updatedAt, (j) => j.status === "SUCCEEDED"),
    assetsSeen: series(assets, (a) => a.firstSeenAt),
    changes: series(changes, (c) => c.observedAt),
    evidence: series(evidence, (e) => e.collectedAt),
  };

  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const a of audit) {
    const d = (a.timestamp.getUTCDay() + 6) % 7; // Mon = 0
    heat[d][a.timestamp.getUTCHours()]++;
  }

  return {
    totals: {
      programs: programs.length,
      activePrograms: programs.filter((p) => p.state === "ACTIVE").length,
      campaigns: campaigns.length,
      runningCampaigns: campaigns.filter((c) => c.state === "RUNNING").length,
      assets: assets.length,
      authorized: byScope.AUTHORIZED ?? 0,
      endpoints,
      findings: findings.length,
      validated: validated.length,
      candidates: byStatus.PROPOSED ?? 0,
      critical: (bySeverity.CRITICAL ?? 0) + (bySeverity.HIGH ?? 0),
      evidence: evidence.length,
      jobs: jobs.length,
    },
    halted: !!stop,
    bySeverity,
    byStatus,
    byScope,
    byJob,
    offRamps: OFF_RAMPS.map((s) => ({ s, n: byStatus[s] ?? 0 })),
    value,
    quality,
    ops,
    ai: aiMetrics,
    trends,
    heat,
  };
}

export type PrdMetrics = Awaited<ReturnType<typeof loadPrdMetrics>>;
