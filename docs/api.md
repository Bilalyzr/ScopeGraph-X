# API Reference (`/v1`)

Conventions (PRD §9): JSON bodies; **RFC 7807** problem responses (`application/problem+json`, `code`, `detail`, `request_id`); `X-Request-ID` echoed on every response; `Idempotency-Key` honored on mutations (replay returns the stored response; key reuse with a different body ⇒ `422 IDEMPOTENCY_KEY_REUSE`); cursor pagination (`?cursor=&limit=`, opaque base64url of the last row id); async actions return **202 + job references**. All endpoints require a session (login sets `sgx_session`) and enforce role permissions + tenant scope server-side.

Auth endpoints outside `/v1`: `POST /api/auth/login`, `POST /api/auth/logout`, `GET|POST /api/auth/orgs` (list/select active organization).

## Programs & scope

| Method & path | Permission | Notes |
|---|---|---|
| `GET /v1/programs` | `program:read` | Cursor-paginated, tenant-scoped |
| `POST /v1/programs` | `program:write` | 201; requires `authorization_ref`; `409 PROGRAM_EXISTS` on duplicate provider+handle |
| `GET /v1/programs/{id}` | `program:read` | Includes scope versions with parsed rules |
| `POST /v1/programs/{id}/scope-versions` | `scope:write` | Body `{ rules: {allow[], deny[], budgets}, note, provenance }`; rules validated by zod; 201 |
| `POST /v1/scope-versions/{id}:approve` | `scope:approve` | PROPOSED → APPROVED; `409 INVALID_STATE` otherwise |
| `POST /v1/scope-versions/{id}:activate` | `scope:approve` | APPROVED → ACTIVE (supersedes previous); **403 SELF_APPROVAL** if caller proposed it; `409 POLICY_REVOKED` if revoked |
| `POST /v1/scope-versions/{id}:revoke` | `scope:approve` | Requires `reason`; cancels queued jobs, stops campaigns, audits |

## Assets & graph

| Method & path | Permission | Notes |
|---|---|---|
| `GET /v1/assets?program_id=&scope_state=` | `asset:read` | Filters + cursor pagination |
| `GET /v1/assets/{id}` | `asset:read` | With observations + endpoints |
| `PATCH /v1/assets/{id}` | `asset:write` | Explicit scope-state decision; `AUTHORIZED` requires prior `OWNERSHIP_VERIFIED` (`422 OWNERSHIP_NOT_VERIFIED`); fully audited |
| `GET /v1/assets/{id}/relationships?depth=1..2` | `asset:read` | Graph neighbors with confidence + provenance; tenant-filtered |

## Campaigns & jobs

| Method & path | Permission | Notes |
|---|---|---|
| `GET /v1/campaigns` | `campaign:read` | With parsed budgets |
| `POST /v1/campaigns` | `campaign:write` | PRD §9.1 shape (`program_id`, `policy_version_id`, `mode`, `budget`); 201 `{id, state:"draft", policy_version_id}`; `409 POLICY_REVOKED` / `POLICY_NOT_ACTIVE` |
| `POST /v1/campaigns/{id}:start` | `campaign:execute` | **202** + job ids; re-checks policy (revoked/stale ⇒ 409); enqueues passive discovery, scanner import, and (approved-active mode only) gateway-gated active probes vs AUTHORIZED assets; drains the queue |
| `POST /v1/campaigns/{id}:stop` | `campaign:stop` | Cancels queued/running jobs, marks STOPPED |
| `GET /v1/jobs?campaign_id=` | `job:read` | Status, attempts, results |
| `POST /v1/jobs` | `job:read` | Dev queue drain (worker maintenance) |

## Identities, hypotheses, tests

| Method & path | Permission | Notes |
|---|---|---|
| `GET/POST /v1/identities` | `identity:write` | `secret_ref` must be `vault://…` (422 otherwise) |
| `GET /v1/hypotheses` | `campaign:read` | With parsed assumptions/evidence refs |
| `POST /v1/hypotheses/{id}/tests` | `test:propose` | Typed bounded plan; `409 NO_ACTIVE_POLICY` without an active policy |
| `POST /v1/tests/{id}:approve` | `test:approve` | `APPROVE` (403 if caller proposed it; 409 if bound policy not active) executes **simulated** constrained execution, stores evidence, may create an OBSERVED finding candidate; `REJECT` records refusal |

## Findings, reports, audit, safety

