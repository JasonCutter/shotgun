## FE-P3-S3 — Semantic Graph and Relationship Exploration (Contract Preparation, revision 2)

Tracking issue: #58

This Draft PR revises the FE-P3-S3 contract preparation to exact V1 contracts, normalized semantic axes, base-view/overlay separation, frozen read operations, a hybrid projection/persistence decision and an executable implementation request. It does **not** start Product implementation, Canonical graph writes, relation editing, Entity merge, Review/Approval, Action execution, FE-P4, Yjs/CRDT, new runtime dependencies, deployment or production verification.

### Prepared artifacts (revision 2)
- Gap Audit: `docs/engineering/frontend-phase-3-section-3-semantic-graph-gap-audit-260804001.md`
- Contract Snapshot (revision 2, exact V1): `docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`
- Implementation Request (revision 2, executable one-round): `docs/implementation/frontend-phase-3-section-3-implementation-request-260804001.md`
- Preparation Verification (revision 2): `docs/engineering/frontend-phase-3-section-3-contract-preparation-verification-260804001.md`
- Proposed ADR-127 (PROPOSED, not accepted): `docs/architecture/adr/ADR-127-semantic-graph-projection-read-persistence-health-and-continuation-boundary.md`
- Registries: `docs/architecture/adr/adr-registry.json` (1-127), `docs/architecture/frontend/adr-index.md`, `docs/engineering/evidence-registry.json`
- Registry status: `FE-P3-S3` remains `IN_PROGRESS`; `FE-P3` remains `IN_PROGRESS`

### What changed
- **A — Exact typed graph model**: all types frozen as exact V1 contracts with `schemaVersion: '1.0.0'`, unknown-field rejection, non-empty-ID validation, exhaustive unions, no `any`. No illustrative or implementation-defined types remain.
- **B — Normalized semantic axes**: nine orthogonal axes (resource/node kind; edge semantic kind; authority classification; base-view membership; overlay membership; projection health; result completeness; access/masking; traversal-relative direction) plus the projection mapping; Relation is an edge + optional reified RELATION node with stable `relationId`+`qualifier` identity; edge semantic kinds are never used as node authority classifications; no intrinsic INCOMING/OUTGOING.
- **C — Base views and overlays**: `KNOWLEDGE_SEMANTIC`/`GOVERNANCE_IMPACT`/`OPERATIONAL_DEPENDENCY` base views; `CONFLICT`/`KNOWLEDGE_GAP`/`RECURSIVE_IMPACT` overlays; exact composition, revision ownership, cache identity, removal and `ACTION_CANDIDATE` exclusion rules.
- **D — Every read operation frozen**: ten operations with routes, client methods, scope, revision identity, applied limits, continuation, cancellation and typed failures.
- **E — Projection/persistence decision**: explicit hybrid (ephemeral base snapshots + materialized projection-health registry + persisted overlay health + server-side expiring continuation tokens) with migration 026; ADR re-evaluated.
- **F — Security/scope hardening**: `DISCLOSABLE_MASKED` vs `FULLY_HIDDEN`; counts/truncation exclude hidden resources; cross-Project deep links never silently replace the Active Project; two-phase cache keys.
- **G — Objective Acceptance Criteria**: `FE-P3-S3-AC-01` through `FE-P3-S3-AC-31`, all `NOT_RUN`, with exact measurable evidence requirements; ambiguous wording removed.
- **H — Executable implementation request**: exact branch/base, contract/decoder files, Port/Adapter boundaries, route and client names, migration 026, React/Cytoscape boundaries, accessible fallback components, negative-test matrix, focused-test commands by work package, final redirected `npm run check`, final push and exact-head CI, completion report fields, explicit exclusions.

### ADR decision
`NEW_PROPOSED_ADR_REQUIRED` — **ADR-127** created as PROPOSED (not accepted). The hybrid persistence model is a genuinely new server-side decision not covered by existing accepted ADRs. Blocked criteria until acceptance: AC-13, AC-16, AC-27, AC-31.

### Evidence
- Focused checks: `docs:validate`, `docs:frontend-work-items`, `docs:completion-invariants`, `docs:frontend-projections:check` — PASS (ADR identifiers 1-127)
- `npx prettier --check` on all changed files — PASS
- `git diff --check` — PASS
- Full gate `npm run check`: exit 0 (log redirected, not committed)
- Automatic CI run **#451** (run 30830727883) at exact head `2404516ecf01d6e8899cd3f1432a556610448b04`: **success** — Quality, Frontend and Required Gates all green

### Status
- PR remains **OPEN and DRAFT**.
- `FE-P3-S3` is `IN_PROGRESS` and is **not** marked `COMPLETE`.
- All Product ACs remain `NOT_RUN`; Product implementation is **not authorized** and not started; no Ready/Merge/deployment/FE-P4 work was started.
