# FE-P3-S3 Contract Preparation Verification

- Record ID: `frontend-phase-3-section-3-contract-preparation-verification-260804001`
- Record class: `ARCHITECTURE_VERIFICATION`
- Date: 2026-08-04 (revision 3 — focused correction after `CHANGES_REQUIRED` review)
- Repository: `JasonCutter/shotgun`
- Scope: Frontend Phase 3 Section 3 — Semantic Graph and Relationship Exploration
- Result: **GAP AUDIT / EXACT CONTRACT SNAPSHOT (V1) / AC / ADR-127 PROPOSED / EXECUTABLE IMPLEMENTATION REQUEST COMPLETE — REVISION 3 CORRECTIONS APPLIED**
- Product implementation: **NOT STARTED**
- Canonical authority: GitHub `main`

## 1. Approved work boundary

The user requested completion through:

```text
Start FE-P3-S3 (branch, tracking issue, Draft PR, registry IN_PROGRESS, projections)
→ Audit existing assets (preparation only)
→ Gap Audit
→ Contract precision (exact V1 typed graph model, normalized semantic axes,
   base-view/overlay separation, every read operation frozen)
→ Projection/persistence decision (hybrid) + ADR re-evaluation
→ Security/scope hardening
→ Objective Acceptance Criteria (FE-P3-S3-AC-01 …)
→ Executable Implementation Request
→ Evidence, verification and publication
```

The request did not authorize Product implementation, Canonical graph writes,
graph relation editing, automatic Entity merge, Review decisions, Approval,
Canonical Commit, User Directive Proposal implementation, external Action
execution, FE-P4, Yjs/CRDT, new runtime dependencies, deployment or production
verification.

## 2. Prepared records

- Gap Audit:
  `docs/engineering/frontend-phase-3-section-3-semantic-graph-gap-audit-260804001.md`
- Contract Snapshot:
  `docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`
- Implementation Request:
  `docs/implementation/frontend-phase-3-section-3-implementation-request-260804001.md`
- This Preparation Verification record.
- Registry update: `docs/project/frontend-work-items.json` — `FE-P3-S3` set to
  `IN_PROGRESS`; `FE-P3` remains `IN_PROGRESS`.
- Regenerated status projections (generator): `docs/architecture/frontend/README.md`,
  `docs/architecture/frontend/phase-2-knowledge-input-question.md`,
  `docs/implementation/frontend-phase-1-5-plan-v1.0.md`,
  `docs/architecture/add/README.md`.

## 3. ADR boundary decision (revision 2)

Decision: **NEW_PROPOSED_ADR_REQUIRED — ADR-127**.

ADR-108 (Typed Semantic Graph Projection with Accessible Fallback) governs the
typed read surface and accessible fallback. The selected **explicit hybrid**
persistence model (ephemeral base-view snapshots + materialized
projection-health registry + persisted overlay health/identity + server-side
expiring continuation tokens, migration 026) is a genuinely new server-side
architecture decision not covered by ADR-106/ADR-107/ADR-119/ADR-124.

ADR-127 (`Semantic Graph Projection Read Persistence, Health and Continuation
Boundary`) is created as **PROPOSED** (not accepted) and records the exact user
decision required. Blocked Acceptance Criteria until acceptance: AC-13, AC-16,
AC-27, AC-31.

## 4. Contract snapshot status (revision 2)

The Contract Snapshot is a `PROPOSED_PENDING_USER_REVIEW` proposal, revision 2.
It preserves ADR-108 and freezes:

- **A — Exact V1 typed graph model**: snapshot identity/response, node/edge
  references and payloads, provenance/evidence/temporal/revision/access,
  projection health, result completeness, traversal and applied limits,
  continuation identity, overlay identity, neighborhood/path results,
  capabilities and unavailable reasons, with strict-decoder rules
  (`schemaVersion: '1.0.0'`, unknown-field rejection, non-empty IDs, exhaustive
  unions, no `any`).
- **B — Normalized semantic axes**: nine orthogonal axes and the projection
  mapping; Relation as edges + optional reified RELATION nodes with stable
  `relationId`+`qualifier` identity.
