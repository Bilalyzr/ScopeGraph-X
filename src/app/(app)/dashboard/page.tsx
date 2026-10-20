import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { DashboardHero } from "./DashboardHero";
import { IndexRow, RevealScope } from "./DashboardClient";

export const dynamic = "force-dynamic";

const SEVERITIES = [
  { sev: "CRITICAL", color: "var(--red)" },
  { sev: "HIGH", color: "var(--orange)" },
  { sev: "MEDIUM", color: "var(--amber)" },
  { sev: "LOW", color: "var(--violet)" },
  { sev: "INFO", color: "var(--muted)" },
];
const SCOPE_STATES = [
  { s: "AUTHORIZED", color: "var(--green)" },
  { s: "OWNERSHIP_VERIFIED", color: "var(--violet)" },
  { s: "ASSOCIATED", color: "var(--amber)" },
  { s: "DISCOVERED", color: "var(--muted)" },
  { s: "DENIED", color: "var(--red)" },
];
const LIFECYCLE = ["PROPOSED", "OBSERVED", "REPRODUCED", "REVIEWED", "REPORTED", "ACCEPTED", "CLOSED"];
const OFF_RAMPS = ["REJECTED", "DUPLICATE", "FALSE_POSITIVE"];

export default async function DashboardPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const orgId = principal.orgId;

  // Every metric below is derived from stored application data (PRD A–B).
  const [org, programs, campaigns, assets, findings, jobs, egressDenies, recentAudit, stops, recentChanges, endpoints] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.program.findMany({ where: { orgId } }),
    db.campaign.findMany({ where: { orgId } }),
    db.asset.findMany({ where: { orgId } }),
    db.finding.findMany({ where: { orgId } }),
    db.job.findMany({ where: { campaign: { orgId } } }),
    db.egressCheck.count({ where: { orgId, decision: "DENY" } }),
    db.auditEvent.findMany({ where: { orgId }, orderBy: { timestamp: "desc" }, take: 8 }),
    db.emergencyStop.findFirst({ where: { active: true, OR: [{ scope: "GLOBAL" }, { orgId }] } }),
    db.assetChange.findMany({ where: { orgId }, orderBy: { id: "desc" }, take: 5 }),
    db.endpoint.count({ where: { asset: { orgId } } }),
  ]);

  const count = <T,>(rows: T[], key: (r: T) => string) =>
    rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});
  const assetsByState = count(assets, (a) => a.scopeState);
  const findingsBySeverity = count(findings, (f) => f.severity);
  const findingsByStatus = count(findings, (f) => f.status);
  const jobsByStatus = count(jobs, (j) => j.status);
  const activeCampaigns = campaigns.filter((c) => c.state === "RUNNING").length;
  const validated = findings.filter((f) => f.validationStatus === "VALIDATED").length;
  const candidates = findingsByStatus.PROPOSED ?? 0;
  const authorized = assetsByState.AUTHORIZED ?? 0;
  const offRampTotal = OFF_RAMPS.reduce((n, s) => n + (findingsByStatus[s] ?? 0), 0);
  const livePlate = LIFECYCLE.reduce((best, s, i) => ((findingsByStatus[s] ?? 0) > 0 ? i : best), -1);

  const metrics = [
    { label: "Programs", value: programs.length, sub: `${programs.filter((p) => p.state === "ACTIVE").length} active`, href: "/programs" },
    { label: "Campaigns", value: campaigns.length, sub: `${activeCampaigns} running`, href: "/campaigns" },
    { label: "Assets", value: assets.length, sub: `${authorized} authorized · ${assetsByState.DISCOVERED ?? 0} discovered`, href: "/assets" },
    { label: "Endpoints", value: endpoints, sub: "normalized routes", href: "/assets" },
    { label: "Findings", value: findings.length, sub: `${validated} validated · ${candidates} candidates`, href: "/findings" },
    { label: "Refused", value: egressDenies, sub: "gateway DENY decisions", href: "/audit", alert: egressDenies > 0 },
    { label: "Changes", value: recentChanges.length, sub: "recent surface diffs", href: "/assets" },
  ];

  return (
    <RevealScope className="dx">
      <DashboardHero
        counts={{ programs: programs.length, authorized, endpoints, outside: assets.length - authorized, findings: findings.length }}
        halted={!!stops}
        orgName={org?.name ?? "Workspace"}
        role={principal.role ?? "—"}
        denials={egressDenies}
        candidates={candidates}
      />

      {/* ------------------------------------------------------------ 01 telemetry */}
      <section className="dx-section" aria-labelledby="dx-h1">
        <header className="dx-head">
          <p className="dx-kicker" data-reveal="up"><span>01</span> Telemetry</p>
          <h2 id="dx-h1" className="dx-h2" data-reveal="up">The surface, counted.</h2>
        </header>
        <div className="dx-plates">
          {metrics.map((m, i) => (
            <Link key={m.label} href={m.href} className={`dx-plate ${m.alert ? "alert" : ""}`} data-reveal="up" style={{ ["--d" as string]: i }}>
              <span className="dx-plate-label">{m.label}</span>
              <span className="dx-plate-n">{m.value}</span>
              <span className="dx-plate-sub">{m.sub}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ 02 posture */}
      <section className="dx-section" aria-labelledby="dx-h2">
        <header className="dx-head">
          <p className="dx-kicker" data-reveal="up"><span>02</span> Threat posture</p>
          <h2 id="dx-h2" className="dx-h2" data-reveal="up">Severity and authorization, side by side.</h2>
        </header>
        <div className="dx-split2">
          <article className="dx-card" data-reveal="mask">
            <div>
              <div className="dx-card-head">
                <h3>Findings by severity</h3>
                <Link href="/findings" className="dx-link">All findings →</Link>
              </div>
              {findings.length === 0 ? (
                <p className="dx-empty">No findings yet — candidates appear here once research or scanner imports run.</p>
              ) : (
                <>
                  <div className="dx-stack" title="Findings distribution by severity">
                    {SEVERITIES.map(({ sev, color }) => {
                      const n = findingsBySeverity[sev] ?? 0;
                      return n ? <span key={sev} style={{ flexGrow: n, background: color }} /> : null;
                    })}
                  </div>
                  <ul className="dx-legend-list">
                    {SEVERITIES.filter(({ sev }) => findingsBySeverity[sev]).map(({ sev, color }) => (
                      <li key={sev}>
                        <i style={{ background: color }} />
                        <span className="k">{sev}</span>
                        <span className="v">{findingsBySeverity[sev]}</span>
                        <span className="faint">{findings.filter((f) => f.severity === sev && f.validationStatus === "VALIDATED").length} validated</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </article>

          <article className="dx-card" data-reveal="mask">
            <div>
              <div className="dx-card-head">
                <h3>Authorization ladder</h3>
                <Link href="/assets" className="dx-link">Inventory →</Link>
              </div>
              <p className="dx-note">Discovery ≠ ownership ≠ authorization. Only AUTHORIZED assets receive active jobs.</p>
              <ul className="dx-ladder">
                {SCOPE_STATES.map(({ s, color }) => {
                  const n = assetsByState[s] ?? 0;
                  const pct = Math.round((n / Math.max(1, assets.length)) * 100);
                  return (
                    <li key={s}>
                      <span className="k">{s.replace("_", " ")}</span>
                      <span className="bar"><span style={{ width: `${pct}%`, background: color }} /></span>
                      <span className="v">{n}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </article>
        </div>
      </section>

      {/* ------------------------------------------------------------ 03 lifecycle */}
      <section className="dx-section" aria-labelledby="dx-h3">
        <header className="dx-head">
          <p className="dx-kicker" data-reveal="up"><span>03</span> Evidence lifecycle</p>
          <h2 id="dx-h3" className="dx-h2" data-reveal="up">Where every claim stands.</h2>
        </header>
        <div className="dx-track-wrap" data-reveal="up">
          <svg className="dx-ecg" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
            <path
              pathLength={1}
              style={{ strokeDashoffset: 1 - (livePlate + 1) / LIFECYCLE.length }}
              d="M0 20 H60 l8 -14 l8 26 l8 -12 H200 l8 -14 l8 26 l8 -12 H340 l8 -14 l8 26 l8 -12 H480 l8 -14 l8 26 l8 -12 H620 l8 -14 l8 26 l8 -12 H760 l8 -14 l8 26 l8 -12 H900 l8 -14 l8 26 l8 -12 H1000"
            />
          </svg>
          <ol className="dx-track">
            {LIFECYCLE.map((s, i) => {
              const n = findingsByStatus[s] ?? 0;
              return (
                <li key={s} className={`dx-step ${n > 0 ? "has" : ""}`}>
                  <Link href={`/findings?status=${s}`}>
                    <span className="dx-step-n">{String(i + 1).padStart(2, "0")}</span>
                    <span className="dx-step-v">{n}</span>
                    <span className="dx-step-k">{s}</span>
                  </Link>
                </li>
              );
            })}
            <li className={`dx-step off ${offRampTotal > 0 ? "has" : ""}`}>
              <Link href="/findings?status=FALSE_POSITIVE">
                <span className="dx-step-n">↳</span>
                <span className="dx-step-v">{offRampTotal}</span>
                <span className="dx-step-k">Off-ramps</span>
              </Link>
            </li>
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ 04 activity */}
      <section className="dx-section" aria-labelledby="dx-h4">
        <header className="dx-head">
          <p className="dx-kicker" data-reveal="up"><span>04</span> Ledger</p>
          <h2 id="dx-h4" className="dx-h2" data-reveal="up">Every decision, written down.</h2>
        </header>
        <div className="dx-split2 wide-left">
          <div>
            <div className="dx-card-head plain">
              <h3>Recent audit activity</h3>
              <Link href="/audit" className="dx-link">Full ledger →</Link>
            </div>
            {recentAudit.length === 0 ? (
              <p className="dx-empty">The ledger is empty.</p>
            ) : (
              <div className="dx-index">
                {recentAudit.map((e) => (
                  <IndexRow key={e.id} href="/audit">
                    <span className="dx-row-t mono">{e.action}</span>
                    <span className="dx-row-d mono">{e.resourceType} · {e.resourceId.slice(0, 18)}</span>
                    <span className={`dx-row-tag ${e.decision === "DENY" ? "deny" : e.decision === "ALLOW" ? "allow" : ""}`}>{e.decision}</span>
                    <span className="dx-row-time mono">{e.timestamp.toISOString().slice(11, 16)}</span>
                  </IndexRow>
                ))}
              </div>
            )}
          </div>

          <div className="dx-stack-col">
            <article className="dx-card" data-reveal="mask">
              <div>
                <div className="dx-card-head">
                  <h3>Job queue</h3>
                  <Link href="/campaigns" className="dx-link">Campaigns →</Link>
                </div>
                {jobs.length === 0 ? (
                  <p className="dx-empty">No jobs yet.</p>
                ) : (
                  <ul className="dx-kv">
                    {Object.entries(jobsByStatus).map(([s, n]) => (
                      <li key={s}>
                        <span className={`dot ${s === "SUCCEEDED" ? "ok" : s === "FAILED" ? "bad" : "busy"}`} />
                        <span className="k">{s}</span>
                        <span className="v">{n}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>

            <article className="dx-card" data-reveal="mask">
              <div>
                <div className="dx-card-head">
                  <h3>Surface changes</h3>
                  <Link href="/assets" className="dx-link">Inventory →</Link>
                </div>
                {recentChanges.length === 0 ? (
                  <p className="dx-empty">No changes detected — snapshot assets or import schemas to build the feed.</p>
                ) : (
                  <ul className="dx-kv">
                    {recentChanges.map((c) => (
                      <li key={c.id}>
                        <span className="dot busy" />
                        <span className="k">{c.diffKind.replace("_", " ")}</span>
                        <span className="v faint">{c.observedAt.toISOString().slice(5, 16).replace("T", " ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>

            <div className="terminal-panel" data-reveal="up">
              <div className="terminal-header">
                <span className="terminal-dots" aria-hidden="true">
                  <span className="terminal-dot coral" />
                  <span className="terminal-dot amber" />
                  <span className="terminal-dot mint" />
                </span>
                <span className="terminal-title">policy-gateway.stream // live</span>
              </div>
              <div>
                <div>
                  <span style={{ color: "var(--mint)" }}>[GATEWAY]</span> programs={programs.length} · authorized={authorized} · denials={egressDenies}
                </div>
                {recentAudit[0] && (
                  <div>
                    <span style={{ color: "var(--coral)" }}>[AUDIT_HEAD]</span> {recentAudit[0].action} → {recentAudit[0].decision} (sha256:
                    {recentAudit[0].digest.slice(0, 12)}…)
                  </div>
                )}
                <div style={{ color: "#9da69b" }}>
                  {stops ? "Emergency stop engaged — dispatch blocked" : "Awaiting policy-pinned job dispatch"}
                  <span className="terminal-cursor" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </RevealScope>
  );
}
