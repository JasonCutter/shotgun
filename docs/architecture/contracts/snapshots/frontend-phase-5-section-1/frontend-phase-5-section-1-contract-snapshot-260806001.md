---
id: FRONTEND-PHASE-5-SECTION-1-CONTRACT-SNAPSHOT-260806001
classification: CANONICAL
status: frozen_product_implementation_not_authorized
revision: 1
created_at: 2026-08-06
approved_at: 2026-08-06T12:28:00+09:00
approved_by: user
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
governing_adr: ADR-130
---

# FE-P5-S1 — Agent and Job Activity Workspace Contract Snapshot r1

## 1. Authority

This snapshot is **FROZEN** for FE-P5-S1 contract preparation.

- Product implementation: `NOT_AUTHORIZED`
- Additive migration implementation: `NOT_AUTHORIZED`
- New runtime dependency: `NOT_REQUIRED`
- Polling: `BASELINE`
- SSE: `DEFERRED`
- Acceptance Criteria: `FE-P5-S1-AC-01` through `FE-P5-S1-AC-16`

Any change to these boundaries requires an explicit amendment. FE-P5-S1 remains `NOT_STARTED` in the Work Item registry until Product implementation is separately authorized.

## 2. Product boundary

FE-P5-S1 provides a Project-scoped operational workspace for current and recent Sources, Ask and External Action work.

Included:

- Activity Queue and Detail.
- Job-or-Run root, Run, Domain Attempt, Transport Attempt, Stage and Event views.
- Progress, Failure, Partial Failure, Cancel and Outcome Unknown.
- User Attention and exact Domain Resource deep links.
- Correlation, causation and trace references without ID equivalence.
- Projection watermark, lag, stale state and adapter availability.
- Polling refresh and authoritative snapshot recovery.
- Server-derived availability of existing Domain actions.

Excluded:

- Generic Activity execution authority.
- FE-P5-S2 History, Audit, Rollback, Retention and Tombstones.
- Reversal or Compensation implementation.
- SSE.
- Cross-Phase Product Verification.
- Deployment and Production Verification.

## 3. Federated projection

```text
Activity Queue
  → frontend_activity.activity_index
  → adapter summaries

Activity Detail
  → adapter lookup
  → current authoritative Domain Resource Snapshot
  → bounded operational evidence
```

Adapters:

- Sources Activity Adapter.
- Ask Activity Adapter.
- External Action Activity Adapter.
- Limited Connector Diagnostics Adapter where safe and useful.

One adapter failure produces a partial result and adapter health metadata; it must not erase accessible results from other adapters.

## 4. Identity contract

### 4.1 ActivityRootReferenceV1

- `rootKind`: `JOB | RUN`
- `activityId`: projection identity
- `domainKind`
- `domainResourceKind`
- `domainResourceId`
- `resourceProjectId`
- `resourceHref`
- optional `jobId`
- `runId`

`activityId` never replaces the concrete Domain Resource identity.

### 4.2 ActivityRunViewV1

- `runId`
- optional `jobId`
- `sequence`
- `state`
- start/update/completion timestamps
- Domain Attempt references
- correlation and causation references

### 4.3 ActivityDomainAttemptViewV1

- `attemptId`
- `runId`
- `attemptNumber`
- `attemptKind`
- `state`
- failure and retryability
- access and Policy Context references
- start/update/completion timestamps
- Stage references

### 4.4 ActivityTransportAttemptViewV1

- transport-specific identity
- Command or Message reference
- delivery sequence and result
- timestamp
- safe failure classification

A Transport Attempt is never returned as a Domain Attempt.

### 4.5 ActivityStageViewV1

- stable `stageId`
- `stageKey`
- label and sequence
- state and optional bounded progress
- start/update/completion timestamps
- optional safe failure

### 4.6 ActivityEventViewV1

- `eventId`
- related Run, Attempt or Stage reference
- category and sequence
- `occurredAt`
- safe summary
- optional Domain Resource reference

Activity Event is bounded operational evidence, not the FE-P5-S2 immutable History owner.

### 4.7 ActivityProjectionMetadataV1

- `snapshotRevision`
- `generatedAt`
- `sourceUpdatedAt`
- `freshness`: `CURRENT | LAGGING | STALE | UNKNOWN`
- optional `lagMilliseconds`
- `adapterStatus`: `AVAILABLE | DEGRADED | UNAVAILABLE`
- `partial`
- optional cursor

## 5. Lifecycle contract

Common lifecycle states:

- `QUEUED`
- `RUNNING`
- `WAITING_FOR_USER`
- `PARTIAL`
- `SUCCEEDED`
- `FAILED`
- `CANCEL_REQUESTED`
- `CANCELLED`
- `OUTCOME_UNKNOWN`

The server adapter maps Domain state into this view. The browser does not infer authority from child rows.

Separate dimensions:

