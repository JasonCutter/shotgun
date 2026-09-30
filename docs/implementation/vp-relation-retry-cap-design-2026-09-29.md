# VP relation job retry cap — design and OSS decision — 2026-09-29

## Target and behavior

Target: `VPRelationJobStorePort` in `modules/vp-knowledge-ledger` and its
PostgreSQL Adapter. A relation job gets at most three provider attempts by
default. `VP_MAX_RELATION_JOB_ATTEMPTS` can set a deployment value from one to
ten, and the selected ceiling is stored on each newly created job. When the
last attempt fails, or its final lease expires without recovery, the durable
job enters terminal `FAILED`; the same policy revision cannot claim it again.
The daily provider-attempt ceiling remains an independent spending limit.
Changed source evidence or a new relation policy creates a distinct job.

`FAILED` means the automatic relation analysis did not finish. Existing
assertions and previously recorded relation history remain immutable. The
replay checker reports failed relation jobs and does not call the queue
complete while any remain. Owner-facing degraded status and a safe automated
recovery policy remain in VP-09/VP-07; this change does not add a manual retry
button or silently clear terminal failures.

## OSS integration decision

| Candidate                                             | Official URL and reviewed pin                                                                                                                                                 | License, security, maintenance                                                                                                                                                                                                                                                      | Decision and boundary                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                                            | [postgres/postgres](https://github.com/postgres/postgres); existing CI image `pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b` | PostgreSQL License per existing source registry. Uses existing parameterized SQL and runtime DB credentials; no new package or external surface. Major version 16 is fixed. The registry pin still says PostgreSQL 16.14 while this CI image reports 16.15; reconcile before VP-10. | `AUGMENT` existing Postgres job adapter. Shotgun retains job identity, attempt policy, failure meaning, and ports.                                            |
| [garrytan/gbrain](https://github.com/garrytan/gbrain) | Commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`                                                                                                                             | MIT per existing Role Matrix and VP records. Only previously reviewed retry/lease/DLQ patterns are used; no package code enters the runtime. Pinned review remains the maintenance baseline.                                                                                        | `REFERENCE_ONLY`; its runtime, database, and identity model stay excluded.                                                                                    |
| [pg-boss](https://github.com/timgit/pg-boss)          | 12.28.1; tag commit `78089bbd51cce5e70282f6e5f9a9d937856ab414`                                                                                                                | MIT per the source registry; reviewed 2026-09-03. No package-owned worker or schema is deployed. Maintenance follows the pinned review; no runtime dependency installed.                                                                                                            | `DEFER`; its queue metadata and lifecycle would duplicate Shotgun-owned relation job state. Re-evaluate for measured throughput or multi-worker requirements. |
| [Graphile Worker](https://github.com/graphile/worker) | 0.17.3; tag `v0.17.3`, commit `195491c6c4ebf58420ab9d1c8291df0334184063`                                                                                                      | MIT per the source registry; active upstream at review. No task loader, worker service, or package-owned schema is deployed.                                                                                                                                                        | `DEFER`; a general queue is not required for this bounded state transition and would duplicate job ownership.                                                 |

No new dependency or Role Matrix assignment is introduced. PostgreSQL `ADOPT`/
`AUGMENT` and gbrain `REFERENCE_ONLY` decisions remain the existing Shotgun
boundaries.

## Provider response-loss boundary

The VP relation adapter currently calls the resolved provider directly. The
candidate-extraction durable-call API is not a safe fit: its schema, materializer,
source revision pin, and T3 erasure contract are candidate-specific. Add a
Shotgun-owned VP relation execution record in the existing PostgreSQL adapter,
behind a VP decision execution port. PostgreSQL is `AUGMENT`; gbrain remains
`REFERENCE_ONLY`; pg-boss and Graphile Worker remain `DEFER`; no new dependency
or OSS runtime is introduced. The new table belongs to the VP knowledge
boundary and is included in VP reset status and erasure.

Each decision call binds a stable project/request identity to a digest of both
current assertions, the relation policy revision, provider/model identity, and
the structured-output contract. The record is committed before provider egress.
Only that first claim may call the provider. A validated response is then stored
durably and can be replayed after a worker/process restart without another
provider request. A matching `RUNNING` record without saved output is treated as
`OUTCOME_UNKNOWN`; it is never automatically sent again because the provider
may have accepted and billed the original request. A changed source assertion,
policy revision, or provider execution identity produces a separate request
identity. Provider response and transport failures are handled conservatively:
if no durable response was saved, the call cannot be retried automatically.

This boundary closes duplicate egress after response loss and permits replay
when the response was stored. It cannot recover an answer if the process dies
after the provider returns but before PostgreSQL stores the response; that case
is explicitly recorded as unknown and remains a runtime recovery/status concern.

Rollback preserves call records. Remove the new code only after stopping the
worker and retaining the table; do not drop evidence of an uncertain or billed
call. T3 project knowledge reset deletes these derived VP execution records as
part of the existing authorized VP erasure transaction.

## Contract, verification, and rollback

- Port contract: one claim increments the durable attempt count; failure before
  the cap remains `RETRYABLE`; failure at the cap becomes `FAILED`; failed or
  max-attempt expired jobs are never claimed again after constructing a new
  Adapter instance.
- PostgreSQL test: exercise retry count, lease expiry, daily-budget behavior,
  and replay's failed-job signal in an isolated database.
- Worker test: terminal `FAILED` is reported distinctly from `RETRYING`; no
  provider call is made after a failed job is no longer claimable.
- Migration 122 adds the per-job attempt ceiling and terminal status to the
  existing check constraint. It does not rewrite assertions, relations, or
  decision receipts.
- Rollback removes the new Worker/Port behavior and migration only before any
  durable `FAILED` row exists. If such rows exist, preserve evidence and use a
  forward migration; do not erase failures to force an old build to accept
  them.

Implementation is complete only after the Postgres Adapter contract and
database tests pass. The user-facing failure/status surface remains a tracked
product gate.

## Verification result

- Worker unit tests passed 8/8, including terminal failure reporting and
  `OUTCOME_UNKNOWN` readback behavior.
- Isolated PostgreSQL tests passed the failed-on-final-retry path, lease-expiry
  path, no-claim-after-restart path, expired-lease reclamation through a fresh
  Adapter with one durable receipt/relation, and replay's failed-job indicator.
- The existing relation priority, scale, `pg_trgm` frontier, and commit-ACK
  probes passed against the pinned CI image's runtime (PostgreSQL 16.15,
  `pg_trgm` 1.6, pgvector 0.8.6).
- Isolated PostgreSQL tests injected worker loss after the provider output
  commit and confirmed the restarted worker replayed that output, made one
  provider call total, and wrote one receipt and relation.
- A second isolated PostgreSQL test injected an ambiguous provider response,
  confirmed the job and call become terminal `OUTCOME_UNKNOWN`, confirmed a
  restarted worker cannot claim the job, and verified replay reports the
  relation queue incomplete with one unknown job.
- A child-process database test received HTTP 200 from a local provider stub,
  then was killed before output persistence. After lease expiry, recovery set
  both the job and provider-call rows to `OUTCOME_UNKNOWN`; a fresh worker made
  no second request. This also fixed a prior recovery path that left the
  provider-call row `RUNNING` after marking its job unknown.
- The full `tests/database/vp-relation-priority.database.test.ts` suite passed
  9/9 on 2026-09-30, including the refreshed 16-case `pg_trgm` frontier.
- T3 reset status reports the derived provider-call count; project erasure
  removes these records through the relation-job foreign-key cascade.
- This does not recover a response lost before PostgreSQL stores it. It fences
  duplicate egress and reports the unresolved condition. Real DeepSeek-side
  billing reconciliation, installed Runtime restart after an actual database
  or network outage, and user-facing recovery status remain VP-06/VP-07 work.
- No billable provider request or user database write was used for these tests.
- The complete repository typecheck remains blocked only by errors in the
  unrelated, untracked `tests/contract/ts7-cross-section-acceptance.contract.test.ts`.
