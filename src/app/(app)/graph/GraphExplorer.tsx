"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface NodeDto { type: string; id: string; label: string; meta?: Record<string, unknown> }
interface EdgeDto { id: string; source: NodeDto; target: NodeDto; relation: string; confidence: number; observationId?: string; policyContext: string }

const TYPE_COLORS: Record<string, string> = {
  Program: "#22d3ee", Asset: "#34d399", Endpoint: "#60a5fa", Identity: "#fbbf24",
  Finding: "#f87171", Hypothesis: "#c084fc", Test: "#fb923c",
};

export default function GraphExplorer({ assets, initialAssetId }: { assets: Array<{ id: string; canonicalLocator: string; scopeState: string }>; initialAssetId: string | null }) {
  const [assetId, setAssetId] = useState(initialAssetId);
  const [depth, setDepth] = useState(1);
  const [data, setData] = useState<{ nodes: NodeDto[]; edges: EdgeDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EdgeDto | null>(null);

  const load = useCallback(async () => {
    if (!assetId) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/assets/${assetId}/relationships?depth=${depth}`);
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.code}: ${body.detail ?? body.title}`);
        return;
      }
      setData({ nodes: body.nodes, edges: body.edges });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load graph");
    }
  }, [assetId, depth]);

  useEffect(() => {
    load();
  }, [load]);

  // Radial layout around the first node.
  const layout = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const W = 900, H = 520, cx = W / 2, cy = H / 2;
    const positions = new Map<string, { x: number; y: number }>();
    const center = data.nodes[0];
    positions.set(`${center.type}:${center.id}`, { x: cx, y: cy });
    const others = data.nodes.slice(1);
    others.forEach((n, i) => {
      const ring = i < 8 ? 0 : 1;
      const perRing = ring === 0 ? 8 : others.length - 8;
      const idx = ring === 0 ? i : i - 8;
      const r = 150 + ring * 130;
      const angle = (idx / Math.max(1, perRing)) * Math.PI * 2 - Math.PI / 2;
      positions.set(`${n.type}:${n.id}`, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    });
    return { W, H, positions, center };
  }, [data]);

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.8rem" }}>
        <label className="field" style={{ marginBottom: 0, width: 280 }}>
          Start from asset
          <select value={assetId ?? ""} onChange={(e) => setAssetId(e.target.value)}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.canonicalLocator} ({a.scopeState})
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0, width: 120 }}>
          Depth
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
          </select>
        </label>
        <button className="btn" onClick={load}>Refresh</button>
      </div>

      {error && <div className="msg error" role="alert">{error}</div>}

      <div className="card" style={{ overflowX: "auto" }}>
        {!layout ? (
          <p className="empty">Select an asset to explore relationships.</p>
        ) : (
          <svg width={layout.W} height={layout.H} role="img" aria-label="Asset relationship graph" style={{ maxWidth: "100%" }}>
            {data!.edges.map((e) => {
              const a = layout.positions.get(`${e.source.type}:${e.source.id}`);
              const b = layout.positions.get(`${e.target.type}:${e.target.id}`);
              if (!a || !b) return null;
              const activeSel = selected?.id === e.id;
              return (
                <g key={e.id} onClick={() => setSelected(e)} style={{ cursor: "pointer" }}>
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={activeSel ? "#22d3ee" : "#2c3e55"}
                    strokeWidth={activeSel ? 2.5 : 1.4}
                    markerEnd="url(#arrow)"
                  />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} fontSize={9} fill="#8ba0b8" textAnchor="middle">
                    {e.relation}
                  </text>
                </g>
              );
            })}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="24" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="#2c3e55" />
              </marker>
            </defs>
            {data!.nodes.map((n) => {
              const p = layout.positions.get(`${n.type}:${n.id}`);
              if (!p) return null;
              const color = TYPE_COLORS[n.type] ?? "#8ba0b8";
              return (
                <g key={`${n.type}:${n.id}`}>
                  <circle cx={p.x} cy={p.y} r={n === data!.nodes[0] ? 16 : 11} fill={color} opacity={0.9} />
                  <text x={p.x} y={p.y + 28} fontSize={10} fill="#dbe4ee" textAnchor="middle">
                    {n.label.length > 24 ? n.label.slice(0, 24) + "…" : n.label}
                  </text>
                  <text x={p.x} y={p.y + 3.5} fontSize={8.5} fill="#0b1017" textAnchor="middle" fontWeight={700}>
                    {n.type.slice(0, 2).toUpperCase()}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <div className="row" style={{ marginTop: "0.6rem" }}>
          {Object.entries(TYPE_COLORS).map(([t, c]) => (
            <span key={t} className="row" style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: c, display: "inline-block" }} /> {t}
            </span>
          ))}
        </div>
      </div>

      {selected && (
        <div className="card">
          <h2>Edge detail — {selected.relation}</h2>
          <dl className="kv">
            <dt>Source</dt><dd className="mono">{selected.source.type} {selected.source.label}</dd>
            <dt>Target</dt><dd className="mono">{selected.target.type} {selected.target.label}</dd>
            <dt>Confidence</dt><dd>{selected.confidence.toFixed(2)}</dd>
            <dt>Originating observation</dt><dd className="mono">{selected.observationId ?? "—"}</dd>
            <dt>Policy context</dt><dd>{selected.policyContext || "—"}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
