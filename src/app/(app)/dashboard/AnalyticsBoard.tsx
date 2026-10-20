import Link from "next/link";
import "./analytics.css";
import { AreaTrend, Donut, Funnel, Gauge, HBars, Heatmap, SegmentBar, Sparkline } from "@/components/charts/Charts";
import { LIFECYCLE, SCOPE_STATES, SEVERITIES, WINDOW_DAYS, type PrdMetrics } from "@/lib/analytics/prd-metrics";
import { ScopeMap } from "./ScopeMap";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number | null, d = 1) => (v == null ? "—" : `${Math.round(v * 10 ** d) / 10 ** d}`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const title = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function Delta({ series }: { series: number[] }) {
  const half = Math.floor(series.length / 2);
  const prev = sum(series.slice(0, half));
  const cur = sum(series.slice(half));
  if (prev === 0 && cur === 0) return <span className="ax-delta flat">no change</span>;
  if (prev === 0) return <span className="ax-delta up">new · +{cur}</span>;
  const d = Math.round(((cur - prev) / prev) * 100);
  return <span className={`ax-delta ${d > 0 ? "up" : d < 0 ? "down" : "flat"}`}>{d > 0 ? "▲" : d < 0 ? "▼" : "■"} {Math.abs(d)}% vs prior 7d</span>;
}

function Card({ title: t, sub, href, link, className = "", children, prd }: { title: string; sub?: string; href?: string; link?: string; className?: string; children: React.ReactNode; prd?: string }) {
  return (
    <article className={`ax-card ${className}`}>
      <header className="ax-card-h">
        <div>
          <h3>{t}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <div className="ax-card-a">
          {prd && <span className="ax-prd">{prd}</span>}
          {href && (
            <Link href={href} className="ax-link">
              {link ?? "View"} →
            </Link>
          )}
        </div>
      </header>
      {children}
    </article>
  );
}

function Stat({ k, v, note, tone }: { k: string; v: string; note?: string; tone?: "good" | "bad" | "muted" }) {
  return (
    <li className={`ax-stat ${tone ?? ""}`}>
      <span className="k">{k}</span>
      <b className="v">{v}</b>
      {note && <span className="n">{note}</span>}
    </li>
  );
}

export function AnalyticsBoard({ m, showScope = true }: { m: PrdMetrics; showScope?: boolean }) {
  const t = m.trends;
  const kpis = [
    { label: "Findings", value: m.totals.findings, sub: `${m.totals.candidates} awaiting triage`, spark: t.findingsOpened, color: "var(--ink)", href: "/findings" },
    { label: "Validated", value: m.totals.validated, sub: `${pct(m.quality.precision)} precision`, spark: t.validatedEvents, color: "var(--green)", href: "/findings?status=REVIEWED" },
    { label: "Critical + High", value: m.totals.critical, sub: `${m.bySeverity.CRITICAL ?? 0} critical`, spark: t.findingsOpened, color: "var(--red)", href: "/findings" },
    { label: "Authorized assets", value: m.totals.authorized, sub: `of ${m.totals.assets} discovered · ${m.totals.endpoints} endpoints`, spark: t.assetsSeen, color: "var(--violet)", href: "/assets" },
    { label: "Policy denials", value: m.ops.policyDenies, sub: m.ops.egressAnomaly ? "egress anomaly detected" : "gateway + RBAC, 28d", spark: t.egressDeny.map((v, i) => v + t.auditDeny[i]), color: "var(--coral)", href: "/audit", alert: m.ops.egressAnomaly },
    { label: "Job backlog", value: m.ops.backlog, sub: `${m.ops.running} running · ${m.totals.jobs} total`, spark: t.jobsCreated, color: "var(--orange)", href: "/campaigns" },
  ];

  const funnel = LIFECYCLE.map((s) => ({ label: title(s), value: LIFECYCLE.slice(LIFECYCLE.indexOf(s)).reduce((n, x) => n + (m.byStatus[x] ?? 0), 0), href: `/findings?status=${s}` }));

  return (
    <div className="ax">
      {/* ------------------------------------------------------------ KPI strip */}
      <section className="ax-kpis" aria-label="Key indicators">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className={`ax-kpi ${k.alert ? "alert" : ""}`}>
            <span className="ax-kpi-l">{k.label}</span>
            <span className="ax-kpi-row">
              <b className="ax-kpi-v">{k.value.toLocaleString()}</b>
              <Delta series={k.spark} />
            </span>
            <Sparkline values={k.spark} color={k.color} label={`${k.label} trend`} />
            <span className="ax-kpi-s">{k.sub}</span>
          </Link>
        ))}
      </section>

      {/* ------------------------------------------------- throughput + severity */}
      <div className="ax-grid">
        <Card className="span-8" title="Research throughput" sub={`Findings opened vs lifecycle transitions · last ${WINDOW_DAYS} days`} href="/findings" link="Findings" prd="§13 Value">
          <AreaTrend
            title="Research throughput"
            labels={t.labels}
            series={[
              { key: "open", label: "Findings opened", color: "var(--coral)", values: t.findingsOpened },
              { key: "move", label: "Status transitions", color: "var(--violet)", values: t.transitions },
              { key: "val", label: "Reviewed / reported", color: "var(--green)", values: t.validatedEvents },
            ]}
          />
        </Card>
        <Card className="span-4" title="Severity mix" sub="All findings by CVSS-aligned severity" href="/findings" link="Triage">
          <Donut
            title="Findings by severity"
            center={m.totals.findings}
            sub="findings"
            slices={SEVERITIES.map((s) => ({ label: title(s.key), value: m.bySeverity[s.key] ?? 0, color: s.color }))}
          />
        </Card>

        {/* --------------------------------------------- lifecycle + scope */}
        <Card className="span-7" title="Evidence lifecycle funnel" sub="Findings that reached each stage · stage-to-stage conversion" href="/findings" link="Lifecycle" prd="FR-07">
          <Funnel title="Finding lifecycle funnel" stages={funnel} />
          <div className="ax-offramps">
            <span>Off-ramps</span>
            {m.offRamps.map((o) => (
              <Link key={o.s} href={`/findings?status=${o.s}`} className={o.n ? "has" : ""}>
                {title(o.s)} <b>{o.n}</b>
              </Link>
            ))}
          </div>
        </Card>
        <Card className="span-5 ax-dark" title="Scope authorization" sub="Discovery ≠ ownership ≠ authorization" href="/assets" link="Inventory" prd="FR-02">
          {showScope && (
            <ScopeMap
              programs={m.totals.programs}
              authorized={m.totals.authorized}
              endpoints={m.totals.endpoints}
              outside={m.totals.assets - m.totals.authorized}
              findings={m.totals.findings}
              halted={m.halted}
            />
          )}
          <HBars title="Assets by authorization state" rows={SCOPE_STATES.map((s) => ({ label: title(s.key), value: m.byScope[s.key] ?? 0, color: s.color }))} />
        </Card>

        {/* -------------------------------------------------- quality gauges */}
        <Card className="span-12" title="Detection quality" sub="Computed from triage outcomes — recall requires a labelled benchmark corpus and is not estimated" href="/findings" link="Findings" prd="§13 Quality">
          <div className="ax-gauges">
            <Gauge label="Precision" value={m.quality.precision} sub="TP / (TP + FP + rejected)" color="var(--green)" />
            <Gauge label="Reproduction rate" value={m.quality.reproductionRate} sub="reproduced / observed" color="var(--violet)" />
            <Gauge label="Evidence completeness" value={m.quality.evidenceCompleteness} sub="triaged with evidence" color="var(--green)" />
            <Gauge label="False-positive rate" value={m.quality.falsePositiveRate} sub="FP / triaged" color="var(--coral)" invert />
            <Gauge label="Duplicate rate" value={m.quality.duplicateRate} sub="duplicates / all" color="var(--orange)" invert />
          </div>
        </Card>

        {/* --------------------------------------------------- egress + ops */}
        <Card className="span-7" title="Policy gateway decisions" sub={`Outbound egress checks per day · last ${WINDOW_DAYS} days (simulated transport in dev)`} href="/audit" link="Audit" prd="NFR-01">
          <AreaTrend
            kind="bar"
            title="Egress decisions per day"
            labels={t.labels}
            series={[
              { key: "allow", label: "Allowed", color: "var(--green)", values: t.egressAllow },
              { key: "deny", label: "Denied", color: "var(--coral)", values: t.egressDeny },
            ]}
          />
        </Card>
        <Card className="span-5" title="Operations" sub="Durable job queue health" href="/campaigns" link="Campaigns" prd="§13 Operations">
          <SegmentBar
            title="Jobs by status"
            slices={[
              { label: "Succeeded", value: m.byJob.SUCCEEDED ?? 0, color: "var(--green)" },
              { label: "Running", value: m.byJob.RUNNING ?? 0, color: "var(--violet)" },
              { label: "Queued", value: m.byJob.QUEUED ?? 0, color: "#c9a227" },
              { label: "Failed", value: m.byJob.FAILED ?? 0, color: "var(--red)" },
              { label: "Cancelled", value: m.byJob.CANCELLED ?? 0, color: "#9a9a92" },
            ]}
          />
          <ul className="ax-stats">
            <Stat k="Worker utilization" v={pct(m.ops.workerUtilization)} note="running / (running + queued)" />
            <Stat k="Queue lag (median)" v={m.ops.queueLagMin == null ? "—" : `${num(m.ops.queueLagMin, 0)} min`} note="age of queued jobs" />
            <Stat k="Error budget left" v={pct(m.ops.errorBudgetRemaining)} note="vs 95% success SLO" tone={m.ops.errorBudgetRemaining != null && m.ops.errorBudgetRemaining < 0.25 ? "bad" : undefined} />
            <Stat k="Jobs / validated finding" v={num(m.ops.jobsPerValidated)} note="cost proxy" />
            <Stat k="Egress denies (24h)" v={String(m.ops.egressDenyNow)} note={`7d avg ${num(m.ops.egressDenyPrior)}/day`} tone={m.ops.egressAnomaly ? "bad" : undefined} />
            <Stat k="Median job duration" v={m.ops.medianJobMin == null ? "—" : `${num(m.ops.medianJobMin)} min`} />
          </ul>
        </Card>

        {/* ---------------------------------------------- value / AI / class */}
        <Card className="span-4" title="Research value" sub="Outcome metrics per PRD" prd="§13 Value">
          <ul className="ax-stats single">
            <Stat k="Validated / campaign-hour" v={num(m.value.validatedPerCampaignHour, 2)} note={`${num(m.value.campaignHours)} campaign-hours`} />
            <Stat k="Median time-to-triage" v={m.value.medianTimeToTriageH == null ? "—" : `${num(m.value.medianTimeToTriageH)} h`} note={`${m.value.triagedCount} triaged`} />
            <Stat k="Distinct root causes" v={String(m.value.distinctRootCauses)} note="validated categories" />
            <Stat k="Remediation acceptance" v={pct(m.value.remediationAcceptance)} note="accepted / reported" />
            <Stat k="Researcher trust" v="—" note="not instrumented" tone="muted" />
          </ul>
        </Card>
        <Card className="span-4" title="AI research layer" sub="Typed hypotheses & citations" href="/research" link="Hypotheses" prd="§13 AI">
          <div className="ax-ai">
            <Gauge label="Acceptance" value={m.ai.acceptance} sub="supported / decided" color="var(--violet)" />
            <Gauge label="Citation coverage" value={m.ai.citationCoverage} sub="AI claims with evidence" color="var(--green)" />
          </div>
          <ul className="ax-stats single">
            <Stat k="Hypotheses" v={String(m.ai.hypotheses)} note={Object.entries(m.ai.byStatus).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "none yet"} />
            <Stat k="Unsupported-claim rate" v={pct(m.ai.unsupportedClaimRate)} tone={m.ai.unsupportedClaimRate != null && m.ai.unsupportedClaimRate > 0.2 ? "bad" : undefined} />
            <Stat k="Tests approved" v={`${m.ai.testsApproved}/${m.ai.testsTotal}`} note="approval-gated" />
            <Stat k="Prompt-injection pass rate" v="—" note="not instrumented" tone="muted" />
          </ul>
        </Card>
        <Card className="span-4" title="Precision by class" sub="Top vulnerability categories" href="/findings" link="Findings" prd="§12">
          {m.quality.categories.length === 0 ? (
            <p className="ax-empty">No findings yet — classes appear once research or scanner imports run.</p>
          ) : (
            <ul className="ax-class">
              {m.quality.categories.map((c) => (
                <li key={c.cat}>
                  <span className="k">{c.cat}</span>
                  <span className="bar">
                    <span className="tp" style={{ flexGrow: c.tp }} />
                    <span className="bad" style={{ flexGrow: c.bad }} />
                    <span className="open" style={{ flexGrow: Math.max(0, c.total - c.tp - c.bad) }} />
                  </span>
                  <span className="v">{c.total}</span>
                  <span className="p">{pct(c.precision)}</span>
                </li>
              ))}
              <li className="ax-class-legend">
                <i className="tp" /> confirmed <i className="bad" /> FP / rejected <i className="open" /> open
              </li>
            </ul>
          )}
        </Card>

        {/* ------------------------------------------------------ heatmap */}
        <Card className="span-12" title="Operator activity" sub="Audit-ledger events by weekday and hour" href="/audit" link="Ledger" prd="FR-10">
          <Heatmap title="Audit events heatmap" grid={m.heat} />
        </Card>
      </div>
    </div>
  );
}
