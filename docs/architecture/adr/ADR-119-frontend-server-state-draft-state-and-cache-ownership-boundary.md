# ADR-119 — Frontend Server State, Draft State and Cache Ownership Boundary

## Status

Accepted — 2026-07-28

- Approval actor: User
- Product implementation: Not started / separately unauthorized
- Related ADRs: ADR-103, ADR-114, ADR-116, ADR-118
- Notion temporary Canonical record: https://app.notion.com/p/3ab5181d71ad813285cbd3154108c4a5

## Context

Frontend Phase 1 Section 2 already uses React Query, React Router, route-scoped local state, a Settings Draft Controller, and the server-side Frontend Command Ledger. The current implementation mixes the approved five-dimensional Settings Query Key with ad hoc key arrays, invalidates broader cache regions than required, invents fallback Principal and Project identifiers in some production paths, and combines server cache concerns, pinned command context, draft state, mutation state, outcome recovery, and presentation messages in one Hook.

The first-edit pinning of Active Project, Target Project, Resource Project, Settings Revision, and Policy Context Revision is a required safety contract. It must not be removed or delegated to mutable Query Cache state.

## Decision

### 1. State ownership

- React Query owns authoritative server state and browser-side server cache.
- React Router owns route selection and target context encoded in the URL.
- A route-scoped Draft State Machine owns user edits, dirty state, immutable first-edit context binding, validation state, impact-preview state, and derived recovery state.
- The Frontend Command Ledger owns accepted command identity, idempotency, durable outcome, and outcome recovery.
- Component-local state is limited to presentation concerns such as dialog visibility and temporary selection.

### 2. Draft isolation

- Settings Drafts are not stored in React Query cache.
- Settings Drafts are not persisted to localStorage or another browser store in the Phase 1 Section 2 MVP.
- Background refetch may update server cache but must not overwrite a dirty Draft.
- On Project or Revision drift, the Draft is preserved and becomes `STALE` while the original typed failure cause remains available according to ADR-118.
- Reset discards the Draft binding and returns to the latest authoritative Snapshot.

### 3. Immutable DraftContextBinding

The first edit creates one immutable binding containing at least:

- Principal ID
- Active Project ID, nullable where ADR-116 permits zero-project state
- Target Project ID
- Resource Project ID
- Settings Revision
- Policy Context Revision
- Source Snapshot Query Key

The binding remains fixed until apply completion, explicit reset, or Draft disposal.

### 4. Query Key factory

- All Session, Project Administration, Project Detail, Settings Snapshot, Settings Feature, and Principal Preference queries use typed Query Key factories.
- Ad hoc Query Key arrays in feature workspaces are prohibited.
- Query Keys include every authority dimension required to prevent cross-Principal, cross-Project, or cross-Resource reuse.
- Principal Preferences use a Principal-scoped key and are not forced into a Project Settings key.
- Zero-project state disables Project-bound queries.
- Invented fallback identifiers such as `shotgun` or `principal-a` are prohibited outside explicit test fixtures.

### 5. Cache update and invalidation

- Mutation responses update the exact authoritative Resource cache when possible.
- Only directly affected Queries and projections are invalidated.
- Principal Preference changes do not invalidate all Project Settings.
- Project Policy changes invalidate the affected Project, category, policy-dependent feature views, and conditional capability views.
- Project creation invalidates Project list and, for first-project bootstrap, authoritative Session and Project bootstrap queries.
- Rename, archive, restore, and delete-request operations invalidate the affected Project detail, Project list, and affected Project-scoped Queries.
- Active Project switching continues to use the stricter protected-cache purge boundary from Frontend Section 1.

### 6. Retry and failure behavior

- Mutation automatic retry remains disabled.
- Query retry decisions derive from ADR-118 Failure Descriptors.
- Authentication, authorization, validation, conflict, and unknown failures are not blindly retried.
- `OUTCOME_INDETERMINATE` never resubmits a mutation; it resolves the existing outcome by `clientRequestId`.

### 7. No new global state dependency

Redux, Zustand, or another global client-state dependency is not introduced for this decision. A new global store requires a separately approved need such as cross-route Draft continuation, offline Drafts, multiple concurrent Drafts, or Home Continue Working integration.

## Preserved contracts

- Section 2 AC-07 Draft state
- Section 2 AC-11 Revision conflict and `STALE`
- Section 2 AC-12 Idempotency and `OUTCOME_UNKNOWN`
- Section 2 AC-26 Policy revision and cache invalidation
- ADR-114 repository ownership and command precondition contract
- ADR-116 zero-project and Project bootstrap boundary
- ADR-118 typed failure cause preservation

No AC number or meaning changes.

## Rejected alternatives

- Replacing pinned Draft context with mutable React Query state
- Storing editable Drafts inside Query Cache
- Persisting Phase 1 Drafts in browser storage
- Keeping ad hoc Query Key arrays
- Invalidating all Settings and Project caches after every mutation
- Introducing Redux or Zustand without a proven cross-route workflow requirement

## Impact scope

- `apps/shotgun-web/src/app/query-keys.ts`
- Settings and Project Administration workspaces
- Settings Draft Controller and Leave Guard integration
- Session and Project switching cache boundaries
- API Client typed failure handling under ADR-118
- Contract, unit, integration, and browser tests

## Implementation entry conditions

- Add a pure Draft reducer and transition tests before integrating workspaces.
- Define typed Query Key factories and an exact invalidation matrix.
- Remove invented fallback Principal and Project identifiers from production paths.
- Verify dirty Drafts survive background refetch without silent mutation.
- Verify stale and outcome-unknown transitions preserve ADR-118 typed causes.

This ADR does not authorize Product code, dependency, database migration, PR Ready transition, merge, or Frontend Phase completion.
