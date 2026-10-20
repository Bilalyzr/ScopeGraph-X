import Link from "next/link";

/**
 * Deterministic back navigation on detail pages — always targets the parent
 * list (never browser-back, which can leave the app). Rendered as a small
 * ghost button above the page header.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="back-link"
      aria-label={`Back to ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        fontSize: "0.78rem",
        fontWeight: 600,
        color: "var(--text-muted)",
        marginBottom: "0.7rem",
        textDecoration: "none",
      }}
    >
      ← {label}
    </Link>
  );
}
