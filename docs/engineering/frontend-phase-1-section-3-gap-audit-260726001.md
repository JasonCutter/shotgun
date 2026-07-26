# Frontend Phase 1 Section 3 Gap Audit

- Audit ID: `frontend-phase-1-section-3-gap-audit-260726001`
- Audit date: 2026-07-26
- Repository: `JasonCutter/shotgun`
- Baseline branch: `main`
- Baseline commit: `4b5c90a1bccad520c1bdfa2fc5114d8852ed59d2`
- Audit branch: `codex/frontend-phase-1-section-3`
- Scope: Home, Action Center, Global Shell, Frontend Phase 1 completion boundary
- Result: **Section 3 implementation not started; candidate acceptance criteria require user approval**

## Executive Summary

Frontend Phase 1 Sections 1 and 2 provide a sound server-authoritative
foundation, but they do not implement Section 3. The current repository has a
session boundary, a desktop shell skeleton, server-confirmed project switching,
Settings-specific resource project presentation, cache-isolation primitives,
and basic keyboard/focus support. It does not have the Section 3 server views,
Product API routes, runtime decoders, Home Action Center, global feeds, global
search, command palette, first-run readiness, full route guards, or responsive
shell.

Two current behaviors conflict with later governing decisions:

1. The Settings Leave Guard and project selector block project switching for an
   `OUTCOME_UNKNOWN` command. ADR-104 requires preserving and warning about that
   resource without blocking the switch or cancelling the command.
2. Primary navigation is a static list containing placeholder routes. Section 3
   requires server-provided feature and navigation availability and prohibits
   dead or inferred navigation.

No product code, schema, dependency, or migration was changed by this audit.
The acceptance criteria in this document are candidates, not approved
Canonical contracts.

## Canonical Sources

The audit used the following pages as the governing decision set:

