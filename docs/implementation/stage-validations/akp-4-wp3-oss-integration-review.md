# AKP-4 WP3 OSS Integration Review

Status: `ADOPT` / `REFERENCE_ONLY` / `DEFER` decisions for the persistent
Discovery scheduler and manual-trigger normalization.

## Decisions

| Candidate               | Decision         | Version / commit                                                                                           | License            | Boundary                                                                                                                                                   |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL              | `ADOPT`          | Existing project baseline; adapter uses the repository lockfile and deployed PostgreSQL compatibility gate | PostgreSQL License | Durable schedule rows, optimistic advancement, and partial unique trigger indexes behind `DiscoveryScheduleRepositoryPort` and the existing Job repository |
| garrytan/gbrain         | `REFERENCE_ONLY` | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`                                                                 | MIT                | Job/idempotency/recovery patterns only; no runtime, schema, or database code is imported                                                                   |
| pg-boss                 | `DEFER`          | `12.26.0`                                                                                                  | MIT                | No dependency or queue adoption in WP3; generic queue execution is explicitly out of scope                                                                 |
| Graphile Worker         | `DEFER`          | `0.17.3`                                                                                                   | MIT                | No dependency or worker adoption in WP3; PostgreSQL schedule authority remains a narrow Port                                                               |
| Temporal TypeScript SDK | `DEFER`          | `1.20.3`                                                                                                   | MIT                | No workflow runtime adoption; durable Worker/Run/Attempt execution is a later scope                                                                        |

Official repositories reviewed: [gbrain](https://github.com/garrytan/gbrain),
[pg-boss](https://github.com/timgit/pg-boss),
[Graphile Worker](https://github.com/graphile/worker), and
[Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript).

The existing PostgreSQL adapter is the selected production implementation. No
new OSS package is introduced: the scheduler requires Shotgun-owned schedule
revision, timezone validation, occurrence identity, server-owned authority
binding, and crash-safe advancement semantics that must remain behind the
Shotgun Port.

## Contract and replacement boundary

- `DiscoveryScheduleRepositoryPort` owns only schedule persistence and
  compare-and-set occurrence advancement.
- `DiscoveryTriggerRuntimeRepositoryPort` remains the sole `discovery.jobs`
  authority. Logical identity remains `discovery-job-logical:v1` and is not
  replaced by a scheduler-specific hash.
- Migration 050 adds only `discovery.schedules` and scheduled/manual partial
  uniqueness indexes. It adds no execution worker state.
- Replacement is performed by implementing the schedule Port, replaying due
  schedule rows against the same coordinator, and verifying the PostgreSQL
  contract/concurrency tests. Rollback drops the two indexes and then the
  schedule table only after an explicit schedule-data decision; existing Jobs
  and Migration 049 remain untouched.

## Evidence and limits

The four candidates above were evaluated against the existing repository
review matrix and prior PoCs. WP3 uses no upstream runtime code, so there is no
new imported prototype or benchmark claim. The focused tests cover the
Shotgun-owned schedule/trigger contract, PostgreSQL compare-and-set behavior,
mutable-base replay, and security-negative cases. Worker execution, leases,
reclaim, domain retry, and deployment remain deferred to later work.
