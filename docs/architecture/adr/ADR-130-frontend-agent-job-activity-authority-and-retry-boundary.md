# ADR-130 — Frontend Agent·Job Activity Federated Projection, Identity and Retry Boundary

- Status: **ACCEPTED**
- Proposed at: 2026-08-06
- Accepted at: 2026-08-06T12:28:00+09:00
- Accepted by: `USER`
- Work item: `FE-P5-S1`
- Tracking issue: `#71`
- Subject base: `main@8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd`
- Related ADRs: ADR-101, ADR-104, ADR-105, ADR-111, ADR-112, ADR-118, ADR-119, ADR-124, ADR-129
- Contract snapshot:
  `docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md`
- Decision owner: `USER`
- Product implementation: `NOT_AUTHORIZED`

## Context

ADR-111, owned by the consolidated Frontend ADR record, establishes Activity as a Job·Attempt·Event
projection. ADR-112 separates immutable History and reversal behavior. FE-P5-S1 now needs an
implementation-level boundary that maps heterogeneous Sources, Ask and External Action execution
resources into one Project-scoped Activity workspace without inventing a second execution authority.

The repository already contains domain execution records:

- Sources: IntakeSubmission, submission-item processing and IntakeAttempt.
- Ask: AnswerRun, AnswerRunAttempt and AnswerRunEvent.
- External Action: Action aggregate, Execution, ExecutionAttempt and AuditEvent.
- Connector Runtime: internal Job/transport-attempt diagnostics.

Those resources do not share one durable Job identity or one lifecycle hierarchy.
`packages/job-runtime` and observability stores are in-memory and cannot become Product authority.

## Decision

### 1. Federated read projection

FE-P5-S1 adopts a **Federated Activity Read Projection**.

```text
Activity Workspace
  → Activity Index and Projection Watermarks
  → Sources Activity Adapter
  → Ask Activity Adapter
  → External Action Activity Adapter
  → limited Connector Diagnostics Adapter
  → authoritative Domain Resource Snapshot
```

Activity is not a common execution ledger. Queue/search may use an additive Activity index, but
detail reads re-resolve the owning Domain Resource snapshot.

### 2. Root and identity model

An Activity root is either `JOB` or `RUN`.

- A durable Job is shown only when the owning Domain actually has one.
- A Run may be the root where no durable Job exists; Ask must not receive an invented Job ID.
- Domain Attempt and Transport Delivery Attempt are distinct types.
- Stage is a typed logical segment within a Run or Domain Attempt.
- Event is bounded operational evidence, not FE-P5-S2 long-term History.

`commandId`, `messageId`, `jobId`, `runId`, `attemptId`, `stageId`, `eventId` and `traceId` remain
separate identities connected through typed references.

Initial mappings:

| Domain            | Job                     | Run                        | Domain Attempt         | Event                      |
| ----------------- | ----------------------- | -------------------------- | ---------------------- | -------------------------- |
| Sources           | IntakeSubmission        | Submission-item processing | IntakeAttempt          | domain processing evidence |
| Ask               | none                    | AnswerRun                  | AnswerRunAttempt       | AnswerRunEvent             |
| External Action   | Action aggregate        | Execution                  | ExecutionAttempt       | AuditEvent                 |
| Connector Runtime | internal diagnostic Job | none                       | transport attempt only | TraceRecord                |

### 3. Retry and outcome semantics

- Transport Retry repeats delivery of the same Command or Message and does not create a Domain
  Attempt.
- Domain Retry uses the owning Domain command, creates a new Domain Attempt or Run as defined by
  that Domain, and preserves correlation and causation.
- Earlier Attempts, failures, timestamps and Policy Context remain visible.
- `OUTCOME_UNKNOWN` never triggers automatic Domain Retry or duplicate submission.
- Activity provides no generic retry or cancel authority. It exposes server-derived available
  actions and delegates execution to existing Domain commands.

### 4. State and separate dimensions

Common lifecycle states are:

```text
QUEUED
RUNNING
WAITING_FOR_USER
PARTIAL
SUCCEEDED
FAILED
CANCEL_REQUESTED
CANCELLED
OUTCOME_UNKNOWN
```

Progress, Attention, Failure, Retryability, Projection Freshness and Adapter Availability remain
separate dimensions. `STALE` is Projection Freshness, not a Domain lifecycle state.

### 5. Persistence

An additive `frontend_activity` read model is required:

- `activity_index`: Project-scoped queue/search index with concrete Domain Resource identity,
  current summary, source revision and `projected_at`.
- `projection_watermarks`: Project- and adapter-scoped source observation, projection time, lag and
  adapter status.

The migration must not duplicate full Domain execution histories or create the FE-P5-S2 History
ledger. Migration implementation remains separately unauthorized.

### 6. Refresh transport

Typed HTTP snapshot reads and bounded polling are the baseline. SSE is **DEFERRED**.

Polling, SSE, browser cache and timeline presentation are observation mechanisms only. Refresh
always converges on an authoritative Domain Resource snapshot, and lower revisions cannot overwrite
a newer snapshot.

### 7. Security and deep links

Every queue, detail and deep-link read revalidates current Principal, Project, Capability,
sensitivity and Resource access. Inaccessible resources are non-disclosing. Event and failure
payloads expose only explicitly allowed safe fields.

### 8. Activity and History boundary

```text
Activity
→ current operational projection and bounded evidence

History
→ long-term immutable revision, decision, approval, audit and result record
```

FE-P5-S1 does not pre-implement retention, tombstones, legal hold, reversal or compensation history.

## Consequences

### Positive

- Heterogeneous Domain work is observable through one Project-scoped workspace.
- Domain authority, retry meaning and concrete Resource identity are preserved.
- Projection lag and partial adapter failure become explicit.
- Existing PostgreSQL, Fastify, React Query and Domain stores are reused without a new runtime
  dependency.

### Costs

- Each participating Domain requires an adapter.
- Activity index/watermark rebuilding, ordering and partial-result behavior require focused
  verification.
- Detail reads must combine the read model with current Domain authorization.

## Rejected alternatives

- Observability traces as Activity authority.
- One universal durable Job for every Domain.
- Browser-side composition as the authoritative Activity model.
- Generic Activity retry/cancel commands.
- A full Activity Event history ledger in FE-P5-S1.
- SSE-only delivery or a new workflow engine.

## Accepted authority

- ADR-130: `ACCEPTED`
- Contract Snapshot: `FROZEN`
- Acceptance Criteria: `FE-P5-S1-AC-01` through `FE-P5-S1-AC-16` frozen
- Additive Migration: `REQUIRED / IMPLEMENTATION_NOT_AUTHORIZED`
- Runtime Dependency: `NOT_REQUIRED`
- Polling: `BASELINE`
- SSE: `DEFERRED`
- Product implementation: `NOT_AUTHORIZED`
