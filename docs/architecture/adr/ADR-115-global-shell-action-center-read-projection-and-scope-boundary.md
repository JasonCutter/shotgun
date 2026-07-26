# ADR-115 — Global Shell·Action Center Read Projection and Scope Boundary

## Status

Proposed for Frontend Phase 1 Section 3.

User approval and Canonical synchronization are pending. This ADR is a review
candidate and does not authorize product implementation, a database migration,
or a new runtime dependency.

## Context

Frontend Phase 1 Section 3 introduces Global Shell, Home Action Center, global
background and notification summaries, global search, readiness, and typed
route guards. These views combine authorized summaries from several owning
modules. If the browser or Shell reads domain repositories directly, it can
recreate ranking, membership, sensitivity, and availability authority outside
the server boundary.

ADR-101 requires every browser write to use the versioned
`FrontendCommandRequest` contract and server-owned command outcome recovery.
ADR-104 separates active-project Home Attention from explicitly scoped global
feeds and requires running server resources, including `OUTCOME_UNKNOWN`, to
remain bound to their original resource project without blocking a
server-confirmed active-project switch.

The initial Section 3 implementation does not yet have measured evidence that
requires persistent projection tables, a new SSE runtime, list virtualization,
or another UI runtime dependency.

## Proposed Decision

### 1. Initial read projection

- An Application Coordinator composes non-persistent, server-authorized read
  views through replaceable projection and search ports.
- `GlobalShellProjectionPort` owns the derived Shell, navigation, readiness,
  feature availability, and warning snapshot.
- `ActionCenterProjectionPort` owns server-ranked Primary Action, Attention,
  server-resource Continue Working, Recent, and Pinned presentation.
- `BackgroundSummaryProjectionPort` and
  `NotificationSummaryProjectionPort` own separate principal-global summary
  views.
- `GlobalSearchPort` returns typed, authorized resource references. Existing
  Stage 7 search may be reused only through a typed adapter for its owned result
  kinds.
- The Shell and browser do not call domain repositories directly or calculate
  ranking, membership, sensitivity, feature availability, or existence
  masking.

The views own derived snapshots and revisions only. Session, membership,
project, policy, Canonical, source, resource, command, and credential truth
remain with their existing owners.

`HomeActionCenterView` never contains browser drafts. The client presentation
layer reads an allowed local-draft registry into
`BrowserDraftPresentationView` and composes those items as a separately
labelled Continue Working group. It does not insert them into server ranking,
upload them automatically, or reuse stable IDs across origins.

### 2. Initial persistence and migration

- The initial Section 3 implementation adds no projection table and no database
  migration.
- It reads existing authorized query ports and returns views with explicit
  source watermarks, access/policy revisions, and projection revisions.
- Pin and notification presentation state use the existing
  `SettingsRepository` principal-preference boundary. The no-migration decision
  assumes that boundary can store a bounded cursor/watermark representation. If
  it cannot, implementation stops and requests approval for a forward-only
  additive migration; it does not create an unapproved side store.
- Persistent projection storage may be proposed later only after measured
  performance, replay, recovery, or stable-identity requirements justify it.
  That proposal requires a separate ADR and an additive migration with rebuild
  and rollback evidence.

### 3. Snapshot and refresh authority

- A decoded snapshot query is always the authority state.
- Initial refresh mechanisms are TanStack Query focus refetch, explicit user
  refresh, and bounded polling for an approved degraded or operational need.
- Section 3 does not introduce new SSE infrastructure initially.
- A future event stream may only signal invalidation. It cannot carry or replace
  authoritative domain state and requires a separate contract and adoption
  decision.

### 4. Project and global scope

- Home Attention, Primary Actions, Continue Working, Recent, and Pinned views
  default to the active project.
- Global Background and Global Notification use the principal's accessible
  project set or another explicit server-authorized scope.
