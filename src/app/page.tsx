import type { Metadata } from "next";
import { currentPrincipal } from "@/lib/auth/session";
import Landing from "@/components/landing/Landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ScopeGraph X — Security research that never crosses the line",
  description:
    "Scope-controlled vulnerability discovery: executable scope policy, an attack-surface graph, validator-gated findings and a tenant-wide emergency stop.",
};

export default async function Home() {
  const principal = await currentPrincipal();
  const authed = !!principal;
  return <Landing authed={authed} consoleHref={authed ? "/dashboard" : "/login"} />;
}
