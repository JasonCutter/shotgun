# Frontend Work Item Registry Migration Decision

- Decision status: **MIGRATED**
- Decision ID: `frontend-canonical-roadmap-migration-260801001`
- Decision date: 2026-08-01
- Scope: existing official Frontend Phase, Section, and Increment identities
- Governing ADR: `docs/architecture/adr/ADR-124-frontend-work-item-identity-scope-amendment-and-completion-authority-boundary.md`

## Decision

The existing official Frontend roadmap identities are migrated into
`docs/project/frontend-work-items.json`. This is a bounded identity migration,
not acceptance of ADR-124 and not approval of any unfinished Product scope.

The migrated set is closed in the governance validator. A new Phase, Section, or
Increment must use a separately accepted decision or remain a `CANDIDATE` with
`NOT_STARTED` status; adding a row to the Registry alone cannot authorize work.

## Preserved boundaries

- `FE-P2-S2` remains `IN_PROGRESS`.
- Answer Execution, failure and retry, and final Section verification remain
  unresolved Section scope.
- ADR-124 was Proposed/Candidate when this migration decision was recorded; it is now Accepted by the user on 2026-08-01.
- No Product code, runtime dependency, database migration, PR readiness, or
  merge authorization is created by this migration.
