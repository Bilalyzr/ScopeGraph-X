import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas, type Role } from "@/lib/rbac";
import { canTransition, type FindingStatus } from "@/lib/findings/lifecycle";
import { FindingActions } from "./FindingActions";

export const dynamic = "force-dynamic";

const NEXT_STATES: Partial<Record<FindingStatus, FindingStatus[]>> = {
  PROPOSED: ["OBSERVED", "REJECTED", "DUPLICATE", "FALSE_POSITIVE"],
  OBSERVED: ["REPRODUCED", "REJECTED", "DUPLICATE", "FALSE_POSITIVE"],
  REPRODUCED: ["REVIEWED", "REJECTED", "FALSE_POSITIVE"],
  REVIEWED: ["REPORTED", "REJECTED"],
  REPORTED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["CLOSED"],
};

export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const { id } = await params;
  const finding = await db.finding.findFirst({ where: { id, orgId: principal.orgId } });
  if (!finding) notFound();

  const history = await db.findingStatusEvent.findMany({ where: { findingId: finding.id }, orderBy: { createdAt: "asc" } });
  const evidence = await db.findingEvidence.findMany({ where: { findingId: finding.id } });
  const evidenceRows = await Promise.all(
    evidence.map(async (fe) => ({ role: fe.role, meta: await db.evidence.findUnique({ where: { id: fe.evidenceId } }) }))
  );
  const asset = finding.assetId ? await db.asset.findFirst({ where: { id: finding.assetId, orgId: principal.orgId } }) : null;
  const program = await db.program.findFirst({ where: { id: finding.programId, orgId: principal.orgId } });
  const allowedNext = (NEXT_STATES[finding.status as FindingStatus] ?? []).filter((s) => canTransition(finding.status as FindingStatus, s));
  const role = principal.role as Role;
  const canReview = roleHas(role, "finding:review");
  const isValidator = role === "VALIDATOR" || role === "APPSEC_LEAD" || role === "TENANT_ADMIN";

  return (
    <div>
      <div className="row spread">
        <div>
          <div className="mono-label">FINDING RECORD // IMMUTABLE EVIDENCE CHAIN</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>{finding.title}</h1>
          <p className="muted mono" style={{ margin: "0.3rem 0 0", fontSize: "0.78rem" }}>
            {finding.id} · {program?.name} · asset {asset?.canonicalLocator ?? "n/a"} · detector {finding.sourceDetector}
          </p>
        </div>
        <div className="row">
          <span className={`badge sev-${finding.severity}`}>{finding.severity}</span>
          <span className="badge info">{finding.status.replace("_", " ")}</span>
          <span className={`badge ${finding.validationStatus === "VALIDATED" ? "ok" : "warn"}`}>{finding.validationStatus}</span>
        </div>
      </div>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>TECHNICAL ANALYSIS &amp; LIFECYCLE CONTROLS</span>
      </div>

      <div
        className="row"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-ink)",
          borderRadius: 14,
          padding: "0.65rem 1rem",
          marginBottom: "1.15rem",
          boxShadow: "var(--shadow-press-sm)",
          justifyContent: "space-between",
        }}
        aria-label="Finding lifecycle pipeline"
      >
        {["PROPOSED", "OBSERVED", "REPRODUCED", "REVIEWED", "REPORTED", "ACCEPTED", "CLOSED"].map((step, i, arr) => {
          const active = finding.status === step;
          return (
            <span key={step} className="row" style={{ gap: "0.45rem" }}>
              <span className={`badge ${active ? "accent" : "neutral"}`}>
                {step === "REPORTED" && finding.validationStatus !== "VALIDATED" ? "🔒 " : ""}
                {step}
              </span>
              {i < arr.length - 1 && <span className="mono faint">→</span>}
            </span>
          );
        })}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div>
          <div className="card">
            <h2>Description</h2>
            <p style={{ fontSize: "0.92rem" }}>{finding.description}</p>
            <dl className="kv" style={{ marginTop: "0.9rem" }}>
              <dt>Expected behavior</dt>
              <dd>{finding.expectedBehavior || "—"}</dd>
              <dt>Observed behavior</dt>
              <dd>{finding.observedBehavior || "—"}</dd>
              <dt>Impact</dt>
              <dd>{finding.impact || "—"}</dd>
              <dt>Limitations</dt>
              <dd>{finding.limitations || "—"}</dd>
              <dt>Remediation</dt>
              <dd>{finding.remediation || "—"}</dd>
              <dt>Confidence</dt>
              <dd className="mono">{finding.confidence.toFixed(2)}</dd>
            </dl>
            <h2 style={{ marginTop: "1.2rem" }}>Reproduction steps</h2>
            <ol style={{ fontSize: "0.88rem", margin: 0, paddingLeft: "1.2rem" }}>
              {(JSON.parse(finding.reproductionJson) as string[]).map((r, i) => (
                <li key={i} className="mono" style={{ marginBottom: "0.3rem" }}>
                  {r}
                </li>
              ))}
            </ol>
          </div>

          <div className="card">
            <h2>Immutable status history</h2>
            <table className="data">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Actor</th>
                  <th>Reason</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{h.fromStatus || "—"}</td>
                    <td className="mono">
                      <strong>{h.toStatus}</strong>
                    </td>
                    <td className="mono" style={{ fontSize: "0.72rem" }}>
                      {h.actorId}
                    </td>
                    <td style={{ fontSize: "0.8rem" }}>{h.reason || "—"}</td>
                    <td className="faint" style={{ fontSize: "0.72rem" }}>
                      {h.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Lifecycle actions</h2>
            {canReview ? (
              allowedNext.length > 0 ? (
                <FindingActions findingId={finding.id} allowedNext={allowedNext} isValidator={isValidator} />
              ) : (
                <p className="empty">Terminal status — no further transitions.</p>
              )
            ) : (
              <p className="empty">Your role ({role}) cannot review findings.</p>
            )}
          </div>

          <div className="card">
            <h2>Evidence ({evidenceRows.length})</h2>
            {evidenceRows.length === 0 ? (
              <p className="empty">No evidence linked. Findings require traceable evidence.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Evidence</th>
                    <th>Sensitivity</th>
                    <th>Redaction</th>
                  </tr>
                </thead>
                <tbody>
                  {evidenceRows.map(({ role: r, meta }) =>
                    meta ? (
                      <tr key={meta.id}>
                        <td>
                          <span className="badge neutral">{r}</span>
                        </td>
                        <td className="mono" style={{ fontSize: "0.72rem" }}>
                          {meta.id}
                          <div className="faint">sha256 {meta.sha256.slice(0, 16)}…</div>
                        </td>
                        <td>
                          <span className="badge warn">{meta.sensitivity}</span>
                        </td>
                        <td className="mono" style={{ fontSize: "0.68rem" }}>
                          {meta.redactionStatus}
                        </td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
