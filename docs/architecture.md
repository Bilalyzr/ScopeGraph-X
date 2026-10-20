# Architecture

## Current deployment shape (this build)

```
Browser ── Next.js (App Router)
             ├── UI: React server components + client actions      (src/app)
             ├── API: /v1 route handlers                           (src/app/api/v1)
             └── Service layer                                     (src/lib)
                   ├── auth/        sessions, scrypt passwords
                   ├── policy/      rules schema, matcher, IP guard, GATEWAY
                   ├── jobs/        durable queue + simulated executors
                   ├── discovery/   passive observation adapter (mock)
                   ├── graph/       SQL graph projection + traversal
                   ├── findings/    lifecycle state machine
                   ├── evidence/    content-addressed store + redaction
                   ├── detection/   differential fixtures, scanner adapter
                   ├── ai/          typed schema, injection defense, mock provider
                   ├── reports/     HTML / PDF / JSON generation
                   ├── safety.ts    emergency stop, policy revocation propagation
                   └── audit.ts     append-only hash-chained audit log
             ├── Prisma ── SQLite (dev) / PostgreSQL (production target)
             └── Local object store (.data/evidence — content-addressed, tenant-namespaced)
```

## Target enterprise shape (PRD §5 — not claimed implemented)

Next.js workbench → API gateway/WAF/OIDC → control services (program, scope/policy, jobs, approval, identity, findings, reporting) → event backbone (Kafka/Redpanda) + Temporal workflows → PostgreSQL, Neo4j projection, ClickHouse, OpenSearch, object storage + KMS/vault → isolated worker pools (passive recon, browser/API discovery, scanner adapters, stateful tests, evidence validation) → **all worker egress through the policy enforcement gateway**.

The current build implements the same boundaries in-process: every module above corresponds to a target service and communicates through typed functions rather than shared mutable state, so extraction into separate services is mechanical.

## Architectural invariants (enforced + tested)

| Invariant | Where enforced |
|---|---|
| Scheduler requests jobs; only the policy gateway authorizes outbound operations | `src/lib/policy/gateway.ts` — executors call `authorizeEgress` per operation |
| Every observation links tenant/program/asset/job/policy provenance | `AssetObservation`, `EgressCheck`, `GraphEdge.policyContext/observationId` |
| Untrusted target content is data, not instructions | `src/lib/ai/injection.ts` — `<UNTRUSTED-DATA>` wrapping + marker detection, tested |
| Credentials are vault references only; never in evidence or prompts | `Identity.secretRef` `vault://` schema; redaction before any storage |
| Reportable findings require evidence + a validator decision | `transitionFinding` refuses REPORTED without `validationStatus=VALIDATED` |
| Fail closed | gateway denies on any unresolvable condition (no policy, no asset, no DNS answer, mismatched tenant…) |

## Job pipeline

`POST /v1/campaigns/{id}:start` → policy re-check (409 POLICY_REVOKED / POLICY_STALE / NO_ACTIVE_POLICY) → jobs enqueued (unique per campaign+idempotency key) → in-process worker drains → passive discovery upserts assets (never AUTHORIZES them) → active probes (only in approved-active mode, only vs AUTHORIZED assets) call the gateway per request and revalidate DNS at the egress point → scanner import normalizes results into candidate findings → audit events record every step. Cancellation (stop, revoke, emergency stop) flips jobs to CANCELLED and campaigns to STOPPED.

## Graph projection

`graph_edges` stores typed relationships with provenance (observation id, confidence, policy context). `src/lib/graph/projection.ts` is the adapter: BFS traversal with tenant filtering at every node load. Swapping to Neo4j means reimplementing `addEdge`/`neighbors` only.
