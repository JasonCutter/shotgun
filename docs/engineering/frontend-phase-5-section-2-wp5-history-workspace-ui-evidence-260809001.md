---
id: FRONTEND-PHASE-5-SECTION-2-WP5-EVIDENCE-260809001
classification: CANONICAL
status: wp5_round3_fixes_pending_review
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp4_accepted_head: 001f56b43
wp5_implementation_head: 1c363a0
wp5_implementation_ci_number: 712
wp5_implementation_ci_run_id: 31302130483
wp5_implementation_ci_conclusion: SUCCESS
wp5_round1_fix_head: a427d1538
wp5_round1_fix_ci_number: 719
wp5_round1_fix_ci_run_id: 31304991337
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

| File                                                                | Content                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/frontend-section3.ts`                       | `TargetRouteView` routeId/href `history` added (route registry + decoder)                                                                                                                                                                 |
| `packages/shotgun-api-client/src/frontend-history-client.ts`        | `FrontendHistoryClient` + `createFrontendHistoryClient` (listHistoryWorkspace / getHistoryEntry, strict decode, CSRF read)                                                                                                                |
| `packages/shotgun-api-client/src/index.ts` + `contracts.ts`         | History client + view/request type re-exports                                                                                                                                                                                             |
| `adapters/frontend-product-read-in-memory/src/index.ts`             | `/history` route guard + History navigation item (projectReady → AVAILABLE)                                                                                                                                                               |
| `apps/shotgun-web/src/app/query-keys.ts`                            | `HistoryQueryScope` + `historyScopeFromShell` + `historyListQueryKey`/`historyEntryQueryKey`                                                                                                                                              |
| `apps/shotgun-web/src/history/history-queries.ts`                   | `historyListQueryOptions` / `historyEntryQueryOptions` (React Query, retry from ADR-118 descriptors)                                                                                                                                      |
| `apps/shotgun-web/src/history/history-workspace-state.ts`           | workspace reducer (domain filters, selection, keyset cursor; availability filter removed — Round 1 A)                                                                                                                                     |
| `apps/shotgun-web/src/history/history-route-contract.ts`            | `/history?entry=` deep link + owning-Domain hrefs (external action / review / reversal)                                                                                                                                                   |
| `apps/shotgun-web/src/routes/history-workspace.tsx`                 | `HistoryWorkspace` (`/history` guarded route); Reversal initiation button (Round 1 B); deleted-project audit target preserved on selection/clear deep link (Round 3 Blocker 3)                                                            |
| `apps/shotgun-web/src/app/router.tsx`                               | `/history` route → `HistoryWorkspace` (guarded)                                                                                                                                                                                           |
| `apps/shotgun-web/src/styles/application.css`                       | History Workspace styles                                                                                                                                                                                                                  |
| `packages/shotgun-api-client/src/frontend-review-client.ts`         | `createReversalDraftChangeSet` on `FrontendReviewClient` (Round 1 B)                                                                                                                                                                      |
| `assemblies/shotgun-app/src/product-api/frontend-review-routes.ts`  | `POST /product-api/frontend/review/reversal-draft` (Round 1 B) + Reversal → SUBMITTED Knowledge DraftChangeSet materialize + persist in the approved frontend-knowledge-draft store (Round 3 Blocker 2; migration 025 — NO new migration) |
| `assemblies/shotgun-app/src/product-api/frontend-history-routes.ts` | deleted-project audit scope gate on History read routes (Round 1 C)                                                                                                                                                                       |
| `assemblies/shotgun-app/src/server.ts` + `main.ts`                  | `projectTombstoneStore` + `reversalEligibilityPort` wiring + review route options (Round 1 B/C, Round 3 Blocker 2)                                                                                                                        |
| `modules/frontend-history/src/product-api.ts`                       | `HistoryProductScopeV1.deletedProjectAudit` + deleted-project binding (Round 1 C)                                                                                                                                                         |
| `apps/shotgun-web/src/routes/history-workspace.test.tsx`            | 10 tests (list/filters, detail + payload, audit lineage, reversal entry points, reversal initiation w/ authoritative revisionId, purged, pagination, cursor reset, deleted-audit deep link + preserved on select/clear)                   |
| `tests/integration/frontend-history-deleted-project-audit.test.ts`  | 4 deleted-project audit integration tests (Round 1 C)                                                                                                                                                                                     |
| `adapters/frontend-history-canonical/src/index.ts`                  | authoritative `revisionId` resolve in the Canonical History payload (Round 2 B1)                                                                                                                                                          |
| `tests/integration/frontend-reversal-review-queue.test.ts`          | 2 integration tests (create → queue → Context → Record APPROVE → Approval issued; numeric afterVersion rejected fail-closed) (Round 2 B1 / Round 3 Blocker 2)                                                                             |

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
- **Reversal entry point (Round 1 B / Round 2 B1)**: a selected CANONICAL entry
  shows a `Reversal draft 생성` button; clicking it calls
  `POST /product-api/frontend/review/reversal-draft` with the authoritative
  `sourceRevisionId`. The revision identity is resolved SERVER-SIDE by the
  Canonical History adapter (`HistoryEvent → commitId →
