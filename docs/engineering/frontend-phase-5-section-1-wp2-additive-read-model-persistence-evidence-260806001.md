---
id: FRONTEND-PHASE-5-SECTION-1-WP2-EVIDENCE-260806001
classification: CANONICAL
status: wp2_implemented_pending_review
work_item: FE-P5-S1
created_at: 2026-08-06
subject_head: ab0c8749f6db475b16df674250c3b66dc3c63cdb
wp1_head: 26f5e4e7ed70119b7903f66e15e13c9b3ce9d96c
exact_head: b06a4c37df7586045e3bac79819225008984e247
ci_number: 608
ci_run: 31093162869
ci_conclusion: SUCCESS
corrected_head: 7814727935c0729e667d95daf8ad0b75dc615d13
corrected_ci_number: 611
corrected_ci_run: 31095478566
corrected_ci_conclusion: SUCCESS
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/73
governing_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
implementation_request: docs/implementation/frontend-phase-5-section-1-implementation-request-260806001.md
---

# FE-P5-S1 — WP2 Additive Read-Model Persistence Evidence

## 1. Scope

WP2 — Additive read-model persistence (Implementation Request r1 §4) implemented on
`codex/frontend-phase-5-section-1-product-implementation` after WP1 was accepted (review:
WP1 ACCEPTED, binding-test head `92dccb6f`, final verification head `26f5e4e7` CI #606).

WP2 covered:

- Additive migration 029 using the next verified migration sequence.
- `frontend_activity.activity_index` and `frontend_activity.projection_watermarks`.
- Project binding, stable ordering, indexes and deterministic rebuild behavior.
- In-memory and PostgreSQL read-model store adapters with exact parity.
- No duplicate full Domain execution history.

## 2. Implemented files

| File                                                              | Content                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `db/migrations/029_frontend_activity_read_model.sql`              | Additive `frontend_activity` schema (activity_index + projection_watermarks + indexes) |
| `modules/frontend-activity/src/activity-index-store-port.ts`      | Index store port, keyset cursor, stale-rebuild guard                                   |
| `modules/frontend-activity/src/activity-watermark-store-port.ts`  | Watermark store port                                                                   |
| `modules/frontend-activity/src/activity-read-model-store-port.ts` | Combined read-model boundary                                                           |
| `modules/frontend-activity/src/index.ts`                          | Module exports                                                                         |
| `adapters/frontend-activity-in-memory/src/index.ts`               | In-memory stores                                                                       |
| `adapters/frontend-activity-postgres/src/index.ts`                | PostgreSQL stores                                                                      |
| `scripts/database.ts`                                             | `frontend_activity` registered in managedSchemas + requiredTables                      |

## 3. Migration 029 (frozen boundary)

- Preflight requires migration 028.
- `frontend_activity.activity_index`: Project-scoped current projection summary with concrete
  Domain identity (`activity_id` is projection identity; `domain_resource_id` keeps concrete
  identity), source revision, bounded `snapshot` jsonb, `snapshot_revision`, `projected_at`,
  `updated_at`. PK `(resource_project_id, domain_kind, activity_id)`.
  - Index for stable total ordering: `(resource_project_id, updated_at DESC, domain_kind, activity_id)`.
  - Index for deterministic per-domain rebuild: `(resource_project_id, domain_kind, domain_resource_id)`.
- `frontend_activity.projection_watermarks`: project- and adapter-scoped source observation,
  projection time, lag, adapter status, snapshot revision, cursor. PK `(resource_project_id, adapter_id)`.
- No existing Domain execution table is modified; no duplicate full Domain execution history;
  Activity is never the FE-P5-S2 History ledger.

## 4. Store semantics

- `ActivityIndexStorePort` — upsert by identity; project-scoped `queryProject` with filters
  (domain/state/attention), stable total ordering and base64url keyset cursor pagination;
  `deleteProject` / `deleteByProjectAndDomain`; `rebuildProject` with
  `assertRebuildRevisionNotLower` (a rebuild never lets a lower snapshot revision replace a
  newer one).
- `ActivityWatermarkStorePort` — upsert by `(resource_project_id, adapter_id)`, project and
  adapter reads, project delete.
- `ActivityReadModelStorePort` — combines index + watermarks for the WP3 projection builder.

## 5. Verification

Focused tests only (no previously-passed head re-run):

- `tests/integration/frontend-activity-read-model-store.test.ts` — 25 tests (project binding,
  stable ordering, filters, true keyset pagination incl. same-updatedAt ties, cursor-row
  deletion/updatedAt-change behavior, deterministic rebuild, stale-revision/upsert guards,
  rebuild scope validation, record invariants, watermark monotonicity).
- `tests/database/frontend-activity-postgres-parity.test.ts` — 11 tests (in-memory vs PostgreSQL
  parity for ordering/pagination, tie pagination, cursor mutation, stale upsert, rebuild scope,
  rebuild+guard, watermarks, watermark stale upsert, rebuild/upsert concurrency serialization,
  DB CHECK parity). Requires local Postgres and migration 029 (`db:reset` + `db:verify` PASS).

WP1 + WP2 focused suites: 99 tests PASS (contract 39, unit 16, integration 33, parity 11 — with
DB). `tsc --noEmit`, ESLint and Prettier clean. Governance gates (`docs:validate`,
`docs:frontend-work-items`, `docs:completion-invariants`, `docs:frontend-projections:check`)
PASS. `db:reset` and `db:verify` PASS with migration 029 applied.

## 5.1 Correction — review findings (CHANGES_REQUIRED)

Review found four blocking defects and one evidence mismatch, all corrected within WP2 scope:

1. **PostgreSQL keyset pagination** — the cursor predicate did not match `ORDER BY updated_at
DESC, domain_kind ASC, activity_id ASC`. Fixed to `updated_at < cursor OR (updated_at =
cursor AND (domain_kind, activity_id) > (cursor kind, cursor id))`; added same-updatedAt tie
   pagination tests (in-memory and parity).
2. **Upsert monotonicity** — a lower `snapshotRevision` could overwrite a newer row. In-memory
   and PostgreSQL upserts now fail with `ACTIVITY_INDEX_STALE_UPSERT` when a newer revision
   exists; parity tests added.
3. **Rebuild scope validation** — the batch is now fully validated BEFORE any delete (project
   binding, scoped domain, revision equality, duplicate identity), in-memory and PostgreSQL
   alike; out-of-scope rebuild tests added.
4. **Persistence invariants** — migration 029 now enforces the state lifecycle CHECK, the
   domain/root binding CHECK (ASK=RUN, others=JOB) and the root/job CHECK; the in-memory store
   enforces the same via `validateActivityIndexRecord`, with DB CHECK parity verified.
5. **Evidence/PR metadata** — test counts and PR #73 body updated to the corrected state.

## 5.2 Correction — second review round (CHANGES_REQUIRED)

A second review round found four items, all corrected within WP2 scope:

1. **In-memory true keyset semantics** — the in-memory cursor used a positional slice (find the
   exact cursor row then skip it), which returned an empty page when the cursor row was deleted
   or its `updatedAt` changed after the cursor was issued. Replaced with the same tuple predicate
   as PostgreSQL (`updatedAt < cursor OR (updatedAt = cursor AND (domain_kind, activity_id) >
cursor)`). Added cursor-row deletion and cursor-row updatedAt-change regression tests with
   in-memory/PostgreSQL parity.
2. **Watermark revision monotonicity** — `projection_watermarks` also now rejects a lower
   `snapshotRevision` upsert (`ACTIVITY_WATERMARK_STALE_UPSERT`) in-memory and PostgreSQL;
   revision 5 → 4 rejected, 6 accepted.
3. **Rebuild/upsert concurrency serialization** — PostgreSQL index writes (upsert, delete,
   rebuild) now take a project-scoped `pg_advisory_xact_lock`, so a rebuild's DELETE → INSERT
   window cannot interleave with a concurrent upsert and end with a lower revision winning.
   Added a concurrent upsert-vs-rebuild race test asserting the newest committed revision always
   wins.
4. **Evidence/PR current authority** — PR #73 title/body updated to WP1+WP2 scope with the
   corrected heads and CI (#611, #612); this section documents the accurate history.

## 6. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP3 projection builder and Product API.
- WP4 Activity Workspace UI.
- WP5 Domain action delegation.
- WP2+ migration beyond the two frozen Activity read-model tables.
- SSE, new runtime dependency, generic retry/cancel, FE-P5-S2, Ready/Merge, deployment and
  production verification.

## 7. Automatic CI

WP2 exact head `b06a4c37df7586045e3bac79819225008984e247` (PR #73, draft for auto CI only) —
**CI #608 / `31093162869`: Quality, Frontend, Required Gates SUCCESS**. No manual or duplicate
CI was dispatched and no previously-passed head was re-run.

Review-correction head `7814727935c0729e667d95daf8ad0b75dc615d13` (includes the five WP2
corrections) — **CI #611 / `31095478566`: Quality, Frontend, Required Gates SUCCESS**.

## 8. Next action

Report WP2 implementation, verification and evidence. Do not begin WP3 until this Work Package is
reviewed and accepted for progression.
