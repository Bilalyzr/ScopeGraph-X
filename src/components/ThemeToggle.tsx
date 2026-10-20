"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = (localStorage.getItem("sgx-theme") as "dark" | "light" | null) ?? "dark";
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("sgx-theme", next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button className="btn small" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
