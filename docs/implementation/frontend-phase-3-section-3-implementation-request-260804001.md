---
id: FRONTEND-PHASE-3-SECTION-3-IMPLEMENTATION-REQUEST-260804001
classification: IMPLEMENTATION_REQUEST_PROPOSAL
status: PENDING_USER_APPROVAL
revision: 4
review_round: 3
contract_basis_status: CONTRACT_SNAPSHOT_PROPOSED
contract_basis_commit: 69cd0f0ccc03ba487b954b8f8f53fb1f54d2e9ab
contract_snapshot_revision: 4
work_item: FE-P3-S3
governing_adr: ADR-108
proposed_adr: ADR-127
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md
implementation_authorized: false
approved_by: null
approved_at: null
branch: codex/frontend-phase-3-section-3-contract-preparation
---

# FE-P3-S3 Implementation Request (Executable One-Round Instruction)

This document is the executable implementation request for FE-P3-S3 — Semantic
Graph and Relationship Exploration. It is **not yet approved** and must not be
executed. After user approval it is intended to run as **one large
implementation round**.

The request is bounded by the frozen Contract Snapshot revision 3
(`docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`),
ADR-108, proposed ADR-127, and the Gap Audit
(`docs/engineering/frontend-phase-3-section-3-semantic-graph-gap-audit-260804001.md`).
Implementation must not make architectural choices that belong in the frozen
contract; every request/response/failure type is already frozen in snapshot
sections D.1/D.2 and must be implemented as written.

## 0. Branch and base assumptions

- Repository: `JasonCutter/shotgun`
- Base: `main` at the exact head approved at implementation start (recorded in
  the completion report).
- Target branch: `codex/frontend-phase-3-section-3-implementation` (created from
  the approved base).
- PR: new Draft PR linked to issue #58; keep OPEN and DRAFT until separate
  authorization.
- ADR-127 must be accepted (or replaced by an approved alternative model) before
  WP1 persistence work; blocked AC-13, AC-16, AC-27, AC-31.

## 1. Contract and decoder files

Create exact V1 contracts and strict decoders in:

- `packages/contracts/src/frontend-knowledge-graph.ts` — every shape frozen in
  Contract Snapshot sections 3 and D.1 (`GraphSnapshotIdentityV1`, `GraphNodeV1`,
  `GraphEdgeV1`, references, payloads, provenance, evidence, temporal, revision
  binding, access/masking, projection health, result completeness, traversal and
  applied limits, continuation identity, overlay identity, neighborhood/path
  results, capabilities, unavailable reasons, `GraphOperationFailureV1`, and the
  exact ten request/response contract pairs and their cross-field invariants
  from D.2).
- Decoder rules: `schemaVersion: '1.0.0'`, unknown-field rejection, non-empty-ID
  validation, exhaustive unions, no `any`, plus every cross-field invariant in
  D.2 (numeric ranges, truncation binding, path edge binding, node-kind
  binding, masking payload binding, applied-limits binding, continuation request
  union, revision binding). Negative decode tests accompany every shape and
  invariant.
- `packages/contracts/src/frontend-knowledge-graph-failures.ts` — typed failure
  mapping for every `GraphUnavailableReasonV1` using the shared typed-failure
  taxonomy.
- Reuse frozen value types from `frontend-knowledge-draft.ts` and
  `knowledge-model.ts` as payloads; do not duplicate or widen them.

## 2. Ports and Adapter boundaries

- `modules/frontend-knowledge-graph/src/graph-read-port.ts` — `GraphReadPort`
  (snapshot, neighborhood, path, evidence detail) and `GraphImpactPort`
  (recursive impact). Server-derived `FrontendReadScope` is the input authority.
- `modules/frontend-knowledge-graph/src/snapshot-context-store-port.ts` —
  `SnapshotContextStorePort`: write the immutable snapshot-context descriptor
  (including the normalized `GraphFilterSetV1` and `filtersDigest`), resolve
  `snapshotId` → descriptor, and enforce `expiresAt` TTL.
