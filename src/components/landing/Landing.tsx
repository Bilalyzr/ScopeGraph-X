"use client";

import "./landing.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { ScopeScene, CHAPTERS, type Frame } from "./ScopeScene";
import { matchScope } from "@/lib/policy/matcher";
import type { ScopeRules } from "@/lib/policy/rules";

/* -------------------------------------------------------------------------- */
/* Content                                                                    */
/* -------------------------------------------------------------------------- */

const CHAPTER_LABELS = ["Intro", "Scope", "Graph", "Lifecycle", "Stop", "Guardrails", "Enter"];

/** Illustrative policy used only by the on-page evaluator (runs the real matcher). */
const ILLUSTRATIVE_POLICY = {
  allow: [
    { host: "api.yourco.com", paths: ["/v1/orders", "/v1/users"], methods: ["GET", "POST"] },
    { host: "shop.yourco.com", paths: ["/"], methods: ["GET"] },
  ],
  deny: [
    { host: "admin.yourco.com", reason: "Excluded by engagement contract §4" },
    { host: "*.internal.yourco.com", reason: "Internal hosts are never in scope" },
  ],
  budgets: { max_requests: 500, max_rps: 2, max_concurrency: 2 },
  notes: "",
} satisfies ScopeRules;

const TRY_TARGETS: { method: string; url: string }[] = [
  { method: "GET", url: "https://api.yourco.com/v1/orders/1042" },
  { method: "DELETE", url: "https://api.yourco.com/v1/orders/1042" },
  { method: "GET", url: "https://admin.yourco.com/export" },
  { method: "GET", url: "https://db.internal.yourco.com/" },
  { method: "GET", url: "https://api.yourco.com/v2/billing" },
];

const LIFECYCLE = [
  { state: "PROPOSED", copy: "An AI hypothesis or scanner alert. A candidate — never a fact.", gate: "test:propose" },
  { state: "OBSERVED", copy: "Behaviour is recorded against the target with evidence attached.", gate: "evidence attached" },
  { state: "REPRODUCED", copy: "Rerun independently under the same pinned policy version.", gate: "policy version pinned" },
  { state: "REVIEWED", copy: "A validator signs off — review is a separate permission.", gate: "finding:review" },
  { state: "REPORTED", copy: "The report is generated with its evidence cited inline.", gate: "report:write" },
  { state: "ACCEPTED", copy: "The program owner acknowledges the risk.", gate: "owner acknowledgement" },
  { state: "CLOSED", copy: "Fixed, verified and written to the audit ledger.", gate: "audit event" },
];

const GUARDRAILS = [
  { t: "Deny-priority scope matcher", d: "Deny always overrides allow. Every outbound request is matched against the active, approved policy version — host, path prefix and method." },
  { t: "Egress IP guard", d: "Private, loopback, link-local and IPv4-mapped IPv6 destinations are refused before a socket is opened." },
  { t: "Tenant-wide emergency stop", d: "One switch halts campaigns and blocks test approvals across the organization, instantly." },
  { t: "Validator-gated findings", d: "AI hypotheses and scanner output stay candidates until an independent validator reviews the evidence." },
  { t: "Hard tenant isolation", d: "Every query is scoped to the caller's organization; cross-tenant asset and program links are rejected." },
  { t: "Signed, SSRF-safe webhooks", d: "HMAC-signed deliveries verified in constant time, sent only to validated public URLs." },
  { t: "Exportable audit ledger", d: "Every decision is an audit event. CSV exports are hardened against formula injection." },
];

const ROLES = ["RESEARCHER", "APPSEC LEAD", "VALIDATOR", "PROGRAM OWNER", "TENANT ADMIN", "AUDITOR", "PLATFORM OPERATOR"];

/* -------------------------------------------------------------------------- */
/* Small primitives                                                           */
/* -------------------------------------------------------------------------- */

function Split({ text, className = "" }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={`lx-split ${className}`} aria-label={text}>
      {words.map((w, i) => (
        <span className="w" key={i} aria-hidden="true">
          <span style={{ ["--i" as string]: i }}>{w}&nbsp;</span>
        </span>
      ))}
    </span>
  );
}