- [Frontend and Human Interaction Architecture Contract](https://app.notion.com/p/3a15181d71ad81e4bfa4ee2578e692a0)
- [Frontend Phase 1 — Platform Boundary](https://app.notion.com/p/3a65181d71ad81b1836ec4503df86c46)
- [Frontend Phase 1 Section 3 — Home, Action Center, Global Shell, Phase 1 Completion](https://app.notion.com/p/3a65181d71ad813faa06e1cdd054f2cc)
- [ADR-100 — Active Project, Resource Project, Draft Project Binding](https://app.notion.com/p/3a65181d71ad8182ab8fc67e791ebd85)
- [ADR-101 — Frontend Async Command, Resource Snapshot, Outcome Unknown](https://app.notion.com/p/3a65181d71ad815c8c23e6b1cbe8d962)
- [ADR-104 — Global Shell and Server-ranked Action Center Boundary](https://app.notion.com/p/3a65181d71ad81c78fb3c5b70df73304)
- [Frontend Phase 1–5 Cross-Phase Integration Decision](https://app.notion.com/p/3a65181d71ad81e28b9cfb13f322e983)
- [Cross-phase normalization pending record](../architecture/canonical-normalization/frontend-cross-phase-normalization-pending-260726001.md)

When wording conflicted, the later explicit ADR-104 and cross-phase decisions
governed. The exact replacements applied to the Section 3 page are recorded in
[the normalization record](../architecture/canonical-normalization/frontend-phase-1-section-3-normalization-260726001.md).

## Current Repository Baseline

The baseline was fast-forwarded and audited at the exact requested commit. The
following runtime evidence was inspected:

- Shell and routing:
  `apps/shotgun-web/src/shell/application-shell.tsx`,
  `apps/shotgun-web/src/shell/primary-navigation.tsx`,
  `apps/shotgun-web/src/shell/top-bar.tsx`,
  `apps/shotgun-web/src/router.tsx`
- Home and responsive styling:
  `apps/shotgun-web/src/pages/home-page.tsx`,
  `apps/shotgun-web/src/application.css`
- Project switching and Settings Leave Guard:
  `apps/shotgun-web/src/settings/project-selector.tsx`,
  `apps/shotgun-web/src/settings/settings-draft-controller.ts`
- Session, connectivity, and caches:
  `apps/shotgun-web/src/session/`,
  `apps/shotgun-web/src/query-keys.ts`,
  `apps/shotgun-web/src/use-connectivity-state.ts`
- Shared contracts:
  `packages/contracts/src/frontend-foundation.ts`
- API client and Product API:
  `packages/shotgun-api-client/src/`,
  `assemblies/shotgun-app/src/product-api/`
- Tests:
  `apps/shotgun-web/src/**/*.test.tsx`,
  `apps/shotgun-web/e2e/`,
  `packages/contracts/test/`

The classification standard is:

- `IMPLEMENTED`: a contract-aligned runtime path, authority boundary, and
  relevant verification exist.
- `PARTIAL`: a usable foundation exists, but contract, authority, error states,
  integration, or verification is incomplete.
- `MISSING`: no usable Section 3 runtime path exists.
- `CONFLICT`: a runtime behavior contradicts a governing decision.
- `OUT_OF_SCOPE`: the capability belongs to another phase or domain workspace.

## IMPLEMENTED

The following are implemented foundations, not proof that Section 3 is
complete:

1. `ProductSessionView` and `SessionBoundaryView` are versioned, decoded at
   runtime, and fail closed.
2. Session, principal, active project, and accessible projects come from the
   server; the browser does not supply project-authority headers.
3. Project switching is server-confirmed and non-optimistic.
4. Settings drafts and blocking dialogs participate in a Leave Guard.
5. Settings resource routes display both active project and resource project
   and do not automatically mutate the active project.
6. The shell has a skip link, navigation landmark, `aria-current`, and route
   heading focus.
7. Query-key primitives include principal/project isolation and project-switch
   purging.
8. `OperationalResourceKindRegistrySnapshot` provides a versioned foundation
   for resource capabilities and sensitivity.
9. API mutations do not retry automatically; CSRF and same-origin handling are
   present.
10. Architecture tests prevent the web application and API client from
    importing server modules, adapters, database code, Kernel internals, or
    browser-supplied authority headers.

## PARTIAL

1. **Global shell skeleton**: desktop layout, a top bar, and primary navigation
   exist, but the header does not expose a global project selector, readiness,
   background, notification, or warning projections.
2. **Responsive navigation**: one narrow breakpoint changes the layout, but
   there is no tablet rail, mobile top bar, mobile bottom navigation, More
   menu, or protected overflow state.
3. **Project selector**: authority behavior is sound, but the selector is
   available only inside Settings rather than the global shell.
4. **Resource project context**: the Section 2 Settings path demonstrates the
   binding, but there is no shared shell/page-header contract for other typed
   resources.
5. **Home**: principal and active project identity are rendered, but none of the
   six Action Center regions are implemented.
6. **Route guard**: the session loader and shared capability evaluator exist,
   but generic routes do not execute the full typed guard sequence.
7. **Offline handling**: browser online/offline detection and project-switch
   blocking exist; explicit stale data, degraded states, and capability-specific
   blocks do not.
8. **Cache foundation**: project/settings keys and purge helpers exist, but
   Section 3 views, revisions, global scope digests, and invalidation events do
   not.
9. **Accessibility foundation**: basic shell focus and an accessible dialog
   helper exist, but Section 3 interaction patterns and cross-viewport tests do
   not.
10. **Search reuse foundation**: Stage 7 Canonical search can support a
    Knowledge-search adapter, but it is not a typed, cross-resource Product API
    for global shell search.
11. **Resource registry**: a contract and decoder exist, but no Section 3 server
    snapshot is consumed by the shell.

## MISSING

### Product API and projections

No implementation or runtime decoder was found for:

- `GlobalShellView`
- `HomeActionCenterView`
- `ActionCenterItem`
- `PrimaryActionView`
- `ContinueWorkingItem`
- `RecentResourceView`
- `PinnedResourceView`
- `BackgroundSummaryView`
- `NotificationSummaryView`
- `GlobalWarningView`
- `NavigationItemView`
- `FeatureAvailabilityView`
- `GlobalSearchResultView`
- `FirstRunReadinessView`
- `RouteGuardFailureView`

There are no Section 3 Product API routes, projection ports, repositories, or
API-client methods for those views.

### Product experiences

- Server-ranked Primary Actions and Attention Queue
- Continue Working with the approved inclusion/exclusion boundary
- Recent and Pinned project resources
- Operational summary
- Principal-global background and notification feeds
- Single prioritized global warning presentation
- Typed global search and explicit cross-project scope
- Navigation-only command palette
- Server-authoritative first-run/readiness experience
- Typed route failures and safe deep-link restoration
- Section 3 tablet/mobile navigation
- Snapshot refresh signalling or SSE integration
- Large-data controls, measurement budgets, and virtualization decisions
- Section 3 contract, security-negative, replacement, accessibility, and browser
  tests

## CONFLICT

### C-01: `OUTCOME_UNKNOWN` blocks project switching

- Current statement: Settings includes an `OUTCOME_UNKNOWN` command in the
  Leave Guard blocking predicate; the project selector also explicitly blocks
  when such a command exists.
- Governing later decision: a running server resource or
  `OUTCOME_UNKNOWN` command remains bound to its resource project and produces a
  warning; it is not cancelled and does not prevent active-project switching.
- Conflict reason: current client behavior upgrades uncertainty into a global
  navigation lock.
- Required replacement: separate browser-draft/blocking-dialog guards from
  persistent server-resource warnings. Preserve the command and resource
  binding, show a warning, and allow the server-confirmed switch.
- Implementation impact: update the Section 2 guard consumer contract and its
  tests before exposing the selector globally.

### C-02: static navigation exposes unavailable placeholder routes

- Current statement: primary navigation hard-codes Home, Sources, Ask,
  Knowledge, Review, Activity, History, and Settings.
- Governing later decision: the server supplies Feature Availability and
  Navigation Availability; the client must not infer sensitive capabilities or
  expose dead links.
- Conflict reason: placeholder pages are represented as normal available
  product routes.
- Required replacement: render decoded server navigation items with explicit
  `AVAILABLE`, `UNAVAILABLE`, `COMING_LATER`, or hidden behavior as approved.
- Implementation impact: Global Shell Product API and route-guard work must
  precede final navigation rendering.

## OUT_OF_SCOPE

- Detailed Sources, Ask, Knowledge, Review, Activity, and History workspaces
- Source ingestion, Ask execution, approval/rejection, Canonical writes,
  connector revoke, project deletion, or external actions from Home
- Phase 2 product implementation or verification
- Phase 3–5 detailed functionality
- Whole-frontend architecture completion

Section 3 may show server-provided summaries and navigation targets for these
areas. It must not duplicate their domain commands or claim they are complete.

## Security Findings

### Present

- Server sessions and membership authority
- CSRF and same-origin enforcement
- Legacy/browser project-authority-header rejection
- Frontend dependency-boundary checks
- No browser-storage authority in the existing browser checks
- Fail-closed session/registry runtime decoding

### Required for Section 3

1. Authorize every shell, Action Center, search, background, and notification
   projection on the server.
2. Apply capability, visibility, sensitivity, and existence masking before
   serializing results.
3. Minimize global metadata to typed references, safe labels, state, route, and
   revision; never cache source contents, answer payloads, credentials, or full
   activity logs globally.
4. Purge affected project/global metadata on membership, sensitivity, policy,
   accessible-project-set, session, or principal revision changes.
5. Validate `targetRoute` against a server/client route registry; prohibit open
   redirects and unsafe external URLs.
6. Keep search text out of browser persistence and protected telemetry by
   default.
7. Treat refresh events as hints only and re-fetch an authorized snapshot.
8. Add negative tests for cross-project access, revoked membership, sensitive
   resource masking, stale revisions, CSRF, unsafe deep links, and session
   replacement.

No active Section 3 cross-project leak was found because its global caches and
views do not yet exist. However, the current protected-cache purge lists do not
include the unused `global` query-key family; Section 3 must close that gap
before using it.

## Accessibility Findings

Implemented basics are the skip link, `nav` landmark, `aria-current`, route
heading focus, dialog focus trap/restore helper, and associated unit tests.

Missing verification includes:

- tablet rail, mobile top/bottom navigation, More menu, drawer, and popover
  semantics
- accessible project selector behavior in the shell
- command-palette dialog/combobox behavior, arrow navigation, Escape, focus
  restore, selection/result announcements, and IME composition
- live-region restraint and text equivalents for severity
- reduced motion, forced/high-contrast colors, 200% zoom, narrow mobile, and
  touch target behavior
- screen-reader-oriented and browser E2E coverage for the complete Section 3
  flow

DOM presence alone is not acceptance evidence.

## Responsive Findings

The current CSS provides a desktop shell and one breakpoint at 760px. It does
not implement the Canonical desktop/tablet/mobile model. Mobile adaptations
must keep active project, critical warnings, failed background work,
notifications, resource-project mismatches, and session/backend state
discoverable. Features may move into an accessible More/drawer/popover surface;
they must not disappear.

## Cache and Scope Findings

### Required Home project cache identity

```text
principalId
sessionId
activeProjectId
projectAccessRevision
policyContextRevision
shellViewRevision
view-specific projection revision
```

### Required global-feed cache identity

```text
principalId
sessionId
accessibleProjectSetRevision
explicitScopeDigest
policyContextRevision
view-specific projection revision
```

Project switching must invalidate the Home, search, recent, and pinned views
for the prior active project without deleting valid principal-global feeds.
Membership, capability, sensitivity, policy, or accessible-project-set changes
must reauthorize and purge affected global entries. Session/principal
replacement must purge every protected key, including the future `global`
family.

SSE is not present. If later adopted, it is only an invalidation signal; the
authorized revisioned snapshot remains authoritative. A scope/revision mismatch
requires a full snapshot refresh.

## API Contract Findings

Every Section 3 view requires:

- an explicit `schemaVersion`
- a runtime decoder that rejects unsupported versions and unknown unsafe enums
- principal/session and project or explicit global-scope binding
- access, policy, and projection revisions
- typed capability, visibility, availability, and target route
- `fetchedAt` and safe stale/error state

TypeScript identity casts are not runtime validation. The web application must
consume the API-client decoder output, not server/module types or domain
repositories.

## Repository and Port Ownership Findings

The existing ownership boundaries should remain:

- `AuthRepository`: principal, session, membership
- `ProjectAdministrationRepository`: project metadata and lifecycle
- `SettingsRepository`: settings and policy
- `FrontendCommandGateway`: approved domain command entry

Candidate read-side ports, subject to ADR and user approval:

1. `GlobalShellProjectionPort`: shell, navigation, feature availability,
   readiness, and global warning snapshot.
2. `ActionCenterProjectionPort`: primary actions, attention, continue working,
   recent, and pinned presentation.
3. `BackgroundSummaryProjectionPort`: principal-global background summary.
4. `NotificationSummaryProjectionPort`: principal-global notification
   presentation and read state, separate from domain resolution.
5. `GlobalSearchPort`: typed cross-resource search, using the existing Stage 7
   search projection only through a Knowledge-result adapter.

These ports own derived read snapshots/revisions only. They do not own
Canonical, domain resource, command, membership, policy, or credential data.
An application coordinator may combine ports; the shell must not call multiple
domain repositories directly and derive priority or authorization in the
browser. Cross-domain write transactions are prohibited from these read paths.

A new ADR is required to fix module placement, snapshot persistence, cache
boundaries, update watermarks, and rollback.

## OSS Findings

Current exact dependencies remain the default:

- React `19.2.8`: `ADOPT`, existing
- React Router `8.3.0`: `ADOPT`, existing
- TanStack Query `5.101.4`: `ADOPT`, existing
- Playwright `1.61.1`: `ADOPT`, existing

Candidates reviewed without installation:

| Candidate                    | Version | License    | Decision | Boundary                                                                                                                        |
| ---------------------------- | ------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| React Aria Components        | 1.19.0  | Apache-2.0 | `DEFER`  | Prototype accessible dialog, combobox, popover, and focus primitives behind Shotgun components; never authority or route policy |
| cmdk                         | 1.1.1   | MIT        | `DEFER`  | Prototype command-palette interaction only; disable client reranking/filtering when the server order is authoritative           |
| TanStack Virtual             | 3.14.8  | MIT        | `DEFER`  | Adopt only after measured list size/DOM evidence and pagination contract                                                        |
| Microsoft fetch-event-source | 2.0.1   | MIT        | `DEFER`  | Consider only after an authenticated refresh-event contract exists; events never replace snapshots                              |

Existing WAI-ARIA/APG patterns and the repository dialog helper are
`REFERENCE_ONLY` foundations. `ddsyasas/llm-wiki` and Inkeep OpenKnowledge are
`REFERENCE_ONLY` for Action Center and operational-cockpit information
hierarchy; their runtimes, databases, command execution, and Canonical models
remain excluded.

Before any `ADOPT`, `EXTRACT`, or `AUGMENT` decision, record the exact upstream
commit, lockfile, security/maintenance result, prototype, contract and
replacement tests, and rollback. No new runtime dependency is approved by this
audit.

## Performance and Large-data Findings

There is no Section 3 list implementation today, so no current unbounded DOM or
SSE flood exists to measure. Canonical does not provide numeric budgets. This
audit does not invent pass thresholds.

Implementation acceptance must first approve representative datasets and
budgets for attention items, notifications, background jobs, search results,
project count, cache size, render work, and refresh-event bursts. Pagination,
server caps, incremental rendering, and virtualization should be selected from
measured evidence. Local storage must not be used for unbounded server data.

## Recommended Implementation Order

1. Approve candidate acceptance criteria and open the ownership/cache ADR.
2. Define versioned contracts, projection ports, safe routes, runtime decoders,
   and exact OSS decisions.
3. Implement server-authorized read projections and Product API routes.
4. Implement API-client decoding, cache identities, invalidation, and session
   purge; decide snapshot polling versus refresh events.
5. Implement responsive Global Shell, global project selector, resource-project
   warning, server navigation, and prioritized warning presentation.
6. Implement Home regions in server-ranked order.
7. Implement typed search, navigation-only command palette, first-run
   readiness, route guards, deep-link recovery, and offline/degraded states.
8. Complete contract, architecture, security-negative, replacement,
   accessibility, performance, and browser E2E verification.
9. Judge Frontend Phase 1 completion separately, only after Sections 1–3 are
   implemented, verified, merged, and explicitly approved.

## Blocking Decisions

Implementation must not start until the user resolves or approves:

1. Candidate AC numbering and wording.
2. The `OUTCOME_UNKNOWN` switch correction and its Section 2 regression scope.
3. Projection port/module ownership, persistence, and required ADR.
4. Snapshot polling versus SSE/refresh-event scope for the initial release.
5. React Aria/cmdk/virtualization/SSE library decisions and exact pinned commits.
6. Representative data sets and numeric performance budgets.
7. Server behavior for unavailable placeholder navigation: hidden,
   unavailable, or `COMING_LATER`.
8. Pinned-resource presentation storage ownership.

## Candidate Acceptance Criteria

The following are **unapproved candidates**. They are not Canonical and may not
be used to claim completion until explicitly approved.

1. **AC-C01 — Typed Product API**: all Section 3 views are versioned and
   runtime-decoded; unknown schema and unsafe enum values fail closed.
2. **AC-C02 — Server-authoritative shell**: `GlobalShellView` supplies session,
   project, readiness, warning, background, notification, feature, and
   navigation state without browser inference.
3. **AC-C03 — Responsive navigation**: desktop, tablet, mobile, narrow-mobile,
   and 200%-zoom layouts retain accessible access to every available global
   function.
4. **AC-C04 — Active-project switch**: the accessible-project list and final
   selection are server-confirmed and non-optimistic; browser drafts and
   blocking dialogs guard leaving, while `OUTCOME_UNKNOWN` warns without
   cancelling or blocking the switch.
5. **AC-C05 — Resource project**: active and resource project are both visible
   when different; resource-local actions remain bound to the resource project,
   and deep links never mutate active project automatically.
6. **AC-C06 — Home structure**: Home renders project state, Primary Actions,
   Attention, Continue Working, Recent/Pinned, and Operational Summary from a
   typed active-project view with loading, empty, error, unavailable, and stale
   states.
7. **AC-C07 — Primary Actions**: availability, disabled reason, capability,
   readiness, lifecycle, privacy/budget, and target route are server-provided;
   Home only navigates and executes no high-risk command.
8. **AC-C08 — Attention Queue**: the server supplies persistent, ranked items
   with stable ID, priority, reason, project/resource reference, route,
   timestamps, capabilities, and visibility.
9. **AC-C09 — Continue Working**: only approved restorable server resources
   appear; Settings drafts, already-submitted command forms,
   `OUTCOME_UNKNOWN` resubmission states, inaccessible resources, and expired
   downloads are excluded.
10. **AC-C10 — Recent/Pinned**: items are project-bound, reauthorized,
    sensitivity-masked, retirement-aware, and safely labelled across projects;
    pinning changes presentation state only.
11. **AC-C11 — Global Background**: a revisioned, explicitly scoped,
    principal-global view returns minimal typed references for accessible
    projects.
12. **AC-C12 — Global Notification**: notification presentation/read state is
    separate from resolving the underlying domain issue and contains no full
    domain payload.
13. **AC-C13 — Global Warning**: server/policy priority selects one leading
    warning and summarizes additional states without unbounded banner stacking.
14. **AC-C14 — Global Search**: results are typed, authorized, sensitivity
    aware, and active-project scoped by default; cross-project search is
    explicit and labelled, and query text is not persisted.
15. **AC-C15 — Command palette**: the palette offers approved navigation and
    project-switch commands only, preserves server ranking, and passes
    dialog/combobox, keyboard, announcement, focus-restore, and IME checks.
16. **AC-C16 — First-run readiness**: readiness comes from a server view that
    distinguishes required from optional capabilities; settings changes occur
    only in Settings.
17. **AC-C17 — Route guard**: session, principal, existence, resource project,
    membership, sensitivity/scope, feature availability, and render checks
    produce typed failure states with sensitive existence masking.
18. **AC-C18 — Deep-link recovery**: permitted links restore the target route
    and project context without unsafe redirects or active-project mutation;
    forbidden, retired, unavailable, and session-required cases are explicit.
19. **AC-C19 — Offline/degraded**: safe cached UI is clearly stale; project
    switch, server commands, issue resolution, review, search, external action,
    and notification synchronization are blocked or explicitly unavailable.
20. **AC-C20 — Cache isolation**: Home/global keys include approved
    principal/session/scope/access/policy/projection revisions and purge
    correctly on project, membership, sensitivity, policy, session, or
    principal change.
21. **AC-C21 — Ownership**: shell aggregation uses approved projection/search
    ports, not browser composition or direct domain-repository access; read
    projections own no domain or Canonical truth.
22. **AC-C22 — Security**: negative tests cover authority headers,
    cross-project access, revocation, masking, protected query/notification
    metadata, cache purge, credentials, existence masking, CSRF, same-origin,
    open redirects, and unsafe deep links.
23. **AC-C23 — Accessibility**: all Section 3 surfaces pass keyboard, focus,
    name/role/state, live-region, reduced-motion, high-contrast, 200%-zoom,
    touch-target, and IME verification.
24. **AC-C24 — Performance**: user-approved datasets and budgets govern server
    caps, pagination, cache size, DOM size, render work, and refresh bursts;
    measured evidence determines virtualization.
25. **AC-C25 — Automated verification**: contract, architecture, security,
    replacement, cache/revision, and OSS integration gates pass without skipped
    failures.
26. **AC-C26 — Browser E2E**: representative desktop/tablet/mobile flows cover
    session, project switch, Home, warnings, navigation, search, palette,
    guarded/deep-linked resources, offline/degraded behavior, and sensitive
    denial.
27. **AC-C27 — Phase 1 completion gate**: Frontend Phase 1 is complete only
    after Sections 1, 2, and 3 are implemented, verified, merged, evidenced, and
    separately approved; this does not claim Phase 2 or whole-frontend
    completion.

## Contract Snapshot Plan

Create an immutable implementation snapshot only after the user approves the
ACs. It should contain:

- Section 3 decision
- ADR-100
- ADR-101
- ADR-104
- Cross-phase integration decision
- the user-approved Section 3 acceptance criteria

Unapproved candidate ACs must not enter the snapshot.

## Audit Conclusion

- Canonical normalization: complete for the explicitly authorized Section 3
  wording only
- Repository gap audit: complete at baseline commit
  `4b5c90a1bccad520c1bdfa2fc5114d8852ed59d2`
- Candidate implementation plan: prepared
- Section 3 product implementation: **not started**
- Frontend Phase 1: **incomplete**
- Next action: user review and explicit approval or revision of the candidate
  ACs and blocking decisions