CanonicalCommitResult.revisionId`) and carried as
  `payloadSnapshot.revisionId`; the browser NEVER infers a revision identity
  from the numeric `beforeVersion`/`afterVersion` (Round 2 B1 — a numeric
  afterVersion used as the identity fails closed with `REVERSAL_SOURCE_NOT_FOUND`).
  The server derives the current capability (`project:action:rollback`) + the
  principal, persists the CANDIDATE Reversal to the owning change-set-review
  store (`review.reversals`, migration 033, Round 2 B), and the EXISTING
  `KNOWLEDGE_DRAFT_CHANGE_SET` Review queue surfaces it via
  `ReversalReviewTargetAdapter` → current Review Context → current Review →
  current Approval path (Round 2 B). On success the workspace navigates to the
  current Review Workspace (`/review`, WP3). REVIEW rows show a `Review
workspace` link only — History owns no command endpoint.
- **Compensation link/action**: EXTERNAL_ACTION rows link to the owning-Domain
  External Action workspace (Compensation lives there, WP4/AC-09).
- **Deleted-project audit handling (Round 1 C + Round 2 C)**: a History read for
  a deleted project is permitted only when the request targets a project with an
  active tombstone AND the principal holds a granted, non-revoked audit scope
  bound to that project AND currently holds `project:deleted-audit:read` in the
  active project's membership scopes. Every denial is the same non-disclosing
  `PROJECT_ACCESS_DENIED` (no existence leak). Round 2 C adds a WORKSPACE
  ENTRY POINT: `/history?resourceProjectId=<deleted-project-id>` names the
  explicit deleted-audit target while the ACTIVE project stays the live control
  project; `historyScopeFromShell(shell, resourceProjectIdOverride)` keeps the
  query key fully bound (principal + session + active project + resource
  project + access + policy revision) for cache isolation.

## 4. Verification

- Web app full suite: **125 tests PASS** (21 files) — includes 9 History
  Workspace tests.
- History Workspace focused: **9 tests PASS** (list+filters, authoritative
  detail + payload snapshot, audit lineage link, reversal entry points
  canonical-button/review-link, reversal draft initiation → Review navigation
  with the authoritative `revisionId` (never numeric afterVersion), PURGED
  display without raw payload, cursor pagination, filter cursor reset,
  deleted-project audit deep-link target).
- Reversal → Review queue integration (NEW, Round 2 B / Round 3 Blocker 2):
  **2 tests PASS** (create with authoritative `revision:2` → Review Queue →
  Get Context → **Record APPROVE Decision → Approval Resource issued
  (APPROVED_READY / ACTIVE)**; numeric afterVersion as the identity is rejected
  fail-closed, non-disclosing).
- Deleted-project audit integration (Round 1 C): **4 tests PASS** (allow with
  tombstone+scope+capability; deny without audit scope; deny without current
  capability; deny non-tombstoned cross-project).
- Related integration + unit + contracts: change-set-review reversal unit,
  review security/product-api/negative/domain, section3 product-api/bootstrap,
  knowledge-draft product-api, frontend-history contracts, frontend-review
  contracts — **145 tests PASS** (12 files) plus the above.
- `tsc --noEmit` (root + app), ESLint, Prettier clean.
- Known flaky (unrelated, pass standalone): `stage-8-format-expansion`,
  `compiled-truth`, `knowledge-model`, `health`, `canonical-projection-recovery`.
- Automatic CI on push (PR #80, Draft) — latest head recorded in the Round 3
  section below (Product Correction Head / Automatic CI).

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

## 5b. GPT WP5 Round 2 review delta (CHANGES_REQUIRED B1/B2/C — D RESOLVED)

GPT WP5 Round 2 verdict was CHANGES_REQUIRED (B1/B2/C); D was RESOLVED.
Required deltas and how each was resolved:

- **B1 — authoritative Canonical revision identity**: the UI previously sent
  `payloadSnapshot.afterVersion` (a NUMBER in real Canonical data, never a
  revision identity) as `sourceRevisionId`. → the Canonical History adapter now
  resolves the authoritative identity server-side (`HistoryEvent → commitId →
CanonicalCommitResult.revisionId`) and carries it as
  `payloadSnapshot.revisionId`; the UI sends ONLY that `revisionId`. A numeric
  afterVersion used as the identity fails closed (`REVERSAL_SOURCE_NOT_FOUND`,
  non-disclosing). Focused regression uses the REAL shape (`afterVersion: 2` +
  `revisionId: 'revision:...'`).
- **B2 — Reversal → current Review Context / queue**: the candidate was created
  purely in-memory and the UI just navigated to `/review` with no persisted
  Review flow. → Round 3 Blocker 1/2 refined the approach to stay inside the
  approved persistence: the reversal-draft route materializes the candidate as
  a SUBMITTED Knowledge DraftChangeSet in the frontend-knowledge-draft store
  (migration 025) — the single existing `DraftReviewTargetAdapter` then
  surfaces it through the `KNOWLEDGE_DRAFT_CHANGE_SET` queue → current Review
  Context (CLAIM_REMOVE items from `computeReversalSnapshotImpact`) → current
  Review → current Approval path. No new `ReviewTargetKind`, no adapter
  collision, no new migration. Focused integration proves the full path: create
  reversal → returned `reversalId` → Review queue → Review Context → Record
  APPROVE Decision → Approval Resource issued (APPROVED_READY / ACTIVE).
- **C — deleted-project audit workspace entry point**: the server gate was
  PASS but the browser scope was hard-bound to `shell.activeProject.id`, so the
  UI could not reach the authorized deleted-project audit read. → `/history?
