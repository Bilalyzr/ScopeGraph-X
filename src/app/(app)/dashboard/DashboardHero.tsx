"use client";

import "@/components/landing/landing.css";
import "./dashboard.css";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ScopeScene } from "@/components/landing/ScopeScene";
import { Magnetic, Split } from "@/components/landing/motion";

export interface HeroCounts {
  programs: number;
  authorized: number;
  endpoints: number;
  outside: number;
  findings: number;
}

export function DashboardHero({
  counts, halted, orgName, role, denials, candidates,
}: {
  counts: HeroCounts;
  halted: boolean;
  orgName: string;
  role: string;
  denials: number;
  candidates: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const empty = counts.programs + counts.authorized + counts.endpoints + counts.outside === 0;

  useEffect(() => {
    const el = canvas.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    const scene = new ScopeScene(el, {
      mobile, reduced, interactive: false,
      // Every node maps to a real record count (capped for rendering cost).
      counts: {
        core: Math.min(counts.programs, 12),
        s1: Math.min(counts.authorized, 80),
        s2: Math.min(counts.endpoints, mobile ? 160 : 360),
        out: Math.min(counts.outside, mobile ? 120 : 260),
      },
      frame: {
        morph: 1, edges: 0.9, labels: 0, pulses: counts.findings > 0 ? 0.55 : 0, boundary: 1,
        outside: 0.55, dist: mobile ? 3.1 : 3.3, offX: 0, offY: 0, tilt: 0.32, dim: 1, paper: 0, rot: 0.6,
      },
    });
    scene.setHalted(halted);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(el);
    // Only animate while the hero is on screen.
    const io = new IntersectionObserver(([en]) => (en.isIntersecting && !document.hidden ? scene.start() : scene.stop()), { threshold: 0 });
    io.observe(wrap.current!);
    const onVis = () => (document.hidden ? scene.stop() : scene.start());
    document.addEventListener("visibilitychange", onVis);
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      scene.setMouse(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, -9999, -9999);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    scene.start();
    return () => {
      ro.disconnect(); io.disconnect(); scene.destroy();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [counts.programs, counts.authorized, counts.endpoints, counts.outside, counts.findings, halted]);

  return (
    <section ref={wrap} className={`dx-hero ${halted ? "is-halted" : ""}`} aria-labelledby="dx-title">
      <div className="dx-hero-copy">
        <p className="dx-kicker dx-kicker-night" data-reveal="up">
          <span>00</span> Instrument panel · {orgName}
        </p>
        <h1 id="dx-title" className="dx-display" data-reveal="words">
          {halted ? (
            <>
              <Split text="Everything" /> <br />
              <Split text="has stopped." className="coral" />
            </>
          ) : (
            <>
              <Split text="Everything inside" /> <br />
              <Split text="the line." className="dim" />
            </>
          )}
        </h1>
        <p className="dx-lede" data-reveal="up">
          {empty ? (
            <>No programs yet. Import an engagement contract to draw your first scope boundary.</>
          ) : (
            <>
              <b className="mint">{counts.authorized}</b> authorized assets across <b>{counts.programs}</b>{" "}
              {counts.programs === 1 ? "program" : "programs"} · <b className="coral">{denials}</b> requests refused at the gateway ·{" "}
              <b>{candidates}</b> {candidates === 1 ? "candidate" : "candidates"} awaiting review.
            </>
          )}
        </p>
        <div className="dx-cta-row" data-reveal="up">
          <Magnetic>
            <Link href={empty ? "/programs" : "/campaigns"} className="dx-btn" data-cursor="enter">
              <span>{empty ? "Create a program" : "Dispatch campaign"}</span>
              <span className="dx-btn-arrow" aria-hidden="true">↗</span>
            </Link>
          </Magnetic>
          <Link href="/findings" className="dx-ghost">Review findings <span aria-hidden="true">→</span></Link>
        </div>
      </div>

      <div className="dx-hero-scene" aria-hidden="true">
        <canvas ref={canvas} className="dx-canvas" />
        {empty && <span className="dx-scene-empty">No scope drawn yet</span>}
      </div>

      <div className="dx-hero-foot" aria-hidden="true">
        <span>FIG. 01 — LIVE SCOPE · ROLE {role}</span>
        <span className="dx-legend">
          <i className="sw mint" /> {counts.authorized} authorized
          <i className="sw ring" /> {counts.endpoints} endpoints
          <i className="sw coral" /> {counts.outside} outside authorization
        </span>
        <span className={`dx-status ${halted ? "halted" : ""}`}>
          <span className="lx-pulse" /> egress {halted ? "halted" : "live"}
        </span>
      </div>
    </section>
  );
}
