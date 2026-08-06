---
id: FRONTEND-PHASE-5-SECTION-1-WP3-EVIDENCE-260806001
classification: CANONICAL
status: wp3_implemented_pending_review
work_item: FE-P5-S1
created_at: 2026-08-06
subject_head: ab0c8749f6db475b16df674250c3b66dc3c63cdb
wp2_head: 86bafee6c97e9e87694414a22b0a64353b07d7d3
round1_head: 9159f20ee6dd09e9e6b0537b23af68987a33da07
round1_ci_number: 615
round1_ci_run: 31098837551
round2_implementation_head: 66a2ca13aae728990e938dc3e622259c7c9386a3
round2_implementation_ci_number: 618
round2_implementation_ci_run: 31103054212
round2_correction_head: 419db19ad0577e336fea0d6930e34b23e0f40d7b
round2_correction_ci_number: 620
round2_correction_ci_run: 31106782611
current_evidence_head: f4afc32a3c79d424e0297d363ecb078c7dd5b106
current_evidence_ci_number: 621
current_evidence_ci_run: 31107258903
round3_correction_head: 62071a3b3e59254a06d2cc85f8c824451b1151a1
round3_correction_ci_number: 623
round3_correction_ci_run: 31110838089
round4_correction_head: b90b97a59fde01ef92a0932e6dd9f3c4e2ae4fa1
round4_correction_ci_number: 625
round4_correction_ci_run: 31114640938
implementation_exact_head: b90b97a59fde01ef92a0932e6dd9f3c4e2ae4fa1
implementation_ci_number: 625
implementation_ci_run: 31114640938
implementation_ci_conclusion: SUCCESS
evidence_metadata_base_head: 31df6b9f718b63fd08704d62a8e9228cac264308
evidence_metadata_base_ci_number: 624
evidence_metadata_base_ci_run: 31111295808
current_pr_head: b90b97a59fde01ef92a0932e6dd9f3c4e2ae4fa1
current_pr_ci_number: 625
current_pr_ci_run: 31114640938
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

- Concrete owning-Domain Activity adapters for Sources, Ask and External Action (real Domain
  state mapping — IntakeSubmission/item/IntakeAttempt, AnswerRun/AnswerRunAttempt/AnswerRunEvent,
  Action/Execution/ExecutionAttempt/AuditEvent).
- Runtime assembly of the adapter registry + PostgreSQL/in-memory read-model store + builder +
  coordinator, and the HTTP Product API routes.
- Project-scoped Queue, Detail, continuation and explicit refresh reads.
- Multi-page projection (nextCursor iteration + cycle detection), per-adapter atomicity,
  failed-adapter UNAVAILABLE watermarks and an atomic Project-scoped commit.
- Cursor bounds, stable ordering, watermark/lag and partial adapter health.
- Strict runtime request validation (schemaVersion + required identity + deny-by-default scope).
- Non-disclosing security and safe payload filtering.
- Optional limited Connector diagnostics are NOT yet wired (no Connector adapter in WP3).

## 2. Implemented files (round 2 — concrete adapters, assembly, routes, boundaries)

