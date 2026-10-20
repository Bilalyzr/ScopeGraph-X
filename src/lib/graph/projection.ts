import { db } from "@/lib/db";
import { newId } from "@/lib/ids";

// Graph projection from PostgreSQL/SQLite records (PRD §F, FR-GRF-01): a
// replaceable adapter — a dedicated graph DB would implement the same queries.
// Every edge keeps provenance (observation id), confidence and policy context.

export async function addEdge(input: {
  orgId: string;
  sourceType: string;
  sourceId: string;
  relation: string;
  targetType: string;
  targetId: string;
  observationId?: string;
  confidence?: number;
  policyContext?: string;
}) {
  return db.graphEdge.upsert({
    where: {
      sourceType_sourceId_relation_targetType_targetId: {
        sourceType: input.sourceType, sourceId: input.sourceId, relation: input.relation,
        targetType: input.targetType, targetId: input.targetId,
      },
    },
    create: {
      id: newId("ged"),
      orgId: input.orgId,
      sourceType: input.sourceType, sourceId: input.sourceId,
      relation: input.relation,
      targetType: input.targetType, targetId: input.targetId,
      observationId: input.observationId,
      confidence: input.confidence ?? 0.5,
      policyContext: input.policyContext ?? "",
    },
    update: { confidence: input.confidence ?? 0.5 },
  });
}

export interface GraphNodeDto {
  type: string;
  id: string;
  label: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdgeDto {
  id: string;
  source: GraphNodeDto;
  target: GraphNodeDto;
  relation: string;
  confidence: number;
  observationId?: string;
  policyContext: string;
}

const LABELS: Record<string, (row: Record<string, unknown>) => string> = {
  Program: (r) => String(r.name ?? r.id),
  Asset: (r) => String(r.canonicalLocator ?? r.id),
  Endpoint: (r) => `${r.method} ${r.routeTemplate}`,
  Identity: (r) => `${r.roleLabel}@${r.tenantLabel || "default"}`,
  Finding: (r) => String(r.title ?? r.id),
  Hypothesis: (r) => String(r.summary ?? r.id).slice(0, 60),
  Test: (r) => `test ${r.id}`,
};

async function loadNode(type: string, id: string, orgId: string): Promise<GraphNodeDto | null> {
  const table = {
    Program: db.program, Asset: db.asset, Endpoint: db.endpoint,
    Identity: db.identity, Finding: db.finding, Hypothesis: db.hypothesis, Test: db.test,
  }[type];
  if (!table) return null;
  const row = (await (table as typeof db.program).findUnique({ where: { id } })) as Record<string, unknown> | null;
  if (!row) return null;
  // Tenant guard for graph traversal (cross-tenant graph queries are denied).
  const rowOrg = row.orgId ?? (row.programId ? await orgOfProgram(String(row.programId)) : null);
  if (rowOrg !== orgId) return null;
  return { type, id, label: (LABELS[type] ?? ((r) => String(r.id)))(row), meta: { status: row.status ?? row.scopeState } };
}

async function orgOfProgram(programId: string): Promise<string | null> {
  const p = await db.program.findUnique({ where: { id: programId }, select: { orgId: true } });
  return p?.orgId ?? null;
}

/** Neighbors of a node with tenant filtering — one hop by default. */
export async function neighbors(orgId: string, type: string, id: string, depth = 1): Promise<{ nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }> {
  const start = await loadNode(type, id, orgId);
  if (!start) return { nodes: [], edges: [] };
  const nodes = new Map<string, GraphNodeDto>([[`${type}:${id}`, start]]);
  const edges: GraphEdgeDto[] = [];
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    const next: GraphNodeDto[] = [];
    for (const n of frontier) {
      const outRows = await db.graphEdge.findMany({ where: { orgId, sourceType: n.type, sourceId: n.id } });
      const inRows = await db.graphEdge.findMany({ where: { orgId, targetType: n.type, targetId: n.id } });
      for (const row of [...outRows, ...inRows]) {
        const src = nodes.get(`${row.sourceType}:${row.sourceId}`) ?? (await loadNode(row.sourceType, row.sourceId, orgId));
        const tgt = nodes.get(`${row.targetType}:${row.targetId}`) ?? (await loadNode(row.targetType, row.targetId, orgId));
        if (!src || !tgt) continue; // includes tenant mismatch
        nodes.set(`${row.sourceType}:${row.sourceId}`, src);
        nodes.set(`${row.targetType}:${row.targetId}`, tgt);
        edges.push({
          id: row.id, source: src, target: tgt, relation: row.relation,
          confidence: row.confidence, observationId: row.observationId ?? undefined,
          policyContext: row.policyContext,
        });
        if (src.id !== n.id || src.type !== n.type) next.push(src);
        if (tgt.id !== n.id || tgt.type !== n.type) next.push(tgt);
      }
    }
    frontier = next;
  }
  return { nodes: [...nodes.values()], edges };
}
