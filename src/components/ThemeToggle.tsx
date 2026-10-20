"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"paper" | "ledger">("paper");

  useEffect(() => {
    const stored = (localStorage.getItem("sgx-signal-theme") as "paper" | "ledger" | null) ?? "paper";
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
  }, []);

  function toggle() {
    const next = theme === "paper" ? "ledger" : "paper";
    setTheme(next);
    localStorage.setItem("sgx-signal-theme", next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button
      className="btn small"
      onClick={toggle}
      aria-label={`Switch paper stock to ${theme === "paper" ? "Bone Ledger" : "Sage Press"}`}
      title="Switch editorial paper stock"
    >
      <span className="signal-dot" style={{ background: theme === "paper" ? "var(--mint)" : "var(--coral)" }} />
      {theme === "paper" ? "STOCK: SAGE" : "STOCK: BONE"}
    </button>
  );
}
