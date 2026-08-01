# ADR-124 — Frontend Work Item Identity, Scope Amendment, and Completion Authority Boundary

- Status: **Proposed / Candidate**
- Proposal date: 2026-08-01
- Approved by: not yet approved
- Scope: Frontend Phase and Section planning, status projection, completion claims, and correction records
- Supersedes: none
- Related ADRs: ADR-113, ADR-117, ADR-120, ADR-121, ADR-123

## Context

Frontend status was repeated manually across architecture, implementation, ADD, and completion documents. PR #48 validly delivered and verified the Ask read, command, persistence, and outcome-recovery increments. A later record treated those increments as the completion authority for the whole Section and referred to a nonexistent follow-on Section. The original Section contract still contains mandatory Answer Execution, streaming, cancel, retry, export, feedback, transition, and final verification scope.

The repository needs one machine-readable identity and status authority that preserves historical records while preventing a child increment, a narrow frozen contract, or a prose edit from silently completing its parent Section.

## Proposed decision

### 1. Stable Work Item identity

`docs/project/frontend-work-items.json` is the proposed Canonical registry for Frontend Phase, Section, and named Increment identity. Registered identifiers are stable. A Section or Increment that is absent from the registry does not exist as an active Product work item.

The Section chain is explicit through reciprocal `predecessor` and `successor` links. The successor of `FE-P2-S2` is `FE-P3-S1`; no intermediate Section is defined.

### 2. Section completion authority

A Section may be `COMPLETE` only when:

1. its completion manifest exists;
2. every mandatory criterion is `PASS`, or an explicit approved Scope Amendment changes the criterion before completion;
3. required architecture, implementation, verification, and Evidence Registry updates exist;
4. final Section verification is `PASS`;
5. the required approval and Git merge boundary is satisfied.

An Increment can be `COMPLETE` while its parent Section remains `IN_PROGRESS`. Child completion never promotes the parent by inference.

### 3. Scope Amendment boundary

Omitted or excluded contract scope must reference a registered Work Item or governed Backlog identifier. It cannot be silently moved to “later” or treated as complete.

Remaining Section scope is recorded as `remainingScope` and cannot be treated as excluded completion scope. Removing, deferring, splitting, or changing a mandatory Section criterion requires an approved Scope Amendment that records the decision document, affected criteria, rationale, successor ownership, migration and rollback impact, and approval metadata. `excludedScope` is reserved for entries with that approved amendment; a proposed or missing amendment has no completion effect.

### 4. Projection ownership

Architecture summaries, implementation plans, and ADD status summaries are projections from the Work Item Registry and completion manifests. Only bounded machine-managed blocks are generated. Handwritten decisions and historical evidence remain human-authored and are never overwritten by the generator.

Projection drift and invalid active-plan references fail CI.

### 5. Correction without history rewriting

PR #48 and PR #49 remain part of repository history. The narrow implementation and its evidence remain valid. The premature parent-completion interpretation is corrected by a new durable reconciliation record and a supersession/correction note. Pull request bodies, commits, and historical evidence are not rewritten or deleted.

## Current reconciliation represented by this proposal

- `FE-P2-S1`: `COMPLETE`
- `FE-P2-S2`: `IN_PROGRESS`
- `FE-P2-S2-I01` Read Foundation: `COMPLETE`
- `FE-P2-S2-I02` Command and Persistence: `COMPLETE`
- `FE-P2-S2-I03` Answer Execution and remaining Section contract: `NOT_STARTED`
- Frontend Phase 2: `IN_PROGRESS`
- next valid Product Section after `FE-P2-S2`: `FE-P3-S1`

This is a documentation-governance correction only. It does not modify Product code, runtime behavior, database schema, or implementation authorization.

## Enforcement

```text
npm run docs:frontend-work-items
npm run docs:completion-invariants
npm run docs:frontend-projections:check
```

The gates validate the registry schema and decision status, ID/type and parent relationships, reciprocal ordering, one active Phase and Section, phase/section status derivation, completion-manifest invariants, remaining/excluded-scope ownership, Increment Evidence Registry updates, and generated projection drift. Existing official roadmap items are marked by the closed `frontend-canonical-roadmap-migration-260801001` migration decision. Only those migrated items may use the legacy Markdown completion-evidence path; every newly introduced completed Section requires a JSON Completion Manifest. Regression tests preserve each failure mode.

## OSS integration decision

`NO_RELEVANT_OSS`. This change is repository-specific governance over existing JSON, Markdown, TypeScript, Ajv, Prettier, and CI facilities. No new runtime dependency, external generator, database migration, or OSS adapter is introduced.

## Migration and rollback

Migration is additive: register existing official Work Items, add one Section manifest, replace only bounded status summaries with generated blocks, and retain historical documents.

Rollback is a Git revert of this governance change. A rollback must not revive the corrected parent-completion claim as current authority; any replacement must preserve the reconciliation record and establish a new explicit status authority.

## Approval boundary

This ADR remains Proposed/Candidate until explicit user approval and merge to `main`. Its presence does not approve the remaining Section 2 scope, mark Section 2 or Phase 2 complete, authorize Phase 3 implementation, make a pull request Ready, or authorize merge.