- Every cross-project item preserves a typed resource reference,
  `resourceProjectId`, and a safe project label.
- Active-project switching invalidates active-project views but does not
  indiscriminately delete still-valid global feeds.
- Membership, capability, sensitivity, policy, accessible-project-set, session,
  or principal changes reauthorize and purge affected project and global
  entries.

### 5. `OUTCOME_UNKNOWN` and Leave Guard

- Browser drafts and blocking dialogs may prevent route or project changes
  under their approved Leave Guard contract.
- A running server resource or `OUTCOME_UNKNOWN` command does not block a
  server-confirmed active-project switch.
- The Shell warns about the persistent operation and preserves its original
  resource-project binding.
- Cancellation, transfer, automatic resubmission, and automatic retry with a
  new key are prohibited.
- Outcome resolution uses the existing command/dedup ledger or expected domain
  resource through `clientRequestId`.

### 6. Presentation writes and ownership

Pinned state is a principal presentation preference owned through the existing
`SettingsRepository` boundary.

Notification read state is also a principal presentation preference owned
through `SettingsRepository`:

```text
Owner: SettingsRepository
Scope: Principal
Resource: notification-presentation-state/self
Write command: notification.presentation.mark-read.v1
Precondition: Principal notification presentation revision
Domain effect: none
```

The write changes only presentation read state. It does not dismiss an
Attention item, resolve a domain problem, or change the underlying
notification-producing resource. `NotificationSummaryProjectionPort` remains a
non-persistent read view over authorized notification summaries and the
principal presentation state; `FrontendCommandGateway` owns command acceptance
and outcome, not the read-state record.

Storage uses a server cursor/read watermark or a bounded exception set with an
explicit retention limit. It does not retain an unbounded row or identifier for
every notification.

The fixed Section 3 command registry entries are:

```text
notification.presentation.mark-read.v1
presentation.pin.upsert.v1
presentation.pin.remove.v1
```

Every browser write uses a complete versioned `FrontendCommandRequest` and
returns a typed `FrontendCommandOutcomeView`. The browser supplies
`clientRequestId` and `idempotencyKey`; it never supplies `commandId`. The
server creates `commandId`, derives accepted authority contexts, computes the
semantic digest, atomically checks typed preconditions, and provides
`clientRequestId`-based `OUTCOME_UNKNOWN` resolution.

### 7. Frontend command project scope

The current `FrontendCommandRequest 1.0.0` requires non-empty
`activeProjectId` and `targetProjectId`, so it cannot express
`project.create.v1` when an authenticated principal has zero projects. Changing
that shape is a breaking contract change. Per ADR-080, implementation adds
`FrontendCommandRequest 2.0.0` alongside the retained 1.0.0 decoder:

```ts
type FrontendProjectContextInputV2 =
  | {
      scope: 'PRINCIPAL';
      activeProjectId?: string;
      observedProjectAccessRevision?: string;
    }
  | {
      scope: 'PROJECT';
      activeProjectId: string;
      targetProjectId: string;
      observedProjectAccessRevision?: string;
    }
  | {
      scope: 'RESOURCE';
      activeProjectId: string;
      targetProjectId: string;
      resourceProjectId: string;
      observedProjectAccessRevision?: string;
    };
```

- `PRINCIPAL` is for principal/bootstrap commands that do not require an
  existing Project, including zero-project `project.create.v1`.
- `PROJECT` is for commands bound to a selected Project.
- `RESOURCE` is for existing-resource commands bound to the Resource Project.
- The server authorizes principal-scoped Project creation through a
  server-derived principal/bootstrap capability, not a browser capability or a
  fabricated Project ID.
- The server records a discriminated accepted project context and returns the
  created Project as a `ProducedResourceRef`.
- Semantic digest, idempotency ledger, outcome lookup, and audit bind to the
  normalized scope and its identifiers. `PRINCIPAL` scope binds to the accepted
  principal and command type without inventing `targetProjectId`.
