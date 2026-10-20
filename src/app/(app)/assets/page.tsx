import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import { roleHas } from "@/lib/rbac";
import { ImportAssetForm } from "./ImportAssetForm";
import { ChangeFeed } from "./ChangeFeed";

export const dynamic = "force-dynamic";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ scope_state?: string; program_id?: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const sp = await searchParams;

  const assets = await db.asset.findMany({
    where: {
      orgId: principal.orgId,
      ...(sp.scope_state ? { scopeState: sp.scope_state } : {}),
      ...(sp.program_id ? { programId: sp.program_id } : {}),
    },
    orderBy: { lastSeenAt: "desc" },
  });
  const programs = await db.program.findMany({ where: { orgId: principal.orgId } });
  const states = ["AUTHORIZED", "OWNERSHIP_VERIFIED", "ASSOCIATED", "DISCOVERED", "DENIED"];
  const canWrite = roleHas(principal.role, "asset:write");

  return (
    <div>
      <div className="row spread" style={{ marginBottom: "0.4rem" }}>
        <div>
          <div className="mono-label">SURFACE PROVENANCE // AUTHORIZATION LADDER</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>Asset inventory</h1>
        </div>
        <span className="badge accent">{assets.length} ASSETS IN VIEW</span>
      </div>
      <p className="muted" style={{ marginTop: "0.25rem" }}>
        Passive observations with source provenance. An asset never becomes authorized for active testing merely because it appears related to an in-scope asset.
      </p>

      <div className="row" style={{ marginBottom: "0.9rem" }}>
        <Link href="/assets" className={`badge ${!sp.scope_state ? "accent" : "neutral"}`}>
          all
        </Link>
        {states.map((s) => (
          <Link key={s} href={`/assets?scope_state=${s}`} className={`badge ${sp.scope_state === s ? "accent" : "neutral"}`}>
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      {canWrite && <ImportAssetForm programs={programs.map((p) => ({ id: p.id, name: p.name }))} />}

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>CANONICAL ASSET LEDGER</span>
      </div>

      <div className="card">
        {assets.length === 0 ? (
          <p className="empty">No assets match. Run a passive discovery campaign or import one manually.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Locator</th>
                <th>Type</th>
                <th>Scope state</th>
                <th>Confidence</th>
                <th>Program</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const program = programs.find((p) => p.id === a.programId);
                return (
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
                    <td className="mono">
                      <span>{a.confidence.toFixed(2)}</span>{" "}
                      <span style={{ color: "var(--green)", letterSpacing: "1px", fontSize: "0.7rem" }} aria-hidden="true">
                        {"●".repeat(Math.max(1, Math.round(a.confidence * 4)))}
                        <span style={{ color: "var(--border)" }}>{"●".repeat(4 - Math.max(1, Math.round(a.confidence * 4)))}</span>
                      </span>
                    </td>
                    <td>{program?.name ?? "—"}</td>
                    <td className="faint" style={{ fontSize: "0.75rem" }}>
                      {a.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-label">
        <span className="section-label-num">02</span>
        <span>SURFACE DRIFT &amp; CHANGE FEED</span>
      </div>

      <ChangeFeed orgId={principal.orgId} />
    </div>
  );
}
