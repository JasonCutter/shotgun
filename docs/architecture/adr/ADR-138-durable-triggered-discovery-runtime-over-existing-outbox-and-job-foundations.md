# ADR-138 — Durable Triggered Discovery Runtime over Existing Outbox and Job Foundations

- Status: **ACCEPTED**
- Proposed at: 2026-08-11
- Decision date: 2026-08-12
- Accepted at: 2026-08-12
- Accepted by: `USER`
- Decision owner: `USER`
- Work item: `AKP-4 — Trigger, Scheduling & Durable Runtime`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-080, ADR-086, ADR-090, ADR-096, ADR-097, ADR-118, ADR-130, ADR-134, ADR-137
- Product implementation: **NOT_AUTHORIZED**

## Context

The canonical Phase 5 design calls for incremental Discovery after approved changes and a periodic full Discovery pass. Current Stage 10 exposes a manual `RunKnowledgeDiscovery` command with modes `INCREMENTAL` and `WEEKLY`, but the module consumes no events and no persistent scheduler exists. Findings persist, but a durable Discovery run lifecycle does not.

Shotgun already has a transactional `CanonicalCommitted` outbox and accepted Job/Run/Attempt/Stage Activity semantics. AKP should close the Discovery runtime gap without creating a second outbox or silently promoting the deferred general-purpose durable knowledge-processing queue.

## Decision

### 1. Trigger coordinator

Introduce a server-owned `DiscoveryTriggerCoordinator` with three v1 trigger classes:

- `CANONICAL_COMMITTED` -> incremental Discovery after required projections reach an eligible state;
- `SCHEDULED_FULL_SCAN` -> persistent periodic full-project Discovery;
- `MANUAL` -> explicit authorized user request.

A later projection-recovery wake-up may resume an already-persisted waiting Job; it is not a new logical trigger.

### 2. Existing Canonical Outbox is reused

`CanonicalCommitted` remains the durable transport/source event. AKP does not add a second transaction-local Discovery outbox. The consumer is idempotent and derives one logical Discovery job identity from project + trigger identity + canonical/projection base + policy/profile revisions.

### 3. Real periodic scheduler

A `WEEKLY` enum or manually submitted WEEKLY command is insufficient. Persist `DiscoverySchedulePolicy` and scheduler bookkeeping so the runtime can create a full-scan Job without an interactive request.

The architectural default cadence is weekly, matching the existing Phase 5 design. Exact day/time is deployment/project configuration, not hard-coded midnight. The owner may explicitly disable or change cadence only within approved bounded policy.

### 4. Durable Discovery lifecycle

Persist an AKP Discovery Job/Run/Attempt lifecycle compatible with ADR-130 identities. Baseline lifecycle states include:

```text
QUEUED
WAITING_FOR_PROJECTION
RUNNING
PARTIAL
SUCCEEDED
FAILED_RETRYABLE
FAILED_TERMINAL
CANCELLED
```

Stages are typed, e.g. projection wait, signal retrieval, candidate generation, finding quality gate, persistence/re-entry publication and finding reconciliation. A Domain Retry creates a new Attempt and never erases the prior failure.

### 5. Projection readiness gating has a deadline

An incremental Job triggered by Canonical commit may enter `WAITING_FOR_PROJECTION` until the required Compiled Truth and applicable semantic/graph projections reach the policy-required readiness. It must not read an arbitrary stale projection merely to run quickly.

Every waiting Job records a bounded projection-wait deadline/policy. It cannot wait silently forever. At expiry the typed policy must choose one of:

- continue with an explicitly permitted degraded deterministic/lexical strategy set and record `PARTIAL`/degraded provenance;
- transition to `FAILED_RETRYABLE` for later recovery;
- transition to `FAILED_TERMINAL` when the missing capability/policy makes the run invalid.

If semantic capability is unavailable but policy permits deterministic/lexical fallback before the deadline, the run may continue with the effective strategy set recorded.

### 6. Lease, retry and restart recovery

Use existing PostgreSQL/in-process worker patterns and durable state. A worker claims an eligible run/attempt under a bounded lease; restart/lease expiry makes retryable work available again. Idempotency keys and finding fingerprints prevent duplicate logical outcomes after redelivery or response loss.

No BullMQ, RabbitMQ, Temporal or generalized workflow service is selected solely for AKP v1.

### 7. Coalescing without losing latest knowledge

Multiple rapid Canonical commits may be coalesced only when the persisted run identity and lineage prove that the later canonical/projection base subsumes the earlier pending work. The latest required canonical version cannot be discarded by debouncing.

### 8. Canonical-triggered finding reconciliation

A Canonical/projection update must also make existing active findings eligible for bounded reconciliation. If a prior proposal is now Canonical, contradicted by a newer approved state, or based on materially superseded inputs, the runtime updates its derived lifecycle to `RESOLVED`, `STALE` or `SUPERSEDED` according to ADR-136 while preserving the original finding/provenance.

Reconciliation is idempotent and budgeted. It is not a Canonical mutation and does not delete historical findings.

### 9. Budget enforcement

AKP-3 work budgets are persisted with or resolved for the run: scan/candidate/provider/token/cost/deadline/concurrency limits. Retry does not reset an overall Job budget without an explicit policy reason.

### 10. Activity and observations

Discovery runtime emits normalized activity observations consumed by the existing Activity projection. Activity is not authority over the Discovery Job; it presents the domain-owned durable snapshot and events according to ADR-130.

### 11. Manual trigger remains governed

Manual Discovery is project-scoped, capability-checked and records actor, requested mode/policy and effective bounded limits. The Browser cannot supply project authority, external provider authority or unbounded budgets.

## Consequences

- Shotgun becomes proactively active after Canonical changes and on a real periodic cadence.
- Restart/duplicate-delivery behavior becomes testable and observable.
- AKP gains durable Job tables/fields as needed, but does not require a general queue platform.
- Incremental Discovery can wait safely for projection readiness without infinite silent waits.
- Existing findings can be reconciled as Canonical evolves instead of remaining misleadingly fresh.

## Rejected alternatives

- Run Discovery inside the Canonical transaction.
- A process-local `setInterval` as the only periodic scheduler.
- Treat `mode: WEEKLY` as proof that scheduling exists.
- Leave `WAITING_FOR_PROJECTION` with no deadline or typed terminal/degraded disposition.
- Create a second Outbox specifically for Discovery triggers.
- Add a new queue/workflow product before the existing PostgreSQL/Job approach hits measured limits.
- Blind daily full scans regardless of changes/cost.
- Leave fulfilled/obsolete findings active until a user manually dismisses them.