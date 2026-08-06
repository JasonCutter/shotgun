---
id: FRONTEND-PHASE-5-SECTION-1-IMPLEMENTATION-REQUEST-260806001
classification: CANONICAL
status: frozen_product_implementation_not_authorized
revision: 1
created_at: 2026-08-06
approved_at: 2026-08-06T12:28:00+09:00
approved_by: user
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
governing_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
---

# FE-P5-S1 — Agent and Job Activity Workspace Implementation Request r1

## 1. Authority

This request is **FROZEN / NOT AUTHORIZED FOR PRODUCT IMPLEMENTATION**.

It defines the implementation boundary to use after a separate authorization. It does not authorize Product code, migration implementation, dependency changes, Ready, merge, deployment, production verification or FE-P5-S2.

## 2. Objective

Build a Project-scoped Activity Workspace that observes Sources, Ask and External Action work through a Federated Activity Read Projection while preserving each Domain's execution authority, identity and retry semantics.

## 3. Frozen inputs

- `docs/architecture/frontend/phase-5-operations-audit.md`
- `docs/architecture/adr/ADR-130-frontend-agent-job-activity-authority-and-retry-boundary.md`
- `docs/engineering/frontend-phase-5-section-1-agent-job-activity-gap-audit-260806001.md`
- `docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md`
- ADR-101, ADR-105, ADR-111, ADR-112, ADR-118, ADR-119, ADR-124 and ADR-129

## 4. Implementation scope after authorization

### WP1 — Typed contract and adapter ports

- Activity root, Run, Domain Attempt, Transport Attempt, Stage, Event and Projection metadata.
- Sources, Ask and External Action adapter ports.
- Domain-state mapping and separate projection dimensions.
- Contract decoders that reject browser-authored authority.

### WP2 — Additive read-model persistence

- Additive migration using the next verified migration sequence.
- `frontend_activity.activity_index`.
- `frontend_activity.projection_watermarks`.
- Project binding, stable ordering, indexes and deterministic rebuild behavior.
- No duplicate full Domain execution history.

### WP3 — Projection builder and Product API

- Adapter projection for Sources, Ask and External Action.
- Optional limited Connector diagnostics.
- Project-scoped Queue, Detail, continuation and explicit refresh reads.
- Cursor bounds, stable ordering, watermark/lag and partial adapter health.
- Non-disclosing security and safe payload filtering.

### WP4 — Activity Workspace

- `/activity` Queue, filters, Attention and adapter health.
- Detail with Job-or-Run root, Runs, Attempts, Stages and bounded Events.
- Projection Lag, Partial Failure, Outcome Unknown and recovery states.
- Exact Domain Resource deep links.
- Polling-based authoritative refresh.
- Accessible list/table alternatives and deterministic focus behavior.

### WP5 — Existing Domain action delegation

- Display Retry and Cancel only from server-derived Domain capabilities.
- Invoke existing Sources, Ask or External Action command routes.
- Revalidate state and authority at execution time.
- Preserve Domain Retry causation.
- Never turn Transport Retry into a Domain Attempt.
- No generic Activity command endpoint.

### WP6 — Focused verification and evidence

- Contract and adapter mapping tests.
- Migration/rebuild and revision-ordering tests.
- Cross-Project non-disclosure and deep-link security tests.
- Partial adapter failure and authoritative refresh tests.
- Keyboard/accessibility and browser E2E.
- Deterministic three-sample median gates for Queue and Queue-to-Detail.
- AC-01 through AC-16 evidence matrix.

Only one Work Package is implemented and reviewed at a time.

## 5. Migration boundary

Migration is `REQUIRED / IMPLEMENTATION_NOT_AUTHORIZED`.

Allowed:

- the two frozen Activity read-model tables;
- supporting indexes, constraints and deterministic fixtures;
- additive adapter cursor/revision metadata within the Activity schema.

Forbidden:

- destructive changes to Sources, Ask or External Action stores;
- full duplicate Job/Run/Attempt/Event ledgers;
- FE-P5-S2 retention, history, rollback or tombstone data;
- deployment side effects.

## 6. Dependency and transport boundary

- New runtime dependency: `NOT_REQUIRED`.
- Polling: `BASELINE`.
- SSE: `DEFERRED`.
- New workflow engine, queue, event store or state library: prohibited without a new approved decision.

## 7. Verification discipline

- Do not rerun a previously passed exact head.
- Run focused checks only for changed contracts and modules during implementation.
- Use the repository's automatically triggered CI for each new exact head.
- Do not manually dispatch duplicate CI.
- Run the final complete Section verification once, immediately before completion review.

## 8. Frozen Acceptance Criteria

Implementation must satisfy exactly `FE-P5-S1-AC-01` through `FE-P5-S1-AC-16` from the frozen Contract Snapshot. A new criterion or semantic change requires an explicit amendment before implementation continues.

## 9. Exclusions

- FE-P5-S2 History, Audit and Rollback.
- Long-term retention, tombstone and legal hold.
- Reversal DraftChangeSet and Compensation implementation.
- Cross-Phase Product Verification.
- Deployment and Production Verification.
- FE-P4 changes.
- Product implementation before separate authorization.

## 10. Current decision state

- Gap Audit: `APPROVED`
- ADR-130: `ACCEPTED`
- Contract Snapshot r1: `FROZEN`
- Implementation Request r1: `FROZEN / NOT_AUTHORIZED`
- Migration: `REQUIRED / IMPLEMENTATION_NOT_AUTHORIZED`
- Runtime Dependency: `NOT_REQUIRED`
- Product implementation: `NOT_AUTHORIZED`
