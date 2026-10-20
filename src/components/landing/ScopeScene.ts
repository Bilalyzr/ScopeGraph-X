/**
 * ScopeScene — a dependency-free, canvas-projected 3D "attack surface" scene.
 *
 * The scene tells the ScopeGraph X story as a function of a single scroll
 * timeline value `s` (chapter index + local progress):
 *   hero      → an unbounded, chaotic cloud of hosts (the open internet)
 *   scope     → a policy boundary draws itself; nodes converge, inside = authorized
 *   graph     → relationships (program → asset → endpoint) wire up, labels appear
 *   lifecycle → evidence pulses travel the graph toward candidate findings
 *   stop      → the boundary arms; the emergency stop freezes everything
 *   guardrails→ the scene recedes behind the content
 *   final     → the complete system, on paper stock
 *
 * Rendering is a hand-rolled perspective projection on a 2D canvas so the
 * landing page ships no WebGL/three.js payload. It renders continuously only
 * while motion is allowed and the tab is visible; with reduced motion it
 * renders on demand (scroll / resize) only.
 */

export const CHAPTERS = ["hero", "scope", "graph", "lifecycle", "stop", "guardrails", "final"] as const;

const KF = {
  morph: [0, 1, 1, 1, 1, 1, 1],
  edges: [0, 0.12, 1, 0.85, 0.6, 0.3, 0.9],
  labels: [0, 0, 1, 0, 0, 0, 0],
  pulses: [0, 0, 0.35, 1, 0.4, 0, 0.6],
  boundary: [0, 1, 0.65, 0.4, 1, 0.25, 0.7],
  outside: [1, 0.75, 0.35, 0.28, 0.32, 0.22, 0.3],
  dist: [3.5, 3.6, 3.0, 3.7, 4.6, 5.2, 4.1],
  offX: [0.2, 0.22, -0.2, 0.2, 0, 0.26, 0],
  offY: [0.02, 0, 0, -0.16, 0.24, 0, 0.08],
  rot: [0, 0.9, 1.9, 2.7, 3.3, 4.2, 5.4],
  tilt: [0.42, 0.22, 0.5, 0.15, 0.28, 0.55, 0.32],
  dim: [1, 1, 1, 0.7, 0.85, 0.38, 0.8],
  paper: [0, 0, 0, 0, 0, 0, 1],
};

export type Frame = { [K in keyof typeof KF]: number };
const KEYS = Object.keys(KF) as (keyof typeof KF)[];
const LAST = CHAPTERS.length - 1;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Keyframes are reached at the vertical middle of each chapter (s = i + 0.5). */
function sampleFrame(s: number): Frame {
  const x = Math.max(0, s - 0.5);
  const i = Math.min(LAST, Math.floor(x));
  const j = Math.min(LAST, i + 1);
  const t = i >= LAST ? 0 : easeInOut(x - i);
  const out = {} as Frame;
  for (const k of KEYS) out[k] = lerp(KF[k][i], KF[k][j], t);
  return out;
}

