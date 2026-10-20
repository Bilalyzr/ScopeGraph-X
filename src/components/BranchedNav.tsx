"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavGroup {
  code: string;
  section: string;
  items: Array<{ href: string; label: string; code: string }>;
}

const PAD = 6;
const MARK = 16;

function routeIcon(code: string): ReactNode {
  const props = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (code) {
    case "SYS":
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "PRM":
      return (
        <svg {...props}>
          <path d="M12 3l8 4v5c0 5.25-3.4 9.74-8 11-4.6-1.26-8-5.75-8-11V7l8-4z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "AST":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.6 9h16.8M3.6 15h16.8M12 3a14.5 14.5 0 0 0 0 18M12 3a14.5 14.5 0 0 1 0 18" />
        </svg>
      );
    case "KGR":
      return (
        <svg {...props}>
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="12" cy="18" r="3" />
          <path d="M8.6 7.5L10.5 15.5M15.4 7.5L13.5 15.5M9 6h6" />
        </svg>
      );
    case "CMP":
      return (
        <svg {...props}>
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "HYP":
      return (
        <svg {...props}>
          <path d="M9 3h6M10 3v5.4L5.2 17A2 2 0 0 0 7 20h10a2 2 0 0 0 1.8-3L14 8.4V3" />
        </svg>
      );
    case "FND":
      return (
        <svg {...props}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "RPT":
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
      );
    case "AUD":
      return (
        <svg {...props}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "ADM":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
  }
}

export function BranchedNav({
  groups,
  width = 240,
  rowHeight = 36,
  indent = 38,
  trunk = 10,
  radius = 10,
  lineWidth = 1.65,
  fontSize = 14,
  drawDuration = 400,
  foldDuration = 300,
}: {
  groups: NavGroup[];
  width?: number;
  rowHeight?: number;
  indent?: number;
  trunk?: number;
  radius?: number;
  lineWidth?: number;
  fontSize?: number;
  drawDuration?: number;
  foldDuration?: number;
}) {
  const pathname = usePathname() ?? "/dashboard";

  // Resolve which child href is currently active based on pathname
  const activeHref = (() => {
    for (const g of groups) {
      for (const item of g.items) {
        if (pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))) {
          return item.href;
        }
      }
    }
    return "/dashboard";
  })();

  const activeSection = groups.findIndex((g) => g.items.some((it) => it.href === activeHref));

  // Open all sections by default so all routes remain immediately accessible,
  // while still supporting React Bits collapsible trunk behavior.
  const [open, setOpen] = useState<Set<number>>(() => new Set(groups.map((_, idx) => idx)));
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);

  // Ensure the active section automatically opens on route change
  useEffect(() => {
    if (activeSection >= 0) {
      setOpen((prev) => {
        if (prev.has(activeSection)) return prev;
        const next = new Set(prev);
        next.add(activeSection);
        return next;
      });
    }
  }, [activeSection]);

  const navRef = useRef<HTMLElement>(null);
  const heads = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRef = useRef<HTMLSpanElement>(null);

  const markerShown = activeSection >= 0 && open.has(activeSection);

  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const m = markerRef.current;
      const el = heads.current[activeSection];
      if (!m) return;
      const on = markerShown && el;
      if (!glide) m.style.transition = "none";
      if (on) m.style.top = `${el.offsetTop + (el.offsetHeight - MARK) / 2}px`;
      m.toggleAttribute("data-on", Boolean(on));
      if (!glide) {
        void m.offsetHeight;
        m.style.transition = "";
      }
    };
    place(true);
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      place(false);
    });
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [activeSection, markerShown, groups, fontSize, rowHeight]);

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // Exact React Bits BranchedMenu SVG geometry
  const r = Math.min(radius, rowHeight / 2 - 2);
  const endX = indent - 8;
  const rowY = (k: number) => PAD + k * rowHeight + rowHeight / 2;
  const branch = (k: number) =>
    `M ${trunk} ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const reach = (k: number) =>
    `M ${trunk} 0 V ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const length = (k: number) => rowY(k) - r + (Math.PI * r) / 2 + (endX - trunk - r);

  return (
    <nav
      ref={navRef}
      className="branched-menu"
      aria-label="Main instrument navigation"
      style={
        {
          "--bm-w": `${width}px`,
          "--bm-ink": "var(--ink)",
          "--bm-accent": "var(--coral)",
          "--bm-line": "rgba(53, 53, 57, 0.28)",
          "--bm-font": `${fontSize}px`,
          "--bm-row": `${rowHeight}px`,
          "--bm-indent": `${indent}px`,
          "--bm-line-w": lineWidth,
          "--bm-draw": `${drawDuration}ms`,
          "--bm-fold": `${foldDuration}ms`,
        } as CSSProperties
      }
    >
      <span ref={markerRef} className="branched-menu__marker" aria-hidden="true" />
      {groups.map((group, i) => {
        const kids = group.items;
        const isOpen = open.has(i);
        const sectionHasActive = i === activeSection;
        const bodyH = PAD * 2 + kids.length * rowHeight;

        return (
          <div
            key={group.section}
            className="branched-menu__section"
            data-open={isOpen ? "" : undefined}
          >
            <button
              ref={(el) => {
                heads.current[i] = el;
              }}
              type="button"
              className="branched-menu__head"
              aria-expanded={isOpen}
              data-active={sectionHasActive ? "" : undefined}
              onClick={() => toggle(i)}
            >
              <span className="branched-menu__head-pill">{group.code}</span>
              <span className="branched-menu__head-title">{group.section}</span>
              <span className="branched-menu__head-chevron" aria-hidden="true">
                {isOpen ? "−" : "+"}
              </span>
            </button>

            <div className="branched-menu__body">
              <div className="branched-menu__fold">
                <div className="branched-menu__tree" style={{ height: bodyH }}>
                  <svg
                    className="branched-menu__lines"
                    width={indent}
                    height={bodyH}
                    aria-hidden="true"
                  >
                    <path
                      className="branched-menu__base"
                      d={`M ${trunk} 0 V ${rowY(kids.length - 1) - r}`}
                    />
                    {kids.map((kid, k) => (
                      <path key={kid.href} className="branched-menu__base" d={branch(k)} />
                    ))}
                    {kids.map((kid, k) => {
                      const traced = kid.href === activeHref || kid.href === hoveredHref;
                      return (
                        <path
                          key={kid.href}
                          className="branched-menu__reach"
                          d={reach(k)}
                          style={{
                            strokeDasharray: length(k),
                            strokeDashoffset: traced ? 0 : length(k),
                          }}
                        />
                      );
                    })}
                  </svg>

                  {kids.map((kid) => {
                    const isActive = kid.href === activeHref;
                    return (
                      <Link
                        key={kid.href}
                        href={kid.href}
                        className="branched-menu__item"
                        aria-current={isActive ? "page" : undefined}
                        data-active={isActive ? "" : undefined}
                        title={`${kid.label} (${kid.code})`}
                        tabIndex={isOpen ? 0 : -1}
                        onMouseEnter={() => setHoveredHref(kid.href)}
                        onMouseLeave={() => setHoveredHref(null)}
                      >
                        <span className="branched-menu__icon" aria-hidden="true">
                          {routeIcon(kid.code)}
                        </span>
                        <span className="branched-menu__label">{kid.label}</span>
                        <span className="branched-menu__code">{kid.code}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
