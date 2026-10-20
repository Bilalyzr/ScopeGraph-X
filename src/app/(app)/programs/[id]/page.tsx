import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { explainMatch } from "@/lib/policy/matcher";
import { parseRules } from "@/lib/policy/rules";
import { ApiAction } from "@/components/ApiAction";
import { ProposeScopeForm } from "./ProposeScopeForm";
import { OpenApiImportForm } from "./OpenApiImportForm";
import { BackLink } from "@/components/BackLink";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "ok",
  APPROVED: "info",
  PROPOSED: "neutral",
  SUPERSEDED: "warn",
  REVOKED: "danger",
  REJECTED: "danger",
};

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const { id } = await params;
  const program = await db.program.findFirst({ where: { id, orgId: principal.orgId } });
  if (!program) notFound();

  const versions = await db.scopeVersion.findMany({ where: { programId: program.id }, orderBy: { version: "desc" } });
  const assets = await db.asset.findMany({ where: { programId: program.id } });
  const campaigns = await db.campaign.findMany({ where: { programId: program.id }, orderBy: { createdAt: "desc" }, take: 5 });
  const canScopeWrite = roleHas(principal.role!, "scope:write");
  const canApprove = roleHas(principal.role!, "scope:approve");

  return (
    <div>
      <BackLink href="/programs" label="All programs" />
      <div className="row spread">
        <div>
          <div className="mono-label">PROGRAM DOSSIER // POLICY LEDGER</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>{program.name}</h1>
          <p className="muted mono" style={{ margin: "0.3rem 0 0", fontSize: "0.8rem" }}>
            {program.id} · {program.provider}/{program.handle} · authorization: {program.authorizationRef}
          </p>
        </div>
        <span className={`badge ${program.state === "ACTIVE" ? "ok" : "neutral"}`}>{program.state}</span>
      </div>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>SCOPE POLICY VERSIONS</span>
      </div>

      <div className="card">
        <h2>Scope policy versions</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Deny rules override allow rules. Activation requires a different user than the proposer (segregation of duties).
        </p>
        {versions.length === 0 && <p className="empty">No scope versions proposed yet.</p>}
        {versions.map((v) => {
          const rules = parseRules(v.rulesJson);
          return (
            <div
              key={v.id}
              style={{
                border: "1px solid var(--border-ink)",
                background: "var(--bg)",
                borderRadius: 16,
                padding: "1rem 1.2rem",
                marginBottom: "0.9rem",
              }}
            >
              <div className="row spread">
                <div className="row">
                  <strong style={{ color: "var(--ink)" }}>Version {v.version}</strong>
                  <span className={`badge ${STATUS_BADGE[v.status] ?? "neutral"}`}>{v.status}</span>
                  <span className="faint mono" style={{ fontSize: "0.72rem" }}>
                    {v.id}
                  </span>
                </div>
                <div className="row">
                  {v.status === "PROPOSED" && canApprove && (
                    <ApiAction label="Approve" method="POST" url={`/api/v1/scope-versions/${v.id}:approve`} className="btn small" />
                  )}
                  {v.status === "APPROVED" && canApprove && (
                    <ApiAction
                      label="Activate"
                      method="POST"
                      url={`/api/v1/scope-versions/${v.id}:activate`}
                      className="btn small primary"
                      confirmText={`Activate policy v${v.version}? Active testing becomes possible within these rules.`}
                    />
                  )}
                  {v.status === "ACTIVE" && canApprove && (
                    <ApiAction
                      label="Revoke"
                      method="POST"
                      url={`/api/v1/scope-versions/${v.id}:revoke`}
                      body={{ reason: "Revoked from program screen" }}
                      className="btn small danger"
                      confirmText="Revoke this policy? Queued jobs are cancelled and new active operations are rejected (409 POLICY_REVOKED)."
                    />
                  )}
                </div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "0.75rem" }}>
                <div>
                  <div className="mono-label" style={{ marginBottom: "0.25rem" }}>
                    Allow rules
                  </div>
                  {rules.allow.map((a, i) => (
                    <div key={i} className="mono" style={{ fontSize: "0.78rem" }}>
                      {a.methods.join(",")} <strong>{a.host}</strong>
                      {a.paths.join(",")}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mono-label" style={{ marginBottom: "0.25rem" }}>
                    Deny rules (override)
                  </div>
                  {rules.deny.length === 0 && (
                    <div className="mono" style={{ fontSize: "0.78rem" }}>
                      —
                    </div>
                  )}
                  {rules.deny.map((d, i) => (
                    <div key={i} className="mono" style={{ fontSize: "0.78rem", color: "var(--danger)" }}>
                      DENY <strong>{d.host}</strong> — {d.reason}
                    </div>
                  ))}
                </div>
              </div>
              <div className="row" style={{ marginTop: "0.65rem", fontSize: "0.78rem" }}>
                <span className="badge neutral">
                  budget: {rules.budgets.max_requests} req · {rules.budgets.max_rps} rps · conc {rules.budgets.max_concurrency}
                </span>
                {v.activatedAt && (
                  <span className="faint">activated {v.activatedAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                )}
                {v.revokedReason && <span className="badge danger">revoked: {v.revokedReason}</span>}
              </div>
              {rules.allow[0] && (
                <div className="hint">
                  Matcher check — <code className="inline">{rules.allow[0].methods[0] ?? "GET"} {rules.allow[0].host}{rules.allow[0].paths[0] ?? "/"}</code>:{" "}
                  {explainMatch(rules, {
                    host: rules.allow[0].host,
                    path: rules.allow[0].paths[0] ?? "/",
                    method: rules.allow[0].methods[0] ?? "GET",
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(canScopeWrite || roleHas(principal.role!, "asset:write")) && (
        <>
          <div className="section-label">
            <span className="section-label-num">02</span>
            <span>POLICY COMPILER &amp; SCHEMA INGESTION</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {canScopeWrite && (
              <div className="card">
                <ProposeScopeForm programId={program.id} />
              </div>
            )}
            {roleHas(principal.role!, "asset:write") && (
              <div className="card">
                <OpenApiImportForm programId={program.id} assets={assets.map((a) => ({ id: a.id, locator: a.canonicalLocator }))} />
              </div>
            )}
          </div>
        </>
      )}

      <div className="section-label">
        <span className="section-label-num">03</span>
        <span>PROGRAM ASSETS &amp; CAMPAIGNS</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h2>Assets in program ({assets.length})</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Locator</th>
                <th>Type</th>
                <th>Scope state</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/assets/${a.id}`} className="mono">
                      {a.canonicalLocator}
                    </Link>
                  </td>
                  <td className="mono">{a.assetType}</td>
                  <td>
                    <span className={`badge scope-${a.scopeState}`}>{a.scopeState.replace("_", " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Recent campaigns</h2>
          {campaigns.length === 0 ? (
            <p className="empty">None yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mode</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/campaigns/${c.id}`}>{c.name}</Link>
                    </td>
                    <td className="mono" style={{ fontSize: "0.75rem" }}>
                      {c.mode}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          c.state === "RUNNING" ? "info" : c.state === "COMPLETED" ? "ok" : "neutral"
                        }`}
                      >
                        {c.state}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
