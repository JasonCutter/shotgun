# Frontend Phase 1 Section 3 Candidate Implementation Plan

- Plan ID: `frontend-phase-1-section-3-implementation-plan-260726001`
- Prepared: 2026-07-26
- Baseline:
  `main@4b5c90a1bccad520c1bdfa2fc5114d8852ed59d2`
- Status: **candidate; implementation not authorized**
- Depends on:
  [Section 3 gap audit](../engineering/frontend-phase-1-section-3-gap-audit-260726001.md)
- Canonical normalization:
  [Section 3 normalization record](../architecture/canonical-normalization/frontend-phase-1-section-3-normalization-260726001.md)
- Proposed architecture:
  [ADR-115](../architecture/adr/ADR-115-global-shell-action-center-read-projection-and-scope-boundary.md)

## Objective

After explicit user approval, implement Frontend Phase 1 Section 3 as a
server-authoritative Global Shell and Home Action Center that reuses Sections 1
and 2 without duplicating session, project, draft, command, or domain authority.

This document defines a candidate sequence and ownership model. It does not
authorize product code, migrations, dependencies, a PR, or a completion claim.

## Entry Conditions

All conditions must be met before implementation starts:

1. The user approves or revises the candidate acceptance criteria in the gap
   audit.
2. The user approves or revises proposed ADR-115.
3. Representative dataset candidates, server pagination and caps, the
   prohibition of unbounded DOM/storage, and the measurement method are fixed.
4. Existing adopted dependencies remain pinned. Any later OSS adoption requires
   an exact tag/commit, license/security/maintenance evidence, lockfile update,
   contract/replacement tests, and rollback.

Numeric performance budgets are a completion condition after baseline
measurement, not an implementation entry condition.

## Scope

- Versioned Section 3 server views and runtime decoders
- Read-side projection/search ports and Product API routes
- Responsive Global Shell
- Server-authoritative active-project selector
- Active/resource-project presentation
- Home project state, Primary Actions, Attention, Continue Working,
  Recent/Pinned, and Operational Summary
- Principal-global background and notification summaries
- Prioritized global warning
- Typed global search and navigation-only command palette
- Server readiness/first-run view
- Typed route guards and safe deep-link recovery
- Offline/degraded behavior
- Cache/revision isolation and authorized refresh
- Security, accessibility, performance, contract, architecture, replacement,
  and browser verification

## Non-scope

- Detailed Sources, Ask, Knowledge, Review, Activity, or History workspace
  implementation
- Direct Home execution of ingestion, Ask, approval/rejection, Canonical writes,
  project deletion, connector revoke, sensitivity/retention, or external
  actions
- Phase 2 implementation
- Phase 3–5 implementation
- Whole-shell redesign beyond Section 3 contracts
- Whole-frontend completion

## Candidate AC Traceability

The candidate definitions remain in the gap audit and are not frozen. This plan
links every candidate without changing the AC-01–AC-27 count:

| Candidate AC | Implementation plan area                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| AC-01        | Product API views, runtime decoders, presentation command registry, and common browser-write contract |
| AC-02–AC-03  | Server-authoritative Global Shell and responsive navigation                                           |
| AC-04–AC-05  | Active-project switch and resource-project binding                                                    |
| AC-06–AC-13  | Home structure, actions, Attention, Continue Working, Recent/Pinned, global summaries, and warning    |
| AC-14–AC-15  | Protected global search and navigation-only command palette                                           |
| AC-16–AC-18  | Zero-project first run, server route-guard decision, and deep-link recovery                           |
| AC-19–AC-21  | Offline/degraded behavior, cache isolation, and projection ownership                                  |
| AC-22–AC-24  | Security, accessibility, and staged performance gate                                                  |
| AC-25–AC-26  | Required automated gates and browser E2E                                                              |
| AC-27        | Separate Frontend Phase 1 completion judgment                                                         |

## Architecture

```text
Domain modules and existing repositories
                  |
                  v
     Authorized read/projection ports
                  |
                  v
    Section 3 application coordinator
                  |
                  v
 Versioned Product API views and revisions
                  |
                  v
 API-client runtime decoders and cache keys
                  |
                  v
 Global Shell / Home / Search / Route guards
```

The server owns ranking, availability, membership, sensitivity, visibility,
project scope, readiness, and target routes. The browser owns presentation,
accessible interaction, explicit stale state, and navigation requests. It does
not infer authority or compose domain counts into business priority.

Read projections do not create a cross-domain write transaction. Each returned
view is tied to source watermarks and access/policy revisions. High-risk work
navigates to the owning domain workspace and uses its existing command
contract.

