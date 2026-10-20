"use client";

/**
 * Zero-dependency SVG chart kit for the ScopeGraph X dashboards.
 *
 * Every chart is a pure function of the data passed in (no fixtures, no
 * random fill-ins). Charts draw themselves in once when they enter the
 * viewport and expose an accessible text summary via <title>/<desc> and
 * aria-labels. Motion is disabled under `prefers-reduced-motion`.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/* ------------------------------------------------------------------ utils */

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, seen };
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${Math.round(n * 10) / 10}`);

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

/* -------------------------------------------------------------- sparkline */

export function Sparkline({ values, color = "var(--ink)", height = 36, label }: { values: number[]; color?: string; height?: number; label: string }) {
  const id = useId().replace(/:/g, "");
  const { ref, seen } = useInView<SVGSVGElement>();
  const W = 120;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * W, height - 3 - (v / max) * (height - 8)] as [number, number]);
  const line = smoothPath(pts);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <svg ref={ref} className={`cx-spark ${seen ? "in" : ""}`} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${total} over ${values.length} days`}>
      <defs>
        <linearGradient id={`sg${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {total > 0 && <path d={`${line} L${W},${height} L0,${height} Z`} style={{ fill: `url(#sg${id})` }} className="cx-spark-area" />}
      <path d={total > 0 ? line : `M0,${height - 3} H${W}`} className="cx-spark-line" style={{ stroke: color, fill: "none" }} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------- area trend */

export function AreaTrend({ series, labels, height = 220, stacked = false, kind = "area", title }: { series: Series[]; labels: string[]; height?: number; stacked?: boolean; kind?: "area" | "bar"; title: string }) {
  const id = useId().replace(/:/g, "");
  const { ref, seen } = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = labels.length;

  const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  const rawMax = stacked || kind === "bar" ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values));
  const max = niceMax(rawMax);
  const empty = rawMax === 0;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const barW = Math.max(4, (iw / n) * 0.56);
  const bx = (i: number) => pad.l + (i + 0.5) * (iw / n);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = kind === "bar" ? Math.floor(((px - pad.l) / iw) * n) : Math.round(((px - pad.l) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  const hx = hover == null ? 0 : kind === "bar" ? bx(hover) : x(hover);

  return (
    <div ref={ref} className={`cx-trend ${seen ? "in" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <title>{title}</title>
        <desc>{series.map((s) => `${s.label}: ${s.values.reduce((a, b) => a + b, 0)} total`).join("; ")}</desc>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`ag${id}${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="1" stopColor={s.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t} className="cx-grid">
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 8} y={y(t) + 3} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % Math.ceil(n / 7) === 0 || i === n - 1 ? (
            <text key={l + i} className="cx-axis" x={kind === "bar" ? bx(i) : x(i)} y={H - 8} textAnchor="middle">{l}</text>
          ) : null,
        )}

        {kind === "bar"
          ? labels.map((_, i) => {
              let acc = 0;
              return (
                <g key={i} className="cx-bar-col" style={{ ["--i" as string]: i }} opacity={hover == null || hover === i ? 1 : 0.45}>
                  {series.map((s) => {
                    const v = s.values[i] ?? 0;
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    return v > 0 ? <rect key={s.key} x={bx(i) - barW / 2} y={y1} width={barW} height={Math.max(0, y0 - y1)} rx={2} style={{ fill: s.color }} /> : null;
                  })}
                </g>
              );
            })
          : (() => {
              let base = labels.map(() => 0);
              return series.map((s) => {
                const tops = s.values.map((v, i) => (stacked ? base[i] + v : v));
                const top = tops.map((v, i) => [x(i), y(v)] as [number, number]);
                const bottom = (stacked ? base : base.map(() => 0)).map((v, i) => [x(i), y(v)] as [number, number]).reverse();
                const line = smoothPath(top);
                const area = `${line} L${bottom.map((p) => p.join(",")).join(" L")} Z`;
                if (stacked) base = tops;
                return (
                  <g key={s.key}>
                    {!empty && <path d={area} className="cx-area" style={{ fill: `url(#ag${id}${s.key})` }} />}
                    <path d={line} pathLength={1} className="cx-draw" style={{ stroke: s.color, fill: "none" }} strokeWidth={2} />
                  </g>
                );
              });
            })()}

        {hover != null && (
          <g className="cx-hover" pointerEvents="none">
            <line x1={hx} x2={hx} y1={pad.t} y2={pad.t + ih} />
            {kind === "area" &&
              (() => {
                let acc = 0;
                return series.map((s) => {
                  acc = stacked ? acc + (s.values[hover] ?? 0) : s.values[hover] ?? 0;
                  return <circle key={s.key} cx={hx} cy={y(acc)} r={4} style={{ fill: "var(--surface)", stroke: s.color }} strokeWidth={2} />;
                });
              })()}
          </g>
        )}
        {empty && (
          <text x={pad.l + iw / 2} y={pad.t + ih / 2} textAnchor="middle" className="cx-empty-t">No activity recorded in this window</text>
        )}
      </svg>
      {hover != null && (
        <div className="cx-tip" style={{ left: `${(hx / W) * 100}%` }} role="status">
          <b>{labels[hover]}</b>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} /> {s.label} <em>{s.values[hover] ?? 0}</em>
            </span>
          ))}
        </div>
      )}
      <ul className="cx-legend" aria-hidden="true">
        {series.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} /> {s.label} <b>{s.values.reduce((a, b) => a + b, 0)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ donut */

export function Donut({ slices, center, sub, size = 180, title }: { slices: Slice[]; center: string | number; sub: string; size?: number; title: string }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 70;
  const C = 2 * Math.PI * r;
  const gap = total > 0 && slices.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let off = 0;
  const h = hover != null ? slices[hover] : null;
  return (
    <div ref={ref} className={`cx-donut ${seen ? "in" : ""}`}>
      <div className="cx-donut-fig" style={{ width: size, height: size }}>
        <svg viewBox="0 0 180 180" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
          <circle cx="90" cy="90" r={r} className="cx-ring-track" strokeWidth="18" fill="none" />
          {total > 0 &&
            slices.map((s, i) => {
              if (!s.value) return null;
              const len = (s.value / total) * C;
              const dash = Math.max(0.001, len - gap);
              const el = (
                <circle
                  key={s.label}
                  cx="90"
                  cy="90"
                  r={r}
                  fill="none"
                  strokeWidth={hover === i ? 24 : 18}
                  className="cx-seg"
                  style={{ stroke: s.color, strokeDasharray: `${seen ? dash : 0} ${C}`, strokeDashoffset: -off, ["--i" as string]: i }}
                  transform="rotate(-90 90 90)"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              );
              off += len;
              return el;
            })}
        </svg>
        <div className="cx-donut-c">
          <b>{h ? h.value : center}</b>
          <span>{h ? h.label : sub}</span>
        </div>
      </div>
      <ul className="cx-dlegend">
        {slices.map((s, i) => (
          <li key={s.label} className={hover === i ? "on" : ""} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{s.value}</b>
            <em>{total ? Math.round((s.value / total) * 100) : 0}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- funnel */

export function Funnel({ stages, title }: { stages: { label: string; value: number; href?: string }[]; title: string }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div ref={ref} className={`cx-funnel ${seen ? "in" : ""}`} role="list" aria-label={title}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 100) : null;
        const Row = (
          <>
            <span className="cx-f-k">{s.label}</span>
            <span className="cx-f-bar">
              <span style={{ width: `${(s.value / max) * 100}%`, ["--i" as string]: i }} />
            </span>
            <span className="cx-f-v">{s.value}</span>
            <span className="cx-f-c">{conv == null ? "—" : `${conv}%`}</span>
          </>
        );
        return s.href ? (
          <a key={s.label} href={s.href} className="cx-f-row" role="listitem">{Row}</a>
        ) : (
          <div key={s.label} className="cx-f-row" role="listitem">{Row}</div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ radial gauge */

export function Gauge({ value, label, sub, color = "var(--green)", invert = false }: { value: number | null; label: string; sub?: string; color?: string; invert?: boolean }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const r = 38;
  const arc = Math.PI * r; // half circle
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const tone = value == null ? "var(--border-ink)" : color;
  const quality = value == null ? "n/a" : invert ? (v <= 0.1 ? "good" : v <= 0.25 ? "watch" : "poor") : v >= 0.8 ? "good" : v >= 0.5 ? "watch" : "poor";
  return (
    <div ref={ref} className={`cx-gauge ${seen ? "in" : ""}`}>
      <svg viewBox="0 0 100 58" role="img" aria-label={`${label}: ${value == null ? "not enough data" : `${Math.round(v * 100)}%`}`}>
        <path d="M12 50 A38 38 0 0 1 88 50" className="cx-ring-track" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path
          d="M12 50 A38 38 0 0 1 88 50"
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className="cx-gauge-v"
          style={{ stroke: tone, strokeDasharray: `${seen ? v * arc : 0} ${arc}`, opacity: v > 0 ? 1 : 0 }}
        />
      </svg>
      <b className="cx-gauge-n">{value == null ? "—" : `${Math.round(v * 100)}%`}</b>
      <span className="cx-gauge-l">{label}</span>
      {sub && <span className="cx-gauge-s">{sub}</span>}
      <span className={`cx-q ${quality}`}>{quality}</span>
    </div>
  );
}

/* ------------------------------------------------------- horizontal bars */

export function HBars({ rows, title, unit = "" }: { rows: { label: string; value: number; color: string; note?: string }[]; title: string; unit?: string }) {
  const { ref, seen } = useInView<HTMLUListElement>();
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul ref={ref} className={`cx-hbars ${seen ? "in" : ""}`} aria-label={title}>
      {rows.map((r, i) => (
        <li key={r.label}>
          <span className="k">{r.label}</span>
          <span className="bar">
            <span style={{ width: `${(r.value / max) * 100}%`, background: r.color, ["--i" as string]: i }} />
          </span>
          <span className="v">
            {r.value}
            {unit}
          </span>
          <span className="p">{total ? Math.round((r.value / total) * 100) : 0}%</span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------- segmented bar */

export function SegmentBar({ slices, title }: { slices: Slice[]; title: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="cx-seg-wrap">
      <div className="cx-segbar" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        {total === 0 ? <span className="empty" /> : slices.map((s) => (s.value ? <span key={s.label} title={`${s.label}: ${s.value}`} style={{ flexGrow: s.value, background: s.color }} /> : null))}
      </div>
      <ul className="cx-seg-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} /> {s.label} <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- heatmap */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Heatmap({ grid, title }: { grid: number[][]; title: string }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const max = useMemo(() => Math.max(1, ...grid.flat()), [grid]);
  const total = useMemo(() => grid.flat().reduce((a, b) => a + b, 0), [grid]);
  return (
    <div className="cx-heat">
      <div className="cx-heat-grid" role="img" aria-label={`${title}: ${total} events`}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="cx-heat-h">{h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>
        ))}
        {grid.map((row, d) => (
          <div key={d} className="cx-heat-row">
            <span className="cx-heat-d">{DAYS[d]}</span>
            {row.map((v, h) => (
              <span
                key={h}
                className="cx-heat-c"
                style={{ ["--a" as string]: v ? 0.15 + (v / max) * 0.85 : 0 }}
                onPointerEnter={() => setHover([d, h])}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="cx-heat-foot">
        <span>{hover ? `${DAYS[hover[0]]} ${String(hover[1]).padStart(2, "0")}:00 UTC — ${grid[hover[0]][hover[1]]} events` : `${total} events · last 28 days · UTC`}</span>
        <span className="cx-heat-scale">
          less <i style={{ ["--a" as string]: 0.15 }} /> <i style={{ ["--a" as string]: 0.45 }} /> <i style={{ ["--a" as string]: 0.75 }} /> <i style={{ ["--a" as string]: 1 }} /> more
        </span>
      </div>
    </div>
  );
}
