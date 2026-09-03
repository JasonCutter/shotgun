# ADR-155: WP-05 Connector Durable State and Outcome-Unknown Recovery

- Status: **Accepted for WP-05 implementation**
- Date: 2026-09-03
- Scope: `RIC-N3`, `RIC-N4`, Connector Runtime durable delivery state
- Work item: Runtime/Data Integrity Correction WP-05, Issue #175
- Implementation branch: `codex/runtime-data-integrity-wp05-connector-durable-runtime`
- Base: `main@48dac5e0e6c963531033e27b5d48d7dfb883f89b`
- Approval evidence: Issue #175 implementation approval comment `5526599795`
- Related decisions: ADR-082, ADR-086, ADR-092, ADR-096, ADR-154

## Authority and scope gate

WP-00 through WP-04 are complete. This decision authorizes WP-05 only. It does
not authorize Ask Queue claim changes (WP-06), handoff rollout (WP-07),
readiness redesign (WP-08), HTTP decoder work (WP-09), Action feedback or
Discovery diagnostics (WP-10), legacy cleanup (WP-11), or the final E2E gate
(WP-12).

The decision was made after the fresh-main inventory and OSS contract-fit gate
in [`runtime-data-integrity-wp05-connector-inventory-oss-contract-fit-2026-09-03.md`](../../implementation/stage-validations/runtime-data-integrity-wp05-connector-inventory-oss-contract-fit-2026-09-03.md).

## Context and reproduced failure

`ConnectorRuntime` currently constructs `InMemoryJobRuntime`,
`InMemoryDedupStore`, `InMemoryOrderingStore`, and
`InMemoryDeadLetterStore` by default (`packages/connector-runtime/src/runtime.ts`;
`packages/connector-runtime/src/stores.ts`). A timeout uses `Promise.race`.
That race rejects the caller but cannot cancel the handler. The dedup store then
removes its `running` Promise in `finally`, so a late side effect can be
followed by a second handler call with the same idempotency key.

The same process-memory boundary loses completed results, attempts, ordering
checkpoints, dead letters, replay history, and unresolved outcomes after a
restart. A second process cannot claim work safely because there is no durable
lease or fencing authority. This is the exact `RIC-N3`/`RIC-N4` failure; the
existing Source/Evidence, Canonical, Approval, Action, and Stage 4 authorities
must remain unchanged.

## Decision

Add infrastructure-neutral Connector Ports and a PostgreSQL adapter. PostgreSQL
is an adopted storage/locking substrate; it is not promoted to own Canonical,
Evidence, Approval, Action, Source, Claim, or Fact meaning. No external queue
package is installed for WP-05.

### 1. Authority separation

The following table is normative. A row is not allowed to become a second
semantic truth merely because it contains a convenient status column.

| Durable authority                | Owns                                                                                                                                                      | Does not own                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `connector.dedup_records`        | One semantic delivery identity per project/security scope + consumer + semantic key; request fingerprint; authoritative semantic outcome/result tombstone | Scheduling, worker lease, attempt history, Canonical or provider meaning |
| `connector.jobs`                 | Execution scheduling, claim, lease, fencing token, retry/backoff, terminal/dead-letter execution disposition for a dedup identity                         | A second request identity or a competing final business outcome          |
| `connector.job_attempts`         | Append-only attempt start/end, worker/fence, safe error and delay evidence                                                                                | Current semantic outcome authority                                       |
| `connector.dead_letters`         | Governed failure disposition and safe envelope/resource reference                                                                                         | Automatic replacement execution or raw protected payload by default      |
| `connector.replays`              | Explicit authorization, reason, actor/scope, and replay result referencing the original semantic identity                                                 | New identity or bypass of `OUTCOME_UNKNOWN` reconciliation               |
| `connector.ordering_checkpoints` | Monotonic project/security/consumer/message scope + ordering-key sequence, reservation lease, and fence                                                   | Business revision or Canonical version                                   |

`jobs` references the semantic identity in `dedup_records`; it never invents a
second idempotency key. A job-level `unknown`/`dead-letter` marker is an
execution stop/disposition that references the dedup row. The final semantic
outcome and `OUTCOME_UNKNOWN` tombstone are authoritative in
`dedup_records`.

### 2. Infrastructure-neutral Ports

The Ports are exported from `packages/connector-runtime` and contain no
PostgreSQL, pg-boss, Graphile, gbrain, or database ID types.