The initial architecture is the ADR-115 candidate: an Application Coordinator
composes non-persistent read views through ports; snapshot queries are
authoritative; refresh uses focus refetch, explicit refresh, and approved
bounded polling; no new SSE infrastructure, projection migration, or runtime
dependency is introduced.

## Candidate Contracts

### Global Shell

- `GlobalShellView`
- `NavigationItemView`
- `FeatureAvailabilityView`
- `GlobalWarningView`
- `BackgroundSummaryView`
- `NotificationSummaryView`
- `FirstRunReadinessView`

### Home Action Center

- `HomeActionCenterView`
- `PrimaryActionView`
- `ActionCenterItem`
- `ContinueWorkingItem`
- `RecentResourceView`
- `PinnedResourceView`

### Search and routing

- `GlobalSearchRequest`
- `GlobalSearchResultView`
- `RouteGuardDecisionView`
- safe `TargetRouteView` or equivalent registered-route discriminated union

### Browser writes

- `FrontendCommandRequest`
- `FrontendCommandOutcomeView`
- `notification.presentation.mark-read.v1`
- `presentation.pin.upsert.v1`
- `presentation.pin.remove.v1`

Every response includes an explicit schema version, scope binding, access and
policy revisions, projection revision, and fetch timestamp. Unsupported
versions, unsafe unknown enums, invalid routes, and inconsistent scope fail
closed.

Every state-changing browser request uses the complete common command contract.
The browser supplies `clientRequestId` and `idempotencyKey`, never `commandId`.
The server creates `commandId`, computes the semantic digest, atomically checks
typed preconditions and accepted authority contexts, and resolves
`OUTCOME_UNKNOWN` through `clientRequestId`.

## Candidate Modules and Ports

Final module names require ADR approval. Candidate responsibilities are:

### `GlobalShellProjectionPort`

- Reads: session/principal membership, project metadata, policy/readiness, and
  summary projection watermarks
- Owns: derived shell/navigation/feature/warning snapshot and revision only
- Does not own: session, membership, project, policy, credentials, command, or
  Canonical truth
- Dependency direction: assembly/application layer toward existing read ports
- Transaction boundary: read snapshot/watermark consistency only
- Cache boundary: principal/session/accessible-project-set/policy/projection

### `ActionCenterProjectionPort`

- Reads: approved resource summaries and domain-provided action candidates
- Owns: server-ranked presentation snapshot, stable item identity, and revision
- Does not own: domain resource state or command execution
- Dependency direction: projection adapter toward typed domain summary ports
- Transaction boundary: no cross-domain writes
- Cache boundary: principal/session/active-project/access/policy/projection

### `BackgroundSummaryProjectionPort`

- Reads: operational resource summaries for explicitly authorized projects
- Owns: minimal global presentation snapshot and revision
- Excludes: credentials, raw payloads, and full logs

### `NotificationSummaryProjectionPort`

- Reads: authorized notification projections and presentation/read state
- Owns: notification presentation state, not domain issue resolution
- Excludes: raw domain payloads and inferred resolution

### `GlobalSearchPort`

- Reads: typed, authorized search-provider adapters
- Reuses: Stage 7 search through a Knowledge-result adapter
- Owns: no Canonical source or resource; returns typed ranked references
- Default scope: active project
- Cross-project scope: explicit, server-authorized, and labelled

## Data Ownership

| Data                                           | Owner                      | Section 3 usage                                    |
| ---------------------------------------------- | -------------------------- | -------------------------------------------------- |
| Session, principal, membership                 | Auth                       | Read through authorized view                       |
| Project metadata/lifecycle                     | Project Administration     | Read safe labels and availability                  |
| Settings and policy                            | Settings                   | Read derived feature/readiness policy              |
| Canonical/source/domain resources              | Owning domain modules      | Read typed minimal summaries                       |
| Command execution/outcome                      | Owning command modules     | Navigate; never duplicate execution                |
| Shell/action/background/notification snapshots | Candidate projection layer | Derived, revisioned, replaceable                   |
| Pin presentation preference                    | Settings                   | Principal preference; no domain/Canonical mutation |

No OSS type, database identifier, or internal schema becomes a shared
Canonical/Product API identifier.

## Product API Routes

Exact route names are candidate details and must be fixed with the contract.
The route family should support:

```text
GET  /product-api/frontend/shell
GET  /product-api/frontend/home
POST /product-api/frontend/search/query
POST /product-api/frontend/notifications/:id/read
POST /product-api/frontend/pins
DELETE /product-api/frontend/pins/:id
```

