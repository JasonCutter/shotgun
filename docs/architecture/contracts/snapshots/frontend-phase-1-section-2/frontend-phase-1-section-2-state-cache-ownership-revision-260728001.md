# Frontend Phase 1 Section 2 — State and Cache Ownership Contract Revision

## Status

Approved and frozen — 2026-07-28

- Approval actor: User
- Related ADR: ADR-119
- Product implementation: Not started / separately unauthorized
- Notion temporary Canonical record: https://app.notion.com/p/3ab5181d71ad81f6bbc0eb0a8488e2d7

## Revision purpose

This revision clarifies the implementation structure for the already-approved Frontend Phase 1 Section 2 acceptance criteria. It does not create, renumber, remove, or change the meaning of AC-01 through AC-30.

## Frozen ownership matrix

| State | Authoritative owner |
| --- | --- |
| Session, Project list, Project detail, Settings Snapshot, feature views | React Query server cache |
| Selected route and target context | React Router |
| User edits, dirty state, pinned Project and Revision context | Route-scoped Draft State Machine |
| Accepted command, idempotency and durable outcome | Frontend Command Ledger |
| Dialog and temporary presentation state | Component-local state |

## Draft contract

- The first edit pins Principal, Active Project, Target Project, Resource Project, Settings Revision, Policy Context Revision, and source Snapshot Query Key.
- The pinned context is immutable for the lifetime of the Draft.
- Background refetch may refresh Query Cache but cannot overwrite a dirty Draft.
- Project or Revision drift preserves the Draft and derives `STALE` while preserving the original typed failure cause.
- `OUTCOME_INDETERMINATE` derives `OUTCOME_UNKNOWN` and resolves the existing command by `clientRequestId` without automatic resubmission.
- Reset releases the binding and resumes the latest authoritative Snapshot.
- Phase 1 Section 2 does not persist Drafts outside the route, restore them after reload, or include them in Home Continue Working.

## Query and cache contract

- All production Queries use typed Query Key factories.
- Settings keys include the authority dimensions required by the request: Principal, Target Project, Resource Project, category or feature, and revision or resource identity where applicable.
- Principal Preferences use a Principal-scoped key.
- Project-bound Queries are disabled when no valid Project context exists.
- Production code must not invent fallback identifiers such as `shotgun` or `principal-a`.
- Mutation results update exact authoritative cache entries where possible.
- Invalidation is limited to directly affected resources and projections.
- Active Project switching retains the stricter protected-cache purge contract from Frontend Phase 1 Section 1.

## Invalidation matrix

| Mutation | Exact cache update | Invalidate |
| --- | --- | --- |
| Principal Preference update | Principal Preference resource | Related Principal preference projections only |
| Project Policy update | Affected Settings Snapshot or returned resource | Affected category, Project policy feature views, conditional capability views |
| Project creation | Returned Project resource where applicable | Project list; first-project bootstrap also Session and Project bootstrap queries |
| Project rename | Project detail | Project list and affected Project views |
| Project archive or restore | Project detail | Project list and affected Project-scoped queries |
| Project delete request | Project detail | Project list and affected Project-scoped queries |
| Active Project switch | Authoritative Session | Remove inaccessible protected caches according to Section 1 |

## Retry contract

- Mutation automatic retry is disabled.
- Query retry follows ADR-118 typed Failure Descriptors.
- Authentication, authorization, validation, conflict, and unknown failures are not blindly retried.
- Outcome-indeterminate writes are recovered, not resubmitted.

## Preserved acceptance criteria

- **AC-07:** Draft state
- **AC-11:** Revision conflict and `STALE`
- **AC-12:** Idempotency and `OUTCOME_UNKNOWN`
- **AC-26:** Policy revision and cache invalidation

All other AC-01 through AC-30 remain unchanged.

## Required verification

1. Production paths contain no invented fallback Principal or Project IDs.
2. Project-bound Queries do not execute for a zero-project Session.
3. All Settings and Project queries use typed Query Key factories.
4. Cache data cannot cross Principal, Target Project, or Resource Project authority boundaries.
5. Background refetch does not overwrite a dirty Draft.
6. Revision or Project drift preserves the Draft and enters `STALE`.
7. Reset returns to the latest authoritative Snapshot.
8. Mutation success updates or invalidates only the affected resources and projections.
9. Active Project switch removes inaccessible protected caches.
10. `OUTCOME_INDETERMINATE` does not resubmit the mutation.
11. Drafts are not restored outside the route or after reload.
12. ADR-118 typed failure cause is preserved independently from derived Frontend state.

## Explicit non-scope

- No Product TypeScript or React Query configuration change
- No Redux, Zustand, or new runtime dependency
- No browser Draft persistence
- No database migration
- No AC renumbering or meaning change
- No PR Ready transition, merge, Section 2 reopening, or Frontend Phase completion declaration