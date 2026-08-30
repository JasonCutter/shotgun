# AKP-4 WP4 OSS Integration Review

- 검토일: 2026-08-30
- 대상: Durable Discovery execution, PostgreSQL lease/fencing, recovery, retry,
  cumulative budget checkpoint, FindingReady publication and reconciliation
- 기준: `main@d9e70c6446f642f4274901cbd5878543be55075a`
- 상태: corrective implementation evidence recorded; Draft PR review remains required

## Integration decisions

| 후보                                | 공식 Repository                                                                       | 검토 Version·Commit                                                                           | Target boundary                                                                    | 결정             |
| ----------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| Existing Shotgun PostgreSQL runtime | repository-local `db/migrations/048`–`051` and `adapters/discovery-runtime-postgres`  | Shotgun base `d9e70c6446f642f4274901cbd5878543be55075a`; PostgreSQL 16.14 deployment baseline | `DiscoveryRuntimeExecutionRepositoryPort` and `PostgresDiscoveryRuntimeRepository` | `ADOPT`          |
| `garrytan/gbrain`                   | https://github.com/garrytan/gbrain                                                    | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`                                                    | Job/retry/lock/recovery patterns only; no imported Runtime or DB                   | `REFERENCE_ONLY` |
| `pg-boss`                           | https://github.com/timgit/pg-boss                                                     | `12.26.0` from existing OSS registry                                                          | General queue/runtime behind a Port                                                | `DEFER`          |
| Graphile Worker                     | https://github.com/graphile/worker                                                    | `0.17.3` from existing OSS registry                                                           | General worker/cron runtime                                                        | `DEFER`          |
| Temporal TypeScript SDK             | https://github.com/temporalio/sdk-typescript                                          | `v1.20.3` / `ae823d7f9dd513f3b90aeba8c66854c59c39a359`                                        | Multi-day workflow runtime                                                         | `DEFER`          |
| BullMQ / RabbitMQ                   | https://github.com/taskforcesh/bullmq and https://github.com/rabbitmq/rabbitmq-server | Not adopted; no lockfile version                                                              | Additional broker/queue authority                                                  | `REJECT`         |

## Boundary and evidence

- PostgreSQL is the existing durable authority. WP4 adds only Migration 051 objects:
  one-Run-per-Job claim serialization through the Job row lock and lookup index,
  attempt lease/fence and atomic failure finalization, cumulative budget
  checkpoints, normalized completed-stage outputs, durable provider reservations,
  restartable reconciliation cursors, and the immutable FindingReady ledger.
- The existing 048/049/050 migrations, logical identity
  `discovery-job-logical:v1`, WP2 coordinator and WP3 scheduler/manual path are
  unchanged.
- The Product path composes the accepted AKP-1 semantic retriever, AKP-3 WP1
  deterministic engine, AKP-3 WP2 bounded neighborhood selectors, AKP-3 WP3
  `DiscoveryAIGenerationService`, and WP3 Quality Gate. Finding persistence is
  fenced in the same PostgreSQL transaction as its immutable envelope/lifecycle
  initialization; reconciliation uses a server-owned observation callback and a
  lease-fenced lifecycle transition.
- Generate output is a strict durable `candidate + proof` record. The worker
  decodes and replays the server-derived ADR-149 semantic/follow-up/conflict
  proof bundle after restart; model prompts, raw responses, credentials and
  provider payloads never cross that stage boundary. Reconciliation hydrates
  the same frozen budget ledger, checkpoints its keyset cursor after each
  Finding, yields as `PARTIAL` through a retryable stage state, and resumes the
  same Job/Run/Attempt under a new fence.
- No OSS runtime, internal DB schema, OSS ID, provider client, Activity ledger,
  Canonical writer, second outbox, broker or new npm dependency is introduced.
- The Open-source Role Matrix already contains these candidate decisions and was
  not changed by WP4; this review records the WP4 target Port and evidence.

## Security, maintenance and replacement

- Lease owner, expiry and fencing token are server-owned. Every authoritative
  stage, attempt, Run, Job, budget, finding and FindingReady write checks the
  active PostgreSQL lease; an expired or stale worker receives `STALE` and cannot
  commit.
- Attempt, Run and Job success or failure finalization is one fenced PostgreSQL
  transaction, so a process failure cannot leave the lineage half-finalized
  between those three writes. Completed generation, quality, and persistence
  values are Finding-decoded and written before their stage succeeds and are
  reused after reclaim. Provider admission is reserved before dispatch and
  token/cost usage is reconstructed from the durable reservation ledger.
- Canonical reconciliation processes a bounded keyset page, records a fenced
  cursor after each Finding, and resumes after reclaim. It covers all four
  dispositions (`UNCHANGED`, `CANONICAL_EQUIVALENT_ACCEPTED`,
  `RELEVANT_INPUT_CHANGED`, `SOURCE_MATERIALLY_SUPERSEDED`) without mutating
  Canonical or the original Finding envelope.
- Unknown/programming failures fail closed. Retry is typed, bounded by the
  server-owned maximum attempt count/backoff/deadline, and never resets the
  frozen cumulative Job budget.
- Migration rollback is forward-safe: stop the worker, retain the additive 051
  tables/columns for forensic recovery, and deploy a compatibility build that
  ignores them. Physical removal requires a separately approved backup/restore
  migration after all WP4 Jobs reach terminal states; no rollback drops 048/049/050.
- A future queue/workflow adapter must implement the same execution Port and
  contract/replacement tests. It may not expose its own Job/Run IDs as Canonical
  identity or bypass Shotgun fencing and approval boundaries.

## Verification

- `npm run typecheck`: PASS.
- `npm run test:architecture`: PASS.
- Focused WP4 contract test: 6 tests / 6 pass; seven stages, normalized stage
  output writes, atomic retryable failure handling, and terminal lineage are
  asserted.
- Focused Product integration test: 2 tests / 2 pass; a bounded fake provider
  reaches WP1 gaps, qualified Clarification/Action, typed-authority Relation/
  Pattern/Conflict, strict durable proof restart, Quality acceptance, and
  cursor/budgeted reconciliation completion.
- AKP-3 WP2/WP3 focused regression: 26 WP2 tests and 18 WP3 tests pass.
- `npm run typecheck`, `npm run lint`, `npm run test:architecture`, and
  `git diff --check`: PASS.
- The PostgreSQL contract suite was safely skipped because `TEST_DATABASE_URL`
  is not configured in this environment; the 051 migration and real-Postgres
  matrix therefore still require execution in the isolated CI/database target.
  The direct targeted run collected 11 database tests and skipped all 11 for
  that missing environment variable.
- No paid provider, manual frontend E2E, #1107 rerun, historical failure rerun,
  Ready/Merge transition, WP5/AKP-5+ work, deployment, or live-provider test
  was performed.
- PostgreSQL contract coverage is committed in
  `tests/database/akp-4-wp4-discovery-execution.database.test.ts` and requires
  the repository's isolated `shotgun_test*` target before execution.
