# ADR-157 — Recovery Registry and Health Readiness Policy

- Status: **Accepted for WP-08 implementation**
- Date: 2026-09-04
- Scope: Application-level recovery status projection and `/health` readiness composition
- Work item: Runtime/Data Integrity WP-08, Issue #181
- Implementation branch: `codex/wp08-recovery-health-readiness`
- Base: `main@448f20804305b430a024676b403cd222717ca9f0`
- Related decisions: ADR-097, ADR-154, ADR-155, ADR-156

## Authority and scope gate

This decision authorizes only WP-08. Existing recovery runners and their owning
repositories, Connector Runtime, Source/Evidence continuation workers, Ask
workers, Discovery workers, Canonical projection/outbox, and AI provider-call
state remain authoritative. The registry is an operational projection; it does
not become a new durability authority, business-data store, scheduler, queue,
or generic observability framework.

WP-09 malformed HTTP handling, WP-10 Action/Discovery diagnostics, WP-11 legacy
cleanup, WP-12 E2E closure, frontend UI, new ports/adapters, migrations, and all
provider or Canonical semantic changes remain out of scope.

## Decision

`shotgun-app` owns one in-memory `ApplicationRecoveryRegistry`. Existing AI
Durable Materialization Recovery and Canonical Projection Recovery executions
record one stable status each. The registry never invokes a runner; startup and
the existing Canonical periodic worker are the only writers. The same Canonical
runner identifier is used for startup and periodic observations, so a retry
updates one record rather than creating an orphaned status.

No new recovery authority is invented. A domain without a truthful signal at an
existing owning Port/adapter is explicitly recorded as not observable and is not
expanded in WP-08.

## Frozen status contract

```ts
interface RecoveryStatus {
  runnerId: string;
  executionStatus: 'COMPLETED' | 'FAILED_TO_RUN';
  outcome: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  freshness: 'CURRENT' | 'STALE';
  readinessImpact: 'NONE' | 'DEGRADED' | 'NOT_READY';
  startedAt?: string;
  completedAt?: string;
  lastSuccessAt?: string;
  nextScheduledAt?: string;
  scannedCount: number;
  succeededCount: number;
  retryableCount: number;
  terminalCount: number;
  outcomeUnknownCount: number;
  safeCodes: readonly string[];
}
```

`COMPLETED` means the runner executed to its normal completion boundary; it may
still be `DEGRADED` when individual items or projects failed. Inability to enter
or finish the runner boundary is `FAILED_TO_RUN`. Freshness is independent of
outcome. Per-item catches update aggregate status and never place raw exception
text in the registry. `lastSuccessAt` advances only after a healthy completed
run and is retained across degraded or failed observations.

The WP-08 stable runner identifiers are:

| Runner                              | Identifier                   |
| ----------------------------------- | ---------------------------- |
| AI Durable Materialization Recovery | `ai-durable-materialization` |
| Canonical Projection Recovery       | `canonical-projection`       |

The status contains only bounded aggregate counts and allow-listed safe codes.
Project IDs, prompts, Source/Evidence text, credentials, connection strings,
provider output, raw exceptions, stack traces, and secret IDs are excluded.

## Readiness composition

`ShotgunKernel.health()` is not modified. `/health` continues to return HTTP 200
while the process and Kernel are alive and adds application `readiness` plus the
redacted `recoveries` list.

For each recorded status, an active condition is any `FAILED_TO_RUN`, non-healthy
outcome, or `STALE` freshness. Any active status with
`readinessImpact = NOT_READY` yields application readiness `NOT_READY`. Otherwise
any active status yields `DEGRADED`; with no active status the result is `READY`.
Stale status is therefore never silently treated as healthy, even if an older
status had `NONE` impact. Kernel liveness and application readiness remain
separate fields.

## Existing-authority inventory

Each operational domain is classified exactly once. The registry does not add a
signal where the existing owner cannot truthfully provide one.

