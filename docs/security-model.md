# Security Model

## Trust boundaries

1. **Browser → API**: session cookie (httpOnly, SameSite=Lax, secure in prod). Every `/v1` handler re-authenticates via `requireContext` — the UI never grants anything.
2. **API → services**: permission-checked (`rbac.ts`, 7 roles × 23 permissions) + tenant-scoped queries everywhere. Cross-tenant lookups return 404 (no existence oracle).
3. **Scheduler → policy gateway**: the only path that can authorize an outbound operation. Executors cannot bypass it; there is no code path from a job to a socket.
4. **Untrusted content → model**: target text/scanner output is wrapped in `<UNTRUSTED-DATA>`, control characters and token-lookalikes stripped, injection markers flagged and audited.

## The policy gateway (PRD §6) — check order, all fail-closed

1. Emergency stop (GLOBAL/ORG/PROGRAM) — overrides everything.
2. Program exists in the caller's tenant and is ACTIVE.
3. An ACTIVE approved scope version exists (revoked ⇒ deny; never falls back to older versions).
4. Campaign is RUNNING and pinned to exactly that policy version (stale ⇒ `POLICY_REVOKED`).
5. Target host is a registered asset of the program with scope state `AUTHORIZED`.
6. Hostname syntax validation (blocks malformed hosts).
7. **Simulated resolution** at the enforcement point; private/loopback/link-local/unique-local/reserved/multicast/CGNAT/documentation addresses denied (SSRF guard, incl. IPv4-mapped IPv6 and `169.254.169.254`).
8. Deny-priority scope matching (host/path/method) — deny rules override allow rules.
9. Durable request budget (count of ALLOW egress rows), then in-process rps/concurrency limits.
10. At the (simulated) connect point, DNS answer is re-checked against the authorized IP — mismatch ⇒ `REBINDING_SUSPECTED` (TOCTOU/DNS-rebinding defense).

Every ALLOW and DENY is recorded in `egress_checks` and denials raise audit events (`egress.denied`).

**Revocation** (`revokeScopeVersion`) rejects new operations, cancels queued jobs, stops campaigns, audits the blast radius. **Emergency stop** does the same plus blocks all future gateway calls until lifted.

## Threat model mapping (PRD §10)

| Threat | Mitigation | Test evidence |
|---|---|---|
| Out-of-scope scanning | immutable active policy + deny-priority matcher + resolver at egress point | `tests/unit/policy-matcher.test.ts`, `tests/integration/gateway.test.ts` |
| SSRF via scan planner | default-deny private/reserved addresses, IPv4-mapped IPv6, malformed hosts | `tests/unit/ipguard.test.ts`, gateway SSRF tests |
| Scope bypass / redirects | no automatic redirect following exists (executor treats redirect targets as new gateway requests); rebinding recheck | `revalidateConnection` tests |
| Credential leakage | vault-only `secretRef`, redaction before storage/index/export, JIT design documented | `tests/unit/redaction.test.ts` (canary tokens in fixtures) |
| Prompt injection | untrusted-data wrapping, schema-validated output, deterministic critic | `tests/unit/ai-safety.test.ts` |
| Tenant data exposure | org-scoped queries, 404 on cross-tenant, tenant-namespaced evidence store, graph tenant filter | `tests/integration/tenancy-lifecycle.test.ts` |
| Unexpected destructive ops | approval workflow with segregation of duties (proposer ≠ approver), fixture-only execution | gateway/lifecycle tests |
| Forensic tampering | hash-chained audit log, content-addressed evidence with read-time hash verification | audit tamper test |

## Secrets

- Passwords: scrypt with per-user salt, constant-time comparison.
- Session tokens: 256-bit random, stored only as SHA-256; cookies httpOnly.
- Target credentials: `vault://` references only — the API rejects plaintext (`422` on non-vault `secret_ref`).
- Evidence/exports: `redactSecrets` runs before hashing/storage (bearer/basic/JWT/cookies/API keys/private keys/AWS keys/passwords).

## Known gaps (explicit)

- In-process rate/concurrency limits reset on restart (request budget is durable). Production moves these to a shared store.
- SQLite dev DB has no row-level tenant enforcement — isolation is enforced at the query layer (as it would be for Postgres without RLS).
- No SSO/MFA yet; no encrypted object storage (files are plaintext-at-rest on the dev disk; production uses the documented object-store adapter seam).
