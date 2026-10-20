import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { ApiAction } from "@/components/ApiAction";

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
  const canRunDifferential = roleHas(principal.role!, "campaign:write");
  const programs = await db.program.findMany({ where: { orgId: principal.orgId } });

  return (
    <div>
      <h1 style={{ fontSize: "1.2rem" }}>Findings</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Lifecycle: PROPOSED → OBSERVED → REPRODUCED → REVIEWED → REPORTED → ACCEPTED → CLOSED (+ REJECTED / DUPLICATE / FALSE_POSITIVE).
        AI hypotheses and scanner alerts remain <strong>candidates</strong> until independent validation.
      </p>

      <div className="row" style={{ marginBottom: "0.8rem" }}>
        <Link href="/findings" className={`badge ${!sp.status && !sp.severity ? "accent" : "neutral"}`}>all</Link>
        {["PROPOSED", "OBSERVED", "REPRODUCED", "REVIEWED", "REPORTED", "ACCEPTED", "CLOSED", "FALSE_POSITIVE"].map((s) => (
          <Link key={s} href={`/findings?status=${s}`} className={`badge ${sp.status === s ? "accent" : "neutral"}`}>{s.replace("_", " ")}</Link>
        ))}
      </div>

      {canRunDifferential && programs.length > 0 && (
        <div className="row" style={{ marginBottom: "0.8rem" }}>
          <ApiAction
            label="Run differential authorization fixtures (BOLA/BFLA)"
            method="POST"
            url="/api/v1/findings"
            body={{ program_id: programs[0].id, run_differential_fixtures: true, title: "fixture batch", description: "fixture batch execution", category: "BOLA", severity: "HIGH", confidence: 0.5 }}
            className="btn"
            confirmText="Run seeded BOLA/BFLA fixtures and create candidate findings?"
          />
          <span className="hint" style={{ margin: 0 }}>Deterministic local fixtures — no network traffic.</span>
        </div>
      )}

      <div className="card">
        {findings.length === 0 ? <p className="empty">No findings match the filter.</p> : (
          <table className="data">
            <thead>
              <tr><th>Finding</th><th>Severity</th><th>Category</th><th>Status</th><th>Validation</th><th>Confidence</th></tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={`/findings/${f.id}`}><strong>{f.title.slice(0, 64)}</strong></Link>
                    <div className="faint mono" style={{ fontSize: "0.7rem" }}>{f.id} · {f.sourceDetector}</div>
                  </td>
                  <td><span className={`badge sev-${f.severity}`}>{f.severity}</span></td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>{f.category}</td>
                  <td><span className={`badge ${["CLOSED", "ACCEPTED"].includes(f.status) ? "ok" : f.status === "REPORTED" ? "accent" : ["REJECTED", "FALSE_POSITIVE", "DUPLICATE"].includes(f.status) ? "neutral" : "info"}`}>{f.status.replace("_", " ")}</span></td>
                  <td><span className={`badge ${f.validationStatus === "VALIDATED" ? "ok" : f.validationStatus === "REFUTED" ? "danger" : "warn"}`}>{f.validationStatus}</span></td>
                  <td>{f.confidence.toFixed(2)}</td>
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