- Mapping a principal-scoped request to a project-bound internal envelope occurs
  only after the Project Creation Coordinator has accepted the server-owned
  produced Project binding. The browser never supplies internal Kernel
  authority.

The 1.0.0 decoder and behavior remain supported for existing project/resource
commands. Contract tests cover exact-version dispatch, 1.0.0 compatibility,
2.0.0 principal/project/resource validation, semantic digest separation, and
zero-project Project creation.

### 8. Search transport and query protection

Global search is a read query even though it uses an HTTP `POST`:

```text
POST /product-api/frontend/search/query
```

It uses a versioned `GlobalSearchRequest` and a runtime-decoded typed response,
not `FrontendCommandRequest`. The raw query is excluded from URLs, browser
storage, persistent query caches, default request-body logging, and content
telemetry. Telemetry may record only non-content metadata such as query length,
latency, and result count. A cache may use a non-reversible query digest, but it
must not make raw query text recoverable.

### 9. Navigation availability

The server returns exactly these availability values:

```text
AVAILABLE
COMING_LATER
TEMPORARILY_UNAVAILABLE
ACCESS_RESTRICTED
HIDDEN
```

- `AVAILABLE`: navigate to a registered route.
- `COMING_LATER`: show disabled state and reason; never expose a clickable dead
  link.
- `TEMPORARILY_UNAVAILABLE`: show outage or recovery state.
- `ACCESS_RESTRICTED`: render a restricted state only when server visibility
  allows it; otherwise hide it.
- `HIDDEN`: do not expose the item in DOM, search, command palette, or
  notification navigation.

### 10. Server-authoritative route guard

The server evaluates resource existence, resource project, membership, scope,
sensitivity, feature availability, and existence masking and returns a final
`RouteGuardDecisionView`.

The client only verifies its session boundary, runtime-decodes the decision,
and renders the authorized route or typed failure state. It does not calculate
guard authority from independent API results.

### 11. First run with zero projects

A valid authenticated session may have no accessible project. The Shell accepts
this normal view:

```text
SESSION_READY: true
PROJECT_READY: false
activeProject: null
accessibleProjects: []
HomeActionCenter: not queried
```

It renders Project creation onboarding through `/settings/projects`. Zero
projects is not `SESSION_REQUIRED`, `NOT_FOUND`, or `BACKEND_UNAVAILABLE`.

The versioned session contract must also represent this state.
`ProductSessionView 2.0.0` permits `activeProject: null` only when
`accessibleProjects` is empty and readiness reports `PROJECT_READY: false`.
The existing 1.0.0 session decoder remains supported for sessions with an
active Project. Project creation submits `project.create.v1` with
`FrontendCommandRequest 2.0.0` and `scope: 'PRINCIPAL'`; its outcome returns the
created Project as a produced resource, after which the server may establish it
as active through the existing server-authoritative session flow.

### 12. OSS boundary

Existing pinned React Router and TanStack Query integrations remain adopted.
All newly reviewed Section 3 runtime candidates remain `DEFER` for the initial
implementation, including React Aria Components, cmdk, TanStack Virtual, and
fetch-event-source. Reference-only UX sources remain reference-only.

## Performance Gate Timing

Before implementation starts, the plan fixes representative dataset
candidates, server pagination, server caps, the prohibition of unbounded
DOM/storage, and the measurement method. Numeric budgets are not an
implementation entry condition when no baseline exists.

After the relevant behavior exists, implementation records a baseline. Before
completion is proposed, the user approves numeric budgets derived from the
measurements and the final performance gate passes.

## Rejected Alternatives

- **Browser composition of domain counts and permissions**: rejected because it
  duplicates server authority and cannot safely implement existence masking.
- **Persistent projection tables in the initial implementation**: rejected
  until measured performance, replay, recovery, or stable-identity evidence
  justifies the operational cost.