resourceProjectId=<deleted-project-id>` names the explicit deleted-audit
  target; `historyScopeFromShell(shell, resourceProjectIdOverride)` overrides
  the resource project while the active project stays the live control project;
  the query key stays fully bound (principal + session + active project +
  resource project + access + policy revision) for cache isolation. The server
  revalidates tombstone + audit scope + current capability (Round 1 C) for any
  non-active `resourceProjectId`; scope-revoked and capability-removed both
  resolve to the same non-disclosing denial.
- **D — RESOLVED**: PR #80 title/body already reflect the cumulative WP1~WP5
  status. Per GPT guidance, evidence/CI metadata is no longer chased with
  repeated metadata-only commits: this round records one
  `Product Correction Head` + one `Automatic CI` (below); the evidence-carrier
  commit is not separately tracked.

### Round 2 verification head

- **Product Correction Head**: 2ba8892a5
- **Automatic CI**: #721 / run 31306559284 / SUCCESS

## 5c. GPT WP5 Round 3 review delta (CHANGES_REQUIRED + ARCHITECTURE_AMENDMENT_REQUIRED_FOR_033)

GPT WP5 Round 3 verdict was CHANGES_REQUIRED; B1 was RESOLVED; migration 033
was flagged as a Frozen IR violation. Required deltas and how each was resolved:

- **Blocker 1 — Migration 033 Frozen IR violation**: IR r1's Migration Sequence
  is fixed at 030/031/032; adding 033 required an Architecture/Contract
  Amendment + explicit user approval. → **Option A (revert)**: migration
  `033_frontend_review_reversal_persistence.sql` is REMOVED and the
  change-set-review port extensions (`saveReversal`/`findReversalById`/
  `listReversals`) are REVERTED. Reversal candidates are instead persisted in
  the APPROVED frontend-knowledge-draft store (migration 025) as SUBMITTED
  Knowledge DraftChangeSets (`materializeReversalAsKnowledgeDraft` in the
  reversal-draft route). No migration boundary change — no amendment needed.
- **Blocker 2 — Reversal adapter collision / broken decision flow**: two
  adapters shared `KNOWLEDGE_DRAFT_CHANGE_SET` and the single-target adapter
  resolution picked the first, so Get Context / Record Decisions / Approval
  resolved to the Knowledge Draft adapter which could not resolve a Reversal
  (REVIEW_TARGET_CHANGED). → the separate `ReversalReviewTargetAdapter` is
  REMOVED. A Reversal is now materialized as a SUBMITTED Knowledge
  DraftChangeSet in the same approved store the single existing
  `DraftReviewTargetAdapter` reads, so the SAME adapter resolves it
  deterministically for Queue / Get Context / Record Decisions / Approval.
  Focused flow now proves the full path: Create Reversal → Review Queue → Get
  Context → **Record APPROVE Decision → Approval Resource issued
  (APPROVED_READY / ACTIVE)**.
- **Blocker 3 — Deleted-project audit target lost on selection/clear**:
  `selectEntry()` rebuilt the URL from scratch, dropping `resourceProjectId`;
  `clearSelection()` cleared everything. → both now build on the existing
  search parameters: `selectEntry` preserves `resourceProjectId` and sets
  `entry`; `clearSelection` deletes only `entry` and keeps the audit target.
  Web regression covers: deleted list → entry click → URL keeps
  `resourceProjectId` + detail request targets the deleted project → clear
  keeps the audit target.
- **D — RESOLVED (carried)**: PR #80 title/body already reflect the cumulative
  WP1~WP5 status; evidence/CI metadata is recorded once per round.

### Round 3 verification head

- **Product Correction Head**: (recorded after the correction commit)
- **Automatic CI**: (recorded after the correction commit's CI run)

## 6. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP6 Integrated Verification + Security + Performance (including the final
  Reversal → Canonical Commit execution, WP6 full-flow verification).
- Central authoritative History ledger: FORBIDDEN (projection is NON-AUTHORITATIVE).
- Reversal candidate is persisted as a SUBMITTED Knowledge DraftChangeSet in the
  approved frontend-knowledge-draft store (migration 025) and reaches the
  current Review flow (Queue → Context → Decision → Approval); no new
  ReviewTargetKind, no new migration.
- PR #80 Ready/Merge: user approval required, remains DRAFT.

## 7. Next action

Report WP5 Round 3 fixes for the GPT Review Round 4. Do not begin WP6 until WP5 is
reviewed and accepted.
