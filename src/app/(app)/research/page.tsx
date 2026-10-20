import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { ApiAction } from "@/components/ApiAction";
import { ProposeTestForm } from "./ProposeTestForm";
import { CorrelationsPanel } from "./CorrelationsPanel";
import { InvariantPanel } from "./InvariantPanel";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const hypotheses = await db.hypothesis.findMany({ where: { orgId: principal.orgId }, orderBy: { createdAt: "desc" }, take: 30 });
  const tests = await db.test.findMany({ where: { orgId: principal.orgId }, orderBy: { createdAt: "desc" }, take: 30 });
  const programs = await db.program.findMany({ where: { orgId: principal.orgId } });
  const externalFindings = await db.externalFinding.findMany({ where: { orgId: principal.orgId }, orderBy: { importedAt: "desc" }, take: 50 });
  const resources = await db.resource.findMany({
    where: { programId: { in: programs.map((p) => p.id) } },
  });
  const canPropose = roleHas(principal.role, "test:propose");
  const canApprove = roleHas(principal.role, "test:approve");
  const canImportExternal = roleHas(principal.role, "finding:review");

  return (
    <div>
      <h1 style={{ fontSize: "1.2rem" }}>Hypotheses & tests<span className="demo-tag">mock AI provider</span></h1>
      <p className="muted" style={{ marginTop: 0 }}>
        AI is an evidence-grounded research assistant. Its output is schema-validated, cited to evidence, independently critiqued, and can never authorize testing or confirm findings — tests need a separate human approver, and findings a validator.
      </p>

      <div className="card">
        <h2>Hypotheses ({hypotheses.length})</h2>
        {hypotheses.length === 0 ? (
          <p className="empty">No hypotheses. Run a campaign with the AI hypothesis pass, or seed data.</p>
        ) : (
          <table className="data">
            <thead><tr><th>Category / summary</th><th>Confidence</th><th>Status</th><th>Model</th><th>Evidence refs</th></tr></thead>
            <tbody>
              {hypotheses.map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.category}</strong> — {h.summary}
                    <div className="faint" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                      Assumptions: {(JSON.parse(h.assumptionsJson) as string[]).length} · Alternatives: {(JSON.parse(h.alternativeExplanationsJson) as string[]).length}
                    </div>
                    <div className="mono faint" style={{ fontSize: "0.68rem" }}>{h.id}</div>
                  </td>
                  <td>{h.confidence.toFixed(2)}</td>
                  <td><span className={`badge ${h.status === "SUPPORTED" ? "ok" : h.status === "DOWNGRADED" || h.status === "REJECTED" ? "danger" : "info"}`}>{h.status}</span></td>
                  <td className="mono" style={{ fontSize: "0.7rem" }}>{h.modelVersion}</td>
                  <td className="mono" style={{ fontSize: "0.7rem" }}>{(JSON.parse(h.evidenceRefsJson) as string[]).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Tests ({tests.length})</h2>
        {tests.length === 0 ? <p className="empty">No test plans proposed.</p> : (
          <table className="data">
            <thead><tr><th>Plan</th><th>Oracle</th><th>Status</th><th>Proposed by</th><th>Actions</th></tr></thead>
            <tbody>
              {tests.map((t) => {
                const plan = JSON.parse(t.planJson) as { target_host?: string; method?: string; target_path?: string };
                return (
                  <tr key={t.id}>
                    <td className="mono" style={{ fontSize: "0.75rem" }}>{plan.method} {plan.target_host}{plan.target_path}</td>
                    <td className="mono" style={{ fontSize: "0.75rem" }}>{t.oracleId}</td>
                    <td><span className={`badge ${t.status === "EXECUTED" ? "ok" : t.status === "REJECTED" ? "danger" : t.status === "APPROVED" ? "accent" : "info"}`}>{t.status}</span></td>
                    <td className="mono" style={{ fontSize: "0.7rem" }}>{t.proposedBy}</td>
                    <td>
                      {t.status === "PROPOSED" && canApprove && (
                        <div className="row">
                          <ApiAction
                            label="Approve (simulated execution)"
                            method="POST"
                            url={`/api/v1/tests/${t.id}:approve`}
                            body={{ decision: "APPROVE", reason: "Approved from research screen" }}
                            className="btn small primary"
                            confirmText="Approve this constrained test? Execution is simulated (no real egress); results are recorded as evidence."
                          />
                          <ApiAction label="Reject" method="POST" url={`/api/v1/tests/${t.id}:approve`} body={{ decision: "REJECT", reason: "Out of policy" }} className="btn small" />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {canPropose && hypotheses.length > 0 && <ProposeTestForm hypothesisId={hypotheses[0].id} />}
      </div>

      <InvariantPanel
        resources={resources.map((r) => ({
          id: r.id,
          objectType: r.objectType,
          fixtureRef: r.fixtureRef,
          machine: JSON.parse(r.invariantJson || '{"initialState":"","transitions":[]}'),
        }))}
        canRun={canPropose}
      />

      {canImportExternal ? (
        <CorrelationsPanel
          programs={programs.map((p) => ({ id: p.id, name: p.name }))}
          rows={externalFindings.map((f) => ({
            id: f.id, tool: f.tool, rule: f.rule, locator: f.locator, cwe: f.cwe,
            severity: f.severity, correlationStatus: f.correlationStatus, correlatedFindingId: f.correlatedFindingId,
          }))}
        />
      ) : (
        <div className="card">
          <h2>SAST/SCA correlation</h2>
          <p className="empty">Importing static-analysis results requires the finding:review permission.</p>
        </div>
      )}
    </div>
  );
}