- **New SSE infrastructure in the initial implementation**: rejected because
  snapshot authority with focus refetch, explicit refresh, and bounded polling
  is sufficient for the current contract.
- **Direct pin or notification mutation endpoints without the common command
  contract**: rejected because ADR-101 applies to every browser write.
- **Unbounded per-notification read-state records**: rejected because global
  notification volume requires a bounded cursor/watermark or retained exception
  contract.
- **Browser drafts inside `HomeActionCenterView`**: rejected because local
  drafts are neither server-owned nor server-ranked resources.
- **Fabricated Project IDs for zero-project bootstrap**: rejected because a
  principal-scoped command must not manufacture Project authority in the
  browser.
- **GET search with raw query parameters**: rejected because browser history,
  proxy, access-log, and telemetry exposure conflict with query protection.
- **Client-computed route guards**: rejected because membership, sensitivity,
  and existence masking are server authority.

## Impact Scope

- `packages/contracts`: candidate Section 3 views, search request/response,
  navigation enum, route-guard decision, browser-draft presentation view,
  notification presentation state, `ProductSessionView 2.0.0`, and
  `FrontendCommandRequest 2.0.0` with retained 1.0.0 decoders.
- `assemblies/shotgun-app`: Application Coordinator and Product API routes.
- `packages/shotgun-api-client`: fail-closed runtime decoders and query/command
  methods.
- `apps/shotgun-web`: Global Shell, Home, search, route rendering, cache
  invalidation, and accessibility behavior.
- `modules/settings-policy`: principal Pin and Notification read presentation
  preferences through the existing `SettingsRepository` boundary.
- `modules/frontend-command-gateway`: common write acceptance, deduplication,
  outcome, and recovery.

## Verification Required

- projection-port replacement and architecture dependency tests
- exact-version dispatch, retained 1.0.0 decoders, 2.0.0 session/command
  decoders, and unsupported-version tests
- presentation-write command registry, semantic digest, typed precondition,
  idempotency, and `OUTCOME_UNKNOWN` recovery tests
- principal notification presentation revision, cursor/watermark retention, and
  no-domain-effect tests
- principal/project/resource scope, scope-digest separation, Project creation
  authorization, produced resource, and zero-project E2E tests
- browser-draft local registry validation, separate-group rendering, and
  no-server-ranking/no-upload/no-cross-origin-ID-reuse tests
- search query URL/log/storage/telemetry protection tests
- navigation enum and hidden/existence-masking negative tests
- zero-project session, first-run, Project creation, and active-project
  establishment tests
- server route-guard decision and sensitive-existence tests
- cache scope/revision and session/principal replacement tests
- baseline measurement followed by user-approved numeric performance gates

## Candidate AC Traceability

This proposed ADR supports the unapproved candidate AC set without freezing it:

- AC-01: shared Product API, retained 1.0.0, and discriminated 2.0.0
  principal/project/resource command boundary
- AC-02: five-value server navigation availability
- AC-04–AC-05: active/resource project and `OUTCOME_UNKNOWN` switch behavior
- AC-09: client-layer browser-draft composition outside the server snapshot
- AC-10–AC-12: Pinned/Notification presentation ownership and global summaries
- AC-14: protected POST-based search read query
- AC-16: zero-project session and principal-scoped Project creation
- AC-17: server route-guard decision
- AC-20–AC-21: cache scope and projection ownership
- AC-24: staged baseline and completion-budget timing
- AC-25: required architecture, command, security, cache, and performance gates

## Rollback

- Disable Section 3 feature/navigation availability and return to the Section
  1/2 Shell.
- Stop bounded polling and clear Section 3 query caches.
- Preserve domain, Canonical, command outcome, Pin/Notification Settings
  preferences, and audit data.
- No projection schema rollback is needed for the initial non-persistent
  implementation.
- Any later persistent projection uses its separately approved additive
  migration and rebuild/rollback contract.
