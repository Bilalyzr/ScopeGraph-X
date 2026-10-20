import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { ApiAction } from "@/components/ApiAction";
import { BackLink } from "@/components/BackLink";
import { ChangeList } from "@/components/ChangeList";

export const dynamic = "force-dynamic";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const { id } = await params;
  const asset = await db.asset.findFirst({ where: { id, orgId: principal.orgId } });
  if (!asset) notFound();

  const observations = await db.assetObservation.findMany({ where: { assetId: asset.id }, orderBy: { observedAt: "desc" }, take: 15 });
  const assetChanges = await db.assetChange.findMany({ where: { assetId: asset.id }, orderBy: { id: "desc" }, take: 10 });
  const endpoints = await db.endpoint.findMany({ where: { assetId: asset.id } });
  const program = await db.program.findUnique({ where: { id: asset.programId } });
  const canAuthorize = roleHas(principal.role!, "asset:write");

  return (
    <div>
      <BackLink href="/assets" label="Asset inventory" />
      <div className="row spread">
        <div>
          <div className="mono-label">ASSET DOSSIER // PROVENANCE &amp; LADDER</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>{asset.canonicalLocator}</h1>
          <p className="muted mono" style={{ margin: "0.3rem 0 0", fontSize: "0.82rem" }}>
            {asset.assetType} · <Link href={`/programs/${asset.programId}`}>{program?.name}</Link> · confidence {asset.confidence.toFixed(2)}
          </p>
        </div>
        <span className={`badge scope-${asset.scopeState}`}>{asset.scopeState.replace("_", " ")}</span>
      </div>

      {asset.authorizationNote && <p className="hint">Authorization note: {asset.authorizationNote}</p>}

      {canAuthorize && (
        <>
          <div className="section-label">
            <span className="section-label-num">01</span>
            <span>EXPLICIT AUTHORIZATION LADDER</span>
          </div>
          <div className="card">
            <h2>Authorization decision (explicit, audited)</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Ladder: DISCOVERED → OWNERSHIP_VERIFIED → AUTHORIZED. A deliberate human decision is required at each step; discovery alone can never authorize testing.
            </p>
            <div
              className="row"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border-ink)",
                borderRadius: 12,
                padding: "0.6rem 0.9rem",
                marginBottom: "0.9rem",
                justifyContent: "space-between",
              }}
            >
              <span className={`badge ${asset.scopeState === "DISCOVERED" || asset.scopeState === "ASSOCIATED" ? "accent" : "ok"}`}>
                01 DISCOVERED
              </span>
              <span className="mono faint">──▶</span>
              <span
                className={`badge ${
                  asset.scopeState === "OWNERSHIP_VERIFIED"
                    ? "accent"
                    : asset.scopeState === "AUTHORIZED"
                      ? "ok"
                      : "neutral"
                }`}
              >
                02 OWNERSHIP VERIFIED
              </span>
              <span className="mono faint">──▶</span>
              <span className={`badge ${asset.scopeState === "AUTHORIZED" ? "ok" : asset.scopeState === "DENIED" ? "danger" : "neutral"}`}>
                {asset.scopeState === "DENIED" ? "03 DENIED (EXCLUDED)" : "03 AUTHORIZED FOR TESTING"}
              </span>
            </div>
            <div className="row">
              {asset.scopeState !== "OWNERSHIP_VERIFIED" && asset.scopeState !== "AUTHORIZED" && (
                <ApiAction
                  label="Mark ownership verified"
                  method="PATCH"
                  url={`/api/v1/assets/${asset.id}`}
                  body={{ scope_state: "OWNERSHIP_VERIFIED", authorization_note: "Ownership verification recorded from UI" }}
                  className="btn small"
                />
              )}
              {asset.scopeState === "OWNERSHIP_VERIFIED" && (
                <ApiAction
                  label="Authorize for active testing"
                  method="PATCH"
                  url={`/api/v1/assets/${asset.id}`}
                  body={{ scope_state: "AUTHORIZED", authorization_note: "Explicit testing authorization recorded from UI" }}
                  className="btn small primary"
                  confirmText={`Authorize ${asset.canonicalLocator} for policy-gated active testing?`}
                />
              )}
              {asset.scopeState !== "DENIED" && (
                <ApiAction
                  label="Mark out-of-scope (DENIED)"
                  method="PATCH"
                  url={`/api/v1/assets/${asset.id}`}
                  body={{ scope_state: "DENIED", authorization_note: "Excluded from testing" }}
                  className="btn small danger"
                  confirmText="Exclude this asset from all active testing?"
                />
              )}
            </div>
          </div>
        </>
      )}

      <div className="section-label">
        <span className="section-label-num">02</span>
        <span>OBSERVATIONS, DIFFS &amp; ENDPOINTS</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.15fr 0.85fr" }}>
        <div className="card">
          <div className="row spread">
            <h2 style={{ margin: 0 }}>Observations (provenance)</h2>
            {canAuthorize && (
              <ApiAction
                label="Capture snapshot / diff"
                method="POST"
                url="/api/v1/changes"
                body={{ asset_id: asset.id }}
                className="btn small"
              />
            )}
          </div>
          <h3 className="mono-label" style={{ margin: "1rem 0 0.5rem" }}>
            Detected changes
          </h3>
          {assetChanges.length === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              No changes recorded. “Capture snapshot / diff” stores the current surface; later captures diff against it.
            </p>
          ) : (
            <ChangeList changes={assetChanges} />
          )}
          <h3 className="mono-label" style={{ margin: "1.2rem 0 0.5rem" }}>
            Observation history
          </h3>
          {observations.length === 0 ? (
            <p className="empty">No observations recorded.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Observed</th>
                  <th>Confidence</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="badge info">{o.source}</span>
                    </td>
                    <td className="faint" style={{ fontSize: "0.75rem" }}>
                      {o.observedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="mono">{o.confidence.toFixed(2)}</td>
                    <td className="mono" style={{ fontSize: "0.72rem", maxWidth: 260 }}>
                      {o.note || JSON.stringify(JSON.parse(o.payloadJson)).slice(0, 80)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Endpoints ({endpoints.length})</h2>
          {endpoints.length === 0 ? (
            <p className="empty">No normalized endpoints.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Route template</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => {
                  const m = e.method.toUpperCase();
                  const methodBadge =
                    m === "GET" ? "ok" : m === "POST" ? "info" : m === "DELETE" ? "danger" : "warn";
                  return (
                    <tr key={e.id}>
                      <td>
                        <span className={`badge ${methodBadge}`}>{m}</span>
                      </td>
                      <td className="mono">{e.routeTemplate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <h2 style={{ marginTop: "1.3rem" }}>Knowledge Graph</h2>
          <Link href={`/graph?asset=${asset.id}`} className="btn small" style={{ marginTop: "0.3rem" }}>
            Explore relationships in the knowledge graph →
          </Link>
        </div>
      </div>
    </div>
  );
}