- **C — Base views and overlays**: `KNOWLEDGE_SEMANTIC`/`GOVERNANCE_IMPACT`/
  `OPERATIONAL_DEPENDENCY` base views; `CONFLICT`/`KNOWLEDGE_GAP`/
  `RECURSIVE_IMPACT` overlays; composition, revision ownership, cache identity,
  removal, `ACTION_CANDIDATE` exclusion.
- **D — Ten read operations** frozen with routes, client methods, scope,
  revisions, limits, continuation, cancellation, failures.
- **E — Projection/persistence**: explicit hybrid + migration 026 + ADR-127.
- **F — Security/scope hardening**: `DISCLOSABLE_MASKED` vs `FULLY_HIDDEN`,
  cross-Project deep links, two-phase cache keys.
- **G — Objective Acceptance Criteria**: `FE-P3-S3-AC-01` through
  `FE-P3-S3-AC-31` with exact measurable evidence; ambiguous wording removed.

None are marked passed; Product implementation remains `NOT_AUTHORIZED`.

## 5. Gap audit result (revision 2)

The audit confirms existing reusable assets (Canonical knowledge, Stage 9 graph
and impact queries, NetworkX oracle, Compiled Truth status, `FrontendReadScope`,
protected routes, typed clients, scope-aware cache keys, accessibility
primitives, Knowledge UI components, test infrastructure) and documents the
missing Product surface (graph snapshot/overlay contracts, `/knowledge/graph`
route, Cytoscape integration, graph projection reads, accessible fallback,
security/performance controls), now normalized into nine semantic axes and a
hybrid persistence decision requiring ADR-127. See the Gap Audit for the full
reuse/classification inventory and the 15 risk evaluations.

## 6. Focused checks

Run while editing (results in the PR body and this record):

- `npm run docs:validate`
- `npm run docs:frontend-work-items`
- `npm run docs:completion-invariants`
- `npm run docs:frontend-projections:check`
- `npx prettier --check <changed-files>`
- `git diff --check`

Full gate: `npm run check` — exit code reported in the PR body and the final
report; the redirected log is not committed.

## 6a. Revision 3 focused corrections

The `CHANGES_REQUIRED` review identified five blocking items. All five are
resolved in the Contract Snapshot revision 3, ADR-127 revision 2 and
Implementation Request revision 3:

1. **Authority axis** reduced to pure authority/provenance lineage
   (`CANONICAL | DERIVED_INFERENCE | DISCOVERY_CANDIDATE`); edge semantic,
   resource, conflict/gap and overlay meanings stay on their own axes.
2. **Exact request/response/failure contracts** for all ten operations frozen in
   snapshot D.1, with cross-field invariants in D.2 (numeric ranges, truncation
   binding, path edge binding, node-kind binding, masking payload binding,
   applied-limits binding, continuation request union, revision binding).
3. **Snapshot restoration** resolved with an immutable snapshot-context
   descriptor store (migration 026 adds
   `frontend_knowledge_graph_snapshot_context`); subsequent operations resolve
   `snapshotId` → descriptor and reconstruct the identical computation.
4. **Base-view terminology** unified on `GraphBaseViewKindV1`; `GraphViewKindV1`
   removed; D2 no longer calls governance/operational base views "overlays".
5. **`ACTION_CANDIDATE` fully excluded** from FE-P3-S3 (no resource kind,
   payload or authority value); rendering deferred to FE-P4.

## 7. Governance status

- Tracking issue: [#58](https://github.com/JasonCutter/shotgun/issues/58)
- Draft PR: [#59](https://github.com/JasonCutter/shotgun/pull/59) — OPEN and DRAFT.
- Proposed ADR: ADR-127 — PROPOSED, not accepted; blocked AC-13, AC-16, AC-27, AC-31.
- `FE-P3-S3` is `IN_PROGRESS`; `FE-P3` remains `IN_PROGRESS`.
- `FE-P3-S3` is **not** marked `COMPLETE`.
- All Product ACs remain `NOT_RUN`.
- No Ready, Merge, deployment, FE-P4 or Product implementation work was started.
