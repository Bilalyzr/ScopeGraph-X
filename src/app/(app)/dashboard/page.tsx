import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { FinderQuickActions } from "./FinderQuickActions";
import { GovernanceDashboard } from "./GovernanceDashboard";
import { AnalyticsBoard } from "./AnalyticsBoard";
import { roleFamily } from "@/lib/rbac";
import { loadPrdMetrics, WINDOW_DAYS } from "@/lib/analytics/prd-metrics";
import "./analytics.css";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const orgId = principal.orgId;

  // Separated experiences: governance roles get the Admin Console; hunting
  // roles keep the Finder Workbench. Both are backed by the same PRD §13
  // analytics computed from stored application data (no fixtures).
  if (roleFamily(principal.role) === "governance") {
    const [org, metrics] = await Promise.all([db.organization.findUnique({ where: { id: orgId } }), loadPrdMetrics(orgId)]);
    return <GovernanceDashboard orgId={orgId} orgName={org?.name ?? "Workspace"} role={principal.role ?? "—"} metrics={metrics} />;
  }

  const [org, metrics, programs, recentAudit, recentChanges] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    loadPrdMetrics(orgId),
    db.program.findMany({ where: { orgId }, select: { id: true }, take: 1 }),
    db.auditEvent.findMany({ where: { orgId }, orderBy: { timestamp: "desc" }, take: 7 }),
    db.assetChange.findMany({ where: { orgId }, orderBy: { id: "desc" }, take: 6 }),
  ]);

  return (
    <div className="ax-page">
      <header className="ax-top">
        <div className="ax-top-l">
          <p className="ax-eyebrow">
            Finder workbench <span aria-hidden="true">/</span> <b>{org?.name ?? "Workspace"}</b> <span aria-hidden="true">·</span> {principal.role}
          </p>
          <h1 className="ax-title">Security research overview</h1>
        </div>
        <div className="ax-top-r">
          <span className="ax-pill">Last {WINDOW_DAYS} days · UTC</span>
          <span className={`ax-pill ${metrics.halted ? "halted" : ""}`} role="status">
            <span className="dot" /> {metrics.halted ? "Emergency stop engaged" : "Gateway live"}
          </span>
        </div>
      </header>

      <FinderQuickActions programId={programs[0]?.id ?? null} />

      <AnalyticsBoard m={metrics} />

      <div className="ax-grid">
        <article className="ax-card span-7">
          <header className="ax-card-h">
            <div>
              <h3>Recent audit activity</h3>
              <p>Hash-chained ledger · newest first</p>
            </div>
            <Link href="/audit" className="ax-link">Full ledger →</Link>
          </header>
          {recentAudit.length === 0 ? (
            <p className="ax-empty">The ledger is empty.</p>
          ) : (
            <ul className="ax-ledger">
              {recentAudit.map((e) => (
                <li key={e.id}>
                  <span className={`d ${e.decision}`} />
                  <span className="a">
                    {e.action}
                    <small>
                      {e.resourceType} · {e.resourceId.slice(0, 22)} · sha256:{e.digest.slice(0, 10)}…
                    </small>
                  </span>
                  <span className={`tag ${e.decision}`}>{e.decision}</span>
                  <time dateTime={e.timestamp.toISOString()}>{e.timestamp.toISOString().slice(5, 16).replace("T", " ")}</time>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="ax-card span-5">
          <header className="ax-card-h">
            <div>
              <h3>Surface changes</h3>
              <p>Latest attack-surface diffs</p>
            </div>
            <Link href="/assets" className="ax-link">Change feed →</Link>
          </header>
          {recentChanges.length === 0 ? (
            <p className="ax-empty">No changes detected — snapshot assets or import schemas to build the feed.</p>
          ) : (
            <ul className="ax-ledger">
              {recentChanges.map((c) => (
                <li key={c.id}>
                  <span className="d" style={{ background: "var(--violet)" }} />
                  <span className="a">{c.diffKind.replace(/_/g, " ")}</span>
                  <span />
                  <time dateTime={c.observedAt.toISOString()}>{c.observedAt.toISOString().slice(5, 16).replace("T", " ")}</time>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </div>
  );
}