- Progress.
- Attention.
- Failure.
- Retryability.
- Projection Freshness.
- Adapter Availability.

## 6. Domain mapping

| Domain | Job | Run/root | Domain Attempt | Event |
| --- | --- | --- | --- | --- |
| Sources | IntakeSubmission | submission-item processing | IntakeAttempt | processing evidence |
| Ask | none | AnswerRun | AnswerRunAttempt | AnswerRunEvent |
| External Action | Action aggregate | Execution | ExecutionAttempt | AuditEvent |
| Connector Runtime | internal diagnostic Job | none | none; transport attempt only | TraceRecord |

No fake Job is created for Ask.

## 7. Product API boundary

Read endpoints are typed, Project-bound and cursor-bounded. Final paths may follow repository route conventions, but the capabilities are fixed:

- Activity Queue read with filters and stable ordering.
- Activity Detail read by projection identity plus concrete Domain reference.
- Bounded Event/Stage continuation.
- Explicit authoritative refresh.

Retry and Cancel are not generic Activity commands. Activity returns server-derived action references or capabilities, and the client invokes the existing owning Domain command route. The server revalidates current state and authority at execution time.

## 8. Persistence boundary

Required additive migration:

```text
frontend_activity.activity_index
frontend_activity.projection_watermarks
```

`activity_index` stores only the Project-scoped searchable current projection summary and concrete Domain identity. `projection_watermarks` stores adapter observation and lag metadata.

Forbidden:

- replacing existing Domain execution tables;
- persisting full duplicate Job/Run/Attempt/Event histories;
- using Activity as FE-P5-S2 History;
- destructive modification of Sources, Ask or External Action persistence.

## 9. Security, accessibility and recovery

- Deny by default for missing Principal, Project, Capability or sensitivity authority.
- Do not reveal inaccessible Resource existence, counts, IDs or failure details.
- Deep links revalidate the concrete target Resource.
- Safe allow-listed Event and Failure details only.
- Keyboard-accessible Queue, filters, Detail and actions.
- Ordered list/table alternatives for hierarchy and timeline.
- Text semantics independent of color.
- Restrained live announcements for meaningful changes only.
- Project/access/policy revision changes invalidate affected cache.
- Polling and refresh never let a lower snapshot revision replace a newer one.
- Adapter failure is surfaced as partial/degraded, not fabricated success.
- `OUTCOME_UNKNOWN` does not auto-retry.

## 10. Frozen Acceptance Criteria

- **FE-P5-S1-AC-01**: Current-Project Sources, Ask and External Action work is available in one Activity Queue.
- **FE-P5-S1-AC-02**: Another Project's Activity existence, ID, count and failure information is not disclosed.
- **FE-P5-S1-AC-03**: Job, Run, Domain Attempt, Transport Attempt, Stage and Event identities are distinguished.
- **FE-P5-S1-AC-04**: Activity projection identity never replaces concrete Domain Resource identity.
- **FE-P5-S1-AC-05**: Queue-to-Detail navigation exposes Run, Attempt, Stage and Event lineage.
- **FE-P5-S1-AC-06**: Domain Retry creates a new Attempt with causation while preserving the earlier Attempt and failure.
- **FE-P5-S1-AC-07**: Transport Retry is not presented as a new Domain Attempt.
- **FE-P5-S1-AC-08**: Failure, Partial Failure, Cancel Requested, Cancelled, Outcome Unknown and User Attention are distinct.
- **FE-P5-S1-AC-09**: Projection Watermark, Lag, Stale and Adapter Unavailable states are visible.
- **FE-P5-S1-AC-10**: Failure of one adapter still returns accessible results from other adapters as a partial result.
- **FE-P5-S1-AC-11**: Refresh and polling recover from the latest authoritative Domain Snapshot.
- **FE-P5-S1-AC-12**: Deep-link access revalidates Project Scope, Capability, sensitivity and Resource access.
- **FE-P5-S1-AC-13**: Retry and Cancel are shown only when the owning Domain allows them, and the server revalidates state and authority.
- **FE-P5-S1-AC-14**: Event and Failure payloads contain only approved safe fields.
- **FE-P5-S1-AC-15**: Queue, Detail and timeline are keyboard navigable and have list/table accessibility representations.
- **FE-P5-S1-AC-16**: With deterministic fixtures, initial Queue display and Queue-to-Detail transition each have a three-sample median of at most 2,000 ms.

## 11. Decision summary

- Architecture: `FEDERATED_ACTIVITY_READ_PROJECTION`
- ADR-130: `ACCEPTED`
- Migration: `REQUIRED / IMPLEMENTATION_NOT_AUTHORIZED`
- Runtime Dependency: `NOT_REQUIRED`
- Polling: `BASELINE`
- SSE: `DEFERRED`
- Contract: `FROZEN`
- Product implementation: `NOT_AUTHORIZED`