Constraints:

- Snapshot views are server-authorized and revisioned.
- Search is a state-neutral read query with a versioned `GlobalSearchRequest`
  body and typed response decoder. It is not a `FrontendCommandRequest`.
- Raw search text is absent from the URL, default body logs, content telemetry,
  browser storage, and persistent query caches. Telemetry may retain only
  non-content metadata; a cache may use only a non-reversible query digest.
- Notification and pin mutations use CSRF and same-origin protection plus a
  complete versioned `FrontendCommandRequest`, server-generated `commandId`,
  semantic digest, typed preconditions, idempotency, decoded
  `FrontendCommandOutcomeView`, and `clientRequestId`-based
  `OUTCOME_UNKNOWN` recovery.
- Pinning and notification read state cannot resolve or mutate underlying
  domain truth.
- Routes never trust `X-Project-Id` or equivalent client authority.
- External URLs are not accepted as arbitrary `targetRoute` values.

The route names above are planning placeholders, not approved public contracts.

## Client Routes and Guards

Retain the existing application route tree with this authority split:

### Server

1. resource existence
2. resource-project binding
3. membership
4. scope and sensitivity
5. feature/navigation availability
6. existence masking
7. final `RouteGuardDecisionView`

### Client

1. verify the session boundary
2. runtime-decode `RouteGuardDecisionView`
3. render the authorized route or typed failure state

Typed outcomes:

- `SESSION_REQUIRED`
- `BACKEND_UNAVAILABLE`
- `NOT_FOUND`
- `ACCESS_DENIED`
- `PROJECT_UNAVAILABLE`
- `FEATURE_UNAVAILABLE`
- `RESOURCE_RETIRED`

The browser does not calculate guard authority from independent API results.
Sensitive existence is masked by the server. Deep-link restoration accepts
registered internal routes only and does not change active project
automatically.

## UI Workspaces

### Global Shell

- desktop primary navigation
- tablet navigation rail
- mobile top bar and bottom navigation
- accessible More/drawer/popover overflow
- global project selector
- active/resource project warning
- server navigation availability using exactly `AVAILABLE`, `COMING_LATER`,
  `TEMPORARILY_UNAVAILABLE`, `ACCESS_RESTRICTED`, and `HIDDEN`
- readiness, background, notification, and prioritized warning presentation
- settings entry

### Home

Render these regions in one typed snapshot:

1. project state
2. Primary Actions
3. Attention Queue
4. Continue Working
5. Recent/Pinned
6. Operational Summary

Every region supports loading, empty, unavailable, stale, and error states
without turning missing server data into an enabled action.

Continue Working accepts both approved restorable browser drafts and server
resources. Each item declares `origin` as `BROWSER_DRAFT` or
`SERVER_RESOURCE`, plus project binding, sensitivity, revision, expiry, and
availability. Settings drafts, submitted command forms, `OUTCOME_UNKNOWN`
resubmission states, inaccessible resources, and expired downloads are
excluded. Browser drafts are never represented as server-ranked resources.

### Global search and command palette

- Search defaults to active project.
- Cross-project search is explicit and labelled.
- Results preserve type, project, sensitivity-safe highlight, availability, and
  registered target route.
- Search uses the protected `POST /product-api/frontend/search/query` read-query
  contract; no raw query text is persisted or placed in a URL.
- The palette preserves server order and only navigates or requests a
  server-confirmed project switch.
- High-risk direct execution is absent.

### First run

Use server readiness categories:

- `SESSION_READY`
- `PROJECT_READY`
- `PRIVACY_READY`
- `MODEL_READY`
- `STORAGE_READY`
- `WORKER_READY`
- `OPTIONAL_CONNECTOR_READY`

An authenticated session with no accessible project is a valid first-run
state:

```text
SESSION_READY: true
PROJECT_READY: false
activeProject: null
accessibleProjects: []
HomeActionCenter: not queried
```

The Shell renders safely with `activeProject: null` and provides Project
creation onboarding at `/settings/projects`. It does not convert zero projects
to `SESSION_REQUIRED`, `NOT_FOUND`, or `BACKEND_UNAVAILABLE`. Optional
model/connector absence disables dependent features rather than falsifying
unrelated readiness. Actual settings changes occur in `/settings`.

## Cache

### Home/project views

```text
principalId
sessionId
activeProjectId
projectAccessRevision
policyContextRevision
shellViewRevision
viewProjectionRevision
```

### Principal-global views