```text
DedupStorePort
  begin(identity, fingerprint)
  read(identity, fingerprint)
  complete(identity, resultReference)
  fail(identity, safeError)
  markOutcomeUnknown(identity, safeError)
  reconcile(identity, resolution)

JobRuntimePort
  enqueue(identity, schedule)
  claim(worker, lease)
  renew(identity, lease/fence)
  complete(identity, lease/fence)
  retry(identity, retryAt, safeError, lease/fence)
  terminal(identity, disposition, safeError, lease/fence)
  cancel(identity, reason)
  find(identity)

DeadLetterStorePort
  add(safeEnvelopeReference, identity, failure)
  get/list(project, authorization)
  authorizeReplay(deadLetterId, actor/scope, reason)
  recordReplay(deadLetterId, result)

OrderingStorePort
  acquireNext(identity, orderingKey, sequence, job/lease)
  commit(identity, orderingKey, sequence, fence)
  release(identity, orderingKey, sequence, fence)
```

The exact TypeScript shapes may be refined during implementation, but the
semantic split and method responsibilities may not be broadened. Existing
InMemory stores implement the same contracts for unit and explicit ephemeral
assemblies.

### 3. Transaction, claim, and fencing

- A semantic key and fingerprint are inserted/read under a unique constraint.
  A same key with a different fingerprint fails closed with `CONFLICT`.
- Job claim changes queued/retryable work to running, assigns a lease owner,
  lease expiry, and a monotonically increasing fencing token in one transaction.
- `renew`, `complete`, `retry`, and `terminal` include the owner and fencing
  token in their `WHERE` condition. A stale worker changes zero rows and cannot
  overwrite a successor's state.
- `retry` persists a `retryable` state and `next_attempt_at` with the lease
  released; a restarted worker claims only after that time. Retry progress is
  therefore durable rather than an in-memory loop.
- Ordering acquisition locks the full project/security/consumer/message scope,
  reserves the next sequence with a lease/fence before the handler runs, and
  commit/release require that fence. A successful handler is the only path that
  advances the checkpoint.
- External network/provider/action work never executes inside a database claim
  transaction. Existing business repositories and their transaction boundaries
  remain the owners of their data.

### 4. `OUTCOME_UNKNOWN` and timeout/ack-loss

`Promise.race` remains an observation mechanism only; it is not a cancellation
proof. On timeout, commit/acknowledgement ambiguity, or lost response after an
external operation may have run:

1. the dedup row is atomically retained and marked `OUTCOME_UNKNOWN`;
2. the job is stopped from automatic replacement execution and the safe failure
   is recorded;
3. the caller receives `OUTCOME_UNKNOWN` and no new handler is invoked for the
   same semantic key;
4. a late handler completion can update the original identity only when its
   lease/fence is still valid, otherwise it is recorded as stale evidence;
5. only an explicit reconciliation operation may transition unknown to
   `COMPLETED`, `FAILED`, or an explicitly authorized manual-retryable state.

Provider, action, Canonical, and Evidence semantics are not inferred from a
timeout. Restart and elapsed time alone never authorize a replacement call.
The deterministic Stage 4 request identity and its existing unknown-outcome
behavior from WP-04 are preserved.

### 5. Dead-letter and replay

Dead-letter rows contain the complete original semantic identity (including
project, security scope, message kind/type, semantic key, and fingerprint),
consumer, safe failure code/message, and a protected envelope/resource reference. Raw credential,
provider response, prompt, or protected Evidence is not copied unless an
approved encrypted replay payload is explicitly part of a future contract.

Replay requires current project/tenant authorization, the original route and
fingerprint, an actor, the original security scope, and an explicit reason. The
authorization and all of those fields are persisted on the replay audit row. A
replay is an audit record, not a new semantic identity. `OUTCOME_UNKNOWN` cannot
be replayed until reconciliation explicitly proves that replacement is safe;
the default behavior is rejection.

### 6. PostgreSQL adapter and schema

Add `adapters/connector-runtime-postgres` behind the Ports and one ordered
additive migration after migration 063. The migration creates only the minimum
tables/columns needed by the approved Port contracts, project/security scoped
unique indexes, safe error length constraints, lease/fence fields, and retention
timestamps. It must not alter existing migrations or merge Canonical Outbox,
Evidence continuation, Discovery, Ask, or Action tables into a global queue.

Production composition explicitly injects the adapter into `ShotgunKernel` and
`ConnectorRuntime`. InMemory stores remain available only to unit tests and an
explicit ephemeral/recovery harness. Shotgun-owned envelopes and semantic
identities are mapped at the adapter boundary; PostgreSQL row IDs and schema
details do not cross module contracts.

### 7. Lifecycle and recovery

