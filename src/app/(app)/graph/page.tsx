import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/session";
import GraphExplorer from "./GraphExplorer";

export const dynamic = "force-dynamic";

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const principal = await currentPrincipal();
  if (!principal?.orgId) redirect("/login");
  const sp = await searchParams;
  const assets = await db.asset.findMany({
    where: { orgId: principal.orgId },
    select: { id: true, canonicalLocator: true, scopeState: true },
    orderBy: { canonicalLocator: "asc" },
  });
  const nodesCount = await db.graphEdge.count({ where: { orgId: principal.orgId } });

  return (
    <div>
      <div className="row spread" style={{ marginBottom: "0.4rem" }}>
        <div>
          <div className="mono-label">TOPOLOGY PROJECTION // PROVENANCE GRAPH</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>Application knowledge graph</h1>
        </div>
        <span className="badge accent">{nodesCount} PROJECTED EDGES</span>
      </div>
      <p className="muted" style={{ marginTop: "0.25rem" }}>
        Relationship projection with provenance — {nodesCount} edges. Edge types: IN_SCOPE_OF, HOSTS, EXPOSES, CALLS, HAS_ROLE, BELONGS_TO, OWNS, CAN_ACCESS, TRANSITIONS_TO, EVIDENCED_BY, SUPPORTS, CONTRADICTS.
        Inferred association is never treated as testing authorization.
      </p>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>RADIAL RELATIONSHIP INSTRUMENT</span>
      </div>

      <GraphExplorer assets={assets} initialAssetId={sp.asset ?? assets[0]?.id ?? null} />
    </div>
  );
}
