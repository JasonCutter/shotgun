# Project Shotgun Contract Snapshot Registry

## Purpose

This directory governs non-ADR Contract Snapshots and revisions. Snapshot files are immutable historical records; their effective status is expressed through `contract-snapshot-registry.json` rather than by overwriting the original text.

## Classification model

- `ACTIVE_STANDALONE_REVISION`: approved current contract that does not depend on another Git Snapshot.
- `ACTIVE_BASE`: approved base Snapshot whose unchanged content remains effective.
- `ACTIVE_ADDITIVE_AMENDMENT`: approved revision applied on top of a named base without replacing the base as a whole.
- `SUPERSEDED`: retained record whose defined scope was replaced by a later approved record.
- `DUPLICATE_REFERENCE`: non-owner copy that adds no independent approved meaning.
- `HISTORICAL`: retained evidence that is no longer part of the effective contract.

## Registered records

- [Frontend Phase 1 Section 2 State and Cache Ownership Revision](snapshots/frontend-phase-1-section-2/frontend-phase-1-section-2-state-cache-ownership-revision-260728001.md)
- [Frontend Phase 1 Section 3 Contract Snapshot](snapshots/frontend-phase-1-section-3/frontend-phase-1-section-3-contract-snapshot-260726001.md)
- [Frontend Phase 1 Section 3 Persistence Contract Revision](snapshots/frontend-phase-1-section-3/frontend-phase-1-section-3-persistence-contract-revision-260728001.md)
- [Frontend Phase 2 Section 1 Sources Workspace Contract Snapshot](snapshots/frontend-phase-2-section-1/frontend-phase-2-section-1-contract-snapshot-260730001.md)
- Machine-readable lineage: [`contract-snapshot-registry.json`](contract-snapshot-registry.json)

## Effective-contract rule

An effective contract can be composed from multiple immutable records. A later revision does not automatically supersede its base. Supersession requires explicit scope, reason, approval and a `supersedes` relationship.

For Frontend Phase 1 Section 3, the effective contract is:

```text
frontend-phase-1-section-3-contract-snapshot-260726001
+ frontend-phase-1-section-3-persistence-contract-revision-260728001
```

The persistence revision explicitly preserves AC-01–AC-27 and adds implementable persistence/bootstrap detail. Therefore the base remains active and the revision is an additive amendment, not a duplicate replacement.

For Frontend Phase 2 Section 1, the effective contract is the standalone active base:

```text
frontend-phase-2-section-1-contract-snapshot-260730001
```

It freezes AC-01–AC-32 for Sources Workspace. Product implementation, Migration execution, Runtime Dependency addition, Ready transition and merge remain separate approval states.

## Change control

1. Do not edit an approved Snapshot to incorporate later decisions.
2. Create a new revision with a stable identifier and explicit base or supersession relation.
3. Record approval, source PR and effective order in the Registry.
4. A title or topic overlap is not sufficient to classify a duplicate.
5. Product implementation status is separate from Contract approval status.
6. `npm run docs:validate` verifies the registered Markdown paths through repository-relative links.

## Current result

Four approved non-ADR Snapshot records are registered. No duplicate Snapshot owner, whole-record supersession or unresolved authority conflict is present.
