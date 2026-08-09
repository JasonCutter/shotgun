---
id: FRONTEND-PHASE-5-SECTION-2-WP5-EVIDENCE-260809001
classification: CANONICAL
status: wp5_implemented_pending_review
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp4_accepted_head: 001f56b43
wp5_implementation_head: 1c363a0
wp5_implementation_ci_number: 712
wp5_implementation_ci_run_id: 31302130483
wp5_implementation_ci_conclusion: SUCCESS
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

| File                                                         | Content                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/frontend-section3.ts`                | `TargetRouteView` routeId/href `history` added (route registry + decoder)                                                  |
| `packages/shotgun-api-client/src/frontend-history-client.ts` | `FrontendHistoryClient` + `createFrontendHistoryClient` (listHistoryWorkspace / getHistoryEntry, strict decode, CSRF read) |
| `packages/shotgun-api-client/src/index.ts` + `contracts.ts`  | History client + view/request type re-exports                                                                              |
| `adapters/frontend-product-read-in-memory/src/index.ts`      | `/history` route guard + History navigation item (projectReady → AVAILABLE)                                                |
| `apps/shotgun-web/src/app/query-keys.ts`                     | `HistoryQueryScope` + `historyScopeFromShell` + `historyListQueryKey`/`historyEntryQueryKey`                               |
| `apps/shotgun-web/src/history/history-queries.ts`            | `historyListQueryOptions` / `historyEntryQueryOptions` (React Query, retry from ADR-118 descriptors)                       |
| `apps/shotgun-web/src/history/history-workspace-state.ts`    | workspace reducer (domain filters, availability filter, selection, keyset cursor)                                          |
| `apps/shotgun-web/src/history/history-route-contract.ts`     | `/history?entry=` deep link + owning-Domain hrefs (external action / review)                                               |
| `apps/shotgun-web/src/routes/history-workspace.tsx`          | `HistoryWorkspace` (`/history` guarded route)                                                                              |
| `apps/shotgun-web/src/app/router.tsx`                        | `/history` route → `HistoryWorkspace` (guarded)                                                                            |
| `apps/shotgun-web/src/styles/application.css`                | History Workspace styles                                                                                                   |
| `apps/shotgun-web/src/routes/history-workspace.test.tsx`     | 6 tests (list/filters, authoritative detail + payload, audit lineage, reversal link, purged display, pagination)           |

## 3. Workspace behavior

- **List**: unified federated entries with Domain checkboxes (`CANONICAL` /
  `REVIEW` / `EXTERNAL_ACTION` / `POLICY`) and a payload-availability filter
  (`ANY`/`AVAILABLE`/`REDACTED`/`PURGED_BY_POLICY`/`UNAVAILABLE`).
- **Pagination**: frozen-tuple keyset cursor (`nextCursor` → next page; `처음`
  resets to the first page). The server derives the project binding and audit
  capability gate (AC-13).
- **Detail**: `getHistoryEntry` re-resolves the authoritative source (WP4 C);
  payload availability is displayed as a badge; permitted bounded payload is
  shown only when AVAILABLE (tombstone metadata only on PURGED_BY_POLICY).
- **Audit lineage**: EXTERNAL_ACTION rows link to the owning-Domain External
  Action workspace (`/external-action?actionId=...`).
- **Reversal entry point**: REVIEW/CANONICAL rows link to the change-set-review
  owning route (`/review`, WP3) — History owns no command endpoint.
- **Compensation link/action**: EXTERNAL_ACTION rows link to the owning-Domain
  External Action workspace (Compensation lives there, WP4/AC-09).
- **Deleted-project audit handling**: a missing / cross-project / capability-
  denied detail resolves to the same non-disclosing error presentation (no
  existence leak).

## 4. Verification

- Web app full suite: **122 tests PASS** (21 files) — includes 6 new History
  Workspace tests.
- History Workspace focused: **6 tests PASS** (list+filters, authoritative
  detail + payload snapshot, audit lineage link, Reversal link, PURGED display
  without raw payload, cursor pagination).
- `tsc --noEmit` (root + app), ESLint, Prettier clean.
- Known flaky (unrelated, pass standalone): `stage-8-format-expansion`,
  `compiled-truth`, `knowledge-model`, `health`, `canonical-projection-recovery`.
- Automatic CI on push (PR #80, Draft) — latest head recorded in frontmatter.

## 5. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP6 Integrated Verification + Security + Performance.
- Central authoritative History ledger: FORBIDDEN (projection is NON-AUTHORITATIVE).
- PR #80 Ready/Merge: user approval required, remains DRAFT.

## 6. Next action

Report WP5 implementation for the GPT Review. Do not begin WP6 until WP5 is
reviewed and accepted.
