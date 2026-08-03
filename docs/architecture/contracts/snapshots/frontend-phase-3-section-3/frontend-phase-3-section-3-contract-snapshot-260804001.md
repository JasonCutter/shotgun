---
id: FRONTEND-PHASE-3-SECTION-3-CONTRACT-SNAPSHOT-260804001
classification: PRODUCT_CONTRACT_SNAPSHOT_PROPOSAL
status: PROPOSED_PENDING_USER_REVIEW
revision: 1
review_round: 0
review_result: PENDING_REVIEW
approved_by: null
approved_at: null
work_item: FE-P3-S3
governing_adr: ADR-108
base_commit_requested: 69cd0f0ccc03ba487b954b8f8f53fb1f54d2e9ab
branch: codex/frontend-phase-3-section-3-contract-preparation
implementation_authorized: false
---

# FE-P3-S3 Contract Snapshot — Semantic Graph and Relationship Exploration

## 0. Status

This snapshot freezes the proposed Product contract for the FE-P3-S3 Semantic
Graph and Relationship Exploration Workspace. It is a **preparation proposal**.
It is not approved, does not authorize implementation, and no Acceptance
Criterion in this document is marked passed. The snapshot preserves ADR-108
(Typed Semantic Graph Projection with Accessible Fallback) and is bounded by the
FE-P3-S3 Gap Audit
(`docs/engineering/frontend-phase-3-section-3-semantic-graph-gap-audit-260804001.md`).

## 1. D1 — Product responsibility

FE-P3-S3 is a **read and exploration Workspace for typed graph projections**.

It must not become:

- a Canonical graph store;
- an approval surface;
- a Review Center;
- a direct relation editor;
- an external Action executor;
- an automatic entity-resolution system.

The Graph Workspace reads server-issued projections only. Any knowledge
correction routes to the Knowledge Editor with a typed DraftChangeSet seed
(D11).

## 2. D2 — View kinds

Three separate typed view kinds are defined:

```ts
type GraphViewKindV1 = 'KNOWLEDGE_SEMANTIC' | 'GOVERNANCE_IMPACT' | 'OPERATIONAL_DEPENDENCY';
```

- The default `/knowledge/graph` experience is `KNOWLEDGE_SEMANTIC`.
- `GOVERNANCE_IMPACT` and `OPERATIONAL_DEPENDENCY` are explicit overlays or
  explicitly selected views. They must never silently alter the default
  semantic graph.
- Selecting an overlay changes the requested view; returning to the default view
  must restore the `KNOWLEDGE_SEMANTIC` projection without residue from overlay
  content.

## 3. D3 — Typed graph model

The Product API freezes the following typed shapes (illustrative, to be made
precise by the implementation decoders):

```ts
type GraphSnapshotIdentityV1 = {
  snapshotId: string;
  projectId: string;
  viewKind: GraphViewKindV1;
  projectionRevision: string;
  generatedAt: string;
};

type GraphNodeKindV1 =
  'ENTITY' | 'FACT' | 'CLAIM' | 'RELATION' | 'EVENT' | 'DECISION' | 'EVIDENCE' | 'SOURCE';

type GraphEdgeKindV1 =
  | 'CANONICAL_RELATION'
  | 'CANONICAL_STATEMENT_ASSOCIATION'
  | 'DERIVED_INFERENCE'
  | 'DISCOVERY_CANDIDATE'
  | 'POSSIBLY_SAME'
  | 'EVIDENCE_LINKAGE'
  | 'CONFLICT'
  | 'KNOWLEDGE_GAP'
  | 'TEMPORAL_RELATIONSHIP'
  | 'GOVERNANCE_IMPACT'
  | 'OPERATIONAL_DEPENDENCY';

type GraphAuthorityClassificationV1 =
  | 'CANONICAL'
  | 'CANONICAL_STATEMENT_ASSOCIATION'
  | 'DERIVED_INFERENCE'
  | 'DISCOVERY_CANDIDATE'
  | 'POSSIBLY_SAME'
  | 'EVIDENCE_LINKAGE'
  | 'CONFLICT'
  | 'KNOWLEDGE_GAP'
  | 'TEMPORAL_RELATIONSHIP'
  | 'GOVERNANCE_IMPACT'
  | 'OPERATIONAL_DEPENDENCY';

type GraphNodeV1 = {
  nodeId: string;
  nodeKind: GraphNodeKindV1;
  resourceRef: TypedResourceReferenceV1; // stable identity
  label: string;
  authority: GraphAuthorityClassificationV1;
  provenanceSummary?: GraphProvenanceSummaryV1;
  evidenceSummary?: GraphEvidenceSummaryV1;
  temporalValidity?: GraphTemporalValidityV1;
  revisionBinding?: GraphRevisionBindingV1;
  accessAndMasking: GraphAccessMaskingStateV1;
};

type GraphEdgeV1 = {
  edgeId: string;
  from: GraphNodeReferenceV1;
  to: GraphNodeReferenceV1;
  edgeKind: GraphEdgeKindV1;
  direction: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL';
  authority: GraphAuthorityClassificationV1;
  provenanceSummary?: GraphProvenanceSummaryV1;
  evidenceSummary?: GraphEvidenceSummaryV1;
  temporalValidity?: GraphTemporalValidityV1;
  revisionBinding?: GraphRevisionBindingV1;
  accessAndMasking: GraphAccessMaskingStateV1;
};

type GraphProjectionHealthV1 =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'TRUNCATED'
  | 'STALE'
  | 'REBUILDING'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'ACCESS_RESTRICTED';
```

