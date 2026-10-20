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
      <h1 style={{ fontSize: "1.2rem" }}>Application knowledge graph</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Relationship projection with provenance — {nodesCount} edges. Edge types: IN_SCOPE_OF, HOSTS, EXPOSES, CALLS, HAS_ROLE, BELONGS_TO, OWNS, CAN_ACCESS, TRANSITIONS_TO, EVIDENCED_BY, SUPPORTS, CONTRADICTS.
        Inferred association is never treated as testing authorization.
      </p>
      <GraphExplorer assets={assets} initialAssetId={sp.asset ?? assets[0]?.id ?? null} />
    </div>
  );
}