/** Magnetic hover with a liquid fill that blooms from the pointer position. */
function Magnetic({ children, strength = 0.32 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    el.style.transform = `translate3d(${(x - r.width / 2) * strength}px, ${(y - r.height / 2) * strength}px, 0)`;
  };
  const leave = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return (
    <span ref={ref} className="lx-mag" onPointerMove={move} onPointerLeave={leave}>
      {children}
    </span>
  );
}

function Cursor() {
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = ring.current!;
    let tx = -100, ty = -100, x = -100, y = -100, raf = 0;
    const loop = () => {
      x += (tx - x) * (reduced ? 1 : 0.2);
      y += (ty - y) * (reduced ? 1 : 0.2);
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(loop) : 0;
    };
    const move = (e: PointerEvent) => {
      tx = e.clientX; ty = e.clientY;
      el.classList.add("is-on");
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const over = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-cursor], a, button, input, select");
      el.classList.toggle("is-hover", !!t);
      const text = t?.dataset.cursor ?? "";
      el.classList.toggle("has-label", !!text);
      if (label.current) label.current.textContent = text;
    };
    const leave = () => el.classList.remove("is-on");
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", over, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <div ref={ring} className="lx-cursor" aria-hidden="true">
      <span className="lx-cursor-ring" />
      <span ref={label} className="lx-cursor-label" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Interactive modules                                                        */
/* -------------------------------------------------------------------------- */

function PolicyEvaluator({ onEvaluate }: { onEvaluate: (allowed: boolean) => void }) {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState(TRY_TARGETS[0].url);
  const touched = useRef(false);

  const result = useMemo(() => {
    let host = "", path = "/";
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
      host = u.hostname.toLowerCase();
      path = u.pathname || "/";
    } catch {
      return { ok: false, verdict: "INVALID", why: "Enter a URL such as https://api.yourco.com/v1/orders" };
    }
    const r = matchScope(ILLUSTRATIVE_POLICY, { host, path, method });
    if (r.allowed) return { ok: true, verdict: "ALLOWED", why: `Matched allow rule ${r.matchedAllow!.host} · ${method} ${path}` };
    if (r.matchedDeny) return { ok: false, verdict: "REFUSED", why: `Deny rule ${r.matchedDeny.host} — ${r.matchedDeny.reason}` };
    return { ok: false, verdict: "REFUSED", why: "No allow rule covers this host, path and method" };
  }, [method, url]);

  useEffect(() => {
    if (!touched.current || result.verdict === "INVALID") return;
    const t = setTimeout(() => onEvaluate(result.ok), 380);
    return () => clearTimeout(t);
  }, [result, onEvaluate]);

  return (
    <div data-reveal="mask"><div className="lx-eval">
      <div className="lx-eval-head">
        <span className="lx-dot" /> policy gateway · live evaluation
      </div>
      <pre className="lx-code" aria-label="Illustrative scope policy">
        <span className="k">allow</span> api.yourco.com  <span className="m">/v1/orders /v1/users</span>  GET POST{"\n"}
        <span className="k">allow</span> shop.yourco.com <span className="m">/</span>  GET{"\n"}
        <span className="d">deny </span> admin.yourco.com{"\n"}
        <span className="d">deny </span> *.internal.yourco.com
      </pre>
      <form className="lx-eval-row" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="lx-method">HTTP method</label>
        <select id="lx-method" value={method} onChange={(e) => { touched.current = true; setMethod(e.target.value); }}>
          {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="lx-url">Request URL</label>
        <input
          id="lx-url" value={url} spellCheck={false} autoComplete="off"
          onChange={(e) => { touched.current = true; setUrl(e.target.value); }}
        />
      </form>
      <div className={`lx-verdict ${result.ok ? "ok" : "no"}`} role="status" aria-live="polite">
        <span key={result.verdict + result.why} className="lx-stamp">{result.verdict}</span>
        <span className="lx-why">{result.why}</span>
      </div>
      <div className="lx-chips" aria-label="Try a request">
        {TRY_TARGETS.map((t) => (
          <button
            key={t.method + t.url} type="button" data-cursor="fire"
            onClick={() => { touched.current = true; setMethod(t.method); setUrl(t.url); }}
          >
            <b>{t.method}</b> {t.url.replace("https://", "")}
          </button>
        ))}
      </div>
    </div></div>
  );
}