Edge kinds must **not** be collapsed into one generic edge type. Every edge
carries an authority classification and a typed reference.

## 4. D4 — Authority and identity

- Server resources and projections own graph authority.
- Browser layout coordinates are presentation state only (never sent back as
  authority).
- Stable node IDs resolve to typed resource references
  (`TypedResourceReferenceV1`); they are not arbitrary canvas IDs.
- Projection block or canvas IDs must not replace Canonical resource IDs.
- A node may expose multiple authority or provenance facts without changing its
  identity.
- `POSSIBLY_SAME` remains a typed relationship and must never trigger automatic
  node merging.
- Derived inference and discovery candidates remain visibly distinct from
  Canonical relations (visual distinction is mandatory, D9).
- Hidden or inaccessible resources must not leak existence through node count,
  labels, edge text, path descriptions, or neighboring metadata.

## 5. D5 — Project, policy and access scope

The server validates and responds based on:

- Principal and Session;
- Active Project, Resource Project and effective Project;
- policy revision and access revision;
- sensitivity and masking;
- deleted, archived or inaccessible resources (excluded or masked);
- cross-Project deep links (must fail or resolve only within scope);
- Project switching (re-read under the new scope; never reuse another scope's cache);
- Project-specific cache keys (include project, access/policy revisions, snapshot
  and overlay revisions);
- policy strengthening while a graph is open (subsequent reads fail or return
  `STALE`/`ACCESS_RESTRICTED`; the browser must not override).

The Browser must not construct or override authoritative Project, policy,
sensitivity, access or revision decisions.

## 6. D6 — Snapshot and traversal

Request fields (frozen):

```ts
type GraphSnapshotRequestV1 = {
  rootResourceRef?: TypedResourceReferenceV1; // or root set
  viewKind: GraphViewKindV1;
  direction?: 'OUTGOING' | 'INCOMING' | 'BIDIRECTIONAL';
  nodeKindFilters?: readonly GraphNodeKindV1[];
  edgeKindFilters?: readonly GraphEdgeKindV1[];
  authorityFilters?: readonly GraphAuthorityClassificationV1[];
  temporalFilters?: GraphTemporalValidityV1;
  evidenceFilters?: GraphEvidenceFilterV1;
  maxDepth?: number;
  maxNodes?: number;
  maxEdges?: number;
  traversalBudget?: number;
  serverTimeoutBudgetMs?: number;
  continuationToken?: string;
  selectedOverlay?: GraphOverlayKindV1;
  expectedSnapshotRevision?: string;
  expectedOverlayRevision?: string;
};
```

The server sets and enforces **all** hard limits (depth, nodes, edges, budget,
timeout). The browser may only request values; the server clamps or rejects.

Response completeness:

```ts
type GraphSnapshotCompletenessV1 =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'TRUNCATED'
  | 'STALE'
  | 'REBUILDING'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'ACCESS_RESTRICTED';
```

Partial or truncated results must remain useful and explicit, never presented as
a complete graph.

## 7. D7 — Exploration operations

Separate read operations:

1. initial semantic graph snapshot;
2. neighborhood expansion (server-issued snapshot context + node reference);
3. shortest or supported path exploration;
4. typed path description;
5. conflict overlay;
6. knowledge-gap overlay;
7. recursive impact overlay;
8. Evidence and provenance detail;
9. snapshot refresh;
10. deep-link restoration.

Path and neighborhood requests use server-issued snapshot context and must not
perform unrestricted browser traversal over hidden server data.

## 8. D8 — Overlay isolation

Each overlay carries its own:

- overlay kind;
- snapshot ID;
- source resource or DraftChangeSet reference;
- analyzer or registry revision;
- policy revision;
- generated-at time;
- completeness state;
- truncation state;
- unavailable reason.

Overlay results must not be persisted as Canonical graph edges.
`ACTION_CANDIDATE` may appear only in an explicitly selected governance or
operational overlay and must not appear as a default Knowledge node.

## 9. D9 — Accessible equivalent views

Semantic equivalence is required across:

- canvas;
- list;
- table;
- path description.

Every node, edge, selection, filter, path and overlay available from the canvas
must have an operable keyboard-accessible alternative. The fallback is
**not** a reduced-information summary.

Frozen accessibility requirements:

- accessible names for nodes, edges, filters, overlays;
- headings and landmarks for graph regions;
- focus movement (canvas ↔ list/table/path; node ↔ edge; filter ↔ result);
- selection announcements;
- expansion announcements;
- path narration;
- truncation and stale-state announcements;
- return-focus behavior;
- deep-link focus restoration;
- 200% zoom and reduced-motion behavior.

## 10. D10 — UI and layout ownership

- React owns interaction and presentation state.
- React Query owns read caching only.
- Cytoscape, when used, owns canvas rendering and layout only.
- Layout coordinates, zoom, pan and temporary selection are not server authority.
- Meaningful filters and selected resource references may be URL state.
- Large layouts must not block the main interaction thread without bounded
  behavior.
- Animation must respect reduced-motion preferences.
- Refreshing data must preserve selection and focus by stable resource identity
  where possible.

## 11. D11 — Write and navigation boundaries

Frozen routes:

- relation or knowledge correction → Knowledge Editor with a typed
  DraftChangeSet seed;
- Review or approval action → later Review Center (FE-P4-S1);
- external execution → later External Action Workspace (FE-P4-S2);
- entity-resolution proposal → a typed candidate or DraftChangeSet path, never
  automatic merge.

The Graph Workspace must not:

- create Canonical nodes or edges;
- mutate relations directly;
- approve or commit a DraftChangeSet;
- execute an external Action;
- silently promote inference;
- silently merge entities.

## 12. D12 — Failure and recovery

Typed handling is required for:

- projection unavailable;
- projection rebuilding;
- stale snapshot;
- expired continuation token;
- access changed;
- Project changed;
- policy changed;
- root resource deleted or archived;
- partial neighborhood;
- analyzer timeout;
- overlay unavailable;
- deep-link target unavailable;
- network failure.

Snapshot reads may be retried safely. No write command may be introduced merely
to recover a graph read.

## 13. D13 — Performance boundary

Measurable limits and required evidence:

- initial snapshot size;
- maximum rendered nodes and edges;
- server traversal depth and budget;
- incremental neighborhood expansion;
- large-result truncation;
- layout time;
- interaction responsiveness;
- memory cleanup on route change;
- cancellation through `AbortController`;
- cache eviction;
- no duplicate hidden graph copies in Browser state.

Where no repository baseline supports a numerical threshold, the value is
recorded as an explicit implementation-time measurement requiring evidence
rather than an invented number.

## 14. ADR boundary

The governing decision surface is ADR-108 plus the accepted cross-phase ADRs
(ADR-106, ADR-107, ADR-119 ownership, ADR-124 work-item authority). The audit
found no genuinely new architectural decision requiring a new ADR. The ADR
decision for this preparation round is `NO_NEW_ADR_REQUIRED` (see Gap Audit,
section 13, and the Preparation Verification record).

## 15. Acceptance Criteria

Acceptance Criteria for FE-P3-S3 are frozen with stable IDs `FE-P3-S3-AC-01`
onward. None are marked passed in this preparation round. See the numbered
criteria below (section 16).

## 16. E — Acceptance Criteria

Numbered, testable criteria covering the complete Section:

| ID             | Acceptance criterion                                                                                                                                                                                               | Evidence               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| FE-P3-S3-AC-01 | Typed graph contracts (snapshot/node/edge/reference/kind/authority/provenance/evidence/temporal/revision/health/access/overlay/budget/path/neighborhood/capability) exist with strict decoders and negative tests. | Contract tests         |
| FE-P3-S3-AC-02 | Server-authoritative Project/access scope enforced on every graph read; browser cannot override.                                                                                                                   | Negative tests         |
| FE-P3-S3-AC-03 | Semantic graph snapshot read returns typed nodes/edges with server-set limits.                                                                                                                                     | API/contract tests     |
| FE-P3-S3-AC-04 | Bounded traversal: depth/node/edge/budget/timeout enforced by server; truncation explicit.                                                                                                                         | Integration tests      |
| FE-P3-S3-AC-05 | Neighborhood expansion uses server-issued snapshot context and returns bounded results.                                                                                                                            | Integration tests      |
| FE-P3-S3-AC-06 | Shortest/supported path exploration returns typed path description.                                                                                                                                                | Integration tests      |
| FE-P3-S3-AC-07 | Typed provenance and Evidence summaries are returned and traceable.                                                                                                                                                | Contract tests         |
| FE-P3-S3-AC-08 | Canonical versus inferred edges are visually and semantically distinct.                                                                                                                                            | Browser E2E + unit     |
| FE-P3-S3-AC-09 | `POSSIBLY_SAME` never triggers automatic merge; remains typed.                                                                                                                                                     | Unit tests             |
| FE-P3-S3-AC-10 | Conflict overlay is isolated, revision-bound and read-only.                                                                                                                                                        | Contract/integration   |
| FE-P3-S3-AC-11 | Knowledge-gap overlay is isolated, revision-bound and read-only.                                                                                                                                                   | Contract/integration   |
| FE-P3-S3-AC-12 | Recursive impact overlay reuses the analyzer behind the new port with bounded results.                                                                                                                             | Integration tests      |
| FE-P3-S3-AC-13 | Overlay isolation: each overlay has own snapshot/analyzer/policy revision; overlay never persisted as Canonical edge.                                                                                              | Integration tests      |
| FE-P3-S3-AC-14 | `ACTION_CANDIDATE` is excluded from the default Knowledge graph and appears only in explicit overlays.                                                                                                             | Contract/browser tests |
| FE-P3-S3-AC-15 | Stale/partial/truncated/unavailable states are explicit, never presented as complete.                                                                                                                              | Unit/contract tests    |
| FE-P3-S3-AC-16 | Cache isolation across Project/policy/snapshot/overlay revisions; no cross-scope reuse.                                                                                                                            | Browser tests          |
| FE-P3-S3-AC-17 | Deep links and focus restoration preserve stable resource identity.                                                                                                                                                | Browser E2E            |
| FE-P3-S3-AC-18 | Canvas interaction renders the typed projection without becoming authority.                                                                                                                                        | Browser E2E            |
| FE-P3-S3-AC-19 | List, table and path views are information-equivalent to the canvas.                                                                                                                                               | Browser E2E            |
| FE-P3-S3-AC-20 | Keyboard operation covers all canvas operations (nodes, edges, selection, filters, paths, overlays).                                                                                                               | Browser E2E + axe      |
| FE-P3-S3-AC-21 | Screen-reader semantics: names, landmarks, announcements, narration, return-focus.                                                                                                                                 | Browser E2E + axe      |
| FE-P3-S3-AC-22 | Reduced motion and 200% zoom behavior.                                                                                                                                                                             | Browser E2E            |
| FE-P3-S3-AC-23 | Large-graph performance: bounded render, incremental expansion, no main-thread lockup.                                                                                                                             | Performance evidence   |
| FE-P3-S3-AC-24 | Error recovery and cancellation (`AbortController`); snapshot reads retried safely.                                                                                                                                | Unit/browser tests     |
| FE-P3-S3-AC-25 | Navigation to Knowledge Editor with a typed DraftChangeSet seed for corrections.                                                                                                                                   | Integration/browser    |
| FE-P3-S3-AC-26 | Zero direct Canonical, Approval or Action writes from the Graph Workspace.                                                                                                                                         | Negative tests         |
| FE-P3-S3-AC-27 | In-memory/PostgreSQL parity where applicable for graph reads.                                                                                                                                                      | Parity tests           |
| FE-P3-S3-AC-28 | Product API contract tests for all graph read operations.                                                                                                                                                          | Contract tests         |
| FE-P3-S3-AC-29 | Integration, database and browser E2E coverage.                                                                                                                                                                    | Test suites            |
| FE-P3-S3-AC-30 | Exact-head remote gates green (Quality, Frontend, Required Gates).                                                                                                                                                 | CI evidence            |
| FE-P3-S3-AC-31 | Formal completion governance (completion manifest, evidence registry, user approval).                                                                                                                              | Governance record      |

All criteria remain `NOT_RUN` for this preparation round. No Product
implementation criterion is marked passed.
