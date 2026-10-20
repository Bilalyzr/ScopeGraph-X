# Database

Dev: **SQLite** (`prisma/dev.db`, zero external ports). Production target: **PostgreSQL** — the Prisma schema is written portably (SQLite lacks native enums, so status fields are `String` validated by zod at the service boundary; on Postgres convert to enums + add the same unique/partial indexes).

## Entity map (PRD §8)

| Table | Key fields | Constraints / notes |
|---|---|---|
| `organizations` | slug, name, region, status | unique slug |
| `users` / `memberships` | email; org+principal+role | unique(org, principal); scrypt hashes only |
| `sessions` | sha256(token), org binding, expiry/revocation | never stores raw tokens |
| `programs` | org, provider, handle, authorizationRef, state | unique(org, provider, handle) |
| `scope_versions` | program, version, rulesJson, status, proposedBy/approvedBy, revoked* | unique(program, version); status: PROPOSED→APPROVED→ACTIVE→SUPERSEDED/REVOKED |
| `assets` | org, program, canonicalLocator, assetType, **scopeState** | unique(program, locator, type); scopeState ladder DISCOVERED→OWNERSHIP_VERIFIED→AUTHORIZED (+ASSOCIATED/DENIED) |
| `asset_observations` | asset, source, observedAt, evidenceId, confidence | index(asset, observedAt) |
| `campaigns` | org, program, policyVersion, mode, budgetJson, state | index(program, state), index(org) |
| `jobs` | campaign, kind, **idempotencyKey**, status, attempts | unique(campaign, idempotencyKey); QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED |
| `identities` | org, roleLabel, tenantLabel, **secretRef** | secretRef is a `vault://` reference only |
| `endpoints` | asset, method, routeTemplate | unique(asset, method, route) |
| `resources` | program, objectType, fixtureRef, invariantJson | test-fixture association |
| `graph_edges` | source/relation/target (typed), observationId, confidence, policyContext | unique(source, relation, target); rebuildable projection |
| `hypotheses` | campaign, category, assumptions/evidence/alternatives JSON, status, modelVersion | AI output stored only post-schema-validation |
| `tests` | hypothesis, oracleId, **policyVersionId**, approval, status | active tests rejected without policy binding |
| `observations` | test, evidenceId, normalizedJson | test-run results |
| `findings` | program, **fingerprint**, severity, confidence, status, validationStatus | unique(program, fingerprint); lifecycle states |
| `finding_status_events` | from/to, actor, reason | immutable transition audit |
| `finding_evidence` | finding, evidence, role | unique(finding, evidence) |
| `evidence` | org, **sha256**, encryptedObjectUri, sensitivity, expiresAt, redactionStatus | content-addressed; tenant-scoped store namespace; 30-day default retention |
| `audit_events` | org, actor, action, resource, decision, prevDigest, **digest** | append-only hash chain (digest covers reason+metadata) |
| `idempotency_records` | key (org+route scoped), requestHash, stored response | idempotent mutation replay |
| `approvals`, `emergency_stops`, `egress_checks` | gateway decision log, stop states | `egress_checks.decision` feeds budget + dashboards |

## Migrations

Dev uses `prisma db push` (schema-first). For production use `prisma migrate dev` to generate SQL migrations; keep them backward-compatible per PRD §11 (rollback window).

## Seeding

`prisma/seed.ts` creates two orgs (tenant-isolation demo), seven demo users, one program with an ACTIVE policy v1, five assets across the authorization ladder, endpoints, vault-only identities, a completed campaign with job history, BOLA/BFLA/scanner candidate findings with evidence, one AI hypothesis + proposed test, and chained audit events. **All hosts are reserved documentation domains; no real credentials.**
