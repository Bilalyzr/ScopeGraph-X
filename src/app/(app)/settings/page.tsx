import { redirect } from "next/navigation";
import { currentPrincipal } from "@/lib/auth/session";
import { isMfaEnabled } from "@/lib/auth/mfa";
import PasswordSection from "./PasswordSection";
import MfaSection from "./MfaSection";
import SessionsSection from "./SessionsSection";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const principal = await currentPrincipal();
  if (!principal) redirect("/login");
  const mfaEnabled = await isMfaEnabled(principal.userId);

  return (
    <div>
      <div className="row spread" style={{ marginBottom: "0.4rem" }}>
        <div>
          <div className="mono-label">OPERATOR CREDENTIALS // TOTP &amp; SESSION LEDGER</div>
          <h1 style={{ margin: "0.15rem 0 0" }}>Account &amp; security</h1>
        </div>
        <span className="badge accent">{principal.email}</span>
      </div>
      <p className="muted" style={{ marginTop: "0.25rem" }}>
        Signed in as <strong>{principal.email}</strong> ({principal.name}).
      </p>

      <div className="section-label">
        <span className="section-label-num">01</span>
        <span>AUTHENTICATION FACTORS</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
        <PasswordSection />
        <MfaSection initialEnabled={mfaEnabled} />
      </div>

      <div className="section-label">
        <span className="section-label-num">02</span>
        <span>ACTIVE SESSION TOKENS</span>
      </div>

      <SessionsSection />
    </div>
  );
}
