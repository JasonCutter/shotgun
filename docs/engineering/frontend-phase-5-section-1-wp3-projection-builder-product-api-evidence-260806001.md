---
id: FRONTEND-PHASE-5-SECTION-1-WP3-EVIDENCE-260806001
classification: CANONICAL
status: wp3_implemented_pending_review
work_item: FE-P5-S1
created_at: 2026-08-06
subject_head: ab0c8749f6db475b16df674250c3b66dc3c63cdb
wp2_head: 86bafee6c97e9e87694414a22b0a64353b07d7d3
exact_head: 9159f20ee6dd09e9e6b0537b23af68987a33da07
ci_number: 615
ci_run: 31098837551
ci_conclusion: SUCCESS
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/73
governing_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
implementation_request: docs/implementation/frontend-phase-5-section-1-implementation-request-260806001.md
---

# FE-P5-S1 — WP3 Projection Builder and Product API Evidence

## 1. Scope

WP3 — Projection builder and Product API (Implementation Request r1 §4) implemented on
`codex/frontend-phase-5-section-1-product-implementation` after WP2 was accepted (WP2 final
verification head `86bafee6` CI #613).

WP3 covered:

- Adapter projection for Sources, Ask and External Action (projection builder).
- Project-scoped Queue, Detail, continuation and explicit refresh reads.
- Cursor bounds, stable ordering, watermark/lag and partial adapter health.
- Non-disclosing security and safe payload filtering.
- Optional limited Connector diagnostics are NOT yet wired (no Connector adapter in WP3).

## 2. Implemented files

| File                                                           | Content                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `modules/frontend-activity/src/activity-projection-builder.ts` | Federated projection builder (adapter merge → read-model rebuild, partial failure, watermarks)     |
| `modules/frontend-activity/src/product-api.ts`                 | Activity Product coordinator: Queue/Detail/Stage/Event/refresh reads, capabilities, non-disclosure |
| `modules/frontend-activity/src/index.ts`                       | Module exports                                                                                     |

## 3. Projection builder

- `ActivityProjectionBuilder` observes every owning-Domain adapter (`readQueue`) and merges the
  bounded queue items into `activity_index` through one deterministic full-project rebuild with a
  monotonic `snapshotRevision` (max existing watermark revision + 1).
- Each successful adapter observation also upserts a `projection_watermarks` record
  (source observation, projected time, lag, adapter status, revision, cursor).
- One adapter failure produces a partial result: `partial: true`, combined adapter status
  `DEGRADED`/`UNAVAILABLE`, and a safe failure entry. Raw internals (queries, secrets, paths)
  are never propagated (`asActivityAdapterError` → fixed generic message, `safe: false`).
- A failed adapter contributes no rows for the build (fail closed: stale rows are never presented
  as current); the store's rebuild guard rejects any lower-revision overwrite.

## 4. Product API (Contract Snapshot §7)

- `ActivityProductCoordinator` with typed, project-bound, cursor-bounded reads:
  - `listActivityQueue` — Queue read with domain/state/attention filters, stable ordering and
    keyset cursor continuation (cap 50).
  - `getActivityDetail` — Detail read by projection identity plus concrete Domain reference; the
    owning adapter re-resolves the authoritative Domain Resource snapshot and revalidates access.
  - `listActivityStages` / `listActivityEvents` — bounded Stage/Event continuation (bounded
    operational evidence, not FE-P5-S2 History).
  - `refreshActivityProjection` — explicit authoritative refresh through the projection builder.
- Least-privilege capability matrix: `owner`/`admin`/`activity:read` → read capabilities;
  `owner`/`admin`/`activity:refresh` → refresh. Missing capability → `PROJECT_ACCESS_DENIED`.
- Non-disclosing security: a missing or cross-project resource produces the same `NOT_FOUND`
  result and never leaks existence, identity, counts or failure details.
- Retry and Cancel are NOT generic Activity commands; Activity only exposes read/refresh
  capabilities and delegates any action to the owning Domain route (WP5).

## 5. Verification

Focused tests only (no previously-passed head re-run):

- `tests/integration/frontend-activity-projection-builder.test.ts` — 4 tests (build into read
  model with watermarks, partial failure preserving other adapters, monotonic revisions, stale
  rebuild guard).
- `tests/integration/frontend-activity-product-api.test.ts` — 9 tests (queue ordering/metadata,
  filters + cursor continuation, project binding, detail, stage/event continuation,
  non-disclosure, capability enforcement).

WP1 + WP2 + WP3 focused suites: **101 tests PASS** (contract 39, unit 16, integration 46,
PostgreSQL parity 11 — with DB). `tsc --noEmit`, ESLint and Prettier clean. Governance gates
(`docs:validate`, `docs:frontend-work-items`, `docs:completion-invariants`,
`docs:frontend-projections:check`) PASS.

Automatic CI on WP3 exact head `9159f20ee6dd09e9e6b0537b23af68987a33da07` (PR #73, draft
for auto CI only) — **CI #615 / `31098837551`: Quality, Frontend, Required Gates SUCCESS**.
No manual or duplicate CI was dispatched and no previously-passed head was re-run.

## 6. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP4 Activity Workspace UI.
- WP5 Domain action delegation (Retry/Cancel via owning Domain routes).
- Optional Connector Diagnostics adapter.
- Additional migrations, SSE, new runtime dependency, generic retry/cancel, FE-P5-S2,
  Ready/Merge, deployment and production verification.

## 7. Next action

Report WP3 implementation, verification and evidence. Do not begin WP4 until this Work Package is
reviewed and accepted for progression.
