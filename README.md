# ScopeGraph X

Enterprise scope-controlled vulnerability discovery & security research platform — **authorized testing only**.

Built against *ScopeGraph X Enterprise PRD v1.0* (19 October 2026). This is a working application, not a wireframe: frontend, backend, database, authentication, authorization, workflow orchestration, evidence management, reporting, automated tests and security controls are implemented and verified.

> **Safety posture (read this first)**
> - **All active testing is SIMULATED.** `EGRESS_MODE=simulated` is the only implemented mode. The policy gateway authorizes and logs outbound operations; no real network traffic is ever sent to targets from this codebase (there is no outbound HTTP client for target traffic at all).
> - Out-of-scope testing, destructive exploitation, persistence, credential attacks and evasion are out of scope by design (PRD §2.2).
> - AI is an evidence-grounded assistant: schema-validated output, no shell/network authority, no ability to approve tests or confirm findings.

## Quick start

```bash
npm install
cp .env.example .env         # defaults: SQLite + simulated egress + mock AI
npx prisma db push           # create the local database
npx tsx prisma/seed.ts       # synthetic demo data (no real targets/credentials)
npm run build && npm start   # production server (or: npm run dev)
```

The app listens on **port 3000** (or `PORT`). On machines running other services, verify the port is free first (`netstat -ano | findstr :3000`) and pick another with `npm start -- -p <port>`.

**Demo accounts** (password `Demo1234!`): `researcher@demo.test`, `lead@demo.test` (AppSec lead), `owner@demo.test` (program owner), `validator@demo.test`, `admin@demo.test` (tenant admin), `auditor@demo.test`, `globex@demo.test` (second tenant — use it to verify isolation).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build` + `npm start` | Dev / production server |
| `npm run worker` | Isolated worker process (jobs + webhook delivery + retention sweeps) |
| `npm test` | Full test suite (102 tests: policy adversarial, tenancy, lifecycle, AI safety, crypto/TOTP, change detection, invariants, correlation, webhooks) |
| `npm run typecheck` | TypeScript strict check |
| `npm run db:reset` | Reset + reseed the dev database |

## What is implemented (verified by tests)

- **R1 Control & Trust** — auth (scrypt, server-side sessions, **TOTP MFA with two-step login**), organizations/memberships + **self-serve onboarding**, 7 roles × 23 permissions enforced server-side, programs, versioned scope policies with propose → approve → activate (segregation of duties) → revoke with propagation, **policy gateway** (deny-overrides-allow matcher, SSRF/private-address guard, DNS rebinding revalidation, durable request budgets, rate/concurrency limits, emergency stop, fail-closed everywhere), durable jobs with idempotency + retries + cancellation + **isolated worker process**, append-only **hash-chained audit log** (deterministic seq ordering) + **authorized CSV export**, tenant isolation on every query, dashboard with real metrics, **account/security settings** (password rotation revokes sessions, session list/revoke).
- **R2 Discovery & Graph** — passive discovery adapter (mock fixtures), asset authorization ladder (DISCOVERED → OWNERSHIP_VERIFIED → AUTHORIZED; discovery never authorizes), observations with provenance, **manual asset import**, **OpenAPI schema import with route normalization**, **change feed with snapshot diffs** (NEW_ENDPOINT / REMOVED_ENDPOINT / SCOPE_STATE / ATTRIBUTE, before/after evidence), SQL-backed graph projection with the PRD edge ontology, interactive graph explorer, `/v1/assets/{id}/relationships`.
- **R3 Detection fabric** — differential authorization analysis on seeded BOLA/BFLA fixtures with an expected-access matrix and a **negative control** (HTTP 200 alone is never proof), mock Nuclei-format scanner adapter, **workflow-invariant engine** (analyst-approved state machines; illegal transitions + non-idempotent operations flagged as candidate findings), **SAST/SCA ↔ runtime correlation** (links stay CORRELATED_UNCONFIRMED — never auto-confirms), evidence store (**AES-256-GCM encrypted at rest**, content-addressed sha256, tenant-scoped, secret redaction before storage, integrity verification on read, automated retention sweeps), full finding lifecycle with permission-checked immutable transitions and independent validator gate, report generation in **HTML / PDF / JSON**.
- **R4 AI research layer** — strict zod schema for hypotheses (invalid output rejected wholesale), evidence-bound citations, untrusted-content sanitization with prompt-injection detection, deterministic critic that downgrades unsupported hypotheses, mock provider (no API key), full model audit trail.
- **Enterprise integrations** — **signed webhooks** (HMAC-SHA256 over `timestampMs.nonce.body`, 5-minute replay window, exponential-backoff retries, dead-lettering, tenant-scoped endpoints, recorded dev transport with no real egress; HTTP transport is operator opt-in).
- **Platform** — light/dark theme, accessibility pass (skip link, focus-visible, reduced-motion), generated **PostgreSQL DDL** (`migrations/postgres/0001_init.sql`, 34 tables) alongside the SQLite dev store.

## Documentation

- [docs/architecture.md](docs/architecture.md) — system architecture and service boundaries
- [docs/security-model.md](docs/security-model.md) — trust boundaries, policy gateway, threat model mapping
- [docs/api.md](docs/api.md) — full `/v1` API reference (RFC 7807, idempotency, pagination)
- [docs/database.md](docs/database.md) — schema and relationships
- [docs/testing.md](docs/testing.md) — test strategy, commands, requirement-to-test mapping
- [docs/requirements-traceability.md](docs/requirements-traceability.md) — PRD requirement → implementation → test
- [docs/implementation-plan.md](docs/implementation-plan.md) — phased progress and next tasks
- [docs/deployment.md](docs/deployment.md) — deployment and rollback guide

## Honest limitations (do not mistake for production GA)

- SQLite dev store; PostgreSQL is the production target (schema is compatible; see deployment guide).
- Egress is simulated by design for this release; real adapters (DNS/CT/RDAP, Nuclei/ZAP, crawler) are mock/fixture implementations behind real interfaces.
- SSO/OIDC/SAML and MFA are integration points, not implemented; auth is local session-based.
- Single-process worker; isolated worker pools, Kafka/Temporal/Neo4j/ClickHouse are architecture targets, not claims.
- Rate limiting is per-process (durable request budget is DB-backed; see security model).