| File                                                                 | Content                                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `modules/frontend-activity/src/activity-projection-builder.ts`       | Federated projection builder: multi-page observation, per-adapter atomicity, UNAVAILABLE watermarks, atomic commit           |
| `modules/frontend-activity/src/product-api.ts`                       | Activity Product coordinator + strict request decoders: Queue/Detail/Stage/Event/refresh, capabilities, non-disclosure, caps |
| `modules/frontend-activity/src/activity-index-store-port.ts`         | `findByIdentity` direct lookup (Queue→Detail lineage)                                                                        |
| `modules/frontend-activity/src/activity-read-model-store-port.ts`    | `commitProjectProjection` atomic Project-scoped commit boundary                                                              |
| `modules/frontend-activity/src/activity-domain-read-ports.ts`        | Sources/Ask owning-Domain read ports (SPI) + cursor codecs                                                                   |
| `modules/frontend-activity/src/activity-adapter-port.ts`             | `limit` on Stage/Event continuation reads                                                                                    |
| `modules/frontend-activity/src/index.ts`                             | Module exports                                                                                                               |
| `adapters/frontend-activity-sources/src/index.ts`                    | `SourcesActivityAdapter` (Job = IntakeSubmission) + in-memory `SourcesActivityRead`                                          |
| `adapters/frontend-activity-ask/src/index.ts`                        | `AskActivityAdapter` (Run = AnswerRun) + in-memory `AskActivityRead`                                                         |
| `adapters/frontend-activity-external-action/src/index.ts`            | `ExternalActionActivityAdapter` (Job = Action aggregate) over `ExternalActionRepositoryBoundaryPort`                         |
| `adapters/frontend-sources-write-postgres/src/activity-read.ts`      | PostgreSQL `SourcesActivityReadPort` over `source_product`                                                                   |
| `adapters/frontend-ask-execution-postgres/src/activity-read.ts`      | PostgreSQL `AskActivityReadPort` over `frontend_ask`                                                                         |
| `adapters/frontend-activity-in-memory/src/index.ts`                  | `findByIdentity` + atomic `commitProjectProjection`                                                                          |
| `adapters/frontend-activity-postgres/src/index.ts`                   | `findByIdentity` + transactional `commitProjectProjection`                                                                   |
| `assemblies/shotgun-app/src/product-api/frontend-activity-routes.ts` | HTTP routes: `/product-api/frontend/activity/{queue,detail,stages,events,refresh}`                                           |
| `assemblies/shotgun-app/src/server.ts` / `src/main.ts`               | Registry + store + builder + coordinator assembly; PostgreSQL read ports/store injection                                     |

## 3. Projection builder

- `ActivityProjectionBuilder` observes every owning-Domain adapter page by page (`nextCursor`
  until exhausted, page size 100, cursor cycle detection) and merges the bounded queue items into
  `activity_index` through one deterministic build with a monotonic `snapshotRevision`.
- **Multi-page**: a Domain with more than one page is never truncated (101+ items regression).
- **Per-adapter atomicity**: an adapter's rows join the build only when every page succeeded; a
  page-2+ failure discards that adapter's earlier pages too.
- **Failed-adapter watermarks**: EVERY registry adapter receives a current-revision watermark.
  Successful adapters record their observation (sourceUpdatedAt/lag/cursor from `page.metadata` —
  never `adapter.health()` alone); a failed adapter records `adapterStatus: UNAVAILABLE` with no
  fabricated sourceUpdatedAt/cursor/lag, so a stale AVAILABLE watermark can never be presented as
  current. Combined status is `DEGRADED`/`UNAVAILABLE` when any adapter is unavailable.
- **Atomic commit**: index replace + every watermark publish in ONE Project-scoped transaction/CAS
  boundary (`commitProjectProjection`). A concurrent refresh can never confirm the same revision
  with a different snapshot, and a mid-commit failure rolls the whole projection back.
- Raw internals (queries, secrets, paths) are never propagated (`asActivityAdapterError` → fixed
  generic message, `safe: false`).

## 4. Product API (Contract Snapshot §7)

- `ActivityProductCoordinator` with typed, project-bound, cursor-bounded reads:
  - `listActivityQueue` — Queue read with domain/state/attention filters, stable ordering and
    keyset cursor continuation (cap 50).
  - `getActivityDetail` — Detail by projection identity + `domainKind` + concrete Domain
    reference; resolved through the store's direct `findByIdentity` (Queue→Detail lineage, AC-05 —
    any queue-visible item resolves regardless of page caps). The owning adapter re-resolves the
    authoritative Domain Resource snapshot and revalidates access.
  - `listActivityStages` / `listActivityEvents` — bounded continuation with the server-enforced
    cap (50) passed down to the adapter and re-enforced on the response.
  - `refreshActivityProjection` — explicit authoritative refresh through the projection builder.