- `modules/frontend-knowledge-graph/src/health-store-port.ts` — projection
  health, overlay health, continuation store ports.
- Adapters:
  - `adapters/frontend-knowledge-graph-in-memory/` — in-memory snapshot-context
    store, health/overlay/continuation stores.
  - `adapters/frontend-knowledge-graph-postgres/` — PostgreSQL snapshot-context
    store, health/overlay/continuation stores (migration 026).
  - `adapters/stage9-graph-read/` — adapts Stage 9 `GetKnowledgeGraph`/
    `GetKnowledgeImpact` behind `GraphReadPort`/`GraphImpactPort`.
  - `adapters/networkx-impact-oracle/` — reuse behind `GraphImpactPort` (no
    Stage 9 or NetworkX identifiers exposed as FE-P3-S3 Canonical IDs).

## 3. Routes and client names

- `assemblies/shotgun-app/src/product-api/frontend-knowledge-graph-routes.ts` —
  the ten POST routes frozen in Contract Snapshot section 6
  (`/product-api/frontend/knowledge/graph/snapshot`, `/neighborhood`, `/path`,
  `/path/describe`, `/overlay/conflict`, `/overlay/gap`, `/overlay/impact`,
  `/evidence`, `/snapshot/refresh`, `/restore`) with the existing
  guard/CSRF/decoder pattern.
- `packages/shotgun-api-client/src/frontend-knowledge-graph-client.ts` —
  `FrontendKnowledgeGraphClient` with the ten typed methods
  (`getGraphSnapshot`, `expandGraphNeighborhood`, `findGraphPath`,
  `describeGraphPath`, `getConflictOverlay`, `getKnowledgeGapOverlay`,
  `getRecursiveImpactOverlay`, `getGraphEvidenceDetail`, `refreshGraphSnapshot`,
  `restoreGraphDeepLink`), each with strict identity validation and
  `AbortSignal`.
- `apps/shotgun-web/src/knowledge/graph-queries.ts` — scope-phase and
  snapshot-phase cache keys per Contract Snapshot F.3.

## 4. Migration and persistence work

- Migration `db/migrations/026_frontend_knowledge_graph_projection.sql`:
  `frontend_knowledge_graph_snapshot_context` (immutable descriptor — no graph
  items — storing the normalized `GraphFilterSetV1` payload plus
  `filtersDigest`), `frontend_knowledge_graph_projection_health`,
  `frontend_knowledge_graph_overlay_health`,
  `frontend_knowledge_graph_continuation` (Project-scoped, revision-bound,
  TTL-expiring continuation rows, immutability rules per snapshot-context and
  health row).
- The snapshot-context store is the restoration mechanism for subsequent
  operations (snapshotId → descriptor → identical computation, using the
  stored normalized filters); unknown or expired descriptors return
  `SNAPSHOT_STALE`/`DEEP_LINK_TARGET_UNAVAILABLE`.
- In-memory and PostgreSQL adapters must pass the parity suite for the four
  storage adapters (snapshot-context, projection health, overlay health,
  continuation) over the defined scenario set (AC-27).
- Overlay items are never persisted as Canonical edges.

## 5. React and Cytoscape boundaries

- `apps/shotgun-web/src/routes/graph-workspace.tsx` — `/knowledge/graph` guarded
  route, base-view and overlay selection, deep-link restoration, failure states.
- `apps/shotgun-web/src/knowledge/graph-workspace-state.ts` — browser state
  machine (ADR-119 ownership): selection, focus, filters, overlays, recovery;
  no graph write.
- `apps/shotgun-web/src/knowledge/graph-canvas.tsx` — Cytoscape presentation
  adapter (canvas rendering and layout only; coordinates/zoom/pan never sent as
  authority).
- React Query owns read caching only; layout state never leaves the browser.

