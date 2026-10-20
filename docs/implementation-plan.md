# Implementation Plan & Progress

## Delivered (verified — tests + build + live smoke)

### Phase 0 — Baseline
PRD read in full; greenfield Next.js 15 + TypeScript + Prisma stack; SQLite dev store (zero-port, machine-safe), PostgreSQL production target.

### Phase 1 — R1 Control & Trust ✅
Auth/sessions/scrypt · orgs & memberships · 7-role RBAC (23 permissions, server-enforced) · programs + versioned scope policies (propose→approve→activate with segregation of duties→revoke+propagation) · **policy gateway** (deny-priority matcher, SSRF guard, rebinding recheck, durable budgets, rps/concurrency, emergency stop, fail-closed) · durable jobs (idempotency, retries, cancellation) · simulated executors · hash-chained audit log · tenant isolation · dashboard + full navigation.

*Release gate honored: no active network operations exist — egress is simulated and adversarial tests pass.*

### Phase 2 — R2 Discovery & Graph ✅ (core)
Mock passive discovery adapter (DNS/CT/RDAP/API-schema fixtures) · asset authorization ladder with audited human decisions · observations with provenance · graph projection + relationships API + interactive explorer · endpoints normalization. *Gate: unverified assets never enter the active work queue (tested).*

### Phase 3 — R3 Detection Fabric ✅ (core)
Differential authorization analysis (BOLA/BFLA fixtures, expected-access matrix, negative control) · mock Nuclei adapter with normalization + dedup fingerprints · content-addressed redacted evidence store with integrity verification + retention · full finding lifecycle with validator gate · HTML/PDF/JSON reviewed reports. *Gate: no confirmed finding without evidence + validator decision (tested).*

### Phase 4 — R4 AI Research ✅ (core, mock provider)
Typed zod-validated hypotheses · evidence-bound citations · untrusted-content sanitization + injection detection · deterministic critic with downgrade · model audit trail. *Gate: AI cannot authorize tests or confirm findings (enforced by approval flow + validator).*

## Next tasks (priority order)

1. **FR-REC-03 change feed**: before/after snapshot diffs on assets/endpoints with UI.
2. **FR-DET-03 generic workflow-invariant engine**: declarative state machines on `resources.invariantJson`, transition probing with disposable fixtures.
3. **FR-DET-04 SAST/SCA correlation**: import customer results, link to runtime findings without auto-confirmation.
4. PostgreSQL switch (`provider = "postgresql"` + `prisma migrate`), enums, partial unique index for active findings.
5. OIDC/SAML SSO + MFA policy (FR-ENT-01 completion); service identities for workers.
6. Isolated worker pool (separate process consuming the job table; the queue schema already supports leases).
7. Real adapters behind existing seams: DNS/CT/RDAP, Nuclei/ZAP import, real AI provider config — each gated on explicit authorization + configured credentials.
8. Webhooks/ticketing export (FR-ENT-02), OpenSearch/ClickHouse projections, K8s deployment (docs/deployment.md sketches).

## Not started (explicitly)
FR-OPS-02 private worker pools · multi-region residency · billing/telemetry warehouse · formal WCAG audit · comparative benchmarking (PRD §12 forbids unsupported claims — none made).
