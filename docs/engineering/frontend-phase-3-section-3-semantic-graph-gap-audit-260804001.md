# FE-P3-S3 Semantic Graph and Relationship Exploration — Gap Audit

## Record

- Record ID: `frontend-phase-3-section-3-semantic-graph-gap-audit-260804001`
- Date: 2026-08-04
- Repository: `JasonCutter/shotgun`
- Work item: `FE-P3-S3`
- Parent work item: `FE-P3`
- Base: `main@69cd0f0ccc03ba487b954b8f8f53fb1f54d2e9ab`
- Working branch: `codex/frontend-phase-3-section-3-contract-preparation`
- Tracking issue: [#58](https://github.com/JasonCutter/shotgun/issues/58)
- Draft PR: [#59](https://github.com/JasonCutter/shotgun/pull/59)
- Governing contract: `docs/architecture/frontend/phase-3-knowledge-understanding-editing.md`
- Governing ADR: ADR-108 (Typed Semantic Graph Projection with Accessible Fallback)
- ADR-127 (Semantic Graph Projection Read Persistence, Health and Continuation Boundary) — **ACCEPTED 2026-08-04**
- Contract snapshot revision: 5 (exact V1 contracts; normalized semantic axes; base-view/overlay separation; frozen read operations with exact request/response/failure contracts and invariants; descriptor-based snapshot refresh; hybrid persistence decision with immutable snapshot-context descriptor storing normalized filters; `ACTION_CANDIDATE` fully excluded)
- Status: `PREPARATION_ONLY` — this audit does not claim Product implementation or acceptance.

The presence of Cytoscape, Impact Analysis, Stage 9 knowledge-model graph queries,
or relationship data does **not** mean FE-P3-S3 is already implemented. This audit
separates what exists from what FE-P3-S3 must add as a server-authoritative,
typed, accessible graph exploration Product surface.

## 1. Confirmed existing behavior

The following behaviors exist today and can be reused or extended without
re-implementation:

1. **Canonical Knowledge authority and lineage**: Stage 6 canonical claims,
   snapshots, history and evidence lineage exist under `modules/canonical-knowledge`
   and `packages/contracts/src/frontend-knowledge.ts`. Canonical identity and
   lineage are server-owned and remain compatible.
2. **Typed knowledge value payloads**: `packages/contracts/src/frontend-knowledge-draft.ts`
   defines frozen typed value shapes for Fact, Claim, Entity, Relation, Event,
   Decision, Evidence Link, Temporal Validity, Conflict Proposal, Knowledge Gap
   Proposal and `NO_OP` review result. These are Draft operation payloads and are
   the closest existing value vocabulary for graph node/edge content.
3. **Stage 9 knowledge model graph and impact queries**: `modules/knowledge-model`
   exposes `GetKnowledgeGraph` (nodes/edges/tableRows/fallback), `GetKnowledgeImpact`
   (paths, visited nodes, truncated, cycleSafe) and typed candidates with
   `POSSIBLY_SAME` semantics. A `KnowledgeGraphView` with list/table fallback
   already exists at the Stage 9 boundary.
4. **NetworkX impact oracle**: `adapters/networkx-impact-oracle/oracle.py` provides a
   deterministic Stage 9 recursive impact oracle backed by NetworkX
   (`networkx==3.6.1`).
5. **Compiled Truth projection status**: `modules/compiled-truth` models a versioned
   derived projection with `NOT_BUILT`, `STALE`, lag, and build status semantics —
   a reusable pattern for graph projection health.
6. **Server-derived Product read scope**: `modules/frontend-product-read` owns
   `FrontendReadScope` (active project, access revision, policy context revision,
   access scope) and rejects responses whose revisions do not match the read scope.
7. **Protected Product API and typed clients**: Fastify Product routes
   (`assemblies/shotgun-app/src/product-api/*`) and typed clients in
   `packages/shotgun-api-client` exist for Knowledge read and FE-P3-S2 Draft flows.
8. **Scope-aware React Query cache keys**: `apps/shotgun-web/src/knowledge/knowledge-queries.ts`
   builds query keys from the server-derived project/access/policy scope, preventing
   cross-project cache reuse.
9. **Global Shell and navigation state**: `GlobalShellView` (sessionId, activeProject,
   navigation, features, access/policy/projection revisions) is loaded by
   `ApplicationShell` and drives guarded routes. `/knowledge`, `/knowledge/compare`
   and `/knowledge/:resourceId` are guarded routes.
10. **Accessibility primitives**: `useAccessibleDialog`, `route-focus` (focus restore
    on route change), `role="status"`/`role="alert"` announcement patterns, and
    aria-labelledby sections are used across the app.
11. **Knowledge UI components**: `PageSummaryCard`, `ProjectionStatus`, `EmptyState`,
    `ErrorState`, `LoadingState`, the Knowledge Workspace and the Knowledge Editor
    (FE-P3-S2) provide reusable presentation and state-machine patterns.
12. **Test infrastructure**: `tests/helpers/stage-9.ts`, `frontend-knowledge-draft-parity.ts`,
    `frontend-knowledge-projection-contract.ts`, browser specs
    (`tests/browser/frontend-section-3.spec.ts`, `frontend-knowledge-workspace.spec.ts`)
    and the app `vitest` workspace (`npm run frontend:test`) exist.

## 2. Asset reuse and gap inventory

Classification legend:
`REUSE_AS_IS` · `EXTEND` · `ADAPT_BEHIND_NEW_PORT` · `REPLACE_WITH_REASON` · `NOT_RELEVANT` · `MISSING`

| Asset                                                                                                       | Location                                                                                                                              | FE-P3-S3 classification | Rationale                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical Knowledge contracts and lineage                                                                   | `packages/contracts/src/frontend-knowledge.ts`, `modules/canonical-knowledge`                                                         | `REUSE_AS_IS`           | Server authority for nodes/edges sourced from Canonical.                                                                                         |
| Typed Draft value payloads (Fact/Claim/Entity/Relation/Event/Decision/Evidence/Temporal/Conflict/Gap/NO_OP) | `packages/contracts/src/frontend-knowledge-draft.ts`                                                                                  | `EXTEND`                | Value shapes are reusable, but FE-P3-S3 needs graph node/edge/authority/overlay wrappers.                                                        |
| Stage 9 `KnowledgeGraphView`, `GetKnowledgeImpact`, typed candidates, `POSSIBLY_SAME`                       | `modules/knowledge-model`, `packages/contracts/src/knowledge-model.ts`                                                                | `ADAPT_BEHIND_NEW_PORT` | Stage 9 graph is a bounded legacy query surface; FE-P3-S3 must expose a Product graph projection behind a new port, not expose Stage 9 directly. |
| NetworkX impact oracle                                                                                      | `adapters/networkx-impact-oracle`                                                                                                     | `ADAPT_BEHIND_NEW_PORT` | Reuse deterministic recursive impact behind the FE-P3-S3 impact overlay port.                                                                    |
| Compiled Truth projection status (NOT_BUILT/STALE/lag)                                                      | `modules/compiled-truth`                                                                                                              | `EXTEND`                | Reuse status semantics for graph projection health.                                                                                              |
| `FrontendReadScope` (project/access/policy/access scope)                                                    | `modules/frontend-product-read/src/index.ts`                                                                                          | `REUSE_AS_IS`           | Server-derived scope is the authority FE-P3-S3 must preserve.                                                                                    |
| Knowledge workspace projection contract (FE-P3-S1)                                                          | `packages/contracts/src/frontend-knowledge.ts`, `modules/frontend-product-read/src/knowledge-contract.ts`                             | `EXTEND`                | Add typed graph snapshot read contract alongside.                                                                                                |
| DraftChangeSet (FE-P3-S2)                                                                                   | `packages/contracts/src/frontend-knowledge-draft.ts`                                                                                  | `EXTEND`                | Overlay source reference and editor seeding boundary; do not widen Stage 5 change sets.                                                          |
| Protected Product routes                                                                                    | `assemblies/shotgun-app/src/product-api/frontend-knowledge-draft-routes.ts`, `frontend-product-routes.ts`                             | `EXTEND`                | Add protected graph read routes with the same guard/CSRF/decoder pattern.                                                                        |
| Typed API clients                                                                                           | `packages/shotgun-api-client/src/frontend-knowledge-draft-client.ts` and Knowledge clients                                            | `EXTEND`                | Add typed graph snapshot/neighborhood/path/overlay client methods.                                                                               |
| Scope-aware React Query cache keys                                                                          | `apps/shotgun-web/src/knowledge/knowledge-queries.ts`                                                                                 | `EXTEND`                | Add graph-specific keys including snapshot/overlay revisions.                                                                                    |
| `/knowledge/graph` route                                                                                    | `apps/shotgun-web/src/app/router.tsx`                                                                                                 | `MISSING`               | No `/knowledge/graph` route or Graph Workspace exists today.                                                                                     |
| Cytoscape dependency                                                                                        | `package.json` (`cytoscape: 3.34.0`)                                                                                                  | `MISSING` (integration) | Dependency is declared but there is **no** Product integration or import in `apps/shotgun-web`.                                                  |
| Recursive Impact overlay Product API                                                                        | none                                                                                                                                  | `MISSING`               | Impact exists at Stage 9/Draft boundaries, not as an FE-P3-S3 overlay contract.                                                                  |
| Conflict overlay / Gap overlay Product API                                                                  | none                                                                                                                                  | `MISSING`               | Conflict/Gap typed payloads exist in Draft operations but no graph overlay read exists.                                                          |
| Graph projection persistence/read tables                                                                    | `db/migrations/009_stage9_knowledge_model.sql`, `006_stage6_canonical_history_outbox.sql`, `010_stage10_compiled_truth_discovery.sql` | `EXTEND`/`MISSING`      | Existing tables can support canonical/node/edge reads; a graph projection read/health structure is missing.                                      |
| Graph accessibility (list/table/path equivalence, keyboard, screen reader)                                  | none beyond generic aria patterns                                                                                                     | `MISSING`               | No semantic graph fallback exists at the Product boundary.                                                                                       |
| Graph test fixtures and parity helpers                                                                      | `tests/helpers/stage-9.ts`, browser specs                                                                                             | `EXTEND`                | Add FE-P3-S3 parity, contract and browser fixtures.                                                                                              |
| Global Shell navigation state                                                                               | `packages/contracts/src/frontend-section3.ts` (`GlobalShellView`)                                                                     | `EXTEND`                | Add graph navigation item/availability if governed by Global Shell.                                                                              |

## 3. Missing Product behavior

- No `KNOWLEDGE_SEMANTIC` graph snapshot read with server-set traversal limits.
- No neighborhood expansion, path exploration, or typed path description.
- No `GOVERNANCE_IMPACT` / `OPERATIONAL_DEPENDENCY` explicit overlay selection.
- No Conflict overlay, Gap overlay, or Recursive Impact overlay Product reads.
- No graph projection health (`COMPLETE/PARTIAL/TRUNCATED/STALE/REBUILDING/FAILED/UNAVAILABLE/ACCESS_RESTRICTED`).
- No React Graph Workspace, canvas adapter, or accessible list/table/path fallback.
- No deep-link restoration for a selected graph snapshot/root/overlay.

## 4. Missing contracts (now frozen in snapshot revision 2)

The gap was the absence of any FE-P3-S3 graph Product contract. Revision 2 of
`frontend-phase-3-section-3-contract-snapshot-260804001.md` now freezes exact
`v1` contracts (no illustrative types):

- Graph snapshot identity/response; node and edge references and payloads;
  provenance/Evidence/temporal/revision/access shapes; projection health;
  result completeness; traversal and applied limits; continuation identity;
  overlay identity; neighborhood/path results; capabilities and unavailable
  reasons.
- Decoder rules: `schemaVersion: '1.0.0'`, unknown-field rejection, non-empty-ID
  validation, exhaustive unions, no `any`.
- Request contracts for root/root set, base view kind, overlays, direction,
  filters, depth, node/edge/budget limits, continuation token, expected
  revisions, and typed failures.

## 4a. Semantic normalization gap (now frozen in snapshot section 4)

The audit found no existing FE-P3-S3 semantic-axis separation. Revision 2
freezes nine orthogonal axes (resource/node kind; edge semantic kind; authority
classification; base-view membership; overlay membership; projection health;
result completeness; access/masking state; traversal-relative direction) and the
projection mapping for Entity, Fact, Claim, Relation, Event, Decision, Evidence,
Source, Conflict and Knowledge Gap. Relation resources are a typed combination:
edges with `relationRef` plus optional reified `RELATION` nodes for qualified or
n-ary relations, preserving stable `relationId`+`qualifier` identity.

## 5. Missing persistence or projection infrastructure (decision in snapshot section 7)

- No FE-P3-S3 graph projection health registry; no migration.
- No overlay health/identity persistence; impact artifact refs exist only for
  Drafts.
- No PostgreSQL read path that projects Canonical/Stage 9 edges into a
  versioned, Project-scoped graph snapshot with access masking.

Revision 2 fixes the implementation model as an **explicit hybrid**: ephemeral
base-view snapshots, a materialized projection-health registry, persisted
overlay health/identity, and server-side expiring continuation tokens, with
migration **026** required (`frontend_knowledge_graph_projection_health`,
`frontend_knowledge_graph_overlay_health`,
`frontend_knowledge_graph_continuation`). This persistence decision is not
covered by an accepted ADR and therefore requires proposed **ADR-127**.

## 6. Missing UI behavior

- No Graph Workspace route or canvas/list/table/path views.
- No keyboard traversal of graph nodes/edges, selection announcements, or
  expansion announcements.
- No URL state for meaningful filters or selected resource references.
- No overlay picker or explicit view-kind selection.
- No return-focus or deep-link focus restoration for graph views.

## 7. Missing security and access controls (now frozen in snapshot section 8)

- No server validation that graph roots, neighborhoods, paths, and overlays are
  Project/access-scope checked with masking of hidden resources.
- No guarantee that hidden resources do not leak through node count, labels,
  edge text, path descriptions, or neighboring metadata.
- No cache isolation across Project, policy, snapshot or overlay revisions for
  graph reads.
- No protection against cross-Project deep links resolving into another scope.

Revision 2 hardens this with: `DISCLOSABLE_MASKED` versus `FULLY_HIDDEN`
categories; hidden resources excluded before counting and truncation; paths and
neighborhoods never referencing hidden items; cross-Project deep links never
silently replacing the Active Project; and two-phase cache keys (scope-phase for
initial fetch, snapshot-phase after the first response) that never require an
unknown response revision.

## 8. Missing accessibility behavior

- No accessible equivalent for canvas-only interactions (nodes, edges,
  selection, filters, paths, overlays).
- No path narration, truncation/stale announcements, or 200% zoom / reduced
  motion behavior for the graph.
- No list/table/path fallback that is information-equivalent (not a summary).

## 9. Missing performance and scale controls

- No measured limits for initial snapshot size, rendered node/edge count,
  layout time, interaction responsiveness, memory cleanup on route change,
  cache eviction, or cancellation via `AbortController`.
- No bounded traversal budget or continuation-token expiry semantics.
- No evidence baseline for large-graph browser lockup avoidance.

## 10. Deferred scope (later Sections)

- Review decisions and approval → FE-P4-S1 Review Center.
- External Action execution → FE-P4-S2 External Action Governance.
- User Directive Proposal implementation.
- Canonical Commit / Canonical write.
- Direct relation editing on the canvas.
- Automatic Entity resolution/merge (never automatic).

## 11. Rejected implementation approaches and consequences

| Rejected approach                               | Consequence if pursued                                             | Status                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Browser creates/owns graph authority            | Violates ADR-108 and server authority; enables cross-scope leakage | Rejected — server owns graph projection authority         |
| Client-side similarity merging of nodes/edges   | Merges distinct entities; damages auditability                     | Rejected — `POSSIBLY_SAME` stays typed, never auto-merges |
| Collapsing edge kinds into one generic type     | Loses Canonical/inferred/overlay meaning                           | Rejected — typed edge kinds are mandatory                 |
| Canvas-only interaction without fallback        | Breaks keyboard/screen-reader equivalence                          | Rejected — list/table/path fallback is mandatory          |
| Presenting partial/truncated result as complete | Misrepresents graph coverage                                       | Rejected — explicit partial/truncated state               |
| Direct relation mutation from the canvas        | Bypasses DraftChangeSet and Review                                 | Rejected — routes to Knowledge Editor seed                |
| `ACTION_CANDIDATE` in default Knowledge graph   | Contaminates default semantic meaning                              | Rejected — explicit governance/operational overlay only   |
| Unrestricted browser traversal over server data | Unbounded load and hidden-data exposure                            | Rejected — server-issued snapshot context only            |

## 12. Risk evaluation

1. **Browser-created graph authority** — HIGH. Mitigation: server-owned snapshot/overlay
   projection; browser layout is presentation only (D4).
2. **Client-side similarity merging** — HIGH. Mitigation: `POSSIBLY_SAME` typed
   relationship, no auto-merge (D4).
3. **Canonical and inferred edge ambiguity** — HIGH. Mitigation: distinct authority
   classifications with visible styling (D3/D4).
4. **Cross-Project resource leakage** — HIGH. Mitigation: server Project/access
   scope validation and masking on every read (D5).
5. **Evidence or sensitive metadata leakage through neighboring nodes** — HIGH.
   Mitigation: mask hidden resources in node count, labels, edge text, paths and
   neighbor metadata (D4/D5).
6. **Unbounded traversal or recursive expansion** — HIGH. Mitigation: server-enforced
   depth/node/edge/budget/timeout limits and continuation tokens (D6).
7. **Stale or partially rebuilt projection shown as current** — HIGH. Mitigation:
   explicit projection health states and revision binding (D3/D6).
8. **Overlay revision drift** — HIGH. Mitigation: each overlay carries its own
   snapshot/analyzer/policy revision and expected-revision checks (D8).
9. **Canvas-only interaction** — HIGH. Mitigation: list/table/path equivalence
   (D9).
10. **Keyboard and screen-reader loss of semantic equivalence** — HIGH. Mitigation:
    focus movement, announcements, narration, deep-link focus restoration (D9).
11. **`ACTION_CANDIDATE` contamination of the default Knowledge graph** — MEDIUM.
    Mitigation: default `KNOWLEDGE_SEMANTIC` excludes `ACTION_CANDIDATE`; only
    explicit overlays include it (D2/D8).
12. **Direct relation mutation from the canvas** — HIGH. Mitigation: no graph
    write commands; corrections route to Knowledge Editor DraftChangeSet (D11).
13. **Cache contamination across Project/policy/snapshot/overlay revisions** — HIGH.
    Mitigation: scope- and revision-aware query keys and eviction (D5/D13).
14. **Large-graph browser lockup** — HIGH. Mitigation: bounded initial render,
    incremental expansion, `AbortController`, measured performance evidence (D13).
15. **Unstable node identity/focus/deep links after projection refresh** — MEDIUM.
    Mitigation: stable resource IDs, refresh preserves selection/focus by stable
    identity, deep-link restoration (D4/D10/D12).

## 13. Conclusion

FE-P3-S3 requires a new server-authoritative typed graph read surface, exact V1
graph Product contracts, a hybrid projection-health/continuation persistence
boundary (migration 026), protected routes, a typed client, a React Graph
Workspace with Cytoscape presentation adapter, and an information-equivalent
accessible fallback. Existing Canonical/Stage 9 impact and knowledge-model graph
assets are reusable behind new ports. The persistence decision is governed by
**ADR-127**, accepted by the user on 2026-08-04 (architecture block lifted on
AC-13, AC-16, AC-27, AC-31). Product implementation is now authorized but was
not started at this head; this audit records the gap, not completion.