function KillSwitch({ halted, onToggle }: { halted: boolean; onToggle: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const raf = useRef(0);
  const [log, setLog] = useState<string[]>([]);
  const prev = useRef(halted);

  useEffect(() => {
    if (prev.current === halted) return;
    prev.current = halted;
    const ts = new Date().toISOString().slice(11, 19);
    setLog((l) => [
      halted
        ? `${ts}  emergency_stop.engaged   egress=HALTED  approvals=BLOCKED`
        : `${ts}  emergency_stop.released  egress=LIVE    approvals=OPEN`,
      ...l,
    ].slice(0, 4));
  }, [halted]);

  const setHold = (v: number) => btn.current?.style.setProperty("--hold", String(v));
  const cancel = () => { cancelAnimationFrame(raf.current); setHold(0); };
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 700);
      setHold(p);
      if (p >= 1) { onToggle(); setTimeout(() => setHold(0), 120); return; }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  return (
    <div className="lx-kill">
      <button
        ref={btn} type="button" className={`lx-kill-btn ${halted ? "is-halted" : ""}`}
        aria-pressed={halted} data-cursor={halted ? "hold · release" : "hold · stop"}
        onPointerDown={down} onPointerUp={cancel} onPointerCancel={cancel}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); onToggle(); }
        }}
      >
        <span className="lx-kill-core">
          <span className="lx-kill-word">{halted ? "RELEASE" : "STOP"}</span>
          <span className="lx-kill-sub">{halted ? "hold to resume" : "press & hold"}</span>
        </span>
      </button>
      <div className="lx-log" aria-live="polite">
        <div className="lx-log-head">audit ledger</div>
        {log.length === 0 ? (
          <div className="lx-log-line faint">— awaiting operator —</div>
        ) : (
          log.map((l, i) => <div key={l} className={`lx-log-line ${i === 0 ? "fresh" : ""}`}>{l}</div>)
        )}
      </div>
    </div>
  );
}

