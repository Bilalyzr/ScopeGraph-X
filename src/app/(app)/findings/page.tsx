import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function FindingsPage({ searchParams }: { searchParams: Promise<{ status?: string; severity?: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const sp = await searchParams;

  const findings = await db.finding.findMany({
    where: {
      orgId: principal.orgId,
      ...(sp.status ? { status: sp.status } : {}),
      ...(sp.severity ? { severity: sp.severity } : {}),
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const canReview = roleHas(principal.role!, "finding:review");

  return (
    <div>
      <div className="row spread" style={{ marginBottom: "0.4rem" }}>
        <div>
          <div className="mono-label">EVIDENCE-CITED LIFECYCLE // VALIDATOR GATED</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>Findings</h1>
        </div>
        <span className="badge accent">{findings.length} FINDINGS</span>
      </div>
      <p className="muted" style={{ marginTop: "0.25rem" }}>
        Lifecycle: PROPOSED → OBSERVED → REPRODUCED → REVIEWED → REPORTED → ACCEPTED → CLOSED (+ REJECTED / DUPLICATE / FALSE_POSITIVE).
        AI hypotheses and scanner alerts remain <strong>candidates</strong> until independent validation.
      </p>

      <div className="row" style={{ marginBottom: "0.5rem" }}>
        <span className="mono-label" style={{ marginRight: "0.25rem" }}>STATUS:</span>
        <Link href={sp.severity ? `/findings?severity=${sp.severity}` : "/findings"} className={`badge ${!sp.status ? "accent" : "neutral"}`}>
          all
        </Link>
        {["PROPOSED", "OBSERVED", "REPRODUCED", "REVIEWED", "REPORTED", "ACCEPTED", "CLOSED", "FALSE_POSITIVE"].map((s) => (
          <Link
            key={s}
            href={`/findings?status=${s}${sp.severity ? `&severity=${sp.severity}` : ""}`}
            className={`badge ${sp.status === s ? "accent" : "neutral"}`}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>
      <div className="row" style={{ marginBottom: "0.9rem" }}>
        <span className="mono-label" style={{ marginRight: "0.25rem" }}>SEVERITY:</span>
        <Link href={sp.status ? `/findings?status=${sp.status}` : "/findings"} className={`badge ${!sp.severity ? "accent" : "neutral"}`}>
          all
        </Link>
        {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((sev) => (
          <Link
            key={sev}
            href={`/findings?severity=${sev}${sp.status ? `&status=${sp.status}` : ""}`}
            className={`badge ${sp.severity === sev ? "accent" : `sev-${sev}`}`}
          >
            {sev}
          </Link>
        ))}
      </div>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>FINDING TRIAGE &amp; VALIDATION LEDGER</span>
      </div>

      <div className="card">
        {findings.length === 0 ? (
          <p className="empty">No findings match the filter.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Finding</th>
                <th>Severity</th>
                <th>Category</th>
                <th>Status</th>
                <th>Validation</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={`/findings/${f.id}`}>
                      <strong>{f.title.slice(0, 64)}</strong>
                    </Link>
                    <div className="faint mono" style={{ fontSize: "0.7rem" }}>
                      {f.id} · {f.sourceDetector}
                    </div>
                  </td>
                  <td>
                    <span className={`badge sev-${f.severity}`}>{f.severity}</span>
                  </td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>
                    {f.category}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        ["CLOSED", "ACCEPTED"].includes(f.status)
                          ? "ok"
                          : f.status === "REPORTED"
                            ? "accent"
                            : ["REJECTED", "FALSE_POSITIVE", "DUPLICATE"].includes(f.status)
                              ? "neutral"
                              : "info"
                      }`}
                    >
                      {f.status.replace("_", " ")}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        f.validationStatus === "VALIDATED"
                          ? "ok"
                          : f.validationStatus === "REFUTED"
                            ? "danger"
                            : "warn"
                      }`}
                    >
                      {f.validationStatus}
                    </span>
                  </td>
                  <td className="mono">{f.confidence.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!canReview && <p className="hint">Your role can view findings; review actions need the VALIDATOR / APPSEC_LEAD / PROGRAM_OWNER roles.</p>}
    </div>
  );
}
