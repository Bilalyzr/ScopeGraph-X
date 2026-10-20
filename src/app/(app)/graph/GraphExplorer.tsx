"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface NodeDto { type: string; id: string; label: string; meta?: Record<string, unknown> }
interface EdgeDto { id: string; source: NodeDto; target: NodeDto; relation: string; confidence: number; observationId?: string; policyContext: string }

const TYPE_COLORS: Record<string, { fill: string; text: string }> = {
  Program: { fill: "#0a090f", text: "#26f4d0" },
  Asset: { fill: "#0e8f74", text: "#fbfdfa" },
  Endpoint: { fill: "#724ce8", text: "#fbfdfa" },
  Identity: { fill: "#9a7b0a", text: "#fbfdfa" },
  Finding: { fill: "#e04431", text: "#fbfdfa" },
  Hypothesis: { fill: "#fc6756", text: "#0a090f" },
  Test: { fill: "#e0862f", text: "#0a090f" },
};

export default function GraphExplorer({
  assets,
  initialAssetId,
}: {
  assets: Array<{ id: string; canonicalLocator: string; scopeState: string }>;
  initialAssetId: string | null;
}) {
  const [assetId, setAssetId] = useState(initialAssetId);
  const [depth, setDepth] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [zoom, setZoom] = useState<number>(1);
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
    const W = 940,
      H = 540,
      cx = W / 2,
      cy = H / 2;
    const positions = new Map<string, { x: number; y: number }>();
    const center = data.nodes[0];
    positions.set(`${center.type}:${center.id}`, { x: cx, y: cy });
    const others = data.nodes.slice(1);
    others.forEach((n, i) => {
      const ring = i < 8 ? 0 : 1;
      const perRing = ring === 0 ? Math.min(8, others.length) : others.length - 8;
      const idx = ring === 0 ? i : i - 8;
      const r = 155 + ring * 130;
      const angle = (idx / Math.max(1, perRing)) * Math.PI * 2 - Math.PI / 2;
      positions.set(`${n.type}:${n.id}`, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    });
    return { W, H, cx, cy, positions, center };
  }, [data]);

  return (
    <div>
      <div className="card" style={{ padding: "1rem 1.35rem" }}>
        <div className="row" style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ marginBottom: 0, width: 320 }}>
              Origin Asset Node
              <select value={assetId ?? ""} onChange={(e) => setAssetId(e.target.value)}>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.canonicalLocator} ({a.scopeState})
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0, width: 140 }}>
              Traversal Depth
              <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                <option value={1}>1 hop</option>
                <option value={2}>2 hops</option>
              </select>
            </label>
            <button className="btn primary" onClick={load}>
              REFRESH TOPOLOGY
            </button>
          </div>
          {data && (
            <div className="row">
              <span className="badge accent">{data.nodes.length} NODES</span>
              <span className="badge neutral">{data.edges.length} EDGES</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="msg error" role="alert">
          {error}
        </div>
      )}

      <div className="card" style={{ overflowX: "auto", padding: "1.1rem" }}>
        <div className="row spread" style={{ marginBottom: "0.75rem" }}>
          <div className="row" style={{ gap: "0.35rem" }}>
            <button
              type="button"
              className={`badge ${typeFilter === "ALL" ? "accent" : "neutral"}`}
              style={{ cursor: "pointer" }}
              onClick={() => setTypeFilter("ALL")}
            >
              ALL NODES
            </button>
            {Object.entries(TYPE_COLORS).map(([t, c]) => (
              <button
                key={t}
                type="button"
                className={`badge ${typeFilter === t ? "accent" : "neutral"}`}
                style={{ cursor: "pointer", background: typeFilter === t ? "var(--ink)" : "var(--surface)" }}
                onClick={() => setTypeFilter(t)}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: c.fill,
                    border: "1px solid var(--ink)",
                    display: "inline-block",
                  }}
                />{" "}
                {t}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: "0.35rem" }}>
            <button type="button" className="btn small" onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.15).toFixed(2)))}>
              −
            </button>
            <span className="mono-label" style={{ minWidth: 46, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button type="button" className="btn small" onClick={() => setZoom((z) => Math.min(1.45, +(z + 0.15).toFixed(2)))}>
              +
            </button>
            <button type="button" className="btn small" onClick={() => setZoom(1)}>
              RESET
            </button>
          </div>
        </div>
        {!layout ? (
          <p className="empty">Select an asset to explore relationships.</p>
        ) : (
          <svg
            width={Math.round(layout.W * zoom)}
            height={Math.round(layout.H * zoom)}
            viewBox={`0 0 ${layout.W} ${layout.H}`}
            role="img"
            aria-label="Asset relationship graph"
            style={{
              maxWidth: "100%",
              background: "var(--bg)",
              borderRadius: "14px",
              border: "1px solid var(--border-ink)",
              display: "block",
              margin: "0 auto",
            }}
          >
            <defs>
              <pattern id="press-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(53,53,57,0.09)" strokeWidth="1" />
              </pattern>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="26" refY="3.5" orient="auto">
                <path d="M0,0 L0,7 L7,3.5 z" fill="#353539" />
              </marker>
              <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="26" refY="3.5" orient="auto">
                <path d="M0,0 L0,7 L7,3.5 z" fill="#fc6756" />
              </marker>
            </defs>

            <rect width={layout.W} height={layout.H} fill="url(#press-grid)" />

            {/* Concentric instrument rings */}
            <circle
              cx={layout.cx}
              cy={layout.cy}
              r={155}
              fill="none"
              stroke="rgba(53,53,57,0.18)"
              strokeDasharray="4 4"
            />
            <circle
              cx={layout.cx}
              cy={layout.cy}
              r={285}
              fill="none"
              stroke="rgba(53,53,57,0.14)"
              strokeDasharray="4 4"
            />

            {data!.edges.map((e) => {
              const a = layout.positions.get(`${e.source.type}:${e.source.id}`);
              const b = layout.positions.get(`${e.target.type}:${e.target.id}`);
              if (!a || !b) return null;
              const activeSel = selected?.id === e.id;
              return (
                <g key={e.id} onClick={() => setSelected(e)} style={{ cursor: "pointer" }}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={activeSel ? "#fc6756" : "rgba(10,9,15,0.45)"}
                    strokeWidth={activeSel ? 2.6 : 1.4}
                    markerEnd={activeSel ? "url(#arrow-active)" : "url(#arrow)"}
                  />
                  <rect
                    x={(a.x + b.x) / 2 - 38}
                    y={(a.y + b.y) / 2 - 14}
                    width={76}
                    height={15}
                    rx={7}
                    fill={activeSel ? "#fc6756" : "#fbfdfa"}
                    stroke="#0a090f"
                    strokeWidth={0.8}
                  />
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 4}
                    fontSize={8.5}
                    fontFamily="Roboto Mono, monospace"
                    fontWeight={700}
                    fill="#0a090f"
                    textAnchor="middle"
                  >
                    {e.relation}
                  </text>
                </g>
              );
            })}

            {data!.nodes.map((n) => {
              const p = layout.positions.get(`${n.type}:${n.id}`);
              if (!p) return null;
              const palette = TYPE_COLORS[n.type] ?? { fill: "#6e6e68", text: "#fbfdfa" };
              const isCenter = n === data!.nodes[0];
              const dimmed = typeFilter !== "ALL" && !isCenter && n.type !== typeFilter;
              const radius = isCenter ? 20 : 14;
              return (
                <g key={`${n.type}:${n.id}`} style={{ opacity: dimmed ? 0.22 : 1, transition: "opacity 180ms ease" }}>
                  {/* Hard offset shadow circle */}
                  <circle cx={p.x + 2.5} cy={p.y + 2.5} r={radius} fill="#0a090f" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={radius}
                    fill={palette.fill}
                    stroke="#0a090f"
                    strokeWidth={1.5}
                  />
                  <text
                    x={p.x}
                    y={p.y + 3.5}
                    fontSize={9}
                    fontFamily="Roboto Mono, monospace"
                    fill={palette.text}
                    textAnchor="middle"
                    fontWeight={700}
                  >
                    {n.type.slice(0, 2).toUpperCase()}
                  </text>
                  <text
                    x={p.x}
                    y={p.y + radius + 15}
                    fontSize={10.5}
                    fontFamily="Roboto Mono, monospace"
                    fontWeight={700}
                    fill="#0a090f"
                    textAnchor="middle"
                  >
                    {n.label.length > 24 ? n.label.slice(0, 24) + "…" : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        <div className="row" style={{ marginTop: "0.9rem", justifyContent: "space-between" }}>
          <div className="row">
            {Object.entries(TYPE_COLORS).map(([t, c]) => (
              <span key={t} className="badge neutral" style={{ background: "var(--surface)" }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    background: c.fill,
                    border: "1px solid var(--ink)",
                    display: "inline-block",
                  }}
                />{" "}
                {t}
              </span>
            ))}
          </div>
          <span className="mono-label">CLICK ANY EDGE TO INSPECT PROVENANCE</span>
        </div>
      </div>

      {selected && (
        <div className="card">
          <h2>
            <span>Edge detail — {selected.relation}</span>
            <span className="badge accent">CONFIDENCE {selected.confidence.toFixed(2)}</span>
          </h2>
          <dl className="kv">
            <dt>Source</dt>
            <dd className="mono">
              {selected.source.type} · <strong>{selected.source.label}</strong>
            </dd>
            <dt>Target</dt>
            <dd className="mono">
              {selected.target.type} · <strong>{selected.target.label}</strong>
            </dd>
            <dt>Confidence</dt>
            <dd className="mono">{selected.confidence.toFixed(2)}</dd>
            <dt>Originating observation</dt>
            <dd className="mono">{selected.observationId ?? "—"}</dd>
            <dt>Policy context</dt>
            <dd>{selected.policyContext || "—"}</dd>
          </dl>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            {selected.source.id.startsWith("ast_") && (
              <a href={`/assets/${selected.source.id}`} className="btn small">
                OPEN SOURCE ASSET ({selected.source.id}) →
              </a>
            )}
            {selected.target.id.startsWith("ast_") && (
              <a href={`/assets/${selected.target.id}`} className="btn small">
                OPEN TARGET ASSET ({selected.target.id}) →
              </a>
            )}
            {selected.target.id.startsWith("fnd_") && (
              <a href={`/findings/${selected.target.id}`} className="btn small primary">
                OPEN FINDING ({selected.target.id}) →
              </a>
            )}
            {selected.source.id.startsWith("prg_") && (
              <a href={`/programs/${selected.source.id}`} className="btn small">
                OPEN PROGRAM ({selected.source.id}) →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
