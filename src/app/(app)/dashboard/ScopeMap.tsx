"use client";

import { useEffect, useRef } from "react";
import { ScopeScene } from "@/components/landing/ScopeScene";

/** Compact live scope map — the landing page's 3D scope engine, driven by real counts. */
export function ScopeMap({ programs, authorized, endpoints, outside, findings, halted }: { programs: number; authorized: number; endpoints: number; outside: number; findings: number; halted: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const empty = programs + authorized + endpoints + outside === 0;

  useEffect(() => {
    const el = canvas.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    const scene = new ScopeScene(el, {
      mobile,
      reduced,
      interactive: false,
      counts: { core: Math.min(programs, 12), s1: Math.min(authorized, 80), s2: Math.min(endpoints, mobile ? 120 : 240), out: Math.min(outside, mobile ? 80 : 180) },
      frame: { morph: 1, edges: 0.9, labels: 0, pulses: findings > 0 ? 0.55 : 0, boundary: 1, outside: 0.55, dist: 3.4, offX: 0, offY: 0, tilt: 0.32, dim: 1, paper: 0, rot: 0.6 },
    });
    scene.setHalted(halted);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(el);
    const io = new IntersectionObserver(([en]) => (en.isIntersecting && !document.hidden ? scene.start() : scene.stop()));
    io.observe(el);
    const onVis = () => (document.hidden ? scene.stop() : scene.start());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ro.disconnect();
      io.disconnect();
      scene.destroy();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [programs, authorized, endpoints, outside, findings, halted]);

  return (
    <div className="ax-scope" aria-hidden="true">
      <canvas ref={canvas} />
      {empty && <span className="ax-scope-empty">No scope drawn yet</span>}
    </div>
  );
}
