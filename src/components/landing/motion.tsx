"use client";

import { useEffect, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";

/** Word-by-word mask reveal (shared by the Home page and the console). */
export function Split({ text, className = "" }: { text: string; className?: string }) {
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
export function Magnetic({ children, strength = 0.32 }: { children: ReactNode; strength?: number }) {
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

/** Adds `is-in` to every [data-reveal] descendant as it scrolls into view. */
export function RevealScope({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.classList.add("is-ready");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } }),
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    root.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

/** Direction-aware hover: records whether the pointer entered from the top or bottom edge. */
export function dirAware(e: ReactPointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dataset.dir = e.clientY - r.top < r.height / 2 ? "top" : "bottom";
}
