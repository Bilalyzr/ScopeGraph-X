# Accessibility Audit Report (internal)

Generated: 2026-10-20T09:53:14.849Z by `npm run a11y` (scripts/a11y-audit.ts).

**Scope note:** this is an INTERNAL automated audit — static JSX checks plus design-token
contrast computation. It is NOT a formal WCAG 2.2 AA certification or a third-party
assessment; assistive-technology and screen-reader testing remain manual gates.

## 1. Contrast ratios (dark theme tokens, WCAG 1.4.3)

| Pair | Ratio | Requirement | Verdict |
|---|---|---|---|
| body text / background (`#353539` on `#e9eee7`) | 10.38:1 | 4.5:1 | PASS |
| faint text / background (large/incidental only) (`#6e6e68` on `#e9eee7`) | 4.36:1 | 3:1 | PASS |

## 2. Static JSX checks

**1 finding(s):**

| File | Line | Rule | Snippet |
|---|---|---|---|
| `src/components/landing/Landing.tsx` | 192 | autocomplete-off (1.3.5 — informational) | `ellCheck={false} autoComplete="off" onChange={(e) => { touched.current = true; s` |

## 3. Already-implemented conformance measures

- Skip-to-content link (2.4.1) and `:focus-visible` outlines (2.4.7)
- `prefers-reduced-motion` disables transitions/animations (2.3.3)
- Semantic landmarks (`nav[aria-label]`, `main#main`), labelled form fields, `role=alert`/`role=status` feedback (4.1.2/4.1.3)
- Theme toggle with pre-paint application; both themes keep token-based contrast
- Tables used for data (not layout); `aria-hidden` on decorative SVGs
