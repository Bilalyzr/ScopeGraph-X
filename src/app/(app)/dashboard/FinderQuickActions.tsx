"use client";

import Link from "next/link";
import { ApiAction } from "@/components/ApiAction";

/** Quick-action strip atop the Finder Workbench (hunt-day shortcuts). */
export function FinderQuickActions({ programId }: { programId: string | null }) {
  return (
    <div className="row" style={{ gap: "0.6rem", margin: "0 0 1.2rem", flexWrap: "wrap" }}>
      <Link href="/campaigns" className="btn small primary">▶ New campaign</Link>
      {programId ? (
        <ApiAction
          label="🧪 Run BOLA/BFLA fixtures"
          method="POST"
          url="/api/v1/findings"
          body={{
            program_id: programId,
            run_differential_fixtures: true,
            title: "fixture batch",
            description: "fixture batch execution",
            category: "BOLA",
            severity: "HIGH",
            confidence: 0.5,
          }}
          className="btn small"
          confirmText="Run seeded differential-authorization fixtures and create candidate findings?"
        />
      ) : (
        <Link href="/programs" className="btn small">＋ Create a program first</Link>
      )}
      <Link href="/research" className="btn small">🔬 Hypotheses &amp; tests</Link>
      <Link href="/assets" className="btn small">📡 Change feed</Link>
    </div>
  );
}