function GuardrailIndex() {
  const dir = (e: ReactPointerEvent<HTMLLIElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.dataset.dir = e.clientY - r.top < r.height / 2 ? "top" : "bottom";
  };
  return (
    <ol className="lx-index">
      {GUARDRAILS.map((g, i) => (
        <li key={g.t} className="lx-row" tabIndex={0} onPointerEnter={dir} onPointerLeave={dir} data-reveal="up" style={{ ["--d" as string]: i }}>
          <span className="lx-row-n">{String(i + 1).padStart(2, "0")}</span>
          <span className="lx-row-t">{g.t}</span>
          <span className="lx-row-d">{g.d}</span>
          <span className="lx-row-arrow" aria-hidden="true">→</span>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Landing({ consoleHref, authed }: { consoleHref: string; authed: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const chapters = useRef<(HTMLElement | null)[]>([]);
  const progress = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const ecg = useRef<SVGPathElement>(null);
  const scene = useRef<ScopeScene | null>(null);
  const [active, setActive] = useState(0);
  const [halted, setHalted] = useState(false);
  const [stats, setStats] = useState<{ total: number; inScope: number; refused: number } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = root.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;

    const ink = [10, 9, 15], paper = [233, 238, 231];
    const onFrame = (f: Frame) => {
      const p = f.paper;
      el.style.setProperty("--lx-paper", p.toFixed(3));
      el.style.backgroundColor = `rgb(${ink.map((v, i) => Math.round(v + (paper[i] - v) * p)).join(",")})`;
    };
    const sc = new ScopeScene(canvas.current!, { mobile, reduced, onFrame });
    scene.current = sc;
    setStats(sc.stats);
    sc.start();

    let metrics: { top: number; height: number }[] = [];
    let overflow = 0;
    let plates: HTMLElement[] = [];
    let lastPlate = -1;
    let lastActive = -1;
    let ticking = false;

    const measure = () => {
      const y = window.scrollY;
      metrics = chapters.current.map((c) => {
        const r = c!.getBoundingClientRect();
        return { top: r.top + y, height: c!.offsetHeight };
      });
      if (track.current) {
        overflow = Math.max(0, track.current.scrollWidth - window.innerWidth);
        plates = Array.from(track.current.querySelectorAll<HTMLElement>(".lx-plate"));
      }
    };

    const update = () => {
      ticking = false;
      const y = window.scrollY, vh = window.innerHeight;
      const center = y + vh / 2;
      let i = 0;
      for (let k = 0; k < metrics.length; k++) if (metrics[k].top <= center) i = k;
      const m = metrics[i];
      const local = m ? Math.min(0.999, Math.max(0, (center - m.top) / m.height)) : 0;
      sc.setTarget(i + local);
      if (i !== lastActive) { lastActive = i; setActive(i); }

      const docH = document.documentElement.scrollHeight - vh;
      if (progress.current) progress.current.style.transform = `scaleX(${docH > 0 ? y / docH : 0})`;

      const lc = metrics[3];
      if (lc && track.current) {
        const lp = Math.min(1, Math.max(0, (y - lc.top) / Math.max(1, lc.height - vh)));
        track.current.style.transform = `translate3d(${-lp * overflow}px,0,0)`;
        if (ecg.current) ecg.current.style.strokeDashoffset = String(1 - lp);
        const idx = Math.min(plates.length - 1, Math.floor(lp * plates.length * 0.999 + 0.0001));
        if (idx !== lastPlate) {
          plates.forEach((p, k) => { p.classList.toggle("is-live", k === idx); p.classList.toggle("is-past", k < idx); });
          lastPlate = idx;
        }
      }
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    const onResize = () => { measure(); sc.resize(); update(); };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      sc.setMouse((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1, e.clientX, e.clientY);
    };
    const onVis = () => (document.hidden ? sc.stop() : sc.start());

    measure();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    // fonts shift layout → re-measure once they settle
    document.fonts?.ready.then(onResize).catch(() => {});

    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } }),
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
    );
    el.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
    const raf = requestAnimationFrame(() => setReady(true));

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      sc.destroy();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => { scene.current?.setHalted(halted); }, [halted]);

  const goTo = (i: number) => {
    const c = chapters.current[i];
    if (!c) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY, behavior: reduced ? "auto" : "smooth" });
  };
  const setChapter = (i: number) => (n: HTMLElement | null) => { chapters.current[i] = n; };
  const evaluate = useMemo(() => (ok: boolean) => scene.current?.ping(ok), []);

  return (
    <div ref={root} className={`lx ${ready ? "is-ready" : ""} ${halted ? "is-halted" : ""}`}>
      <a className="lx-skip" href={consoleHref}>Skip to the console</a>
      <canvas ref={canvas} className="lx-canvas" aria-hidden="true" />
      <div className="lx-grain" aria-hidden="true" />
      <Cursor />

      {/* ------------------------------------------------------------ nav */}
      <header className="lx-nav">
        <div className="lx-progress" ref={progress} />
        <Link href="/" className="lx-brand" aria-label="ScopeGraph X home">
          <span className="lx-mark" aria-hidden="true"><i /><i /><i /></span>
          ScopeGraph<b>X</b>
        </Link>
        <nav className="lx-ticks" aria-label="Chapters">
          {CHAPTERS.map((c, i) => (
            <button
              key={c} type="button" onClick={() => goTo(i)} aria-label={`Go to ${CHAPTER_LABELS[i]}`}
              aria-current={active === i ? "step" : undefined} className={active === i ? "on" : ""}
            >
              <span className="n">{String(i).padStart(2, "0")}</span>
              <span className="l">{CHAPTER_LABELS[i]}</span>
            </button>
          ))}
        </nav>
        <div className="lx-nav-end">
          <span className="lx-status" aria-live="polite">
            <span className="lx-pulse" /> egress {halted ? "halted" : "live"}
          </span>
          <Magnetic strength={0.2}>
            <Link href={consoleHref} className="lx-btn lx-btn-sm" data-cursor="enter">
              {authed ? "Open console" : "Sign in"}
            </Link>
          </Magnetic>
        </div>
      </header>

      <main id="top">
        {/* ------------------------------------------------------------ 00 hero */}
        <section ref={setChapter(0)} className="lx-ch lx-hero" aria-labelledby="lx-h0">
          <div className="lx-wrap">
            <p className="lx-eyebrow lx-fade">Authorized security research · scope-controlled by design</p>
            <h1 id="lx-h0" className="lx-display">
              <Split text="Security research" />
              <br />
              <Split text="that never crosses" className="dim" />
              <br />
              <span className="lx-line-word">
                <Split text="the line." />
                <svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M2 14 C 80 4, 160 22, 240 12 S 360 6, 398 13" pathLength={1} />
                </svg>
              </span>
            </h1>
            <p className="lx-lede lx-fade">
              ScopeGraph X turns your authorization contract into executable policy, maps only the attack surface it permits,
              and carries every finding from hypothesis to evidence — behind a gateway that refuses anything out of bounds.
            </p>
            <div className="lx-cta-row lx-fade">
              <Magnetic>
                <Link href={consoleHref} className="lx-btn" data-cursor="enter">
                  <span>{authed ? "Open the console" : "Start a program"}</span>
                  <span className="lx-btn-arrow" aria-hidden="true">↗</span>
                </Link>
              </Magnetic>
              <button type="button" className="lx-ghost" onClick={() => goTo(1)} data-cursor="scroll">
                Watch the scope form <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>
          <div className="lx-hero-foot lx-fade" aria-hidden="true">
            <span>FIG. 00 — UNBOUNDED SURFACE</span>
            {stats && (
              <span className="lx-readout">
                {stats.total} hosts observed · <em className="mint">{stats.inScope} authorized</em> · <em className="coral">{stats.refused} refused</em>
              </span>
            )}
            <span className="lx-scrollcue"><i /> scroll</span>
          </div>
        </section>

        {/* ------------------------------------------------------------ 01 scope */}
        <section ref={setChapter(1)} className="lx-ch lx-tall" aria-labelledby="lx-h1">
          <div className="lx-sticky">
            <div className="lx-wrap lx-col-left">
              <p className="lx-kicker" data-reveal="up"><span>01</span> Scope as code</p>
              <h2 id="lx-h1" className="lx-h2" data-reveal="words"><Split text="Your contract becomes the boundary." /></h2>
              <p className="lx-body" data-reveal="up">
                Paste the engagement terms; get a versioned, approved policy. Deny always beats allow, and every request the
                platform makes is checked against it first. Try it — this runs the same matcher the gateway uses.
              </p>
              <PolicyEvaluator onEvaluate={evaluate} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ 02 graph */}
        <section ref={setChapter(2)} className="lx-ch lx-tall" aria-labelledby="lx-h2">
          <div className="lx-sticky">
            <div className="lx-wrap lx-col-right">
              <p className="lx-kicker" data-reveal="up"><span>02</span> Attack surface graph</p>
              <h2 id="lx-h2" className="lx-h2" data-reveal="words"><Split text="Map what you may see. Nothing else." /></h2>
              <p className="lx-body" data-reveal="up">
                Discovery feeds a living graph of programs, assets, endpoints and identities. Hosts found through DNS, CT
                logs or OpenAPI imports start as <em>discovered</em> — they only become testable when the policy says so.
              </p>
              <div className="lx-chain" data-reveal="up" aria-label="Graph relationships">
                {["Program", "Asset", "Endpoint", "Identity"].map((x, i) => (
                  <span key={x} style={{ ["--d" as string]: i }}>
                    <b>{x}</b>
                    {i < 3 && <i aria-hidden="true" />}
                  </span>
                ))}
              </div>
              <ul className="lx-ladder" data-reveal="up">
                <li><span className="sw coral" />Discovered</li>
                <li><span className="sw amber" />Associated</li>
                <li><span className="sw mint" />Authorized</li>
                <li><span className="sw strike" />Denied</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ 03 lifecycle (pinned horizontal) */}
        <section ref={setChapter(3)} className="lx-ch lx-pin" aria-labelledby="lx-h3">
          <div className="lx-sticky lx-sticky-col">
            <div className="lx-wrap lx-pin-head">
              <p className="lx-kicker" data-reveal="up"><span>03</span> Evidence lifecycle</p>
              <h2 id="lx-h3" className="lx-h2" data-reveal="words"><Split text="A finding is a claim until it's proven." /></h2>
            </div>
            <div className="lx-track-wrap">
              <svg className="lx-ecg" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
                <path
                  ref={ecg} pathLength={1}
                  d="M0 20 H90 l8 -14 l8 26 l8 -12 H230 l8 -14 l8 26 l8 -12 H370 l8 -14 l8 26 l8 -12 H510 l8 -14 l8 26 l8 -12 H650 l8 -14 l8 26 l8 -12 H790 l8 -14 l8 26 l8 -12 H930 l8 -14 l8 26 l8 -12 H1000"
                />
              </svg>
              <div className="lx-track" ref={track}>
                {LIFECYCLE.map((l, i) => (
                  <article className="lx-plate" key={l.state}>
                    <span className="lx-plate-n">{String(i + 1).padStart(2, "0")}</span>
                    <h3>{l.state}</h3>
                    <p>{l.copy}</p>
                    <span className="lx-gate">gate · {l.gate}</span>
                  </article>
                ))}
                <article className="lx-plate lx-plate-off">
                  <span className="lx-plate-n">↳</span>
                  <h3>Off-ramps</h3>
                  <p>REJECTED · DUPLICATE · FALSE POSITIVE — every exit is recorded with a reason, never silently dropped.</p>
                  <span className="lx-gate">gate · reason required</span>
                </article>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ 04 stop */}
        <section ref={setChapter(4)} className="lx-ch lx-tall lx-stop" aria-labelledby="lx-h4">
          <div className="lx-sticky">
            <div className="lx-wrap lx-center">
              <p className="lx-kicker" data-reveal="up"><span>04</span> Emergency stop</p>
              <h2 id="lx-h4" className="lx-h2 lx-h2-xl" data-reveal="words"><Split text="One switch. Everything stops." /></h2>
              <p className="lx-body" data-reveal="up">
                One tenant-wide control halts running campaigns and blocks new test approvals until an operator releases it.
                Go on — hold it and watch the surface freeze.
              </p>
              <KillSwitch halted={halted} onToggle={() => setHalted((h) => !h)} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ 05 guardrails */}
        <section ref={setChapter(5)} className="lx-ch lx-guard" aria-labelledby="lx-h5">
          <div className="lx-wrap">
            <p className="lx-kicker" data-reveal="up"><span>05</span> Guardrails, not guidelines</p>
            <h2 id="lx-h5" className="lx-h2" data-reveal="words"><Split text="Safety is enforced in code, not in a policy PDF." /></h2>
            <GuardrailIndex />
          </div>
          <div className="lx-marquee" aria-label="Built-in roles">
            <div className="lx-marquee-inner">
              {[0, 1].map((k) => (
                <span key={k} aria-hidden={k === 1}>
                  {ROLES.map((r) => <span key={r}>{r}<i>✳</i></span>)}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ 06 final */}
        <section ref={setChapter(6)} className="lx-ch lx-final" aria-labelledby="lx-h6">
          <div className="lx-wrap lx-center">
            <p className="lx-kicker" data-reveal="up"><span>06</span> The instrument</p>
            <h2 id="lx-h6" className="lx-display lx-final-title" data-reveal="words">
              <Split text="The scope" />
              <br />
              <Split text="is the product." />
            </h2>
            <p className="lx-body" data-reveal="up">Programs, policy, graph, evidence and audit — one instrument, one boundary.</p>
            <div className="lx-cta-row lx-center-row" data-reveal="up">
              <Magnetic>
                <Link href={consoleHref} className="lx-btn lx-btn-press" data-cursor="enter">
                  <span>{authed ? "Open the console" : "Sign in to ScopeGraph X"}</span>
                  <span className="lx-btn-arrow" aria-hidden="true">↗</span>
                </Link>
              </Magnetic>
            </div>
          </div>
          <footer className="lx-foot">
            <span>ScopeGraph X</span>
            <span>Authorized testing only · every request is policy-checked and audited</span>
            <button type="button" onClick={() => goTo(0)} data-cursor="top">Back to top ↑</button>
          </footer>
        </section>
      </main>
    </div>
  );
}
