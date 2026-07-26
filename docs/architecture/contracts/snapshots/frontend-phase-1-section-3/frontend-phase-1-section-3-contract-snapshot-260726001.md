# Frontend Phase 1 Section 3 Contract Snapshot

- Snapshot ID: `frontend-phase-1-section-3-contract-snapshot-260726001`
- Created date: 2026-07-26
- Approval date: 2026-07-26
- Approver: User
- Source PR: [JasonCutter/shotgun PR #21](https://github.com/JasonCutter/shotgun/pull/21)
- Approval source Head:
  `17724e1ce605c9dca80cabacac282409ddb73640`
- Base:
  `main@4b5c90a1bccad520c1bdfa2fc5114d8852ed59d2`
- Snapshot creation commit: `PENDING_THIS_COMMIT`
- Commit resolution: the first Git commit containing this immutable file is
  the Snapshot creation commit; the path must not be silently overwritten.
- Product implementation: **Not started**
- Verification: **Not started**
- Frontend Phase 1: **Incomplete**

## Snapshot Authority and Change Control

This Snapshot records only decisions approved by the user on 2026-07-26.
ADR-115 is Accepted, and AC-01–AC-27 are approved and frozen Canonical
implementation acceptance criteria.

Implementation must not add, delete, renumber, narrow, or expand an AC. A
required change needs a new ADR, a new Snapshot revision, and explicit user
approval. This Snapshot does not authorize product implementation, a database
migration, a dependency or lockfile change, PR Ready transition, merge,
Frontend Phase 1 completion, or Phase 2 work.

## Governing Sources

- [Frontend Phase 1 Section 3 Canonical decision](https://app.notion.com/p/3a65181d71ad813faa06e1cdd054f2cc)
- [ADR-100 — Active Project·Resource Project·Draft Project Binding](https://app.notion.com/p/3a65181d71ad8182ab8fc67e791ebd85)
- [ADR-101 — Frontend Async Command·Resource Snapshot·Outcome Unknown](https://app.notion.com/p/3a65181d71ad815c8c23e6b1cbe8d962)
- [ADR-104 — Global Shell and Server-ranked Action Center Boundary](https://app.notion.com/p/3a65181d71ad81c78fb3c5b70df73304)
- [ADR-115 — Global Shell·Action Center Read Projection and Scope Boundary](https://app.notion.com/p/3a95181d71ad815585d3ccb0420fb998)
- [Frontend Phase 1–2 Cross-Phase Integration Decision](https://app.notion.com/p/3a65181d71ad81e28b9cfb13f322e983)
- [Repository ADR-115](../../../adr/ADR-115-global-shell-action-center-read-projection-and-scope-boundary.md)
- [Section 3 Gap Audit and approved ACs](../../../../engineering/frontend-phase-1-section-3-gap-audit-260726001.md)
- [Section 3 Approved Implementation Baseline](../../../../implementation/frontend-phase-1-section-3-implementation-plan-260726001.md)

## Section 3 Decision

- Global Shell is the server-authoritative Session, Project, Navigation,
  Background, Notification, Warning, Search, and Route presentation boundary.
- Home is an Active Project-scoped Action Center. It navigates to owning
  workspaces and does not execute high-risk domain commands directly.
- Application Coordinator-based read projections are non-persistent initially.
  Snapshot queries remain authoritative.
- Focus refetch, explicit refresh, and approved bounded polling are the initial
  refresh mechanisms. No new SSE infrastructure is introduced.
- Section 3 product implementation and verification have not started.
- Frontend Phase 1 remains incomplete until Sections 1, 2, and 3 are
  implemented, verified, merged, evidenced, and separately approved.

## Governing ADR Boundaries

### ADR-100

Active Project, Resource Project, Draft Project, and Effective Project remain
distinct. Existing-resource actions bind to the Resource Project, Deep Links do
not automatically switch the Active Project, and the browser does not create
Project authority.

### ADR-101

Every browser write uses a versioned `FrontendCommandRequest`. The server
creates `commandId`, validates authority and typed preconditions, records the
accepted context, and returns `FrontendCommandOutcomeView`.
`OUTCOME_UNKNOWN` is resolved through `clientRequestId`, deduplication evidence,
and expected resources without automatic new-key resubmission.

### ADR-104

Global Shell and Home do not own domain truth. Home Attention is Active
Project-scoped, while Global Background and Notification use an authorized
accessible-project scope. Server ranking remains authoritative.

### ADR-115

ADR-115 is **Accepted** as of 2026-07-26. It fixes the read-projection,
refresh, Project scope, presentation ownership, Project Context 2.0.0, Browser
Draft composition, search, navigation, route-guard, OSS, and performance
boundaries recorded below.

## Project Context Compatibility

### 1.0.0

- Exact existing `ProductSessionView 1.0.0` and
  `FrontendCommandRequest 1.0.0` decoders remain supported.
- Existing Section 2 Project-bound command meaning does not change.

### 2.0.0

`FrontendCommandRequest 2.0.0` uses a discriminated Project context:

```text
PRINCIPAL
PROJECT
RESOURCE
```

- `PRINCIPAL` supports principal/bootstrap commands without a fabricated target
  Project.
- `PROJECT` requires Active and Target Project binding.
- `RESOURCE` also requires the actual Resource Project binding.
- `ProductSessionView 2.0.0` represents an authenticated zero-project state.
- Zero-project `project.create.v1` uses `PRINCIPAL` scope.
- The server derives bootstrap authorization and returns the created Project as
  a produced resource.
- Semantic digest, ledger, accepted context, outcome lookup, and audit bind to
  the normalized discriminated scope.

## Notification Presentation Ownership

```text
Owner: SettingsRepository
Scope: Principal
Resource: notification-presentation-state/self
Write command: notification.presentation.mark-read.v1
Precondition: Principal notification presentation revision
Domain effect: none
```

Notification Read State is a bounded Principal Presentation Preference.
`NotificationSummaryProjectionPort` owns only the derived read view. Mark-read
does not dismiss Attention or resolve a domain problem. Storage uses a bounded
cursor/read watermark or limited exception set, never an unbounded list of
Notification IDs. If `SettingsRepository` cannot represent this contract,
implementation stops pending a separately approved ADR and additive migration;
no side store is created implicitly.

## Browser Draft Composition Boundary

- `HomeActionCenterView` contains authorized server resources, server ranking,
  server availability, and server-resource identity only.
- Browser drafts remain local and are exposed through
  `BrowserDraftPresentationView`.
- The client validates Project, Session, Sensitivity, Revision, Expiry, and
  Availability before composing a separately labelled Continue Working group.
- Browser Draft automatic upload, server ranking, and Stable ID reuse across
  browser/server origins are prohibited.

## Approved and Frozen Acceptance Criteria

1. **AC-01 — Typed Product API and writes**: all Section 3 views are versioned
   and runtime-decoded; unknown schema and unsafe enum values fail closed. Exact
   `ProductSessionView` and `FrontendCommandRequest` 1.0.0 decoders remain
   supported while exact 2.0.0 decoders add zero-project session state and
   discriminated `PRINCIPAL`/`PROJECT`/`RESOURCE` Project context. Every
   Section 3 browser write uses a complete versioned request, the fixed command
   registry, server-created `commandId`, scope-bound semantic digest, typed
   preconditions, decoded `FrontendCommandOutcomeView`, and
   `clientRequestId`-based `OUTCOME_UNKNOWN` recovery.
2. **AC-02 — Server-authoritative shell**: `GlobalShellView` supplies session,
   project, readiness, warning, background, notification, feature, and
   navigation state without browser inference. Navigation availability is
   exactly `AVAILABLE`, `COMING_LATER`, `TEMPORARILY_UNAVAILABLE`,
   `ACCESS_RESTRICTED`, or `HIDDEN`, with the Canonical render and exposure
   behavior for each value.
3. **AC-03 — Responsive navigation**: desktop, tablet, mobile, narrow-mobile,
   and 200%-zoom layouts retain accessible access to every available global
   function.
4. **AC-04 — Active-project switch**: the accessible-project list and final
   selection are server-confirmed and non-optimistic; browser drafts and
   blocking dialogs guard leaving, while `OUTCOME_UNKNOWN` warns without
   cancelling or blocking the switch.
5. **AC-05 — Resource project**: active and resource project are both visible
   when different; resource-local actions remain bound to the resource project,
   and deep links never mutate active project automatically.
6. **AC-06 — Home structure**: Home renders project state, Primary Actions,
   Attention, Continue Working, Recent/Pinned, and Operational Summary from a
   typed active-project view with loading, empty, error, unavailable, and stale
   states.
7. **AC-07 — Primary Actions**: availability, disabled reason, capability,
   readiness, lifecycle, privacy/budget, and target route are server-provided;
   Home only navigates and executes no high-risk command.
8. **AC-08 — Attention Queue**: the server supplies persistent, ranked items
   with stable ID, priority, reason, project/resource reference, route,
   timestamps, capabilities, and visibility.
9. **AC-09 — Continue Working**: `HomeActionCenterView` contains only
   authorized server resources, server ranking, and server-resource identity.
   The browser client validates approved restorable local drafts for project,
   session, sensitivity, revision, expiry, and availability through
   `BrowserDraftPresentationView`, then composes a separately labelled group.
   Settings drafts, already-submitted command forms, `OUTCOME_UNKNOWN`
   resubmission states, inaccessible resources, and expired downloads are
   excluded. A browser draft is never server-ranked, automatically uploaded, or
   assigned an identity reused by a server-resource item.
10. **AC-10 — Recent/Pinned**: items are project-bound, reauthorized,
    sensitivity-masked, retirement-aware, and safely labelled across projects;
    pinning changes only the principal presentation preference through
    `SettingsRepository`.
11. **AC-11 — Global Background**: a revisioned, explicitly scoped,
    principal-global view returns minimal typed references for accessible
    projects.
12. **AC-12 — Global Notification**: notification read state is a principal
    presentation preference owned by `SettingsRepository`, addressed as
    `notification-presentation-state/self`, checked against its presentation
    revision, and stored as a cursor/read watermark or bounded exception set.
    `NotificationSummaryProjectionPort` owns only the derived summary.
    Mark-read changes no Attention or domain state, and the summary contains no
    full domain payload.
13. **AC-13 — Global Warning**: server/policy priority selects one leading
    warning and summarizes additional states without unbounded banner stacking.
14. **AC-14 — Global Search**:
    `POST /product-api/frontend/search/query` accepts a versioned
    `GlobalSearchRequest` and returns runtime-decoded, typed, authorized,
    sensitivity-aware results. Scope defaults to the active project and
    cross-project scope is explicit and labelled. Raw query text never appears
    in a URL, browser storage, persistent query cache, default body log, or
    content telemetry; a cache may retain only a non-reversible digest.
15. **AC-15 — Command palette**: the palette offers approved navigation and
    project-switch commands only, preserves server ranking, and passes
    dialog/combobox, keyboard, announcement, focus-restore, and IME checks.
16. **AC-16 — First-run readiness**: readiness comes from a server view that
    distinguishes required from optional capabilities. Zero accessible projects
    is a valid authenticated `ProductSessionView 2.0.0` state with
    `SESSION_READY: true`, `PROJECT_READY: false`, `activeProject: null`,
    `accessibleProjects: []`, no Home Action Center query, and Project creation
    onboarding at `/settings/projects`. `project.create.v1` uses
    `FrontendCommandRequest 2.0.0` with `scope: 'PRINCIPAL'`, server-derived
    bootstrap authorization, and a produced Project resource; the server then
    establishes the active Project through its authoritative session flow.
17. **AC-17 — Route guard**: the server computes resource existence, resource
    project, membership, scope, sensitivity, feature availability, and
    existence masking into a final `RouteGuardDecisionView`. The browser checks
    the session boundary, runtime-decodes that decision, and renders the route
    or typed failure; it does not calculate guard authority.
18. **AC-18 — Deep-link recovery**: permitted links restore the target route
    and project context without unsafe redirects or active-project mutation;
    forbidden, retired, unavailable, and session-required cases are explicit.
19. **AC-19 — Offline/degraded**: safe cached UI is clearly stale; project
    switch, server commands, issue resolution, review, search, external action,
    and notification synchronization are blocked or explicitly unavailable.
20. **AC-20 — Cache isolation**: Home/global keys include approved
    principal/session/scope/access/policy/projection revisions and purge
    correctly on project, membership, sensitivity, policy, session, or
    principal change.
21. **AC-21 — Ownership**: shell aggregation uses approved projection/search
    ports, not browser composition or direct domain-repository access; read
    projections own no domain or Canonical truth.
22. **AC-22 — Security**: negative tests cover authority headers,
    cross-project access, revocation, masking, protected query/notification
    metadata, cache purge, credentials, existence masking, CSRF, same-origin,
    open redirects, and unsafe deep links.
23. **AC-23 — Accessibility**: all Section 3 surfaces pass keyboard, focus,
    name/role/state, live-region, reduced-motion, high-contrast, 200%-zoom,
    touch-target, and IME verification.
24. **AC-24 — Performance**: representative datasets, server pagination/caps,
    unbounded DOM/storage prohibitions, and measurement method are fixed before
    implementation. A baseline is measured after behavior exists. Before
    completion, the user approves numeric budgets derived from that evidence
    and the final performance gate passes; measured evidence determines
    virtualization.
25. **AC-25 — Automated verification**: every required contract, architecture,
    security, replacement, cache/revision, OSS integration, accessibility,
    performance, and browser gate is executed and passes. No required gate may
    be skipped, ignored, marked `continue-on-error`, or reported as passing
    without execution.
26. **AC-26 — Browser E2E**: representative desktop/tablet/mobile flows cover
    session, project switch, Home, warnings, navigation, search, palette,
    guarded/deep-linked resources, offline/degraded behavior, and sensitive
    denial.
27. **AC-27 — Phase 1 completion gate**: Frontend Phase 1 is complete only
    after Sections 1, 2, and 3 are implemented, verified, merged, evidenced, and
    separately approved; this does not claim Phase 2 or whole-frontend
    completion.

## Canonical Synchronization Evidence

- Section 3 Canonical decision: ADR-115 Accepted; AC-01–AC-27 approved and
  frozen; implementation and verification not started.
- Frontend ADR Index: ADR-115 registered as Accepted with the approved title.
- Frontend Phase 1 parent: Sections 1 and 2 remain implemented/merged; Section
  3 architecture and contract are approved while implementation is not started;
  Frontend Phase 1 remains incomplete.
- Canonical synchronization date: 2026-07-26.
