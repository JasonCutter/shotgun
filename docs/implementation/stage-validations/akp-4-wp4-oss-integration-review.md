# AKP-4 WP4 OSS Integration Review

- 검토일: 2026-08-30
- 대상: Durable Discovery execution, PostgreSQL lease/fencing, recovery, retry,
  cumulative budget checkpoint, FindingReady publication and reconciliation
- 기준: `main@d9e70c6446f642f4274901cbd5878543be55075a`
- 상태: WP4 implementation evidence recorded; Draft PR review remains required

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
  attempt lease/fence and failure/retry context,
  cumulative budget checkpoints, and the immutable FindingReady ledger.
- The existing 048/049/050 migrations, logical identity
  `discovery-job-logical:v1`, WP2 coordinator and WP3 scheduler/manual path are
  unchanged.
- WP1 deterministic Discovery Engine, WP3 Quality Gate, WP2 finding repository
  and WP3 `DiscoveryFindingLifecycleService` remain the product path. Finding
  persistence is fenced in the same PostgreSQL transaction as its immutable
  envelope/lifecycle initialization.
- No OSS runtime, internal DB schema, OSS ID, provider client, Activity ledger,
  Canonical writer, second outbox, broker or new npm dependency is introduced.
- The Open-source Role Matrix already contains these candidate decisions and was
  not changed by WP4; this review records the WP4 target Port and evidence.

## Security, maintenance and replacement

- Lease owner, expiry and fencing token are server-owned. Every authoritative
  stage, attempt, Run, Job, budget, finding and FindingReady write checks the
  active PostgreSQL lease; an expired or stale worker receives `STALE` and cannot
  commit.
- Attempt, Run and Job terminalization is one fenced PostgreSQL transaction, so
  a process failure cannot leave the lineage half-finalized between those three
  writes.
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
- Focused WP4 contract test: 1 test / 1 pass; seven stages and terminal lineage
  are asserted.
- WP1–WP3 Discovery contract regression: 21 tests / 21 pass.
- WP1/WP3 Discovery unit regression: 24 tests / 24 pass.
- `npm run db:migrate` and `npm run db:verify`: PASS against the configured
  PostgreSQL target; the separate database contract suite was safely skipped
  because `TEST_DATABASE_URL` is not configured.
- The focused worker contract also proves that completed stages are not
  re-executed during recovery and that durable findings are rehydrated before
  FindingReady/reconciliation stages.
- PostgreSQL contract coverage is committed in
  `tests/database/akp-4-wp4-discovery-execution.database.test.ts` and requires
  the repository's isolated `shotgun_test*` target before execution.
