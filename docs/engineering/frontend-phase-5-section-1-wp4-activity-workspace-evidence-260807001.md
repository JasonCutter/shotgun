---
id: FRONTEND-PHASE-5-SECTION-1-WP4-EVIDENCE-260807001
classification: CANONICAL
status: wp4_implemented_pending_review
work_item: FE-P5-S1
created_at: 2026-08-07
subject_head: ab0c8749f6db475b16df674250c3b66dc3c63cdb
wp3_accepted_head: b90b97a59fde01ef92a0932e6dd9f3c4e2ae4fa1
wp3_accepted_ci_number: 625
wp4_implementation_head: df65791fa0fd78808bf850e769ef40eab43ac7db
wp4_implementation_ci_number: 631
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/73
governing_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
implementation_request: docs/implementation/frontend-phase-5-section-1-implementation-request-260806001.md
---

# FE-P5-S1 — WP4 Activity Workspace Evidence

## 1. Scope

WP4 — Activity Workspace (Implementation Request r1 §4 WP4) on
`codex/frontend-phase-5-section-1-product-implementation`, after WP3 was ACCEPTED by GPT
review (implementation head `b90b97a5`, CI #625; final evidence carrier `ca6a72612`, CI #627).

WP4 covered:

- `/activity` Queue with server-derived filters (domain kind, lifecycle state, Attention) and
  projection metadata (Freshness, Adapter availability, Partial, Lag, Snapshot revision).
- Detail with Job-or-Run root, Run, Domain Attempts, Stages and bounded Events (list/table
  accessibility representations).
- Exact Domain Resource deep links (AC-04 identity separation, AC-12 server-side revalidation).
- Polling-based authoritative refresh (Polling = BASELINE, Contract Snapshot §11) plus an
  explicit refresh with scope-scoped cache invalidation.
- Keyboard-accessible Queue, filters and Detail (AC-15), text semantics independent of color,
  restrained live announcements.
- A read + explicit-refresh-only Activity Product API browser client with strict decoding and
  fail-closed Detail identity binding.

Not included (preserved boundaries): Retry/Cancel delegation (WP5), Connector diagnostics,
SSE, new runtime dependency, additional migrations, FE-P5-S2, Ready/Merge, deployment and
production verification.

## 2. Implemented files

| File                                                            | Content                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shotgun-api-client/src/frontend-activity-client.ts`   | Read + refresh Activity client (`listActivityQueue`, `getActivityDetail`, `listActivityStages`, `listActivityEvents`, `refreshActivityProjection`); strict decoders; CSRF read POST with single 403 retry; fail-closed Detail identity binding; re-exports view/request types |
| `packages/contracts/src/frontend-section3.ts`                   | Additive `TargetRouteView` `activity` route (`/activity`)                                                                                                                                                                                                                     |
| `apps/shotgun-web/src/activity/activity-queries.ts`             | React Query options for queue/detail/stages/events + polling intervals + refresh-phase key                                                                                                                                                                                    |
| `apps/shotgun-web/src/activity/activity-workspace-state.ts`     | Workspace UI state (filters, selection, polling preference) + text labels independent of color                                                                                                                                                                                |
| `apps/shotgun-web/src/activity/activity-route-contract.ts`      | `/activity` deep-link contract (parse/build; only server-owned identity in the URL)                                                                                                                                                                                           |
| `apps/shotgun-web/src/routes/activity-workspace.tsx`            | Queue (filters + metadata + list), Detail (root/run/attempts/stages/events + domain deep links), polling + refresh, live region                                                                                                                                               |
| `apps/shotgun-web/src/app/query-keys.ts`                        | `ActivityQueryScope` + scope-safe queue/resource/refresh keys + `activityScopePrefix` invalidation                                                                                                                                                                            |
| `apps/shotgun-web/src/app/router.tsx`                           | Guarded `/activity` route                                                                                                                                                                                                                                                     |
| `adapters/frontend-product-read-in-memory/src/index.ts`         | Activity navigation item + route-guard availability                                                                                                                                                                                                                           |
| `apps/shotgun-web/src/styles/application.css`                   | Activity workspace styles                                                                                                                                                                                                                                                     |
| `apps/shotgun-web/src/activity/activity-route-contract.test.ts` | Deep-link parse/build tests                                                                                                                                                                                                                                                   |
| `apps/shotgun-web/src/routes/activity-workspace.test.tsx`       | Workspace tests                                                                                                                                                                                                                                                               |

## 3. Design decisions

- **Browser owns only selection, filters and the polling preference** (ADR-119/ADR-130). The
  server derives Principal, Project, access, policy, capability and sensitivity authority; the
  browser never authors them.
- **Deep links carry only the server-owned Activity identity** (`/activity?domain=&activity=
&resource=&resourceId=`). Every Detail read revalidates Project Scope, Capability,
  sensitivity and Resource access server-side (AC-12); a denied deep link resolves to the same
  non-disclosing `NOT_FOUND`.
- **Polling is the baseline** (Contract Snapshot §11). The queue polls while visible and the
  selected Detail polls at a longer interval; the user can disable polling and use the explicit
  refresh button. Refresh invalidates the whole Activity scope (no ad hoc key arrays).
- **Accessibility** (AC-15): the queue is a button list with `aria-current`/`aria-pressed`
  selection, filters are labelled fieldsets, Detail uses `<dl>` summaries and `<table>` list
  representations, status is conveyed with text labels plus color, and meaningful changes
  (selection, filter, refresh) use restrained live-region announcements.
- **Identity separation** (AC-03/AC-04): Job/Run/Attempt/Stage/Event identities stay distinct;
  the projection `activityId` never replaces the concrete Domain Resource identity, and each
  Detail exposes the exact Domain Resource reference (`root.resourceHref`) plus a link to the
  owning-Domain workspace.

## 4. Tests

Web workspace tests (`apps/shotgun-web`, jsdom):

- `src/routes/activity-workspace.test.tsx` — queue renders items + projection metadata +
  filters; Detail lineage on selection (Run/Attempt/Stage/Event); deep-link restore with
  server-side Detail revalidation; explicit refresh + announcement; empty queue state; filter
  toggle issues a filtered queue request.
- `src/activity/activity-route-contract.test.ts` — deep-link parse/build, unsupported domain
  deny-by-default, no authority in the URL.

**107 web tests PASS** across 20 files (including the new 10 Activity tests). `tsc --noEmit`
(root and `@shotgun/web`), ESLint, Prettier, `vite build`, `docs:validate` and
`docs:frontend-work-items` all PASS.

## 4a. CI verification

The original WP4 pushes (`737ac11`, `ebb02f8d8`) were pushed during the GitHub Actions global
incident (githubstatus.com `qcvjkzcs7j74`) and never dispatched auto CI. After mitigation a
single re-trigger push (`f00de02`) dispatched run #629, which failed on `oss:audit`; the
dependency fix and an architecture boundary fix were applied, and the final WP4 tree
(`df65791fa0`, CI **#631**) is verified:

| Run | Head | Result | Cause / fix |
| --- | --- | --- | --- |
| #629 | `f00de02` | FAIL | `oss:audit` — new `js-yaml` high CVE-2026-59870 (GHSA-5p4m-2wfm-xmqj), unrelated to WP4 code |
| #630 | `8a04d07` | FAIL | `test:architecture` — `frontend-activity-client.ts` imported the domain module layer |
| #631 | `df65791` | **SUCCESS** | Frontend / Quality / Required Gates all green |

Fixes applied on top of `737ac11`:

- **Security**: `js-yaml` 4.3.0 → 4.3.1 (`package-lock.json` only) to close GHSA-5p4m-2wfm-xmqj;
  `npm run oss:audit` returns 0 vulnerabilities.
- **Architecture boundary**: the Activity Product API wire types (queue/detail/continuation/
  refresh requests, `ActivityQueuePageV1`, `ActivityDetailV1`, `ActivityProjectionBuildResultV1`,
  `ActivityWatermarkRecordV1`, etc.) moved from `modules/frontend-activity` into
  `packages/contracts/src/frontend-activity.ts`. The module re-exports them from Contracts
  (single source of truth) and `@shotgun/api-client` imports Contracts only — matching the
  accepted Review (`frontend-review-client`) and External Action (`frontend-external-action-client`)
  patterns. `scripts/architecture-test.ts` passes.

Local verification before push: `test:architecture`, root `typecheck`, web tests 107 PASS,
Activity integration/unit tests 111 PASS, ESLint, Prettier, `oss:audit`, `docs:knowledge-flow:check`,
`docs:validate`, `docs:frontend-work-items`, `docs:completion-invariants` and
`docs:frontend-projections:check` all PASS.

## 5. Boundaries preserved

- WP5 (Retry/Cancel via owning-Domain routes) — NOT_STARTED.
- Connector diagnostics, SSE, new runtime dependency, additional migrations — NOT included.
- FE-P5-S2 History/Audit/Rollback — NOT included.
- Ready/Merge of PR #73, deployment, production verification — NOT authorized.

## 6. Next action

Report WP4 implementation, verification and evidence to the GPT review gate. Do not begin WP5
until this Work Package is reviewed and accepted for progression.