| Domain                               | Classification                                                                              | Existing evidence and WP-08 disposition                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connectivity                | Already enforced as startup fail-fast elsewhere                                             | `PostgresConnectorRuntimeState.lifecycle.start()` performs the owning database check; no second probe is added.                                                                                                              |
| Migration compatibility              | Already enforced as startup fail-fast elsewhere                                             | Connector lifecycle verifies the required durable-runtime migration boundary (including migration 064); no migration or compatibility port is added.                                                                         |
| Required worker/lifecycle            | Already enforced as startup fail-fast elsewhere                                             | Existing startup wiring propagates worker start failures. Ongoing worker liveness is not truthfully observable at the allowed application boundary and is not fabricated as a registry status.                               |
| Sources Stage 3 progress             | Directly represented by an existing recovery runner                                         | `SourcesStage3RecoveryDispatcher` remains the owner and keeps its existing worker/retry contract; WP-08 does not duplicate its persistence or status model.                                                                  |
| Evidence/Stage 4 continuation        | Directly represented by an existing recovery runner                                         | `SourcesStage4ContinuationDispatcher` remains the owner and keeps its existing worker/retry contract; no new continuation signal is introduced.                                                                              |
| Connector `OUTCOME_UNKNOWN`/DLQ      | Not truthfully observable under existing owning Port/adapter without architecture expansion | Existing Connector Runtime owns the state. WP-08 does not add a probe, queue, or public diagnostic endpoint.                                                                                                                 |
| Ask leases/queue recovery            | Not truthfully observable under existing owning Port/adapter without architecture expansion | Ask execution worker and lease authority remain unchanged; no synthetic health status is emitted.                                                                                                                            |
| Discovery leases/runtime recovery    | Not truthfully observable under existing owning Port/adapter without architecture expansion | Discovery workers and repositories remain authoritative; diagnostics are deferred to WP-10.                                                                                                                                  |
| AI durable materialization recovery  | Directly represented by an existing recovery runner                                         | `runAIDurableMaterializationRecovery` result is projected without changing its no-Provider-call Resume semantics. Startup failures become `FAILED_TO_RUN`; item failures become completed/degraded.                          |
| Canonical projection/outbox recovery | Directly represented by an existing recovery runner                                         | `runCanonicalProjectionRecoveryWithReport` and its existing periodic worker remain authoritative. Safe aggregate facts are projected; isolation, bounded batches, rebuild, outbox and worker overlap behavior are unchanged. |

The four “not observable” domains are deliberate scope boundaries, not healthy
claims. A future status for them requires a separately approved owning Port,
adapter contract, persistence and contract tests.

## Runner projection rules

The AI runner reports `scannedCount = attempted`, `succeededCount = resumed`,
and `retryableCount = failed`. A zero-failure completed run is
`HEALTHY/CURRENT/NONE`; item failures are
`DEGRADED/CURRENT/DEGRADED` with
`AI_DURABLE_MATERIALIZATION_RECOVERY_DEGRADED`. A top-level exception is
`FAILED_TO_RUN/FAILED/STALE/NOT_READY` with the safe code
`AI_DURABLE_MATERIALIZATION_RECOVERY_FAILED`.

The Canonical report maps project count to `scannedCount`, ready projects to
`succeededCount`, and failed projects to `retryableCount`. A completed partial
report is degraded with `CANONICAL_PROJECTION_RECOVERY_PARTIAL_FAILURE`. A
top-level failed report is `FAILED_TO_RUN/FAILED/STALE/NOT_READY` with its
allow-listed safe error (or `CANONICAL_PROJECTION_RECOVERY_FAILED`). No project
identifier from the existing safe report is copied into public registry state.

## Verification, rollback and replacement

WP-08 must pass the deterministic readiness contract table, completed/degraded
mapping, top-level failure safe-code mapping, startup retention for both AI and
Canonical, periodic Canonical degradation-to-recovery on the same runner record,
HTTP-200 Kernel liveness, and public redaction tests. Existing Canonical bounded,
isolation, overlap, stop and safe-reporter tests and existing AI no-Provider-call
tests remain the behavior authority.

The implementation is limited to the application server, focused recovery and
health tests, and this ADR plus ADR index metadata. Rollback is a one-commit
revert: remove the registry projection and additive health fields while leaving
the underlying runners and their persisted state untouched. A replacement
registry or persisted operational store requires a new ADR, migration/rollback
plan, and adapter replacement contract.