The production adapter's pool, request-scoped claim/renew operations, and
expired-lease recovery timer use the existing app-owned `AsyncCleanupStack`.
Startup validates migration compatibility before accepting work. Startup
failure cleans resources already acquired. Shutdown stops the recovery timer,
waits only for the configured bounded grace period, and does not consume a
business retry merely because the process is stopping. Expired running jobs
become `OUTCOME_UNKNOWN` according to the durable state rules; they are not
silently re-executed.

## OSS and replacement decision

| Candidate       | Reviewed pin and license                                                                                                                                                            | Decision         | Boundary                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| PostgreSQL      | 16.14 existing image digest, PostgreSQL License                                                                                                                                     | `ADOPT`          | Storage/transaction/row-lock substrate behind Shotgun Ports and schema                                            |
| pg-boss         | Canonical/Stage-6 historical baseline 12.26.0, tag `31a4cf0093b0df73d077782689b738bcd0292021`; current registry review 12.28.1, tag `78089bbd51cce5e70282f6e5f9a9d937856ab414`; MIT | `DEFER`          | No package schema, worker lifecycle, or queue IDs in WP-05; re-evaluate only with a future JobRuntime adapter PoC |
| Graphile Worker | v0.17.3, tag `195491c6c4ebf58420ab9d1c8291df0334184063`; MIT                                                                                                                        | `DEFER`          | No `graphile_worker` schema/task loader/worker pool in WP-05                                                      |
| gbrain Minion   | commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`; MIT                                                                                                                              | `REFERENCE_ONLY` | Lock, retry, backoff, and recovery patterns only; no gbrain Runtime, DB, migration, or IDs                        |

The full contract-fit evidence, official URLs, maintenance/security notes, and
version discrepancy are recorded in the companion inventory. No benchmark is
required because the written fit is not genuinely ambiguous. Any future
`ADOPT`, `EXTRACT`, or `AUGMENT` decision must pin one exact version, commit,
lockfile, adapter boundary, replacement test, migration, and rollback plan.

## Migration, rollout, rollback

1. Apply the additive migration after 063 with preflight and existing
   `runtime.schema_migrations` tracking.
2. Drain current InMemory workers before cutover. New requests after the
   cutover timestamp use the durable authority; historical InMemory Maps are
   not backfilled because their completeness cannot be proven.
3. If durable rows are unresolved, do not roll back to InMemory. Stop workers,
   reconcile or forward-fix the durable rows, then replace/disable the adapter.
4. Code rollback before adapter activation is allowed. Data-destructive table
   drops or rewriting committed/unknown evidence are not rollback mechanisms.
5. Backup/restore includes the connector rows, safe references, and integrity
   digests without exposing credentials or raw protected payloads.

## Required validation

- Port replacement: InMemory and PostgreSQL adapters pass the same contract
  suite; PostgreSQL-specific rows are never exposed in the contract.
- Restart: completed, running, retryable, terminal, dead-letter, and unknown
  states retain identity, fingerprint, result/error reference, and replay
  evidence.
- Concurrency: two real PostgreSQL connections cannot execute one semantic key
  twice; stale fence completion/renewal is rejected.
- Retry: persisted attempt count and backoff survive restart; terminal and
  unknown do not auto-retry.
- Timeout/ack-loss: handler invocation count remains one and replacement side
  effect count remains zero until explicit reconciliation.
- Crash after handler success before local acknowledgement returns duplicate
  from the durable result rather than invoking the handler again.
- Ordering, DLQ authorization/replay, project/tenant/security isolation,
  startup/shutdown cleanup, migration, backup/restore, and rollback rehearsal.
- Exact-head focused tests first, then aggregate Required Gates CI on the same
  final SHA. Do not claim WP-05 complete without the evidence matrix.

## Alternatives rejected

- **Keep process memory and add only a timeout flag:** rejected; restart and
  multi-worker safety remain unaddressed.
- **Use pg-boss or Graphile as the Connector authority:** rejected for this WP;
  their package-owned schema, identity, migration, and worker lifecycle would
  duplicate Shotgun state and cannot express the approved unknown/fence
  contract without a second authority.
- **Embed gbrain Minion:** rejected; it couples BrainEngine/runtime/schema and
  violates the existing module and Canonical boundaries.
- **Create a global Connector outbox for every producer:** rejected; it merges
  distinct Source/Evidence/Canonical/Action ownership and expands WP-05.
- **Treat timeout as retryable failure:** rejected; it can duplicate an external
  side effect and violates the `OUTCOME_UNKNOWN` invariant.
