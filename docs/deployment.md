# Deployment & Rollback Guide

## Local / development (current, verified)

```bash
npm install && cp .env.example .env
npx prisma db push && npx tsx prisma/seed.ts
npm run build && npm start            # binds 0.0.0.0:3000 by default
# safer on shared machines (verify the port is free first):
netstat -ano | findstr :3000          # empty output = free
npm start -- -H 127.0.0.1 -p 3000
```

**Port discipline on this machine:** other services already own 8080, 5434 (PostgreSQL), 27017 (MongoDB) and others. Never bind those; always `netstat`-check before choosing a port. The dev stack itself needs **no external ports** (SQLite + local file object store).

## Production target (PostgreSQL)

1. Set `DATABASE_URL` to the managed Postgres connection string.
2. In `prisma/schema.prisma` switch `provider = "postgresql"`, convert status `String` fields to enums, add the partial unique index for active findings (`@@index([programId, fingerprint])` where status active).
3. `npx prisma migrate deploy` (generate migrations in staging first — keep them backward-compatible for the rollback window, PRD §11).
4. Object storage: replace `storeEvidence/readEvidence` filesystem URIs with S3-compatible encrypted storage (the `encryptedObjectUri` field already abstracts location); keep sha256 verification.
5. Secrets: move `vault://` references to a real vault; workers fetch just-in-time.
6. Reverse proxy with TLS termination; set `secure` cookies (automatic when `NODE_ENV=production`).
7. Run `npm run build && npm start` per API replica; workers as separate processes draining the `jobs` table.

## Environment variables

| Var | Dev default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | Postgres URL in production |
| `EVIDENCE_STORE_DIR` | `.data/evidence` | swap for object storage in prod |
| `EVIDENCE_RETENTION_DAYS` | `30` | NFR-07 |
| `SESSION_TTL_HOURS` | `24` | |
| `AI_PROVIDER` | `mock` | only implemented provider |
| `EGRESS_MODE` | `simulated` | **only implemented mode — do not change** |

## Rollback

- App: previous immutable build artifact; DB migrations are additive/backward-compatible by convention (old app version keeps running against the new schema during the window).
- Emergency operational rollback: `POST /v1/emergency-stop` (ORG scope) halts all policy-gated activity and cancels queued jobs — verified by tests — independent of deployment state.
- Data: `prisma/dev.db` + `.data/evidence` are the dev state; back up both together (evidence is content-addressed; restores re-verify hashes on read).

## Disaster recovery posture (current vs PRD NFR-05)

Current build: file-level backup of DB + evidence dir; audit chain verifies restore integrity. PRD RPO ≤15min / RTO ≤4h with managed replicas, quarterly restore tests and region-failure planning are R5 scope — not claimed.