## 6. Accessible fallback components

- `apps/shotgun-web/src/knowledge/graph-list-view.tsx` (list),
  `graph-table-view.tsx` (table), `graph-path-view.tsx` (path description).
- Information equivalence per AC-19: the four views expose the identical set of
  accessible `(nodeId, edgeId, label, authority, baseViewMembership,
overlayMemberships)` tuples from the same snapshot response.
- Exact keyboard set (AC-20), frozen announcement strings (AC-21), reduced
  motion and 200% zoom (AC-22).

## 7. Negative-test matrix

| Area                    | Negative test                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decoders                | unknown field, empty ID, unknown discriminant, missing `schemaVersion`                                                                                              |
| Scope                   | forged Project/policy/access/revision values rejected                                                                                                               |
| Traversal               | over-cap limits clamped (`clamped: true`) and truncation explicit                                                                                                   |
| Continuation            | expired/mismatched binding token → `CONTINUATION_EXPIRED`                                                                                                           |
| Hidden resources        | hidden nodes/edges absent from counts, paths, neighborhoods, truncation                                                                                             |
| Cross-Project deep link | root outside Active Project → `ACCESS_RESTRICTED`, no silent switch                                                                                                 |
| Overlay                 | any `ACTION_CANDIDATE` discriminator rejected (no such resource kind/payload/authority exists); overlay without base view rejected; duplicate overlay kind rejected |
| Writes                  | no Canonical/Approval/Action write endpoint reachable from the Graph Workspace                                                                                      |
| Recovery                | no write issued during any graph-read recovery                                                                                                                      |

## 8. Focused-test commands by work package

- **WP1** (contracts, domain, adapters, routes, client):
  `npx vitest run tests/contract/frontend-knowledge-graph.contract.test.ts tests/unit/frontend-knowledge-graph-client.test.ts`
  plus `npm run typecheck`.
- **WP2** (snapshot, traversal, neighborhood, path, overlays):
  `npx vitest run tests/integration/frontend-knowledge-graph-product-api.test.ts tests/database/frontend-knowledge-graph-postgres-parity.test.ts`
- **WP3** (React Workspace, Cytoscape, fallback):
  `npm run frontend:test` and `npx playwright test tests/browser/frontend-knowledge-graph.spec.ts`
- **WP4** (accessibility, performance, completion evidence):
  browser E2E + axe + performance suite; then the final gate.

## 9. Final gate and publication

- One final redirected full check:
  `mkdir -p .tmp && npm run check > .tmp/fe-p3-s3-implementation-check.log 2>&1`
  (report only the exit code; do not commit the log).
- `git diff --check` must pass.
- One final push where practical; record exact-head CI evidence (Quality,
  Frontend, Required Gates all `success` at the exact head).
- Update the Draft PR body with the exact head, changed-file summary, focused
  and full-gate results, CI run, and known limits.

## 10. Completion report fields

- branch name; new exact head; changed-file summary; A–G completion status;
- final graph semantic model; base-view/overlay model; projection/persistence
  decision; ADR decision (ADR-127 accepted or replacement);
- operation contract count (10); Acceptance Criteria status (all with evidence);
- focused-check results; final `npm run check` exit code; `git diff --check`;
- CI run number and ID; Quality/Frontend/Required Gates conclusions;
- working-tree status; exclusions confirmation.

## 11. Explicit exclusions

- Canonical graph writes; graph-based relation editing; automatic Entity merge;
  Review decisions; Approval; Canonical Commit; User Directive Proposal
  implementation; external Action execution; `ACTION_CANDIDATE` in FE-P3-S3
  (fully excluded; no resource kind, payload or authority value exists); FE-P4;
  Yjs/CRDT; new runtime dependencies (Cytoscape already declared); deployment;
  production verification.
- No Ready or Merge without separate user authorization.

## Do not execute

This request is not executed in the FE-P3-S3 contract preparation round. It is
presented for user review and approval.
