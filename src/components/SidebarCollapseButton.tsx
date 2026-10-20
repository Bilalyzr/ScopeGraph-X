"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "sgx-sidebar-collapsed";

export function SidebarCollapseButton({ variant = "sidebar" }: { variant?: "sidebar" | "topbar" }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 860px)");
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const initial = mql.matches ? true : saved === "1";
    setCollapsed(initial);
    document.documentElement.dataset.sidebar = initial ? "collapsed" : "expanded";

    const onMediaChange = (e: MediaQueryListEvent) => {
      const next = e.matches ? true : window.localStorage.getItem(STORAGE_KEY) === "1";
      setCollapsed(next);
      document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
      window.dispatchEvent(new CustomEvent("sgx-sidebar-sync", { detail: next }));
    };

    const onSync = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setCollapsed(next);
    };

    mql.addEventListener("change", onMediaChange);
    window.addEventListener("sgx-sidebar-sync", onSync);
    return () => {
      mql.removeEventListener("change", onMediaChange);
      window.removeEventListener("sgx-sidebar-sync", onSync);
    };
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    window.dispatchEvent(new CustomEvent("sgx-sidebar-sync", { detail: next }));
  }

  return (
    <button
      type="button"
      className={`sidebar-collapse-btn ${variant}`}
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar (colspan)" : "Collapse sidebar (colspan)"}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <line x1="9" y1="3" x2="9" y2="21" />
        {collapsed ? (
          <polyline points="13 9 16 12 13 15" />
        ) : (
          <polyline points="16 9 13 12 16 15" />
        )}
      </svg>
    </button>
  );
}