- Every Product API request is decoded at runtime: `schemaVersion` enforced, required identity
  fields non-empty, enums allow-listed, browser-authored authority fields
  (`ACTIVITY_BROWSER_AUTHORITY_FIELDS`) rejected, and the server-derived scope is validated
  (empty Principal/Project/revisions → deny-by-default `PROJECT_ACCESS_DENIED`).
- Least-privilege capability matrix: `owner`/`admin`/`activity:read` → read capabilities;
  `owner`/`admin`/`activity:refresh` → refresh. Missing capability → `PROJECT_ACCESS_DENIED`.
- Non-disclosing security: a missing, cross-project or reference-mismatched resource produces the
  same `NOT_FOUND` result and never leaks existence, identity, counts or failure details.
- Retry and Cancel are NOT generic Activity commands; Activity only exposes read/refresh
  capabilities and delegates any action to the owning Domain route (WP5).

## 5. Verification

Focused tests only (no previously-passed head re-run):

- WP1 contract `tests/contract/frontend-activity.contract.test.ts` — 39 tests.
- WP1 unit `tests/unit/frontend-activity-domain-mapping.test.ts` — 16 tests.
- WP1 integration `frontend-activity-adapter-ports.test.ts` — 8 tests.
- WP2 integration `frontend-activity-read-model-store.test.ts` — 25 tests.
- WP3 integration `frontend-activity-projection-builder.test.ts` (4),
  `frontend-activity-product-api.test.ts` (9),
  `frontend-activity-projection-builder-regression.test.ts` (6 — multi-page, per-adapter
  atomicity, cycle detection, failed-adapter watermark across builds, atomic commit CAS/rollback),
  `frontend-activity-product-api-boundaries.test.ts` (8 — 51+ Queue→Detail, identity collision,
  Stage/Event caps, runtime request validation),
  `frontend-activity-domain-adapters.test.ts` (6 — concrete Sources/Ask/External Action mapping),
  `frontend-activity-round2-regression.test.ts` (10 — concrete 101+ queue pagination, empty-
  projection CAS, continuation cursors, Ask attempt identity, sensitivity/access revalidation,
  multi-page watermark aggregation),
  `frontend-activity-round3-regression.test.ts` (9 — project/audience isolation A/B, deep-link
  Domain authorization + required sensitivity, Sources event continuation beyond 100/200,
  in-memory tie ordering),
  `frontend-activity-round4-regression.test.ts` (10 — audience-safe Queue pagination: empty
  page without cursor, 50 leading inaccessible + 1 accessible, interleaved multi-page with no
  gap/duplicate and cursor only on full pages; Sources authoritative revalidation: same
  Principal + low clearance / stale access / stale policy on Queue/Detail/Stage/Event alike;
  External Action Detail audit-event gating for READ_AUDIT).
- PG parity `tests/database/frontend-activity-postgres-parity.test.ts` — 16 tests (with DB,
  includes `findByIdentity`, `commitProjectProjection` parity, registry-shrink watermark parity,
  the Ask sensitivity/access revalidation and the Sources sensitivity/access/policy
  revalidation parity).

WP1 + WP2 + WP3 focused suites: **166 tests PASS — contract 39, unit 16, integration 95,
PostgreSQL parity 16 (with DB)**. `tsc --noEmit`, ESLint and Prettier clean. Governance gates
(`docs:validate`, `docs:frontend-work-items`, `docs:completion-invariants`,
`docs:frontend-projections:check`) PASS.

> **Test-count correction (review round 1, §6.1 item 8):** the round-1 evidence stated
> "101 tests PASS (contract 39, unit 16, integration 46, parity 11)". That total was
> miscounted: the parity 11 was listed as a separate category but the 101 total already excluded
> it. The correct category sum was 39 + 16 + 46 + 11 = **112**. This revision reports the exact
> per-file counts and keeps the parity suite as a separate with-DB category, matching the
> WP1/WP2 convention. Round 3 reported 155 (contract 39, unit 16, integration 85, parity 15);
> round 4 adds 10 integration regression tests and 1 parity test → **166** (contract 39, unit 16,
> integration 95, parity 16).

