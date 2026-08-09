---
id: FRONTEND-PHASE-5-SECTION-2-WP5-EVIDENCE-260809001
classification: CANONICAL
status: wp5_round1_fixes_pending_review
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp4_accepted_head: 001f56b43
wp5_implementation_head: 1c363a0
wp5_implementation_ci_number: 712
wp5_implementation_ci_run_id: 31302130483
wp5_implementation_ci_conclusion: SUCCESS
wp5_round1_fix_head: cbd17fa43
wp5_round1_fix_ci_number: 715
wp5_round1_fix_ci_run_id: 31304262885
wp5_round1_fix_ci_conclusion: SUCCESS
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/80
governing_adr: ADR-131
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-2/frontend-phase-5-section-2-contract-snapshot-260808001.md
implementation_request: docs/implementation/frontend-phase-5-section-2-implementation-request-260808001.md
---

# FE-P5-S2 — WP5 History Workspace UI Evidence

## 1. Scope

WP5 — History Workspace UI (Implementation Request r1 §5 WP5) implemented on
`feat/fe-p5-s2-wp1-contracts-persistence` (PR #80, Draft) after WP4 was ACCEPTED
(head `001f56b43`, Round 5).

IR r1 §5 WP5 minimum scope:

```text
History list, filters, pagination, detail
payload availability display
audit lineage
Reversal entry point
Compensation link/action
deleted-project audit handling
```

## 2. Implemented files

| File                                                                | Content                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/frontend-section3.ts`                       | `TargetRouteView` routeId/href `history` added (route registry + decoder)                                                             |
| `packages/shotgun-api-client/src/frontend-history-client.ts`        | `FrontendHistoryClient` + `createFrontendHistoryClient` (listHistoryWorkspace / getHistoryEntry, strict decode, CSRF read)            |
| `packages/shotgun-api-client/src/index.ts` + `contracts.ts`         | History client + view/request type re-exports                                                                                         |
| `adapters/frontend-product-read-in-memory/src/index.ts`             | `/history` route guard + History navigation item (projectReady → AVAILABLE)                                                           |
| `apps/shotgun-web/src/app/query-keys.ts`                            | `HistoryQueryScope` + `historyScopeFromShell` + `historyListQueryKey`/`historyEntryQueryKey`                                          |
| `apps/shotgun-web/src/history/history-queries.ts`                   | `historyListQueryOptions` / `historyEntryQueryOptions` (React Query, retry from ADR-118 descriptors)                                  |
| `apps/shotgun-web/src/history/history-workspace-state.ts`           | workspace reducer (domain filters, selection, keyset cursor; availability filter removed — Round 1 A)                                 |
| `apps/shotgun-web/src/history/history-route-contract.ts`            | `/history?entry=` deep link + owning-Domain hrefs (external action / review / reversal)                                               |
| `apps/shotgun-web/src/routes/history-workspace.tsx`                 | `HistoryWorkspace` (`/history` guarded route); Reversal initiation button (Round 1 B)                                                 |
| `apps/shotgun-web/src/app/router.tsx`                               | `/history` route → `HistoryWorkspace` (guarded)                                                                                       |
| `apps/shotgun-web/src/styles/application.css`                       | History Workspace styles                                                                                                              |
| `packages/shotgun-api-client/src/frontend-review-client.ts`         | `createReversalDraftChangeSet` on `FrontendReviewClient` (Round 1 B)                                                                  |
| `assemblies/shotgun-app/src/product-api/frontend-review-routes.ts`  | `POST /product-api/frontend/review/reversal-draft` (Round 1 B)                                                                        |
| `assemblies/shotgun-app/src/product-api/frontend-history-routes.ts` | deleted-project audit scope gate on History read routes (Round 1 C)                                                                   |
| `assemblies/shotgun-app/src/server.ts` + `main.ts`                  | `projectTombstoneStore` + `reversalEligibilityPort` wiring (Round 1 B/C)                                                              |
| `modules/frontend-history/src/product-api.ts`                       | `HistoryProductScopeV1.deletedProjectAudit` + deleted-project binding (Round 1 C)                                                     |
| `apps/shotgun-web/src/routes/history-workspace.test.tsx`            | 8 tests (list/filters, detail + payload, audit lineage, reversal entry points, reversal initiation, purged, pagination, cursor reset) |
| `tests/integration/frontend-history-deleted-project-audit.test.ts`  | 4 deleted-project audit integration tests (Round 1 C)                                                                                 |

## 3. Workspace behavior

- **List**: unified federated entries with Domain checkboxes (`CANONICAL` /
  `REVIEW` / `EXTERNAL_ACTION` / `POLICY`). The frozen list request carries no
  availability filter (Round 1 A — availability is display-only; the select
  control was removed).
- **Pagination**: frozen-tuple keyset cursor (`nextCursor` → next page; `처음`
  resets to the first page). Changing a Domain filter resets the cursor to the
  first page (Round 1 A). The server derives the project binding and audit
  capability gate (AC-13).
- **Detail**: `getHistoryEntry` re-resolves the authoritative source (WP4 C);
  payload availability is displayed as a badge; permitted bounded payload is
  shown only when AVAILABLE (tombstone metadata only on PURGED_BY_POLICY).
- **Audit lineage**: EXTERNAL_ACTION rows link to the owning-Domain External
  Action workspace (`/external-action?actionId=...`).
- **Reversal entry point (Round 1 B)**: a selected CANONICAL entry shows a
  `Reversal draft 생성` button; clicking it calls
  `POST /product-api/frontend/review/reversal-draft` with the authoritative
  `sourceRevisionId` (the entry's `payloadSnapshot.afterVersion`) and, on
  success, navigates to the current Review Workspace (`/review`, WP3). REVIEW
  rows show a `Review workspace` link only — History owns no command endpoint.
  The reversal draft is created by the server through `createReversalDraftChangeSet`
  (`reversalEligibilityPort`); the browser never authors revision/principal/
  timestamp.
- **Compensation link/action**: EXTERNAL_ACTION rows link to the owning-Domain
  External Action workspace (Compensation lives there, WP4/AC-09).
- **Deleted-project audit handling (Round 1 C)**: a History read for a deleted
  project is permitted only when the request targets a project with an active
  tombstone AND the principal holds a granted, non-revoked audit scope bound to
  that project AND currently holds `project:deleted-audit:read` in the active
  project's membership scopes. Every denial is the same non-disclosing
  `PROJECT_ACCESS_DENIED` (no existence leak).

## 4. Verification

- Web app full suite: **124 tests PASS** (21 files) — includes 8 History
  Workspace tests.
- History Workspace focused: **8 tests PASS** (list+filters, authoritative
  detail + payload snapshot, audit lineage link, reversal entry points
  canonical-button/review-link, reversal draft initiation → Review navigation,
  PURGED display without raw payload, cursor pagination, filter cursor reset).
- Deleted-project audit integration (NEW, Round 1 C): **4 tests PASS**
  (allow with tombstone+scope+capability; deny without audit scope; deny
  without current capability; deny non-tombstoned cross-project).
- Related integration: section3 product-api/bootstrap + review product-api/
  security/negative/domain — **59 tests PASS** (6 files).
- `tsc --noEmit` (root + app), ESLint, Prettier clean.
- Known flaky (unrelated, pass standalone): `stage-8-format-expansion`,
  `compiled-truth`, `knowledge-model`, `health`, `canonical-projection-recovery`.
- Automatic CI on push (PR #80, Draft) — latest head recorded in frontmatter.

## 5. GPT WP5 Round 1 review delta (CHANGES_REQUIRED A/B/C/D)

GPT WP5 Round 1 verdict was CHANGES_REQUIRED; required deltas and how each was
resolved:

- **A — Filter/cursor**: remove the availability filter from the frozen list
  request (display-only); changing a Domain filter must reset the keyset cursor
  to the first page. → `history-workspace-state.ts` removed `availability`
  state + `HISTORY_AVAILABILITY_FILTER_OPTIONS`; `TOGGLE_DOMAIN_KIND` resets
  `pageCursor`; the select UI was removed from `history-workspace.tsx`.
- **B — Reversal**: selected Canonical entry → exact historical revision →
  Reversal initiation → candidate created → passed to Review. →
  `reversalEligibilityPort.createReversalDraftChangeSet` (change-set-review
  factory), `POST /product-api/frontend/review/reversal-draft` (server-side
  authority; identity check on `sourceRevisionId`), `createReversalDraftChangeSet`
  on `FrontendReviewClient`, and a `Reversal draft 생성` button (CANONICAL only)
  that navigates to `/review` on success.
- **C — Deleted Project Audit**: History reads for deleted projects are gated
  by tombstone + granted non-revoked audit scope + current
  `project:deleted-audit:read` capability; non-disclosing denial.
- **D — Governance**: PR #80 title/body updated to the cumulative WP1~WP5
  status (see PR body), no separate commit/CI for the PR body.

## 6. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP6 Integrated Verification + Security + Performance.
- Central authoritative History ledger: FORBIDDEN (projection is NON-AUTHORITATIVE).
- Reversal draft persistence: the reversal port currently creates candidate
  drafts in-memory (candidate → current Review flow); persistence remains in
  the owning-Domain (WP3) scope.
- PR #80 Ready/Merge: user approval required, remains DRAFT.

## 7. Next action

Report WP5 Round 1 fixes for the GPT Review Round 2. Do not begin WP6 until WP5 is
reviewed and accepted.