| Method & path | Permission | Notes |
|---|---|---|
| `GET /v1/findings?status=&severity=&program_id=` | `finding:read` | Cursor-paginated |
| `POST /v1/findings` | `campaign:write` | Manual finding, or `run_differential_fixtures:true` to run seeded BOLA/BFLA analysis (candidates + evidence); `409 DUPLICATE_FINDING` on fingerprint match |
| `POST /v1/findings/{id}:review` | `finding:review` | `{to, reason}`; illegal step ⇒ `422 INVALID_TRANSITION` (with allowed list); wrong role ⇒ `403`; REPORTED requires prior validation ⇒ `422 VALIDATION_REQUIRED` |
| `POST /v1/findings/{id}:validate` | VALIDATOR-family | `{outcome: VALIDATED\|UNVALIDATED\|REFUTED, notes}` — the independent validator decision |
| `POST /v1/reports` | `report:write` | `{program_id, format: json\|html\|pdf}`; HTML/PDF blocked with `409 UNREVIEWED_FINDINGS` while PROPOSED findings exist; body stored as content-addressed evidence; PDF streamed with `x-report-id`/`x-evidence-id` headers |
| `GET /v1/audit-events?action=` | `audit:read` | Cursor-paginated, tenant-scoped (system events visible to PLATFORM_OPERATOR) |
| `GET/POST/DELETE /v1/emergency-stop` | `campaign:read` / `campaign:stop` | Trigger (ORG/PROGRAM scope + reason), list, lift |

## Example session

```bash
curl -c jar -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"researcher@demo.test","password":"Demo1234!"}'

curl -b jar -X POST localhost:3000/api/v1/campaigns \
  -H 'content-type: application/json' -H 'idempotency-key: demo-1' \
  -d '{"program_id":"prg_demo_retail","policy_version_id":"spv_demo_v1",
       "name":"Passive sweep","mode":"PASSIVE_ONLY",
       "budget":{"max_requests":100,"max_rps":1,"max_concurrency":1}}'
# → 201 {"id":"cmp_…","state":"DRAFT","policy_version_id":"spv_demo_v1"}

curl -b jar -X POST localhost:3000/api/v1/campaigns/cmp_…:start   # → 202 + jobs
```

## v0.2 additions

| Method & path | Permission | Notes |
|---|---|---|
| `POST /api/auth/login/mfa` | — | Step 2 of MFA login: `{challenge_token, code}` → session cookie (challenge is single-use, 5-min TTL) |
| `POST /api/auth/password` | session | Password rotation (10+ chars); requires MFA code if enabled; **revokes all sessions** |
| `GET/DELETE /api/auth/sessions` | session | List active sessions / revoke all others |
| `POST/PUT/DELETE /api/auth/mfa` | session | Enroll (returns secret + otpauth URI once) / confirm with code / disable with password |
| `POST /api/onboarding/org` | session | Create organization for an org-less user; creator becomes TENANT_ADMIN |
| `POST /v1/assets` | `asset:write` | Manual asset import — always enters as DISCOVERED; `409 ASSET_EXISTS` on duplicate |
| `GET /v1/changes?program_id=` | `asset:read` | Change feed with before/after JSON |
| `POST /v1/changes` | `asset:write` | `{asset_id}` → snapshot + diff (idempotent when unchanged) |
| `POST /v1/programs/{id}/imports/openapi` | `asset:write` | `{asset_id, document}` → normalized endpoints + change events; local parsing only |
| `GET/POST /v1/correlations` | `finding:read` / `finding:review` | Import SAST/SCA batches; linked pairs are `CORRELATED_UNCONFIRMED` — never auto-confirmed |
| `GET /v1/resources/{id}` / `POST /v1/resources/{id}:check` | `asset:read` / `test:propose` | Workflow-invariant engine run; violations create CANDIDATE findings with evidence |
| `GET/POST/PATCH/DELETE /v1/webhooks` (+ `PUT` drain) | `org:admin` | Signed webhook endpoints (secret shown once); HMAC over `timestampMs.nonce.body`; recorded dev transport |
| `GET /v1/audit-events/export` | `audit:read` | CSV export (the export itself is audited) |

## v0.3 additions

| Method & path | Notes |
|---|---|
| `GET /api/auth/oidc/status` | `{enabled}` — drives the SSO button visibility |
| `GET /api/auth/oidc/login` | 302 to the IdP authorization endpoint (state+nonce); **503 OIDC_DISABLED** when unconfigured |
| `GET /api/auth/oidc/callback` | token exchange + JWKS-verified ID token (iss/aud/exp/nonce) + JIT provisioning → session cookie |
| `GET /v1/ticketing` | org:admin — ticketing mode + linked tickets |
CLI: `npm run rotate-key` (dual-key re-sealing), `npm run a11y` (accessibility audit → docs/a11y-report.md), `npm run worker` (lease-based multi-node worker, `SGX_WORKER_ID`).
