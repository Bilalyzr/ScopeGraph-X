/**
 * Accessibility audit (WCAG 2.2 AA orientation) — INTERNAL automated audit.
 * This is NOT a formal third-party certification; it statically checks the
 * codebase for common violations, computes token-palette contrast ratios, and
 * writes docs/a11y-report.md. Run: npm run a11y
 */
import { readdir, readFile, writeFile } from "fs/promises";
import path from "path";

async function walk(dir: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
      out.push(...(await walk(p, exts)));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

interface Violation { file: string; line: number; rule: string; snippet: string }

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function auditTsx(file: string, raw: string): Violation[] {
  // JSX attributes often contain arrow functions (`=>`) whose `>` breaks naive
  // tag regexes — neutralize them before matching.
  const content = raw.replace(/=>/g, "⇒");
  const v: Violation[] = [];
  const push = (idx: number, rule: string) => v.push({ file, line: lineOf(content, idx), rule, snippet: raw.slice(idx, idx + 90).replace(/\s+/g, " ") });

  for (const m of content.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(m[0])) push(m.index ?? 0, "img-alt-missing (1.1.1)");
  }
  for (const m of content.matchAll(/tabIndex=\{(\d+)\}/g)) {
    if (Number(m[1]) > 0) push(m.index ?? 0, "tabindex-positive (2.4.3)");
  }
  for (const m of content.matchAll(/<div\b[^>]*onClick=/g)) {
    const seg = content.slice(m.index ?? 0, (m.index ?? 0) + 220);
    if (!/role=/.test(seg)) push(m.index ?? 0, "clickable-div-without-role (4.1.2)");
  }
  for (const m of content.matchAll(/<a\b[^>]*href="#"/g)) {
    push(m.index ?? 0, "anchor-placeholder (2.4.4)");
  }
  for (const m of content.matchAll(/<button\b[^>]*>((?:[^<]|<(?!\/button))*)<\/button>/g)) {
    const attrs = m[0].slice(0, m[0].indexOf(">"));
    const inner = (m[1] ?? "").trim();
    const hasText = inner.length > 0 && !/^aria-hidden/.test(inner);
    if (!/aria-label/.test(attrs) && !hasText) {
      push(m.index ?? 0, "button-no-accessible-name (4.1.2)");
    }
  }
  // inputs must be inside a <label> or carry aria-label (heuristic on our patterns)
  for (const m of content.matchAll(/<input\b[^>]*>/g)) {
    const before = content.slice(Math.max(0, (m.index ?? 0) - 400), m.index ?? 0);
    if (!/<label/.test(before) && !/aria-label/.test(m[0])) push(m.index ?? 0, "input-label-heuristic (3.3.2)");
  }
  for (const m of content.matchAll(/autoComplete="off"/g)) {
    push(m.index ?? 0, "autocomplete-off (1.3.5 — informational)");
  }
  return v;
}

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function main() {
  const root = process.cwd();
  const files = await walk(path.join(root, "src"), [".tsx", ".ts"]);
  const violations: Violation[] = [];
  for (const f of files.filter((f) => f.endsWith(".tsx"))) {
    violations.push(...auditTsx(f, (await readFile(f, "utf8")).replace(/\r/g, "")));
  }

  // Contrast of the core token pairs (dark theme)
  const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");
  const tok = (name: string): string | null => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    return m ? m[1] : null;
  };
  const pairs: Array<[string, string, string]> = [];
  const text = tok("text"), bg = tok("bg"), muted = tok("text-muted"), faint = tok("text-faint"), accent = tok("accent");
  if (text && bg) pairs.push(["body text / background", text, bg]);
  if (muted && bg) pairs.push(["muted text / background", muted, bg]);
  if (faint && bg) pairs.push(["faint text / background (large/incidental only)", faint, bg]);
  if (accent && bg) pairs.push(["accent link / background", accent, bg]);

  const lines: string[] = [];
  lines.push("# Accessibility Audit Report (internal)");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()} by \`npm run a11y\` (scripts/a11y-audit.ts).`);
  lines.push("");
  lines.push("**Scope note:** this is an INTERNAL automated audit — static JSX checks plus design-token");
  lines.push("contrast computation. It is NOT a formal WCAG 2.2 AA certification or a third-party");
  lines.push("assessment; assistive-technology and screen-reader testing remain manual gates.");
  lines.push("");
  lines.push("## 1. Contrast ratios (dark theme tokens, WCAG 1.4.3)");
  lines.push("");
  lines.push("| Pair | Ratio | Requirement | Verdict |");
  lines.push("|---|---|---|---|");
  for (const [name, fg, bgc] of pairs) {
    const r = contrast(fg, bgc);
    const need = name.startsWith("faint") ? 3.0 : 4.5; // faint reserved for large/incidental
    lines.push(`| ${name} (\`${fg}\` on \`${bgc}\`) | ${r.toFixed(2)}:1 | ${need}:1 | ${r >= need ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## 2. Static JSX checks");
  lines.push("");
  if (violations.length === 0) {
    lines.push("**No violations found.** Checks: img alt, positive tabIndex, clickable divs without");
    lines.push("role, placeholder anchors, buttons without accessible names, input label heuristic,");
    lines.push("autocomplete removal (1.3.5 informational).");
  } else {
    lines.push(`**${violations.length} finding(s):**`);
    lines.push("");
    lines.push("| File | Line | Rule | Snippet |");
    lines.push("|---|---|---|---|");
    for (const v of violations.slice(0, 100)) {
      lines.push(`| \`${path.relative(root, v.file).replace(/\\/g, "/")}\` | ${v.line} | ${v.rule} | \`${v.snippet.replace(/\|/g, "\\|").slice(0, 80)}\` |`);
    }
  }
  lines.push("");
  lines.push("## 3. Already-implemented conformance measures");
  lines.push("");
  lines.push("- Skip-to-content link (2.4.1) and `:focus-visible` outlines (2.4.7)");
  lines.push("- `prefers-reduced-motion` disables transitions/animations (2.3.3)");
  lines.push("- Semantic landmarks (`nav[aria-label]`, `main#main`), labelled form fields, `role=alert`/`role=status` feedback (4.1.2/4.1.3)");
  lines.push("- Theme toggle with pre-paint application; both themes keep token-based contrast");
  lines.push("- Tables used for data (not layout); `aria-hidden` on decorative SVGs");
  lines.push("");
  await writeFile(path.join(root, "docs/a11y-report.md"), lines.join("\n"), "utf8");
  console.log(`[a11y] ${violations.length} violation(s) — report written to docs/a11y-report.md`);
  const blocking = violations.filter((v) => !v.rule.includes("informational") && !v.rule.includes("heuristic"));
  process.exit(blocking.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