type RGB = [number, number, number];
const INK_FG: RGB = [10, 9, 15];
const PAPER_FG: RGB = [214, 222, 208];
const MINT: RGB = [38, 244, 208];
const GREEN: RGB = [14, 143, 116];
const CORAL: RGB = [252, 103, 86];
const GREY: RGB = [128, 128, 122];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a).toFixed(3)})`;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SceneNode {
  cx: number; cy: number; cz: number; // chaos position
  gx: number; gy: number; gz: number; // graph position
  shell: 0 | 1 | 2 | 3; // 0 core program, 1 asset, 2 endpoint, 3 outside scope
  parent: number;
  phase: number;
  delay: number;
  size: number;
  id: string;
  state: string;
}

export interface SceneCounts { core: number; s1: number; s2: number; out: number }

export interface SceneOptions {
  mobile: boolean;
  reduced: boolean;
  onFrame?: (f: Frame, s: number) => void;
  /** Drive node counts from real data (programs / authorized assets / endpoints / outside assets). */
  counts?: SceneCounts;
  /** Pin parts of the frame instead of following the scroll timeline (embedded use). */
  frame?: Partial<Frame>;
  /** Hover inspection of nodes (disable when nodes do not map to real records). */
  interactive?: boolean;
}

interface Ping { t0: number; allowed: boolean; dx: number; dy: number; dz: number }

export class ScopeScene {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: SceneOptions;
  private nodes: SceneNode[] = [];
  private edges: number[] = [];
  private paths: [number, number, number][] = [];
  private labels: { idx: number; text: string }[] = [];
  private wx: Float32Array; private wy: Float32Array; private wz: Float32Array;
  private sx: Float32Array; private sy: Float32Array; private sd: Float32Array;
  private w = 0; private h = 0; private dpr = 1;
  private sTarget = 0; private sCur = 0;
  private time = 0; private last = 0;
  private haltTarget = 0; private haltK = 0;
  private mxT = 0; private myT = 0; private mx = 0; private my = 0;
  private px = -9999; private py = -9999;
  private raf = 0; private running = false; private dirty = true;
  private pings: Ping[] = [];
  private flash = 0; private flashAllowed = true;
  private camRotY = 0; private camRotX = 0; private camDist = 4; private camCx = 0; private camCy = 0; private camF = 1;
  readonly stats: { total: number; inScope: number; refused: number };

  constructor(canvas: HTMLCanvasElement, opts: SceneOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    this.opts = opts;
    this.build(opts.mobile ? 280 : 640, opts.counts);
    const n = this.nodes.length;
    this.wx = new Float32Array(n); this.wy = new Float32Array(n); this.wz = new Float32Array(n);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.sd = new Float32Array(n);
    const inScope = this.nodes.filter((x) => x.shell < 3).length;
    this.stats = { total: n, inScope, refused: n - inScope };
    this.resize();
  }

  private build(total: number, counts?: SceneCounts) {
    const r = rng(0x5c09e);
    const hex = () => Math.floor(r() * 0xffff).toString(16).padStart(4, "0");
    const core = counts ? counts.core : 6;
    const s1 = counts ? counts.s1 : Math.round(total * 0.08);
    const s2 = counts ? counts.s2 : Math.round(total * 0.28);
    const out = counts ? counts.out : total - core - s1 - s2;
    const fib = (k: number, n: number, rad: number, jitter: number): [number, number, number] => {
      const y = 1 - ((k + 0.5) / n) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = k * 2.399963;
      const j = 1 + (r() - 0.5) * jitter;
      return [Math.cos(th) * rr * rad * j, y * rad * j, Math.sin(th) * rr * rad * j];
    };
    const chaos = (): [number, number, number] => {
      const a = r() * Math.PI * 2;
      const rad = 0.35 + Math.pow(r(), 0.7) * 2.3;
      const swirl = a + rad * 0.9;
      return [Math.cos(swirl) * rad, (r() - 0.5) * (0.45 + rad * 0.28), Math.sin(swirl) * rad];
    };
    const push = (shell: SceneNode["shell"], g: [number, number, number], id: string, state: string, size: number) => {
      const c = chaos();
      this.nodes.push({
        cx: c[0], cy: c[1], cz: c[2], gx: g[0], gy: g[1], gz: g[2],
        shell, parent: -1, phase: r() * Math.PI * 2, delay: r(), size, id, state,
      });
    };
    for (let k = 0; k < core; k++) push(0, fib(k, core, 0.2, 0.3), `prg_${hex()}`, "PROGRAM · ACTIVE POLICY", 2.4);
    for (let k = 0; k < s1; k++) push(1, fib(k, s1, 0.52, 0.18), `ast_${hex()}`, "ASSET · AUTHORIZED", 1.7);
    for (let k = 0; k < s2; k++) push(2, fib(k, s2, 0.84, 0.12), `ep_${hex()}`, "ENDPOINT · IN SCOPE", 1.15);
    for (let k = 0; k < out; k++) {
      const d = fib(k, out, 1, 0);
      const rad = 1.35 + r() * 1.35;
      push(3, [d[0] * rad, d[1] * rad * 0.7, d[2] * rad], `ext_${hex()}`, "REFUSED · OUT OF SCOPE", 0.95 + r() * 0.5);
    }
    // parent links: endpoint → nearest asset → nearest program
    const nearest = (i: number, shell: number) => {
      let best = -1, bd = Infinity;
      const a = this.nodes[i];
      for (let j = 0; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        if (b.shell !== shell) continue;
        const d = (a.gx - b.gx) ** 2 + (a.gy - b.gy) ** 2 + (a.gz - b.gz) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      return best;
    };
    this.nodes.forEach((n, i) => {
      if (n.shell === 1) n.parent = nearest(i, 0);
      if (n.shell === 2) n.parent = nearest(i, 1);
      if (n.parent >= 0) this.edges.push(i);
    });
    // evidence paths: program → asset → endpoint
    const endpoints = this.nodes.map((n, i) => (n.shell === 2 ? i : -1)).filter((i) => i >= 0);
    for (let k = 0; k < 14 && endpoints.length; k++) {
      const e = endpoints[Math.floor(r() * endpoints.length)];
      const a = this.nodes[e].parent;
      const p = a >= 0 ? this.nodes[a].parent : -1;
      if (a >= 0 && p >= 0) this.paths.push([p, a, e]);
    }
    const nth = (shell: number, k: number) => {
      const all = this.nodes.map((n, i) => (n.shell === shell ? i : -1)).filter((i) => i >= 0);
      return all.length ? all[Math.min(k, all.length - 1)] : -1;
    };
    this.labels = [
      { idx: nth(0, 0), text: "PROGRAM · scope v3 active" },
      { idx: nth(1, 3), text: "ASSET · authorized" },
      { idx: nth(2, 11), text: "ENDPOINT · GET /v1/orders/{id}" },
      { idx: nth(3, 7), text: "admin.* · DENIED by policy" },
    ].filter((l) => l.idx >= 0);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.opts.mobile ? 1.5 : 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.invalidate();
  }

  setTarget(s: number) {
    this.sTarget = s;
    if (this.opts.reduced) this.sCur = s;
    this.invalidate();
  }

  setMouse(nx: number, ny: number, px: number, py: number) {
    this.mxT = nx; this.myT = ny; this.px = px; this.py = py;
    if (this.opts.reduced) { this.mx = nx; this.my = ny; }
    this.invalidate();
  }

  setHalted(h: boolean) {
    this.haltTarget = h ? 1 : 0;
    if (this.opts.reduced) this.haltK = this.haltTarget;
    this.invalidate();
  }

  /** Fire a request at the boundary: allowed requests pass in, refused ones bounce. */
  ping(allowed: boolean) {
    if (this.opts.reduced) return; // reduced motion: the evaluator's stamp carries the result
    const a = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 0.8;
    const rr = Math.sqrt(1 - y * y);
    this.pings.push({ t0: performance.now(), allowed, dx: Math.cos(a) * rr, dy: y, dz: Math.sin(a) * rr });
    if (this.pings.length > 6) this.pings.shift();
    this.invalidate();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() { this.stop(); }

  private invalidate() {
    this.dirty = true;
    if (this.running && !this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const continuous = !this.opts.reduced;
    if (continuous) {
      const k = 1 - Math.exp(-dt * 4.2);
      this.sCur += (this.sTarget - this.sCur) * k;
      this.mx += (this.mxT - this.mx) * (1 - Math.exp(-dt * 3));
      this.my += (this.myT - this.my) * (1 - Math.exp(-dt * 3));
      this.haltK += (this.haltTarget - this.haltK) * (1 - Math.exp(-dt * 5));
      this.time += dt * (1 - this.haltK);
      this.flash = Math.max(0, this.flash - dt * 1.6);
    }
    if (continuous || this.dirty) {
      this.dirty = false;
      this.draw(now);
    }
    if (continuous) this.raf = requestAnimationFrame(this.tick);
  };

  private project(x: number, y: number, z: number): [number, number, number] {
    const cy = Math.cos(this.camRotY), sy = Math.sin(this.camRotY);
    const cx = Math.cos(this.camRotX), sx = Math.sin(this.camRotX);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y2 = y * cx - z1 * sx;
    const z2 = y * sx + z1 * cx;
    const d = z2 + this.camDist;
    if (d < 0.2) return [0, 0, -1];
    const sc = this.camF / d;
    return [this.camCx + x1 * sc, this.camCy + y2 * sc, d];
  }

  private draw(now: number) {
    const { ctx, w, h } = this;
    const mobile = this.opts.mobile;
    const F = this.opts.frame ? { ...sampleFrame(this.sCur), ...this.opts.frame } : sampleFrame(this.sCur);
    this.opts.onFrame?.(F, this.sCur);
    ctx.clearRect(0, 0, w, h);

    const paper = F.paper;
    const halt = this.haltK;
    const dim = F.dim * (mobile && this.sCur > 1 ? 0.55 : 1);
    this.camCx = w * (0.5 + (mobile ? 0 : F.offX));
    this.camCy = h * (0.5 + (mobile ? F.offY * 0.4 - 0.06 : F.offY));
    this.camF = Math.min(w, h) * (mobile ? 1.0 : 0.92);
    this.camDist = F.dist + (mobile ? 0.5 : 0);
    this.camRotY = this.time * 0.06 + F.rot + this.mx * 0.3;
    this.camRotX = F.tilt + this.my * 0.16;

    const neutral = mix(PAPER_FG, INK_FG, paper);
    const inC = mix(MINT, GREEN, paper);
    const fogFar = this.camDist + 2.6;
    const n = this.nodes.length;

    // --- world positions + projection ---------------------------------------
    for (let i = 0; i < n; i++) {
      const nd = this.nodes[i];
      const m = easeInOut(clamp(F.morph * 1.5 - nd.delay * 0.5));
      const drift = 0.028 * (1 - m * 0.55);
      const t = this.time * 0.6 + nd.phase;
      const x = lerp(nd.cx, nd.gx, m) + Math.sin(t) * drift;
      const y = lerp(nd.cy, nd.gy, m) + Math.cos(t * 1.3) * drift;
      const z = lerp(nd.cz, nd.gz, m) + Math.sin(t * 0.7) * drift;
      this.wx[i] = x; this.wy[i] = y; this.wz[i] = z;
      const p = this.project(x, y, z);
      this.sx[i] = p[0]; this.sy[i] = p[1]; this.sd[i] = p[2];
    }

    // --- policy boundary (wireframe sphere drawn progressively) -------------
    const flashC = this.flashAllowed ? inC : CORAL;
    if (F.boundary > 0.01 || this.flash > 0 || halt > 0.01) {
      const ringC0 = mix(inC, CORAL, halt);
      const ringC = mix(ringC0, flashC, this.flash);
      const baseA = (0.2 * F.boundary + this.flash * 0.45 + halt * 0.25) * dim;
      const draw = Math.max(F.boundary, halt, this.flash > 0 ? 1 : 0);
      const SEG = 72;
      ctx.lineWidth = 1;
      const ring = (fn: (u: number) => [number, number, number], alpha: number) => {
        const segs = Math.floor(SEG * draw);
        if (segs < 2) return;
        ctx.beginPath();
        for (let k = 0; k <= segs; k++) {
          const [x, y, z] = fn((k / SEG) * Math.PI * 2);
          const p = this.project(x, y, z);
          if (k === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
        }
        ctx.strokeStyle = rgba(ringC, alpha);
        ctx.stroke();
      };
      const R = 1.0;
      for (const ly of [-0.55, 0, 0.55]) {
        const rr = Math.sqrt(1 - ly * ly) * R;
        ring((u) => [Math.cos(u) * rr, ly * R, Math.sin(u) * rr], baseA * (ly === 0 ? 1.4 : 0.8));
      }
      for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
        ring((u) => [Math.cos(u) * Math.cos(a) * R, Math.sin(u) * R, Math.cos(u) * Math.sin(a) * R], baseA * 0.6);
      }
      if (halt > 0.01) {
        // armed scan band sweeping the boundary while the stop is engaged
        const band = Math.sin(now / 420) * 0.9;
        const rr = Math.sqrt(Math.max(0, 1 - band * band));
        ring((u) => [Math.cos(u) * rr, band, Math.sin(u) * rr], halt * 0.55 * dim);
      }
    }

    // --- edges ---------------------------------------------------------------
    if (F.edges > 0.01) {
      const E = this.edges.length;
      const reveal = F.edges * 1.15;
      const edgeC = mix(inC, GREY, halt * 0.85);
      ctx.lineWidth = 0.8;
      for (let k = 0; k < E; k++) {
        const kk = k / E;
        if (kk > reveal) break;
        const i = this.edges[k];
        const j = this.nodes[i].parent;
        if (this.sd[i] < 0 || this.sd[j] < 0) continue;
        const fog = clamp((fogFar - this.sd[i]) / 3.2, 0.15, 1);
        const a = 0.3 * Math.min(1, (reveal - kk) * 6) * fog * dim;
        ctx.strokeStyle = rgba(edgeC, a);
        ctx.beginPath();
        ctx.moveTo(this.sx[i], this.sy[i]);
        ctx.lineTo(this.sx[j], this.sy[j]);
        ctx.stroke();
      }
    }

    // --- nodes ----------------------------------------------------------------
    for (let i = 0; i < n; i++) {
      const d = this.sd[i];
      if (d < 0) continue;
      const nd = this.nodes[i];
      const m = easeInOut(clamp(F.morph * 1.5 - nd.delay * 0.5));
      const inside = nd.shell < 3;
      let c = mix(neutral, inside ? inC : CORAL, m);
      c = mix(c, GREY, halt * 0.8);
      const fog = clamp((fogFar - d) / 3.2, 0.12, 1);
      const a = (inside ? 0.95 : lerp(0.8, F.outside, m)) * fog * dim;
      const size = nd.size * (3.1 / d) * (mobile ? 0.9 : 1);
      ctx.fillStyle = rgba(c, a);
      if (size < 1.6) {
        ctx.fillRect(this.sx[i] - size / 2, this.sy[i] - size / 2, size, size);
      } else {
        ctx.beginPath();
        ctx.arc(this.sx[i], this.sy[i], size * 0.62, 0, Math.PI * 2);
        ctx.fill();
        if (nd.shell === 0 && m > 0.5) {
          ctx.fillStyle = rgba(c, a * 0.12);
          ctx.beginPath();
          ctx.arc(this.sx[i], this.sy[i], size * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // --- evidence pulses + candidate findings -------------------------------
    if (F.pulses > 0.01) {
      const pc = mix(inC, GREY, halt);
      this.paths.forEach(([p0, p1, p2], k) => {
        const t = (this.time * 0.3 + k * 0.173) % 1;
        const [a, b, u] = t < 0.5 ? [p0, p1, t * 2] : [p1, p2, (t - 0.5) * 2];
        const x = lerp(this.wx[a], this.wx[b], u);
        const y = lerp(this.wy[a], this.wy[b], u);
        const z = lerp(this.wz[a], this.wz[b], u);
        const p = this.project(x, y, z);
        if (p[2] < 0) return;
        const r = 2.4 * (3 / p[2]);
        ctx.fillStyle = rgba(pc, 0.18 * F.pulses * dim);
        ctx.beginPath(); ctx.arc(p[0], p[1], r * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(pc, 0.95 * F.pulses * dim);
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
        if (k < 3 && this.sd[p2] > 0) {
          const ft = (this.time * 0.7 + k * 0.33) % 1;
          ctx.strokeStyle = rgba(mix(CORAL, GREY, halt), (1 - ft) * 0.85 * F.pulses * dim);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(this.sx[p2], this.sy[p2], 4 + ft * 22, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = rgba(CORAL, 0.95 * F.pulses * dim);
          ctx.beginPath(); ctx.arc(this.sx[p2], this.sy[p2], 2.6, 0, Math.PI * 2); ctx.fill();
        }
      });
    }

    // --- request pings fired by the policy evaluator -------------------------
    const nowMs = performance.now();
    this.pings = this.pings.filter((pg) => nowMs - pg.t0 < 1500);
    for (const pg of this.pings) {
      const u = (nowMs - pg.t0) / 1500;
      const radAt = (q: number) =>
        pg.allowed ? lerp(2.3, 0.45, easeInOut(clamp(q))) : q < 0.5 ? lerp(2.3, 1.0, clamp(q * 2)) : lerp(1.0, 2.6, clamp((q - 0.5) * 2));
      if (!pg.allowed && u > 0.48 && u < 0.56) { this.flash = 1; this.flashAllowed = false; }
      if (pg.allowed && u > 0.42 && u < 0.5) { this.flash = Math.max(this.flash, 0.7); this.flashAllowed = true; }
      const col = pg.allowed ? inC : CORAL;
      for (let tr = 5; tr >= 0; tr--) {
        const q = u - tr * 0.018;
        if (q < 0) continue;
        const rr = radAt(q);
        const p = this.project(pg.dx * rr, pg.dy * rr, pg.dz * rr);
        if (p[2] < 0) continue;
        ctx.fillStyle = rgba(col, (1 - tr / 6) * (1 - Math.max(0, u - 0.85) / 0.15) * 0.95);
        ctx.beginPath();
        ctx.arc(p[0], p[1], (tr === 0 ? 3.4 : 2.2) * (3 / p[2]), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- labels / hover inspection ------------------------------------------
    const fg = mix([233, 238, 231], INK_FG, paper);
    const tag = (i: number, text: string, alpha: number, side = 1, lift = 26) => {
      if (this.sd[i] < 0 || alpha < 0.02) return;
      const x = this.sx[i], y = this.sy[i];
      const lx = x + 26 * side, ly = y - lift;
      ctx.strokeStyle = rgba(fg, 0.5 * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(lx, ly); ctx.lineTo(lx + 10 * side, ly); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.font = "500 10.5px 'Roboto Mono', ui-monospace, monospace";
      const tw = ctx.measureText(text).width;
      const bx = side > 0 ? lx + 12 : lx - 12 - (tw + 14);
      ctx.fillStyle = rgba(paper > 0.5 ? [251, 253, 250] : [10, 9, 15], 0.82 * alpha);
      ctx.fillRect(bx, ly - 10, tw + 14, 20);
      ctx.strokeStyle = rgba(fg, 0.28 * alpha);
      ctx.strokeRect(bx + 0.5, ly - 9.5, tw + 13, 19);
      ctx.fillStyle = rgba(fg, alpha);
      ctx.fillText(text, bx + 7, ly + 3.5);
    };
    if (F.labels > 0.02 && !mobile) this.labels.forEach((l, k) => tag(l.idx, l.text, F.labels * dim, k % 2 ? -1 : 1, 26 + k * 14));

    if (this.opts.interactive !== false && !mobile && F.morph > 0.6 && this.px > -1000) {
      let best = -1, bd = 26 * 26;
      for (let i = 0; i < n; i++) {
        if (this.sd[i] < 0) continue;
        const dx = this.sx[i] - this.px, dy = this.sy[i] - this.py;
        const dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0) {
        const nd = this.nodes[best];
        tag(best, `${nd.id} · ${halt > 0.5 ? "HALTED" : nd.state}`, Math.max(0.6, dim));
      }
    }
  }
}
