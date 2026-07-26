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
2. The `OUTCOME_UNKNOWN` project-switch correction is explicitly authorized.
3. A new ADR fixes projection-module ownership, persistence, cache revisions,
   update watermarks, and rollback.
4. Placeholder navigation behavior is chosen.
5. Initial snapshot refresh transport is chosen: polling/revalidation or
   refresh events.
6. Pinned-resource presentation ownership is chosen.
7. Representative large-data sets and measurable performance budgets are
   approved.
8. Any adopted OSS has an exact tag/commit, license/security/maintenance
   evidence, lockfile update, contract/replacement tests, and rollback.

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
- `RouteGuardFailureView`
- safe `TargetRouteView` or equivalent registered-route discriminated union

Every response includes an explicit schema version, scope binding, access and
policy revisions, projection revision, and fetch timestamp. Unsupported
versions, unsafe unknown enums, invalid routes, and inconsistent scope fail
closed.

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

| Data                                           | Owner                      | Section 3 usage                        |
| ---------------------------------------------- | -------------------------- | -------------------------------------- |
| Session, principal, membership                 | Auth                       | Read through authorized view           |
| Project metadata/lifecycle                     | Project Administration     | Read safe labels and availability      |
| Settings and policy                            | Settings                   | Read derived feature/readiness policy  |
| Canonical/source/domain resources              | Owning domain modules      | Read typed minimal summaries           |
| Command execution/outcome                      | Owning command modules     | Navigate; never duplicate execution    |
| Shell/action/background/notification snapshots | Candidate projection layer | Derived, revisioned, replaceable       |
| Pin presentation preference                    | User decision pending      | Must not mutate domain/Canonical state |

No OSS type, database identifier, or internal schema becomes a shared
Canonical/Product API identifier.

## Product API Routes

Exact route names are candidate details and must be fixed with the contract.
The route family should support:

```text
GET  /product-api/frontend/shell
GET  /product-api/frontend/home
GET  /product-api/frontend/search
POST /product-api/frontend/notifications/:id/read
POST /product-api/frontend/pins
DELETE /product-api/frontend/pins/:id
```

Constraints:

- `GET` views are server-authorized and revisioned.
- Search uses a structured request and explicit project scope.
- Read/pin mutations use CSRF, same-origin, idempotency where needed, and typed
  outcomes.
- Pinning and notification read state cannot resolve or mutate underlying
  domain truth.
- Routes never trust `X-Project-Id` or equivalent client authority.
- External URLs are not accepted as arbitrary `targetRoute` values.

The route names above are planning placeholders, not approved public contracts.

## Client Routes and Guards

Retain the existing application route tree and add a common guard pipeline:

1. session
2. principal
3. resource existence
4. resource-project binding
5. membership
6. scope/sensitivity
7. feature/navigation availability
8. render

Typed outcomes:

- `SESSION_REQUIRED`
- `BACKEND_UNAVAILABLE`
- `NOT_FOUND`
- `ACCESS_DENIED`
- `PROJECT_UNAVAILABLE`
- `FEATURE_UNAVAILABLE`
- `RESOURCE_RETIRED`

Sensitive existence is masked according to server policy. Deep-link
restoration accepts registered internal routes only and does not change active
project automatically.

## UI Workspaces

### Global Shell

- desktop primary navigation
- tablet navigation rail
- mobile top bar and bottom navigation
- accessible More/drawer/popover overflow
- global project selector
- active/resource project warning
- server navigation availability
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

### Global search and command palette

- Search defaults to active project.
- Cross-project search is explicit and labelled.
- Results preserve type, project, sensitivity-safe highlight, availability, and
  registered target route.
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

Session, at least one accessible project, privacy profile, and
storage/database readiness are candidate required conditions. Optional
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
5. Refresh events carry only safe identifiers/revisions and trigger a snapshot
   fetch; they do not carry authoritative domain payloads.
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

No numeric threshold is approved. Before implementation completion:

1. Approve representative counts for projects, attention items, notifications,
   background jobs, and search results.
2. Approve budgets for API payload, response/render latency, DOM size, cache
   size, and refresh-event bursts.
3. Use server caps and pagination by default.
4. Adopt virtualization only when measurements show a benefit and replacement
   tests cover accessibility, focus, and stable item identity.
5. Prevent unbounded browser storage, DOM growth, polling, and event queues.

## Tests

### Contract

- runtime decoder acceptance/rejection
- schema-version and unknown-enum failure
- scope/revision consistency
- route registry validation
- adapter replacement tests

### Server and integration

- server ranking and stable Action Center identity
- project/global authorization and access revocation
- cache invalidation/revision replay
- notification-read versus domain-resolution separation
- pin preference versus domain/Canonical separation
- snapshot refresh and optional event reconnection/idempotency

### Security negative

- authority-header injection
- cross-project enumeration
- sensitive resource existence masking
- membership and session replacement
- CSRF/same-origin
- open redirect and unsafe deep link
- protected search/notification metadata

### Frontend

- shell view states and server navigation
- non-optimistic project switch
- browser-draft guard and `OUTCOME_UNKNOWN` warning-without-block
- all Home states
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

No dependency installation or lockfile change is part of this plan-preparation
task.

## Migration

No migration is approved or required by the audit itself.

Implementation has two candidate paths:

1. **Coordinator-only initial projection**: construct authorized views from
   existing read ports with explicit watermarks and no new persistence.
2. **Additive projection storage**: add shell/action/background/notification
   snapshot and pin-presentation tables plus outbox consumers when scale,
   history, or stable identity requires it.

The ADR must choose based on consistency, performance, replay, and operational
evidence. Any schema work is forward-only and additive, with dual-read or
rebuild capability as appropriate. Rollback disables new view routes and
reverts the shell to the prior Section 1/2 behavior without deleting domain or
Canonical data.

## Candidate Commit Plan

Each commit must remain independently reviewable and gated:

1. `docs: approve section 3 contracts and architecture decision`
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
| Stale event treated as truth                                   | Events only trigger authorized snapshot fetch                            |
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
3. stop optional refresh subscriptions and clear Section 3 caches
4. retain domain and Canonical data
5. retain or rebuild additive projections rather than destructively deleting
   source state
6. revert any adopted OSS through Shotgun-owned component/port boundaries

## Completion Evidence

Section 3 can be proposed for completion only with:

- approved AC and immutable contract snapshot
- approved ownership/cache ADR
- implementation scope and explicit exclusions
- Product API schemas and decoder evidence
- module/port/data ownership evidence
- exact OSS version/commit/license/security/maintenance decisions
- contract, architecture, security-negative, replacement, accessibility,
  performance, and browser E2E results
- migration/rebuild/rollback exercise where persistence is added
- no skipped or ignored required gates
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