```text
principalId
sessionId
accessibleProjectSetRevision
explicitScopeDigest
policyContextRevision
viewProjectionRevision
```

Rules:

1. Active-project switch invalidates project Home/search/recent/pinned views,
   not all valid global feeds.
2. Membership/access/sensitivity/policy revision changes purge and reauthorize
   affected project and global metadata.
3. Session or principal replacement purges every protected family, including
   `global`.
4. Cached data is never presented as current after scope/revision mismatch.
5. Initial refresh uses TanStack Query focus refetch, explicit refresh, and
   approved bounded polling. Snapshot queries remain authoritative; no new SSE
   infrastructure is introduced.
6. Search queries and server data are not persisted in browser storage.

## Security

- Reuse session, CSRF, same-origin, and authority-header rejection.
- Authorize each projection before serialization.
- Apply project membership, capability, visibility, sensitivity, and resource
  existence masking server-side.
- Return minimal cross-project metadata.
- Validate all registered routes and prohibit open redirects.
- Do not expose credentials, secrets, source text, answers, raw logs, or
  protected inferred metadata in global views.
- Add negative tests for access revocation, principal/session replacement,
  stale revisions, cross-project enumeration, unsafe routes, and unauthorized
  command attempts.

## Accessibility

- Preserve skip link, landmark, heading, and focus foundations.
- Use accessible disclosure/dialog/combobox patterns for mobile navigation,
  project selector, and palette.
- Define initial focus, keyboard movement, Escape, focus trap where modal,
  focus restoration, and result/selection announcements.
- Protect IME composition from premature command execution.
- Test severity as text, restrained live regions, reduced motion,
  forced/high-contrast colors, 200% zoom, narrow mobile, and touch targets.
- Verify representative flows in real browsers; unit DOM assertions are not
  sufficient.

## Performance

Numeric thresholds require a measured baseline and are not implementation entry
conditions.

### Before implementation starts

1. Fix representative dataset candidates for projects, attention items,
   notifications, background work, and search results.
2. Define server pagination and caps.
3. Prohibit unbounded DOM, browser storage, polling, and event queues.
4. Define the payload, latency, render, DOM, cache, and refresh measurement
   method.

### During implementation

1. Measure the baseline after the relevant behavior exists.
2. Use server caps and pagination by default.
3. Adopt virtualization only when measurements show a benefit and replacement
   tests cover accessibility, focus, and stable item identity.

### Before completion

1. Obtain user approval for numeric budgets derived from the baseline.
2. Run and pass the final performance gate against those budgets.

## Tests

### Contract

- runtime decoder acceptance/rejection
- schema-version and unknown-enum failure
- scope/revision consistency
- complete `FrontendCommandRequest` and `FrontendCommandOutcomeView` handling
- presentation command registry and server-generated `commandId`
- search read-query transport and query protection
- `RouteGuardDecisionView` authority split
- route registry validation
- adapter replacement tests

### Server and integration

- server ranking and stable Action Center identity
- project/global authorization and access revocation
- cache invalidation/revision replay
- notification-read versus domain-resolution separation
- pin preference versus domain/Canonical separation
- presentation-write semantic digest, typed precondition, idempotency, and
  `clientRequestId` outcome recovery
- focus refetch, explicit refresh, and bounded-poll snapshot behavior

### Security negative

- authority-header injection
- cross-project enumeration
- sensitive resource existence masking
- membership and session replacement
- CSRF/same-origin
- open redirect and unsafe deep link
- protected search/notification metadata
- raw search query absence from URL, logs, telemetry, storage, and persistent
  query cache

### Frontend

- shell view states and server navigation
- non-optimistic project switch
- browser-draft guard and `OUTCOME_UNKNOWN` warning-without-block
- all Home states
- browser-draft/server-resource Continue Working origin separation
- zero-project first-run onboarding
- server-decoded route-guard decisions
- search/palette/readiness/guard/offline behavior
- cache isolation and purging
- keyboard, focus, live region, IME, and responsive behavior

### Browser E2E

- desktop, tablet, mobile, narrow-mobile, and 200%-zoom representative flows
- sensitive denial and revoked membership
- active/resource project mismatch
- offline/degraded state
- no browser authority/persistence

## OSS Integration

Candidate decisions:

| Candidate                       | Candidate decision    | Required proof before adoption                                                         |
| ------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| React Router and TanStack Query | `ADOPT` existing pins | Existing boundaries plus Section 3 replacement/cache tests                             |
| React Aria Components 1.19.0    | `DEFER`               | Exact commit, license/security review, bundle/a11y prototype, wrapper replacement test |
| cmdk 1.1.1                      | `DEFER`               | Server-order preservation, IME/a11y, dependency and large-result prototype             |
| TanStack Virtual 3.14.8         | `DEFER`               | Measured need, paginated data, focus/screen-reader replacement tests                   |
| fetch-event-source 2.0.1        | `DEFER`               | Approved refresh-event contract, auth/reconnect review, native alternative comparison  |
| ddsyasas/llm-wiki               | `REFERENCE_ONLY`      | Action-centric hierarchy only                                                          |
| Inkeep OpenKnowledge            | `REFERENCE_ONLY`      | Activity/cockpit patterns only; recheck source/license before code use                 |

Every newly reviewed Section 3 runtime candidate remains `DEFER` for the
initial implementation. No new SSE, virtualization, command-palette, or
accessibility runtime is selected by this plan.

No dependency installation or lockfile change is part of this plan-preparation
task.

## Migration

The initial implementation uses an Application Coordinator over existing read
ports with explicit watermarks and no persistent projection storage. It adds no
database migration.

Persistent shell/action/background/notification projections may be considered
later only when measured performance, replay, recovery, or stable-identity
requirements justify them. That change requires a separate ADR and a
forward-only additive migration with rebuild and rollback evidence. Rollback
disables new view routes and returns to the Section 1/2 Shell without deleting
domain, Canonical, command, or Settings preference data.

## Candidate Commit Plan

Each commit must remain independently reviewable and gated:

1. `docs: approve section 3 contracts and ADR-115`
2. `feat(contracts): add section 3 product views and decoders`
3. `feat(api): add authorized section 3 projections`
4. `feat(client): add section 3 api decoding and cache boundaries`
5. `feat(web): add responsive global shell`
6. `feat(web): add home action center`
7. `feat(web): add global search palette and route guards`
8. `test: add section 3 security accessibility and browser evidence`
9. `docs: record section 3 verification and phase 1 decision`

Actual grouping may change after AC/ADR approval. No implementation commit is
authorized by this candidate plan.

## Risks and Mitigations

| Risk                                                           | Mitigation                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Browser recreates domain priority                              | Server-ranked typed Action Center snapshot                               |
| Cross-project metadata leak                                    | Explicit accessible-scope revision, minimization, purge, negative tests  |
| Shell couples to domain repositories                           | Projection/search ports and assembly coordinator                         |
| Stale refresh treated as truth                                 | Decoded snapshot query remains authoritative                             |
| `OUTCOME_UNKNOWN` command is cancelled or navigation is locked | Preserve resource binding; warn and allow switch                         |
| Dead/unauthorized navigation                                   | Server availability and typed route registry                             |
| Global cache survives session/access change                    | Include every protected family in revision-aware purge                   |
| Palette reranks or executes unsafe work                        | Preserve server order; navigation-only command registry                  |
| List performance damages accessibility                         | Server caps first; measured, replaceable virtualization                  |
| New projection schema cannot roll back                         | Additive storage, rebuild path, feature disable, no domain-data deletion |

## Rollback

Rollback must:

1. disable Section 3 routes/features through server availability
2. return to the current Section 1/2 shell without changing session or project
   authority
3. stop bounded polling and clear Section 3 caches
4. retain domain and Canonical data
5. retain or rebuild additive projections rather than destructively deleting
   source state
6. revert any adopted OSS through Shotgun-owned component/port boundaries

## Completion Evidence

Section 3 can be proposed for completion only with:

- approved AC and immutable contract snapshot
- approved ADR-115 ownership/cache boundary
- implementation scope and explicit exclusions
- Product API schemas and decoder evidence
- module/port/data ownership evidence
- exact OSS version/commit/license/security/maintenance decisions
- contract, architecture, security-negative, replacement, accessibility,
  performance, and browser E2E results
- migration/rebuild/rollback exercise where persistence is added
- no skipped, ignored, or `continue-on-error` required gates and no unexecuted
  gate reported as passing
- a separate explicit user judgment

Frontend Phase 1 completion additionally requires Sections 1, 2, and 3 to be
implemented, verified, merged, and evidenced. It does not imply Frontend Phase
2 or whole-frontend completion.

## Current Stop State

```text
Canonical normalization: complete within authorized Section 3 wording
Repository gap audit: complete
Candidate acceptance criteria: prepared, unapproved
Candidate implementation plan: prepared, unapproved
Section 3 product implementation: not started
Frontend Phase 1: incomplete
```