Automatic CI on the round-4 correction head `b90b97a59fde01ef92a0932e6dd9f3c4e2ae4fa1`
(PR #73, draft for auto CI only) — **CI #625 / `31114640938` SUCCESS**. Earlier rounds:
round-1 head `9159f20ee` CI #615; round-2 implementation `66a2ca13a` CI #618 (intermediate
`8390e3c67` CI #617 was only the evidence-doc Prettier gate); round-2 correction `419db19ad`
CI #620; evidence heads `f4afc32a3` CI #621 and `b3ee7b3c4` CI #622; round-3 correction
`62071a3b3` CI #623 and evidence-metadata head `31df6b9f7` CI #624. No manual or duplicate CI
was dispatched and no previously-passed head was re-run.

## 6.1 Review corrections — CHANGES_REQUIRED round 1 (2026-08-06)

GPT review of the round-1 WP3 head (`9159f20ee`, CI #615) returned `CHANGES_REQUIRED` with 8
items. Each was resolved in this revision without re-running the previously-passed heads:

1. **Concrete Sources/Ask/External Action adapters + runtime assembly + HTTP routes** — added the
   three real adapters (`adapters/frontend-activity-{sources,ask,external-action}`), the
   owning-Domain read ports (`activity-domain-read-ports.ts` + PostgreSQL implementations over
   `source_product` / `frontend_ask`), the assembly in `server.ts` (registry + store + builder +
   coordinator) and the HTTP routes in `frontend-activity-routes.ts`. Tests now exercise the real
   adapters (no mock-injected projection).
2. **Multi-page projection** — the builder now iterates `nextCursor` until exhausted with cursor
   cycle detection and per-adapter buffering; 101+ item and multi-page regression tests added.
3. **Failed-adapter UNAVAILABLE watermark** — every registry adapter gets a current-revision
   watermark; failed adapters are recorded `UNAVAILABLE` with no fabricated observation fields;
   combined status derives from `page.metadata.adapterStatus`; previous-success→failure regression
   test added.
4. **Atomic revision/commit** — `commitProjectProjection` publishes index + all watermarks in one
   Project transaction/CAS boundary (Postgres transaction under the project advisory lock;
   in-memory all-or-nothing swap); concurrent same-revision commit and mid-commit rollback
   regression tests added.
5. **Queue→Detail completeness** — `findByIdentity` direct store lookup by
   (project, domain, activityId) with concrete-reference revalidation; 51+ queue→detail and
   same-activityId-two-Domains collision tests added.
6. **Stage/Event caps** — `readStages`/`readEvents` accept a capped `limit`; the coordinator
   passes the cap down and re-enforces it on the response; over-cap regression test added.
7. **Runtime request validation** — strict decoders for all four request types (schemaVersion,
   non-empty identity, allow-listed enums, authority-field rejection) + deny-by-default scope
   validation; validation regression tests added.
8. **Evidence test count** — corrected (see §5 note).

## 6.2 Review corrections — CHANGES_REQUIRED round 2 (2026-08-06)

GPT review of the round-2 implementation head (`66a2ca13a`, CI #618) returned `CHANGES_REQUIRED`
with 7 items. Each was resolved on the round-2 correction head `419db19ad` (CI #620) without
re-running any previously-passed head:

1. **Sources/Ask concrete queue pagination skipped one row per page** — the adapters requested
   `limit + 1` from the read port and used the read port's lookahead-row cursor, so the next page
   started after row 101 and row 101 was skipped. The cursor is now derived from the LAST DISPLAYED
   row; concrete 101+ pagination tests verify the identity set (no skip, no duplicate) for both
   Sources and Ask.
2. **Empty-projection atomic CAS** — `commitProjectProjection` guarded only on `activity_index`
   rows, so an empty index (all adapters failed) could double-commit the same revision. The CAS
   now guards on the max revision of BOTH the index and the watermarks; an empty-index
   same-revision race regression test was added (in-memory + PostgreSQL parity).
3. **Stage/Event continuation did not page** — concrete adapters ignored the cursor. Typed
   cursors now drive real pagination: Sources stages/events (offset), Ask events (ordinal),
   External Action stages (offset); the coordinator slices responses to the resolved requested
   limit; first→second page no-overlap regression tests added.
4. **Ask fabricated a Domain Attempt id** — the production read returned only `attempt_number` and
   the adapter synthesized `attempt-${answerRunId}`. `PostgresAskActivityRead` now joins
   `answer_run_attempts` for the authoritative `attempt_id`; the adapter never fabricates an id
   (no attempt → empty attempts) and regression tests cover both cases.
5. **Sensitivity/access revalidation** — `sensitivityClearance` is now server-derived into the
   Activity scope and the owning-Domain read ports; `PostgresSourcesActivityRead` passes the real
   access scopes/sensitivity/revisions into the Sources product service (no synthetic binding) and
   `PostgresAskActivityRead` revalidates sensitivity clearance plus access/policy revisions with a
   DB-backed NOT_FOUND regression test.
6. **Multi-page watermark aggregation** — the builder now aggregates the NEWEST `sourceUpdatedAt`,
   the WORST `lagMilliseconds` and the worst adapter status across every page (the last page is the
   oldest slice of a DESC queue); `partial` is true whenever any adapter failed OR the aggregate
   status is not fully AVAILABLE. Per-page differing source time/lag/status regression test added.
7. **Evidence/PR current authority** — separated heads recorded: round-1 head `9159f20ee`
   (CI #615), round-2 implementation head `66a2ca13a` (CI #618), round-2 correction head
   `419db19ad` (CI #620) and the current evidence head (see frontmatter).

## 6.3 Review corrections — CHANGES_REQUIRED round 3 (2026-08-06)

GPT review of the round-2 correction head (`419db19ad`, CI #620) returned `CHANGES_REQUIRED`
with 5 items. Each was resolved on the round-3 correction head `62071a3b3` (CI #623) without
re-running any previously-passed head:

1. **Project/audience isolation** — the Sources projection is now Project-shared (the adapter
   stops filtering by Principal at projection time), so one user's refresh never erases another
   user's rows. Each queue row is revalidated at response time through the owning adapter's
   non-disclosing `canAccess` (principal ownership, sensitivity, access/policy revisions), so
   per-Principal resources are never disclosed. A/B isolation regression tests added (A refresh →
   B queue hides A-private rows; B refresh does not delete A's shared rows).
2. **Deep-link Domain authorization** — `sensitivityClearance` is now a required, allow-listed
   scope value (missing/empty/unknown → `PROJECT_ACCESS_DENIED`). The External Action adapter
   revalidates access/policy revision, `READ_EXTERNAL_ACTION` (`action:read`) and `READ_AUDIT`
   (`action:audit:read`) capabilities and access masking — all denials are the same non-disclosing
   `NOT_FOUND`. Regression tests for capability gates and stale revisions added.
3. **Sources Event continuation completeness** — a flattened per-submission
   `listSubmissionAttempts` read with an offset cursor replaces the per-item/total cap; the
   adapter pages `limit + 1` and never drops 101+ attempts. 150- and 250-attempt regression tests
   added.
4. **Watermark store parity** — the PostgreSQL `commitProjectProjection` now deletes all Project
   watermarks in the same transaction (removed/renamed adapters do not survive), matching the
   in-memory store. Registry-shrink parity test (3 adapters → 2 adapters) added.
5. **In-memory tie ordering** — Sources/Ask in-memory queue ordering is now `updatedAt DESC` then
   id `ASC`, matching PostgreSQL and the keyset cursor predicate; equal-timestamp reverse-insert
   pagination regression test added.

## 6.4 Review corrections — CHANGES_REQUIRED round 4 (2026-08-06)

GPT review of the round-3 correction head (`62071a3b3`, CI #623) and evidence-metadata head
(`31df6b9f7`, CI #624) returned `CHANGES_REQUIRED` with 3 WP3 Product boundary findings and 1
Evidence-terminology correction. Each was resolved on the round-4 correction head
`b90b97a5` (CI #625) without re-running any previously-passed head:

1. **Audience-safe Queue pagination** — the coordinator previously read `limit` raw index rows
   and returned the raw page cursor even when `canAccess` had filtered the page empty, leaking
   the existence/count of inaccessible rows and blocking accessible rows that sat behind them.
   The coordinator now fills the page with accessible rows in raw index order (iterating raw
   pages as needed) and returns a continuation cursor only when a further accessible row is
   confirmed behind the last displayed row (keyset resume from the last displayed record). An
   empty page never carries a cursor; a cursor is present only on a full page. Regression tests:
   only-inaccessible rows (empty page, no cursor), 50 leading inaccessible rows + 1 accessible
   (surfaces the accessible row, no leak), and interleaved multi-page data (all accessible rows
   returned exactly once in order, pages full whenever a cursor is present).
2. **Sources authoritative access revalidation** — `SourcesActivityReadPort.getSubmission`
   (PostgreSQL and in-memory) now enforces the full owning-Domain access decision and returns
   `undefined` (non-disclosing `NOT_FOUND` on Queue/Detail/Stage/Event alike) when: the
   submission is not found or not Principal-owned (existing), its recorded access/policy
   revisions no longer match the current binding (stale), or the scope's sensitivity clearance
   does not dominate the materialized content (most restrictive stage2 item sensitivity;
   `public` when nothing is materialized). The Sources product read keeps its own
   stale-marking semantics; the Activity surface never returns a stale row as CURRENT.
   Regression tests: same Principal + low clearance, stale access revision, stale policy
   revision; PostgreSQL = in-memory parity scenarios (DB test).
3. **External Action Detail audit gating** — `readDetail()` required only
   `READ_EXTERNAL_ACTION` and then included `audit.listByAction` results in `events`, letting a
   scope without `action:audit:read` bypass the `READ_AUDIT` gate that the separate Event
   continuation enforces. The Detail now checks `READ_AUDIT` and omits the audit events
   (`events: []`) when it is not granted — the same non-disclosing gate everywhere. Regression
   tests: `action:read` only → `detail.events` empty and `readEvents` denied; adding
   `action:audit:read` → events returned.
4. **Evidence authority terminology (CORRECTION_REQUIRED)** — the exact-head fields conflated
   the implementation head with the PR head. The fields are now distinguished: the frontmatter
   records `implementation_exact_head` / `implementation_ci_number` / `implementation_ci_run`
   (the round-4 implementation head `b90b97a5`, CI #625), `evidence_metadata_base_head` /
   `evidence_metadata_base_ci_number` / `evidence_metadata_base_ci_run` (the head at which the
   previous evidence metadata was recorded, `31df6b9f7`, CI #624) and `current_pr_head` /
   `current_pr_ci_number` / `current_pr_ci_run` (the PR-confirmed head at authoring time,
   `b90b97a5`, CI #625). The Evidence Registry uses the matching `implementationExactHead`,
   `evidenceMetadataBaseHead` and `currentPRHead` fields, and §8 below no longer references a
   stale "round-2" wording.

## 7. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP4 Activity Workspace UI.
- WP5 Domain action delegation (Retry/Cancel via owning Domain routes).
- Optional Connector Diagnostics adapter.
- Additional migrations, SSE, new runtime dependency, generic retry/cancel, FE-P5-S2,
  Ready/Merge, deployment and production verification.

## 8. Next action

Report the round-4 WP3 implementation, verification and evidence. Do not begin WP4 until this
Work Package is reviewed and accepted for progression.
