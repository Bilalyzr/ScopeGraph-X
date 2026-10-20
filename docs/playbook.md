# ScopeGraph X — End-to-End Operations Playbook

A click-by-click runbook for every module, followed by the **target-site bug-hunting playbook** (what works today, and the exact authorized path to testing a real site you own).

**Ground rules that never change:** every active operation passes the policy gateway (deny-overrides-allow, SSRF guard, budgets), everything is audit-logged, and in this build **egress is SIMULATED** — detection runs on synthetic fixtures (`*.demo-target.test`), never on real websites.

**Boot sequence** (check the port is free first — `netstat -ano | findstr :3000`):

```bash
npm run build && npm start          # web app on 127.0.0.1:3000
npm run worker                      # (optional) isolated worker: jobs + webhooks + retention
```

**Accounts** (password `Demo1234!`): `researcher@` runs campaigns/tests · `owner@` approves & activates policies · `lead@` approves tests, imports SAST · `validator@` validates findings · `admin@` webhooks + administration · `auditor@` read-only · `globex@` second tenant (isolation demo).

---

## Part 1 — Module walkthroughs

### 1. Sign-in, MFA, onboarding, sessions
1. `/login` → `researcher@demo.test` + `Demo1234!`.
2. **Settings → MFA** → *Enroll authenticator* → add the shown secret to any TOTP app → enter code → enabled. Sign out; sign-in now requires the code (two-step: password → 6-digit challenge).
3. **Settings → Change password**: rotates and revokes ALL sessions (by design, you're logged out).
4. **Settings → Active sessions**: revoke everything except the current one.
5. Onboarding: create a fresh account scenario — an account with no org lands on `/onboarding` → create org → you are its TENANT_ADMIN.

### 2. Programs & scope policy (the control plane)
1. **Programs** → *+ Create program* (name, handle, **authorization reference** — this is your permission provenance, e.g. contract id).
2. Open the program → *+ Propose scope version* → rules JSON:

```json
{
  "allow": [{ "host": "api.demo-target.test", "paths": ["/v1/orders"], "methods": ["GET", "POST"] }],
  "deny":  [{ "host": "admin.demo-target.test", "reason": "excluded by contract" }],
  "budgets": { "max_requests": 200, "max_rps": 1, "max_concurrency": 1 }
}
```

3. Sign in as `owner@` → **Approve** → **Activate** (activation is refused if the same user proposed it — segregation of duties; try it as `researcher@` to see the 403).
4. The version card shows a live matcher example ("why would GET api…/v1/orders be allowed/denied?").
5. **Revoke** (as owner): queued jobs cancel, campaigns stop, and starting a campaign on that policy now returns **409 POLICY_REVOKED** — never a silent fallback.

### 3. Asset inventory & the authorization ladder
1. Run a passive campaign (module 4) → assets appear as **DISCOVERED** with source provenance (dns/ct/rdap).
2. **Assets** → *+ Import asset manually* → always enters DISCOVERED.
3. Open an asset → **Mark ownership verified** → **Authorize for active testing** (explicit, audited human decisions — discovery alone can never authorize).
4. Negative test: run an active-mode campaign while an asset is still DISCOVERED → the campaign's **egress log** shows `DENY ASSET_NOT_AUTHORIZED`. Unverified assets never enter the active work queue.

### 4. Campaigns & jobs (the execution engine)
1. **Campaigns** → *+ New campaign* → pick program + mode:
   - *Passive only* — observations + scanner import, zero active requests.
   - *Passive + approved active* — additionally probes AUTHORIZED assets, each request individually authorized by the gateway (simulated).
2. **▶ Start** → `202` + job ids; open the campaign to watch jobs (attempts, results, errors) and the **policy gateway egress log** (allow/deny + reason per destination).
3. **■ Stop** cancels queued/running jobs. **⛔ EMERGENCY STOP** (top bar, every page) freezes all active operations org-wide; lift it in Administration.
4. Budgets are durable: `max_requests` counts gateway ALLOWs — exceed it and further requests get `DENY BUDGET_EXHAUSTED`.

### 5. Change detection (surface diffs)
1. Asset detail → **Capture snapshot / diff** (baseline).
2. Program page → *Import OpenAPI schema* (sample provided) → new routes become endpoints AND **NEW_ENDPOINT** events.
3. View the before/after feed: Assets → *Change feed*, asset detail, and the Dashboard *Recent changes* card.

### 6. Differential authorization (BOLA/BFLA) — finding object-level bugs
1. **Findings** → *Run differential authorization fixtures*.
2. Two candidates appear (support-agent reading tenant-b's order = BOLA; non-admin calling admin export = BFLA), each with redacted evidence.
3. The negative control (`ord_1002`, 200 expected) produces nothing — **HTTP 200 alone is never proof**; a finding requires expected-DENY + observed-2xx, and stays a candidate until validated.

### 7. Workflow-invariant engine (business-logic bugs)
1. **Research** → *Business workflow invariants* → **Run check** on `order_workflow`.
2. The seeded fixture run skips the PAID state (illegal transition) and re-submits payment with a different outcome (non-idempotent) → both flagged → one CANDIDATE finding with evidence. Clean machines report zero violations.

### 8. AI research layer (hypotheses → tests)
1. **Research** → hypotheses (mock provider; schema-validated; evidence-cited).
2. *Propose test* (as researcher) → **Approve** it as `lead@` or `validator@` (the proposer cannot approve their own test).
3. Approval triggers **simulated** constrained execution → evidence stored → linked hypothesis becomes SUPPORTED → an OBSERVED candidate finding appears. The AI itself can never approve, execute, or confirm.

### 9. Findings lifecycle → validation → report
1. Open a candidate → **Lifecycle actions** (illegal jumps return `422` with the allowed list; wrong roles `403`).
2. As `validator@`: **Record validation** (VALIDATED) — required before REPORTED (try REPORTED first: `422 VALIDATION_REQUIRED`).
3. Walk PROPOSED → OBSERVED → REPRODUCED → REVIEWED → REPORTED → (as `owner@`) ACCEPTED → CLOSED. Every transition is an immutable audit event and fires a signed webhook.
4. **Reports** → generate JSON/HTML/PDF. Human formats are blocked with `409 UNREVIEWED_FINDINGS` while PROPOSED findings exist. Reports contain evidence references, sanitized content, policy version.

### 10. SAST/SCA correlation
**Research** → *Import static-analysis results* (sample JSON provided) → findings link to runtime findings by asset+rule as **LINKED · UNCONFIRMED** — correlation never confirms anything.

### 11. Knowledge graph
**Graph** → pick an asset, 1–2 hops → typed edges (IN_SCOPE_OF, EXPOSES, SUPPORTS…) with confidence + provenance; click an edge for its originating observation. Cross-tenant traversal returns nothing (tested).

### 12. Audit, webhooks, administration
1. **Audit** → filter by action; the badge shows **digest chain verified** (tamper-evidence); **⇩ Export CSV** (the export is itself audited).
2. As `admin@`: **Administration → Webhooks** → add endpoint + events → secret shown ONCE. Delivery worker signs `timestampMs.nonce.body` (HMAC-SHA256) with 5-min replay window, retries with backoff, dead-letters after 5 attempts. Dev transport is *recorded* (no real egress); set `WEBHOOK_TRANSPORT=http` for real delivery to YOUR receiver, verifying:

```js
const expected = crypto.createHmac("sha256", secret)
  .update(`${ts}.${nonce}.${body}`).digest("hex");
if (Math.abs(Date.now() - ts) > 5*60_000 || expected !== sig) return res.status(401).end();
```

---

## Part 2 — Bug-hunting playbook for a TARGET site

### What works today
The entire loop above IS the bug-finding workflow — executed against **synthetic fixtures**. BOLA/BFLA, workflow violations, misconfig candidates, evidence, validation, reporting: all real logic, simulated targets. **No code path in this build can send a request to a real website** (there is no outbound HTTP client for targets; `EGRESS_MODE=simulated` is the only mode).

### Pointing it at a real site you own (authorized path)
Do this **only** for a site you own or have written authorization to test:

1. **Authorization record** — create a program whose `authorization_ref` is your contract/engagement reference. No ref, no policy.
2. **Scope rules** — propose → approve → activate a policy listing exactly your hosts/paths/methods, deny-listing everything else (admin panels, internal subdomains), with tight budgets (e.g. 1 rps).
3. **Asset ladder** — import your host, verify ownership (DNS TXT / control-plane evidence), then explicitly mark it AUTHORIZED.
4. **Run passive-first** — passive observations build inventory and the change baseline with zero risk.
5. **Active checks require build work** — real scanning needs the adapter phase: real DNS/CT/RDAP lookups, a real HTTP executor wired to the SAME policy gateway (IP-pinned connections, per-request authorization, budgets, revocation), and ZAP/Nuclei adapters replacing the mock importer. All safety rails stay exactly as tested. Ask and this becomes the next build phase.
6. **Never** test third-party systems because recon "looks related" (PRD §2.2). Every serious platform (HackerOne etc.) requires reading the program's policy first; this platform encodes that policy as enforceable rules.

### Where bugs typically surface (mapped to modules)
| Bug class | Module to use | Signal |
|---|---|---|
| BOLA / IDOR | Differential fixtures → real adapter later | expected-DENY + observed-2xx on an object |
| BFLA | Differential fixtures / endpoints inventory | non-admin identity reaching admin operations |
| Business-logic state bugs | Invariant engine | illegal transitions, non-idempotent replays |
| Misconfig / info leak | Scanner import + change feed | matcher hits, NEW_ENDPOINT on admin surfaces |
| Schema drift / forgotten APIs | OpenAPI import + change feed | routes present in schema but undocumented |
| SAST hits that matter | Correlation panel | static finding + runtime evidence on same asset |

Everything found stays a **candidate** until a second person reproduces it — that discipline is what keeps false positives out of your reports.
