import { redirect } from "next/navigation";
import { currentPrincipal } from "@/lib/auth/session";
import PasswordSection from "./PasswordSection";
import MfaSection from "./MfaSection";
import SessionsSection from "./SessionsSection";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const principal = await currentPrincipal();
  if (!principal) redirect("/login");

  return (
    <div>
      <h1 style={{ fontSize: "1.2rem" }}>Account & security</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Signed in as <strong>{principal.email}</strong> ({principal.name}).
      </p>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
        <PasswordSection />
        <MfaSection />
      </div>
      <SessionsSection />
    </div>
  );
}
