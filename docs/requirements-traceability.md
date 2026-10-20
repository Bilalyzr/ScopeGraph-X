# Requirements Traceability (PRD v1.0 → implementation → tests)

| PRD ID | Requirement (abbreviated) | Status | Implementation | Verification |
|---|---|---|---|---|
| FR-SCP-01 | Structured allow/deny rules; deny overrides | ✅ | `policy/rules.ts` (zod), `policy/matcher.ts`, scope-versions API | matcher suite; gateway deny-override test |
| FR-SCP-02 | Gate every outbound op through DNS/IP/URL validation | ✅ (simulated egress) | `policy/gateway.ts` `authorizeEgress` + `ipguard.ts` | gateway suite; zero real-egress by construction (no HTTP client exists) |
| FR-SCP-03 | Rate/concurrency budgets; emergency cancellation | ✅ | gateway budgets (`egress_checks` count), `safety.ts` | budget exhaustion + e-stop tests |
| FR-REC-01 | Passive ingestion with source/confidence/authorization | ✅ mock adapter | `discovery/passive.ts`, asset ladder | seeded observations; assets never auto-AUTHORIZED |
| FR-REC-02 | Endpoint normalization, secrets removed | ✅ (schema-import via fixtures) | `endpoints` table, redaction | seed endpoints; redaction tests |
| FR-REC-03 | Snapshot diffs (change feed) | ✅ | `discovery/changes.ts`, `/v1/changes`, asset+dashboard feeds | changes-evidence suite |
| FR-GRF-01 | Graph with originating observations | ✅ | `graph_edges` + projection + `/v1/assets/{id}/relationships` + explorer UI | graph traversal test |
| FR-GRF-02 | Association ≠ ownership ≠ authorization | ✅ | asset scope-state ladder + PATCH guard | gateway `ASSET_NOT_AUTHORIZED` tests |
| FR-DET-01 | Scanner results into common schema; dedup | ✅ (mock Nuclei adapter) | `detection/scanner-adapter.ts`, finding fingerprints | adapter gating (matcher_status), duplicate 409 test |
| FR-DET-02 | Differential auth analysis, no "200 = vuln" | ✅ | `detection/fixtures.ts` + findings API | differential tests incl. negative control |
| FR-DET-03 | State machines / invariant oracles | ✅ | `detection/invariants.ts`, `/v1/resources/{id}:check`, UI panel | openapi.test invariant matrix + correlations-invariants suite |
| FR-DET-04 | SAST/SCA ↔ runtime correlation | ✅ | `detection/sast.ts`, `/v1/correlations`, UI panel | correlations suite (links stay CORRELATED_UNCONFIRMED) |
| FR-DET-05 | Bounded probes; reproduction before confirmation | ✅ | test approval flow, `VALIDATION_REQUIRED` gate | lifecycle tests |
| FR-AI-01 | Typed candidates with evidence IDs; no raw authority | ✅ (mock provider) | `ai/schema.ts`, `ai/provider.ts` | schema suite |
| FR-AI-02 | Critic can downgrade; audited | ✅ | deterministic critic in provider | ai-safety + provider downgrade path |
| FR-FND-01 | Finding states, permission-checked, event-audited | ✅ | `findings/lifecycle.ts` | lifecycle suite |
| FR-FND-02 | Sanitized HTML/PDF/JSON exports; no secrets | ✅ | `reports/generate.ts` (pdf-lib) | redaction suite; unreviewed-export 409 |
| FR-ENT-01 | Tenant roles; forbidden cross-tenant access | ✅ (SSO/MFA pending) | `rbac.ts`, tenant guards everywhere | tenancy suite; live smoke |
| FR-ENT-02 | Audit export, webhooks/ticketing | ✅ webhooks + audit export (Jira-style ticketing ❌) | `webhooks.ts` (signed, retries, dead-letter), CSV export endpoint, admin UI | webhooks suite |
| FR-OPS-01 | Retries, cancellation, worker isolation, idempotency | ✅ (single process) | `jobs/runner.ts`, idempotency records | campaign start/stop tests; e-stop cancellation |
| FR-OPS-02 | Hosted + private worker pools | ⚠️ core | `scripts/worker.ts` isolated worker process (jobs+webhooks+retention); multi-node pools still design-only | worker smoke |
| NFR-06/07 | Evidence integrity + retention | ✅ | sha256 content addressing, read-time verification, expiry sweep | integrity + tamper tests |
| NFR-08 | Encryption at rest/in transit; key rotation | ⚠️ evidence+secrets AES-256-GCM at rest (tested); KMS key rotation still a seam | crypto + changes-evidence suites |
| NFR-09 | Accessibility | ⚠️ improved | skip-link, focus-visible, reduced-motion, labeled controls, theme toggle; formal WCAG 2.2 AA audit still not performed | — |
| UF-01…UF-06 | User journeys | ✅ except noted | program→policy→campaign flow (UF-01), asset change review (UF-02 partial), multi-account fixtures (UF-03), invariant fixtures (UF-04 partial), validator + export (UF-05), e-stop (UF-06) | smoke + suites |

Legend: ✅ implemented & tested · ⚠️ partial (usable foundation, gaps listed) · ❌ not built (no false claims).

## v0.2 additions beyond PRD gaps

- **MFA (TOTP)** — RFC 6238 implementation with RFC test vectors, encrypted secret storage, two-step login challenges (`MfaChallenge`, single-use, 5-min TTL); password rotation revokes all sessions — `crypto-totp` suite.
- **Onboarding + settings** — self-serve org creation (creator = TENANT_ADMIN), session management UI.
- **PostgreSQL DDL** — `migrations/postgres/0001_init.sql` (34 tables) generated from the same schema.
