# Testing

## Commands & actual results (2026-10-20)

| Check | Command | Result |
|---|---|---|
| Unit + integration tests | `npm test` | **65 passed / 0 failed** (7 files) |
| Typecheck (strict) | `npm run typecheck` | clean |
| Production build | `npm run build` | success (33 routes) |
| Live smoke (production server) | see below | all passed |

Test isolation: the suite creates a **fresh `tests/test.db`** every run (`global-setup` runs `prisma db push --force-reset` with a separate `DATABASE_URL`); the dev database is never touched.

## Suites

| File | Covers |
|---|---|
| `tests/unit/policy-matcher.test.ts` | FR-SCP-01 deny-overrides-allow, path/method restrictions, wildcard boundaries, fail-closed unknown hosts |
| `tests/unit/ipguard.test.ts` | SSRF guard: private/loopback/link-local/CGNAT/reserved/multicast/IPv4-mapped-IPv6 blocked; documentation IPs allowed; malformed hostnames |
| `tests/unit/redaction.test.ts` | secret redaction (bearer/basic/JWT/cookies/API keys/private keys/AWS/passwords) and no-op on clean evidence |
| `tests/unit/lifecycle.test.ts` | FR-FND-01 transition matrix, role gating, terminal states, fingerprint determinism |
| `tests/unit/ai-safety.test.ts` | FR-AI-01 schema validation (reject-all on invalid), FR-AI-02 critic, prompt-injection neutralization, FR-DET-02 differential fixtures incl. **negative control** (HTTP 200 alone is never proof) |
| `tests/integration/gateway.test.ts` | Adversarial policy suite: allow path, deny-rule override vs AUTHORIZED asset, DISCOVERED asset blocked, unknown host blocked, non-running campaign, **revocation fail-closed**, **emergency stop cancels jobs + blocks egress**, **durable budget exhaustion**, cross-tenant program refusal, **DNS rebinding/TOCTOU revalidation** |
| `tests/integration/tenancy-lifecycle.test.ts` | tenant-scoped evidence reads + dedup, graph traversal isolation, typed lifecycle errors (403/404/422/409), duplicate fingerprints, **audit chain tamper detection** |

## Requirement → acceptance test map (P0 highlights)

| PRD requirement | Test(s) |
|---|---|
| Deny rules override allow rules | policy-matcher `DENIES when a deny rule matches…`; gateway `deny-listed host … AUTHORIZED` |
| Unverified assets cannot receive active jobs | gateway `denies a DISCOVERED asset` |
| No active operation without approved policy | gateway revocation test (`NO_ACTIVE_POLICY` fail-closed); campaigns route guards |
| Redirect/scope-bypass resistance | no auto-following exists; rebinding recheck test (`REBINDING_SUSPECTED`) |
| Revoked policies prevent new outbound ops | gateway revocation + `campaigns` 409 `POLICY_REVOKED` |
| Emergency stop cancels queued work | gateway `emergency stop blocks new operations and cancels queued jobs` |
| Rate/concurrency budgets enforced | gateway `enforces the durable request budget` |
| Private/reserved destinations blocked | ipguard suite + gateway SSRF tests |
| Cross-tenant access denied | tenancy suite (evidence, graph, findings, programs) |
| HTTP 200 ≠ vulnerability | differential negative-control test |
| Findings need evidence + validator decision | lifecycle `VALIDATION_REQUIRED` path + role gating |
| AI cannot bypass policy / schema-validate output | ai-safety suite; test approval requires separate approver |
| Secrets redacted / not leaked | redaction suite (canary tokens in fixtures) |
| Evidence integrity + audit tampering | tenancy `audit chain` + evidence hash verification on read |

## Live smoke results (production server, port 3000 — verified free before bind)

- `GET /login` → 200
- `POST /api/auth/login` → 200 + org context
- `GET /api/v1/programs` (Acme researcher) → demo program; (Globex admin) → `[]` (tenant isolation)
- `POST /v1/scope-versions/…:approve` as RESEARCHER → **403**
- unauthenticated `POST /v1/programs` → **401 RFC 7807** problem document
- `POST /v1/campaigns` + `:start` → **201 → 202**, jobs executed (`passive-discovery`, `scanner-import` SUCCEEDED)
- `GET /graph`, `/dashboard`, `/api/v1/findings` → 200

## v0.2 additions (all passing — 102/102 total)

| File | Covers |
|---|---|
| `tests/unit/crypto-totp.test.ts` | AES-256-GCM round-trip/tamper (ciphertext + tag), unique IVs; RFC 6238 test vectors (T=59 → 287082, T=1111111109 → 081804), ±1 step skew tolerance, malformed-token rejection |
| `tests/unit/openapi.test.ts` | OpenAPI normalization (`:param`/`<param>` → `{param}`, trailing slashes), non-OpenAPI rejection; invariant engine matrix (conforming, illegal transition, non-idempotent, hidden transition, machine validation) |
| `tests/integration/changes-evidence.test.ts` | evidence never plaintext on disk; GCM tamper fails closed; snapshot/diff lifecycle (baseline → NEW_ENDPOINT + SCOPE_STATE events; idempotent no-op; removed/attribute diffs) |
| `tests/integration/correlations-invariants.test.ts` | invariant run creates CANDIDATE finding + evidence; clean run produces none; correlation links by asset+rule and never touches finding status; tenant scoping |
| `tests/integration/webhooks.test.ts` | signature verify/forgery/replay-window/body-tamper; fan-out on finding transition with verifying signature; backoff retries → DEAD after max attempts; subscription filtering; tenant isolation |

Live smoke (v0.2, production server): login/MFA-guard 200s, change feed 200, audit CSV export 200, SAST import 201, invariant `:check` returns both seeded violations, webhook create shows signing secret once, worker process starts/drains/exits cleanly.
