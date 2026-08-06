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

| File                                                                         | Content                                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `modules/frontend-activity/src/activity-projection-builder.ts`               | Federated projection builder: multi-page observation, per-adapter atomicity, UNAVAILABLE watermarks, atomic commit |
| `modules/frontend-activity/src/product-api.ts`                               | Activity Product coordinator + strict request decoders: Queue/Detail/Stage/Event/refresh, capabilities, non-disclosure, caps |
| `modules/frontend-activity/src/activity-index-store-port.ts`                 | `findByIdentity` direct lookup (Queue→Detail lineage)                                                |
| `modules/frontend-activity/src/activity-read-model-store-port.ts`            | `commitProjectProjection` atomic Project-scoped commit boundary                                      |
| `modules/frontend-activity/src/activity-domain-read-ports.ts`                | Sources/Ask owning-Domain read ports (SPI) + cursor codecs                                           |
| `modules/frontend-activity/src/activity-adapter-port.ts`                     | `limit` on Stage/Event continuation reads                                                            |
| `modules/frontend-activity/src/index.ts`                                     | Module exports                                                                                       |
| `adapters/frontend-activity-sources/src/index.ts`                            | `SourcesActivityAdapter` (Job = IntakeSubmission) + in-memory `SourcesActivityRead`                 |
| `adapters/frontend-activity-ask/src/index.ts`                                | `AskActivityAdapter` (Run = AnswerRun) + in-memory `AskActivityRead`                                 |
| `adapters/frontend-activity-external-action/src/index.ts`                    | `ExternalActionActivityAdapter` (Job = Action aggregate) over `ExternalActionRepositoryBoundaryPort` |
| `adapters/frontend-sources-write-postgres/src/activity-read.ts`              | PostgreSQL `SourcesActivityReadPort` over `source_product`                                           |
| `adapters/frontend-ask-execution-postgres/src/activity-read.ts`              | PostgreSQL `AskActivityReadPort` over `frontend_ask`                                                 |
| `adapters/frontend-activity-in-memory/src/index.ts`                          | `findByIdentity` + atomic `commitProjectProjection`                                                  |
| `adapters/frontend-activity-postgres/src/index.ts`                           | `findByIdentity` + transactional `commitProjectProjection`                                           |
| `assemblies/shotgun-app/src/product-api/frontend-activity-routes.ts`         | HTTP routes: `/product-api/frontend/activity/{queue,detail,stages,events,refresh}`                   |
| `assemblies/shotgun-app/src/server.ts` / `src/main.ts`                       | Registry + store + builder + coordinator assembly; PostgreSQL read ports/store injection             |

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
  `frontend-activity-domain-adapters.test.ts` (6 — concrete Sources/Ask/External Action mapping).
- PG parity `tests/database/frontend-activity-postgres-parity.test.ts` — 13 tests (with DB,
  includes `findByIdentity` and `commitProjectProjection` parity).

WP1 + WP2 + WP3 focused suites: **134 tests PASS — contract 39, unit 16, integration 66,
PostgreSQL parity 13 (with DB)**. `tsc --noEmit`, ESLint and Prettier clean. Governance gates
(`docs:validate`, `docs:frontend-work-items`, `docs:completion-invariants`,
`docs:frontend-projections:check`) PASS.

> **Test-count correction (review round 1, §6 item 8):** the round-1 evidence stated
> "101 tests PASS (contract 39, unit 16, integration 46, parity 11)". That total was
> miscounted: the parity 11 was listed as a separate category but the 101 total already excluded
> it. The correct category sum was 39 + 16 + 46 + 11 = **112**. This revision reports the exact
> per-file counts (134 total across contract 39, unit 16, integration 66, parity 13) and keeps the
> parity suite as a separate with-DB category, matching the WP1/WP2 convention.

## 6. Review corrections — CHANGES_REQUIRED round 1 (2026-08-06)

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

## 7. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP4 Activity Workspace UI.
- WP5 Domain action delegation (Retry/Cancel via owning Domain routes).
- Optional Connector Diagnostics adapter.
- Additional migrations, SSE, new runtime dependency, generic retry/cancel, FE-P5-S2,
  Ready/Merge, deployment and production verification.

## 8. Next action

Report the round-2 WP3 implementation, verification and evidence. Do not begin WP4 until this
Work Package is reviewed and accepted for progression.
