---
id: FRONTEND-PHASE-3-SECTION-3-CONTRACT-SNAPSHOT-260804001
classification: PRODUCT_CONTRACT_SNAPSHOT_PROPOSAL
status: PROPOSED_PENDING_USER_REVIEW
revision: 3
review_round: 2
review_result: PENDING_REVIEW
approved_by: null
approved_at: null
work_item: FE-P3-S3
governing_adr: ADR-108
proposed_adr: ADR-127
base_commit_requested: 69cd0f0ccc03ba487b954b8f8f53fb1f54d2e9ab
branch: codex/frontend-phase-3-section-3-contract-preparation
implementation_authorized: false
---

# FE-P3-S3 Contract Snapshot — Semantic Graph and Relationship Exploration

## 0. Status

This snapshot freezes the proposed Product contract for the FE-P3-S3 Semantic
Graph and Relationship Exploration Workspace. Revision 3 (focused correction
round after `CHANGES_REQUIRED` review) resolves: the authority axis reduced to
pure authority/provenance lineage; exact V1 request/response/failure contracts
for all ten operations with cross-field invariants; the immutable snapshot-context
descriptor that restores ephemeral snapshots for subsequent operations; base-view
terminology unified on `GraphBaseViewKindV1`; and `ACTION_CANDIDATE` fully
excluded from FE-P3-S3. Revision 2 previously replaced all illustrative or
implementation-defined types with exact `v1` contracts and normalized the
semantic axes.

It is a **preparation proposal**. It is not approved, does not authorize
implementation, and no Acceptance Criterion in this document is marked passed.
The snapshot preserves ADR-108 (Typed Semantic Graph Projection with Accessible
Fallback) and is bounded by the FE-P3-S3 Gap Audit
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

## 2. D2 — Base view kinds

Exactly one base view kind exists per snapshot. `GraphViewKindV1` is **not**
defined; the only view-kind type is `GraphBaseViewKindV1` (axis 4, section 4):

```ts
type GraphBaseViewKindV1 = 'KNOWLEDGE_SEMANTIC' | 'GOVERNANCE_IMPACT' | 'OPERATIONAL_DEPENDENCY';
```

- The default `/knowledge/graph` experience is `KNOWLEDGE_SEMANTIC`.
- `GOVERNANCE_IMPACT` and `OPERATIONAL_DEPENDENCY` are explicitly selected
  **base views**, never overlays. They must never silently alter the default
  semantic graph.
- Overlays are only `CONFLICT`, `KNOWLEDGE_GAP` and `RECURSIVE_IMPACT` (defined
  in section 5, C). Selecting an overlay never changes the base view; returning
  to the default view restores the `KNOWLEDGE_SEMANTIC` projection without
  residue from overlay content.

## 3. A — Exact typed graph model (V1)

This section freezes exact `v1` contracts. No type below is illustrative.
Every decoder must implement the rules in A.1.

### 3.1 A.1 — Decoder and identity rules

- Every envelope, entity and payload carries `schemaVersion: '1.0.0'`.
- Decoders reject unknown fields (equivalent to `additionalProperties: false`).
- All IDs are non-empty trimmed strings; decoders reject empty or
  whitespace-only IDs.
- Union discriminants are exhaustive; an unknown discriminant value is rejected.
- No `any`; every field is decoded and validated against its declared type.
- Graph entity payloads reuse the frozen versioned value types from
  `packages/contracts/src/frontend-knowledge-draft.ts`
  (`FactValueV1`, `ClaimValueV1`, `EntityValueV1`, `RelationValueV1`,
  `EventValueV1`, `DecisionValueV1`, `EvidenceLinkValueV1`,
  `TemporalValidityValueV1`, `ConflictProposalValueV1`,
  `KnowledgeGapProposalValueV1`) and `packages/contracts/src/knowledge-model.ts`
  where the semantic matches; the graph wrapper types below are new and exact.

### 3.2 A.2 — Reference types

```ts
type GraphSchemaVersion = '1.0.0';

type GraphNodeReferenceV1 = {
  schemaVersion: '1.0.0';
  resourceKind: GraphResourceKindV1; // axis 1
  resourceId: string; // stable Canonical/typed resource ID, non-empty
};

type GraphEdgeReferenceV1 = {
  schemaVersion: '1.0.0';
  edgeId: string; // non-empty, stable within the snapshot that issued it
  from: GraphNodeReferenceV1;
  to: GraphNodeReferenceV1;
};

type GraphRelationReferenceV1 = {
  schemaVersion: '1.0.0';
  relationId: string; // stable resource ID of the relation, non-empty
  qualifier?: string; // optional qualifier for qualified or n-ary relations
};
```

### 3.3 A.3 — Node and edge payloads

```ts
type GraphResourceKindV1 =
  | 'ENTITY'
  | 'FACT'
  | 'CLAIM'
  | 'RELATION'
  | 'EVENT'
  | 'DECISION'
  | 'EVIDENCE'
  | 'SOURCE'
  | 'CONFLICT'
  | 'KNOWLEDGE_GAP';

type GraphNodeV1 = {
  schemaVersion: '1.0.0';
  nodeId: string; // stable across refreshes; derives from resourceRef
  resourceRef: GraphNodeReferenceV1; // stable typed identity
  label: string; // accessible display label; masked placeholder when masked
  nodeKind: GraphResourceKindV1; // axis 1
  authority: GraphAuthorityClassificationV1; // axis 3
  baseViewMembership: GraphBaseViewKindV1; // axis 4
  overlayMemberships: readonly GraphOverlayKindV1[]; // axis 5; [] in base-only
  provenance?: GraphProvenanceSummaryV1;
  evidence?: GraphEvidenceSummaryV1;
  temporalValidity?: GraphTemporalValidityV1;
  revisionBinding: GraphRevisionBindingV1;
  accessMasking: GraphAccessMaskingStateV1; // axis 8
  payload?: GraphNodePayloadV1; // discriminated by nodeKind
};

type GraphNodePayloadV1 =
  | { schemaVersion: '1.0.0'; nodeKind: 'ENTITY'; entity: EntityValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'FACT'; fact: FactValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'CLAIM'; claim: ClaimValueV1 }
  | {
      schemaVersion: '1.0.0';
      nodeKind: 'RELATION';
      relation: GraphRelationPayloadV1; // reified relation; see B.3
    }
  | { schemaVersion: '1.0.0'; nodeKind: 'EVENT'; event: EventValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'DECISION'; decision: DecisionValueV1 }
  | {
      schemaVersion: '1.0.0';
      nodeKind: 'EVIDENCE';
      evidence: EvidenceLinkValueV1;
    }
  | { schemaVersion: '1.0.0'; nodeKind: 'SOURCE'; source: GraphSourcePayloadV1 }
  | {
      schemaVersion: '1.0.0';
      nodeKind: 'CONFLICT';
      conflict: ConflictProposalValueV1;
    }
  | {
      schemaVersion: '1.0.0';
      nodeKind: 'KNOWLEDGE_GAP';
      knowledgeGap: KnowledgeGapProposalValueV1;
    };

type GraphRelationPayloadV1 = {
  schemaVersion: '1.0.0';
  relationRef: GraphRelationReferenceV1;
  relationType: string;
  subjectRef: GraphNodeReferenceV1;
  objectRef: GraphNodeReferenceV1;
  otherEndpointRefs?: readonly GraphNodeReferenceV1[]; // n-ary endpoints
};

type GraphSourcePayloadV1 = {
  schemaVersion: '1.0.0';
  sourceId: string;
  sourceVersionId?: string;
  title: string;
};

type GraphEdgeV1 = {
  schemaVersion: '1.0.0';
  edgeId: string; // non-empty, stable within the snapshot that issued it
  from: GraphNodeReferenceV1;
  to: GraphNodeReferenceV1; // from/to define relation source/target direction
  relationRef?: GraphRelationReferenceV1; // present when the edge is a relation
  edgeSemanticKind: GraphEdgeSemanticKindV1; // axis 2
  authority: GraphAuthorityClassificationV1; // axis 3
  baseViewMembership: GraphBaseViewKindV1; // axis 4
  overlayMemberships: readonly GraphOverlayKindV1[]; // axis 5
  provenance?: GraphProvenanceSummaryV1;
  evidence?: GraphEvidenceSummaryV1;
  temporalValidity?: GraphTemporalValidityV1;
  revisionBinding: GraphRevisionBindingV1;
  accessMasking: GraphAccessMaskingStateV1; // axis 8
  traversalDirection?: GraphTraversalDirectionV1; // axis 9, derived only
  payload?: GraphEdgePayloadV1;
};

type GraphEdgePayloadV1 = {
  schemaVersion: '1.0.0';
  relationType?: string;
  qualifier?: string;
};
```

Edges never store `INCOMING`/`OUTGOING` as an intrinsic direction field.
`from` and `to` define the relation direction; traversal-relative direction
(axis 9) is derived from the snapshot root when a root is defined.

### 3.4 A.4 — Provenance, Evidence, temporal, revision, access

```ts
type GraphProvenanceSummaryV1 = {
  schemaVersion: '1.0.0';
  sourceProjectId: string;
  canonicalRevision?: string;
  generatedBy: 'CANONICAL' | 'STAGE9_MODEL' | 'COMPILED_TRUTH' | 'IMPACT_ANALYZER';
  provenanceNote?: string;
};

type GraphEvidenceSummaryV1 = {
  schemaVersion: '1.0.0';
  evidenceCount: number;
  sourceIds: readonly string[]; // non-empty strings
  evidenceSpanIds: readonly string[];
};

type GraphTemporalValidityV1 = {
  schemaVersion: '1.0.0';
  validFrom?: string; // ISO-8601
  validTo?: string; // ISO-8601
  status: 'KNOWN' | 'OPEN' | 'UNKNOWN';
};

type GraphRevisionBindingV1 = {
  schemaVersion: '1.0.0';
  projectionRevision: string; // non-empty
  policyContextRevision: string; // non-empty
  accessRevision: string; // non-empty
};

type GraphAccessMaskingStateV1 = 'VISIBLE' | 'MASKED' | 'HIDDEN';
```

### 3.5 A.5 — Projection health and result completeness

```ts
type GraphProjectionHealthV1 =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'TRUNCATED'
  | 'STALE'
  | 'REBUILDING'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'ACCESS_RESTRICTED';

type GraphResultCompletenessV1 = 'COMPLETE' | 'PARTIAL' | 'TRUNCATED';
```

`GraphProjectionHealthV1` describes the server projection; `GraphResultCompletenessV1`
describes one returned result. Partial or truncated results remain useful and
explicit and are never presented as a complete graph.

### 3.6 A.6 — Traversal limits and applied limits

```ts
type GraphTraversalLimitsV1 = {
  schemaVersion: '1.0.0';
  maxDepth: number;
  maxNodes: number;
  maxEdges: number;
  traversalBudget: number;
  serverTimeoutBudgetMs: number;
};

type GraphAppliedLimitsV1 = GraphTraversalLimitsV1 & {
  schemaVersion: '1.0.0';
  requestedMaxDepth: number | null;
  requestedMaxNodes: number | null;
  requestedMaxEdges: number | null;
  clamped: boolean; // true when any requested limit exceeded the server cap
};
```

The server sets and enforces every hard limit. The browser may only request
values; the server clamps or rejects, and `clamped` must be true when any
requested value was clamped.

### 3.7 A.7 — Continuation identity

```ts
type GraphContinuationTokenV1 = {
  schemaVersion: '1.0.0';
  token: string; // opaque, server-issued, non-empty
  expiresAt: string; // ISO-8601
};

type GraphContinuationBindingV1 = {
  schemaVersion: '1.0.0';
  principalId: string;
  sessionId: string;
  projectId: string;
  accessRevision: string;
  policyContextRevision: string;
  snapshotId: string;
  rootRef?: GraphNodeReferenceV1;
  filtersDigest: string; // digest of filters, view and overlay selection
  viewKind: GraphBaseViewKindV1;
  overlayKinds: readonly GraphOverlayKindV1[];
  limits: GraphTraversalLimitsV1;
};
```

Continuation tokens are opaque, server-issued, expiring and bound to every field
in `GraphContinuationBindingV1`. The server stores the binding; the browser
stores only the opaque token.

### 3.8 A.8 — Overlay identity

```ts
type GraphOverlayKindV1 = 'CONFLICT' | 'KNOWLEDGE_GAP' | 'RECURSIVE_IMPACT';

type GraphOverlayIdentityV1 = {
  schemaVersion: '1.0.0';
  overlayKind: GraphOverlayKindV1;
  overlaySnapshotId: string; // non-empty
  overlayRevision: string; // non-empty
  sourceRef?:
    | { kind: 'RESOURCE'; resourceRef: GraphNodeReferenceV1 }
    | { kind: 'DRAFT_CHANGE_SET'; draftId: string; revision: number };
  analyzerRevision: string; // non-empty
  policyContextRevision: string; // non-empty
  generatedAt: string; // ISO-8601
  completeness: GraphResultCompletenessV1;
  truncation?: GraphTruncationStateV1;
  unavailableReason?: GraphUnavailableReasonV1;
};
```

### 3.9 A.9 — Neighborhood and path results

```ts
type GraphTruncationStateV1 = {
  schemaVersion: '1.0.0';
  truncated: true;
  reason: 'MAX_DEPTH' | 'MAX_NODES' | 'MAX_EDGES' | 'TRAVERSAL_BUDGET' | 'SERVER_TIMEOUT';
  omittedNodeCount: number;
  omittedEdgeCount: number;
};

type GraphNeighborhoodResultV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  centerRef: GraphNodeReferenceV1;
  addedNodes: readonly GraphNodeV1[];
  addedEdges: readonly GraphEdgeV1[];
  completeness: GraphResultCompletenessV1;
  appliedLimits: GraphAppliedLimitsV1;
  continuation?: GraphContinuationTokenV1;
  truncation?: GraphTruncationStateV1;
};

type GraphPathSegmentV1 = {
  schemaVersion: '1.0.0';
  step: number;
  nodeRef: GraphNodeReferenceV1;
  edgeRef: GraphEdgeReferenceV1; // edge that leads to this node
  direction: GraphTraversalDirectionV1;
};

type GraphPathResultV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  fromRef: GraphNodeReferenceV1;
  toRef: GraphNodeReferenceV1;
  paths: readonly { pathId: string; segments: readonly GraphPathSegmentV1[] }[];
  completeness: GraphResultCompletenessV1;
  appliedLimits: GraphAppliedLimitsV1;
  truncation?: GraphTruncationStateV1;
};

type GraphPathDescriptionSegmentV1 = {
  schemaVersion: '1.0.0';
  step: number;
  narration: string; // accessible path narration text
  nodeRef: GraphNodeReferenceV1;
  edgeRef?: GraphEdgeReferenceV1;
};

type GraphPathDescriptionV1 = {
  schemaVersion: '1.0.0';
  pathId: string;
  segments: readonly GraphPathDescriptionSegmentV1[];
  summary: string;
};
```

### 3.10 A.10 — Capabilities and unavailable reasons

```ts
type GraphCapabilityV1 =
  | 'SNAPSHOT'
  | 'NEIGHBORHOOD'
  | 'PATH'
  | 'PATH_DESCRIPTION'
  | 'CONFLICT_OVERLAY'
  | 'GAP_OVERLAY'
  | 'IMPACT_OVERLAY'
  | 'EVIDENCE_DETAIL'
  | 'SNAPSHOT_REFRESH'
  | 'DEEP_LINK_RESTORE';

type GraphUnavailableReasonV1 =
  | 'PROJECTION_UNAVAILABLE'
  | 'PROJECTION_REBUILDING'
  | 'SNAPSHOT_STALE'
  | 'CONTINUATION_EXPIRED'
  | 'ACCESS_CHANGED'
  | 'PROJECT_CHANGED'
  | 'POLICY_CHANGED'
  | 'ROOT_RESOURCE_DELETED'
  | 'ROOT_RESOURCE_ARCHIVED'
  | 'OVERLAY_UNAVAILABLE'
  | 'ANALYZER_TIMEOUT'
  | 'DEEP_LINK_TARGET_UNAVAILABLE'
  | 'NETWORK_FAILURE';

type GraphCapabilitiesViewV1 = {
  schemaVersion: '1.0.0';
  capabilities: readonly GraphCapabilityV1[];
  unavailable?: { reason: GraphUnavailableReasonV1; message: string }[];
};
```

## 4. B — Normalized semantic axes

FE-P3-S3 separates nine orthogonal concepts. No axis may be folded into another.

```ts
// Axis 1 — resource/node kind (what a node IS)
type GraphResourceKindV1 =
  | 'ENTITY'
  | 'FACT'
  | 'CLAIM'
  | 'RELATION'
  | 'EVENT'
  | 'DECISION'
  | 'EVIDENCE'
  | 'SOURCE'
  | 'CONFLICT'
  | 'KNOWLEDGE_GAP';

// Axis 2 — edge semantic kind (what an edge MEANS)
type GraphEdgeSemanticKindV1 =
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

// Axis 3 — authority / provenance-lineage classification (how content was
// established). Reduced to authority lineage only. Edge semantic kinds,
// resource/candidate types, conflict/gap types and overlay membership are
// expressed on their own axes, never here.
type GraphAuthorityClassificationV1 = 'CANONICAL' | 'DERIVED_INFERENCE' | 'DISCOVERY_CANDIDATE';

// Axis 4 — base-view membership
type GraphBaseViewKindV1 = 'KNOWLEDGE_SEMANTIC' | 'GOVERNANCE_IMPACT' | 'OPERATIONAL_DEPENDENCY';

// Axis 5 — overlay membership
type GraphOverlayKindV1 = 'CONFLICT' | 'KNOWLEDGE_GAP' | 'RECURSIVE_IMPACT';

// Axis 6 — projection health
type GraphProjectionHealthV1 =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'TRUNCATED'
  | 'STALE'
  | 'REBUILDING'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'ACCESS_RESTRICTED';

// Axis 7 — result completeness
type GraphResultCompletenessV1 = 'COMPLETE' | 'PARTIAL' | 'TRUNCATED';

// Axis 8 — access / masking state
type GraphAccessMaskingStateV1 = 'VISIBLE' | 'MASKED' | 'HIDDEN';

// Axis 9 — traversal-relative direction (derived, never intrinsic)
type GraphTraversalDirectionV1 = 'OUTGOING_FROM_ROOT' | 'INCOMING_TO_ROOT';
```

Rules:

- Axis 3 (authority) is independent of axis 2 (edge semantic kind) and axis 1
  (resource kind). It contains only authority/provenance lineage:
  `CANONICAL` (approved Canonical meaning), `DERIVED_INFERENCE` (derived from
  approved knowledge), `DISCOVERY_CANDIDATE` (not yet approved). Edge semantic
  kinds (`CANONICAL_STATEMENT_ASSOCIATION`, `EVIDENCE_LINKAGE`,
  `TEMPORAL_RELATIONSHIP`, `GOVERNANCE_IMPACT`, `OPERATIONAL_DEPENDENCY`,
  `CONFLICT`, `KNOWLEDGE_GAP`, `POSSIBLY_SAME`) and resource states
  (conflict/gap proposals) live on axis 2 / axis 1, never on axis 3.
- **`ACTION_CANDIDATE` is not part of FE-P3-S3.** There is no `ACTION_CANDIDATE`
  resource kind, node payload, or authority value. ActionCandidate rendering is
  deferred to FE-P4 (governance/execution); FE-P3-S3 never renders an Action
  Candidate (see also C and AC-14).
- Axis 9 is never persisted as an intrinsic edge field; it is derived from the
  snapshot root and the edge `from`/`to` only when a root is defined.

### 4.1 B.1 — Projection mapping

| Resource kind | Graph representation                        | Notes                                                                            |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| ENTITY        | node                                        | stable `entityId` resource identity                                              |
| FACT          | node                                        | typed `FactValueV1` payload                                                      |
| CLAIM         | node                                        | typed `ClaimValueV1` payload                                                     |
| RELATION      | edge **and** optional reified RELATION node | see B.2                                                                          |
| EVENT         | node                                        | typed `EventValueV1` payload                                                     |
| DECISION      | node                                        | typed `DecisionValueV1` payload                                                  |
| EVIDENCE      | node                                        | evidence span node; `EVIDENCE_LINKAGE` edges to its claim/fact                   |
| SOURCE        | node                                        | source identity node                                                             |
| CONFLICT      | node (proposal) + `CONFLICT` edges          | conflict proposal is a node kind; conflict relationship is an edge semantic kind |
| KNOWLEDGE_GAP | node (proposal) + `KNOWLEDGE_GAP` edges     | gap proposal is a node kind; gap relationship is an edge semantic kind           |

### 4.2 B.2 — Relation representation

Relations are a **typed combination** of edges and nodes:

1. Primary form: a directed edge between two nodes with
   `relationRef: GraphRelationReferenceV1` (`relationId` + optional `qualifier`).
   `from`/`to` define the relation source/target; no intrinsic
   `INCOMING`/`OUTGOING` field is stored.
2. Reified form: when a relation is itself the subject of another relationship,
   a `RELATION` node is emitted whose `resourceRef` uses
   `resourceKind: 'RELATION'` and `resourceId: relationId`, with payload
   `GraphRelationPayloadV1` carrying `subjectRef`, `objectRef` and n-ary
   `otherEndpointRefs`.

Stable identity for qualified or n-ary relations is preserved by
`GraphRelationReferenceV1` (`relationId` + `qualifier`); the qualifier
distinguishes distinct qualified edges of the same `relationId`.

## 5. C — Base views and overlays

One unambiguous model:

- **Base view kinds** (axis 4): `KNOWLEDGE_SEMANTIC`, `GOVERNANCE_IMPACT`,
  `OPERATIONAL_DEPENDENCY`.
- **Overlay kinds** (axis 5): `CONFLICT`, `KNOWLEDGE_GAP`, `RECURSIVE_IMPACT`.

Composition rules:

- A snapshot request selects exactly **one** base view kind.
- Zero or more overlays may be active; each overlay kind may appear at most once.
- A snapshot without a base view is invalid; an overlay cannot be selected as
  the sole view.
- Overlay composition is additive set-union; it is order-independent and defines
  no implicit ordering between overlays.
- Each overlay result references its own overlay identity
  (`GraphOverlayIdentityV1`) and is combined with the base snapshot in the
  response; each overlay item carries `overlayMemberships`.
- Overlay results are never persisted as Canonical graph edges.
- **`ACTION_CANDIDATE` is fully excluded from FE-P3-S3.** The contract defines
  no `ACTION_CANDIDATE` resource kind, payload or authority value. Governance
  impact and operational dependency content in FE-P3-S3 is expressed with the
  typed `GOVERNANCE_IMPACT` / `OPERATIONAL_DEPENDENCY` edge semantic kinds and
  the reduced authority axis only. ActionCandidate rendering is deferred to
  FE-P4 (see B and AC-14).

Snapshot and revision ownership:

- The base snapshot owns `snapshotId` and `projectionRevision`.
- Each active overlay owns `overlaySnapshotId`, `overlayRevision`,
  `analyzerRevision` and its own `policyContextRevision`.

Cache identity and removal:

- Cache keys are Project/policy/access/snapshot/overlay revision aware (F.3).
- Removing an overlay restores the base view without residue; re-requesting an
  overlay requires the expected overlay revision and returns `SNAPSHOT_STALE`
  on mismatch.

Forbidden combinations:

- overlay without base view;
- duplicate overlay kind in one request;
- mixing two base view kinds in one snapshot;
- any `ACTION_CANDIDATE` content (no such resource kind, payload or authority
  value exists in FE-P3-S3).

## 6. D — Read operations

All operations are read-only `POST` Product API calls under
`/product-api/frontend/knowledge/graph/*` (matching the repository Product read
convention). Every operation uses the typed `FrontendKnowledgeGraphClient`
(`packages/shotgun-api-client/src/frontend-knowledge-graph-client.ts`), the
server-derived `FrontendReadScope`, strict request/response decoders, and
`AbortSignal` cancellation.

| #   | Operation                      | Route (POST)                                             | Client method                        |
| --- | ------------------------------ | -------------------------------------------------------- | ------------------------------------ |
| 1   | Initial semantic snapshot      | `/product-api/frontend/knowledge/graph/snapshot`         | `getGraphSnapshot(request)`          |
| 2   | Neighborhood expansion         | `/product-api/frontend/knowledge/graph/neighborhood`     | `expandGraphNeighborhood(request)`   |
| 3   | Supported or shortest path     | `/product-api/frontend/knowledge/graph/path`             | `findGraphPath(request)`             |
| 4   | Typed path description         | `/product-api/frontend/knowledge/graph/path/describe`    | `describeGraphPath(request)`         |
| 5   | Conflict overlay               | `/product-api/frontend/knowledge/graph/overlay/conflict` | `getConflictOverlay(request)`        |
| 6   | Knowledge-gap overlay          | `/product-api/frontend/knowledge/graph/overlay/gap`      | `getKnowledgeGapOverlay(request)`    |
| 7   | Recursive-impact overlay       | `/product-api/frontend/knowledge/graph/overlay/impact`   | `getRecursiveImpactOverlay(request)` |
| 8   | Evidence and provenance detail | `/product-api/frontend/knowledge/graph/evidence`         | `getGraphEvidenceDetail(request)`    |
| 9   | Snapshot refresh               | `/product-api/frontend/knowledge/graph/snapshot/refresh` | `refreshGraphSnapshot(request)`      |
| 10  | Deep-link restoration          | `/product-api/frontend/knowledge/graph/restore`          | `restoreGraphDeepLink(request)`      |

### 6.1 D.1 — Exact request, response and failure contracts

The exact `v1` request, response and failure contracts are frozen here. No
operation type is left to implementation-time definition.

```ts
type GraphSnapshotIdentityV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string; // non-empty
  projectId: string; // non-empty
  viewKind: GraphBaseViewKindV1;
  projectionRevision: string; // non-empty
  generatedAt: string; // ISO-8601
};

type GraphOperationFailureV1 = {
  schemaVersion: '1.0.0';
  reason: GraphUnavailableReasonV1;
  message: string;
  retryable: boolean; // true only for idempotent snapshot/overlay reads
};

type GraphFilterSetV1 = {
  schemaVersion: '1.0.0';
  nodeKindFilters?: readonly GraphResourceKindV1[];
  edgeSemanticKindFilters?: readonly GraphEdgeSemanticKindV1[];
  authorityFilters?: readonly GraphAuthorityClassificationV1[];
  temporalFilters?: GraphTemporalValidityV1;
  evidenceFilters?: { sourceId?: string; evidenceSpanId?: string };
};

// 1. Initial semantic snapshot
type GraphSnapshotRequestV1 = {
  schemaVersion: '1.0.0';
  rootRefs?: readonly GraphNodeReferenceV1[]; // empty = project-wide root set
  viewKind: GraphBaseViewKindV1; // exactly one base view
  overlayKinds: readonly GraphOverlayKindV1[]; // each kind at most once
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1; // requested; server clamps
  expectedSnapshotRevision?: string;
};

type GraphSnapshotResultV1 = {
  schemaVersion: '1.0.0';
  identity: GraphSnapshotIdentityV1;
  health: GraphProjectionHealthV1;
  completeness: GraphResultCompletenessV1;
  nodes: readonly GraphNodeV1[];
  edges: readonly GraphEdgeV1[];
  appliedLimits: GraphAppliedLimitsV1;
  truncation?: GraphTruncationStateV1; // required when completeness === 'TRUNCATED'
  overlays: readonly GraphOverlayIdentityV1[];
  capabilities: GraphCapabilitiesViewV1;
  continuation?: GraphContinuationTokenV1; // allowed; see continuation invariant
};

// 2. Neighborhood expansion
type GraphNeighborhoodRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  centerRef: GraphNodeReferenceV1;
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  continuationToken?: string; // allowed; see continuation invariant
};

// 3. Supported or shortest path
type GraphPathRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  fromRef: GraphNodeReferenceV1;
  toRef: GraphNodeReferenceV1;
  edgeSemanticKinds?: readonly GraphEdgeSemanticKindV1[];
  limits?: GraphTraversalLimitsV1;
};

// 4. Typed path description
type GraphPathDescribeRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  pathId: string; // non-empty
};

// 5/6/7. Overlay reads (shared request; response per overlay)
type GraphOverlayRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string; // base snapshot
  projectionRevision: string;
  overlayKind: GraphOverlayKindV1; // 'CONFLICT' | 'KNOWLEDGE_GAP' | 'RECURSIVE_IMPACT'
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  expectedOverlayRevision?: string;
  continuationToken?: string; // allowed only for RECURSIVE_IMPACT
};

type GraphOverlayResultV1 = {
  schemaVersion: '1.0.0';
  baseSnapshotId: string;
  identity: GraphOverlayIdentityV1;
  health: GraphProjectionHealthV1;
  completeness: GraphResultCompletenessV1;
  nodes: readonly GraphNodeV1[];
  edges: readonly GraphEdgeV1[];
  appliedLimits: GraphAppliedLimitsV1;
  truncation?: GraphTruncationStateV1; // required when completeness === 'TRUNCATED'
  continuation?: GraphContinuationTokenV1; // only when overlayKind === 'RECURSIVE_IMPACT'
};

// 8. Evidence and provenance detail
type GraphEvidenceTargetV1 =
  { kind: 'NODE'; nodeRef: GraphNodeReferenceV1 } | { kind: 'EDGE'; edgeRef: GraphEdgeReferenceV1 };

type GraphEvidenceDetailRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  target: GraphEvidenceTargetV1;
  evidenceRef?: { sourceId: string; evidenceSpanId: string };
};

type GraphEvidenceEntryV1 = {
  schemaVersion: '1.0.0';
  sourceId: string;
  sourceVersionId: string;
  evidenceSpanId: string;
  snippet: string;
};

type GraphEvidenceDetailResultV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  targetRef: GraphNodeReferenceV1 | GraphEdgeReferenceV1;
  provenance?: GraphProvenanceSummaryV1;
  evidence: readonly GraphEvidenceEntryV1[];
  accessMasking: GraphAccessMaskingStateV1; // 'MASKED' returns no evidence entries
};

// 9. Snapshot refresh
type GraphSnapshotRefreshRequestV1 = GraphSnapshotRequestV1 & {
  schemaVersion: '1.0.0';
  expectedSnapshotRevision: string; // required, non-empty
};

// 10. Deep-link restoration
type GraphRestoreRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  viewKind: GraphBaseViewKindV1;
  overlayKinds: readonly GraphOverlayKindV1[];
  selectedNodeRefs: readonly GraphNodeReferenceV1[];
  expectedSnapshotRevision?: string;
};

type GraphRestoreResultV1 = {
  schemaVersion: '1.0.0';
  snapshot: GraphSnapshotResultV1;
  focusRefs: readonly GraphNodeReferenceV1[]; // selection/focus restoration targets
};
```

### 6.2 D.2 — Cross-field invariants

The following invariants are frozen and enforced by the decoders:

- **Numeric rules**: `maxDepth` is an integer in `1..10`; `maxNodes` integer in
  `1..500`; `maxEdges` integer in `1..1000`; `traversalBudget` and
  `serverTimeoutBudgetMs` are non-negative integers (`serverTimeoutBudgetMs` in
  `1000..30000`). Values outside these ranges are rejected or clamped, and
  `clamped: true` is set when clamped.
- **Truncation binding**: `completeness === 'TRUNCATED'` requires
  `truncation: GraphTruncationStateV1` present; `completeness === 'COMPLETE'` or
  `'PARTIAL'` forbids the `truncation` field.
- **Path edge binding**: `GraphPathSegmentV1.segments[0].edgeRef` is optional
  (origin node has no incoming edge); for every `step > 0`, `edgeRef` is
  required and must resolve within the snapshot.
- **Node kind binding**: for every `GraphNodeV1`,
  `nodeKind === resourceRef.resourceKind`; the decoder rejects a mismatch.
- **Masking payload binding**: `accessMasking === 'VISIBLE'` requires the
  `payload` for the declared `nodeKind` and allows provenance/evidence/temporal;
  `accessMasking === 'MASKED'` requires a masked placeholder `label` and forbids
  `payload`, `provenance`, `evidence` and `temporalValidity`; `HIDDEN` items
  never appear in any response.
- **Applied-limits binding**: `GraphAppliedLimitsV1` is required in snapshot,
  neighborhood, path and overlay results; path-description and evidence-detail
  results do not perform traversal and therefore omit `appliedLimits`; refresh
  and restore return a `GraphSnapshotResultV1` (which includes it).
- **Continuation request union**: only operations 1 (snapshot), 2 (neighborhood)
  and 7 (recursive-impact overlay) may issue or accept a continuation token.
  Their request types are the exact union that accepts `continuationToken`;
  operations 3–6, 8, 9 and 10 reject a `continuationToken` field as unknown.
- **Revision binding**: every response carries `projectionRevision`
  (+ `overlayRevision` for overlays); mismatch with `expectedSnapshotRevision` /
  `expectedOverlayRevision` yields `SNAPSHOT_STALE` or the typed failure.

## 6.3 D.3 — Operation contract summary (exact types above)

The ten operations use the exact request/response/failure types in D.1 with the
invariants in D.2:

1. **Initial semantic snapshot** — request: root/root-set, base view kind,
   overlays, filters (node kind, edge semantic kind, authority, temporal,
   evidence), limits, optional `expectedSnapshotRevision`. Response:
   `GraphSnapshotResultV1` with snapshot identity, projection health, result
   completeness, nodes, edges, applied limits, truncation, capabilities.
2. **Neighborhood expansion** — request: `snapshotId`, `projectionRevision`,
   `centerRef`, traversal filters, limits, optional continuation token.
   Response: `GraphNeighborhoodResultV1`.
3. **Supported or shortest path** — request: `snapshotId`, `projectionRevision`,
   `fromRef`, `toRef`, allowed edge semantic kinds, limits. Response:
   `GraphPathResultV1`.
4. **Typed path description** — request: `snapshotId`, `projectionRevision`,
   `pathId`. Response: `GraphPathDescriptionV1`.
5. **Conflict overlay** — request: base `snapshotId`, `projectionRevision`,
   overlay kind `CONFLICT`, filters, limits, optional `expectedOverlayRevision`.
   Response: overlay identity + `CONFLICT` nodes/edges + health.
6. **Knowledge-gap overlay** — same shape with overlay kind `KNOWLEDGE_GAP`.
7. **Recursive-impact overlay** — same shape with overlay kind `RECURSIVE_IMPACT`;
   backed by the impact analyzer behind the FE-P3-S3 impact port.
8. **Evidence and provenance detail** — request: `snapshotId`,
   `projectionRevision`, `nodeRef` or `edgeRef`, optional `evidenceRef`.
   Response: provenance/evidence summaries, lineage, `accessMasking`.
9. **Snapshot refresh** — request: same as snapshot + `expectedSnapshotRevision`.
   Response: `GraphSnapshotResultV1` with new revision or explicit
   `STALE`/`REBUILDING` health.
10. **Deep-link restoration** — request: `snapshotId`, `projectionRevision`,
    root/root-set, view kind, overlays, selected node refs,
    `expectedSnapshotRevision`. Response: snapshot + focus/selection refs.

Common contract obligations for every operation:

- **Scope**: server-derived Principal, Session, Active/Resource/Effective
  Project, access revision, policy context revision; browser never overrides.
- **Revision identity**: responses bind to `projectionRevision`
  (+ `overlayRevision` for overlays); mismatch with `expected*Revision` yields
  `SNAPSHOT_STALE` or a typed failure (D.2).
- **Applied limits**: snapshot, neighborhood, path and overlay responses return
  `GraphAppliedLimitsV1`; path-description and evidence-detail responses omit it
  (D.2). Truncation is explicit via `GraphTruncationStateV1`.
- **Continuation**: only operations 1, 2 and 7 may return or accept a
  continuation token (exact request union in D.2); tokens are opaque, expiring,
  and bound per A.7. Expiry yields `CONTINUATION_EXPIRED`; the browser re-issues
  the initial request.
- **Cancellation**: every client method accepts `AbortSignal`.
- **Deterministic and retryable failures**: snapshot and overlay reads are
  idempotent and may be retried safely; typed failures use
  `GraphUnavailableReasonV1` and the shared typed-failure taxonomy. No write
  command is introduced to recover a graph read.
- **Path/neighborhood**: use server-issued snapshot context; the browser never
  performs unrestricted traversal over hidden server data.

## 7. E — Projection and persistence architecture

### 7.1 E.1 — Authoritative implementation model

Decision: **explicit hybrid** with an immutable snapshot-context descriptor.

- **Base-view snapshots** (`KNOWLEDGE_SEMANTIC`, `GOVERNANCE_IMPACT`,
  `OPERATIONAL_DEPENDENCY`) are **ephemeral computations** at read time over
  Canonical / Stage 9 / Compiled Truth read sources, bounded by server limits.
  **No graph node/edge rows are persisted.**
- **Immutable Snapshot Context descriptor**: for every issued snapshot, an
  immutable descriptor row is persisted (no graph items): `snapshotId`,
  `projectId`, `viewKind`, `overlayKinds`, `rootRefs`, `filtersDigest`,
  `limits`, `accessRevision`, `policyContextRevision`, `projectionRevision`,
  `generatedAt`, `expiresAt`. Subsequent operations (neighborhood, path, path
  description, evidence detail, refresh, deep-link restore) resolve
  `snapshotId` → descriptor and reconstruct the identical computation; an
  unknown or expired `snapshotId` returns `SNAPSHOT_STALE` /
  `DEEP_LINK_TARGET_UNAVAILABLE`.
- A **materialized projection-health registry** is persisted per Project:
  `(projectId, viewKind, projectionRevision, status, generatedAt, lag,
rebuildState, accessRevision, policyContextRevision)`.
- **Overlay health/identity** is persisted per
  `(projectId, baseSnapshotId, overlayKind)`:
  `overlaySnapshotId, overlayRevision, analyzerRevision, policyContextRevision,
generatedAt, completeness, truncation, unavailableReason`.
- **Continuation tokens** are persisted (or in-memory with a PostgreSQL fallback
  store) as opaque tokens with server-side binding (A.7) and TTL expiry.

### 7.2 E.2 — Frozen behaviors

- **Snapshot revision generation**: `projectionRevision` is monotonically
  increasing per Project and increments when the underlying Canonical revision,
  access revision, policy context revision, or the applicable Stage 9/Compiled
  Truth inputs change.
- **Projection-health registry**: updated on every snapshot computation;
  `REBUILDING` is recorded when a recomputation starts and `COMPLETE`/`FAILED`
  when it ends.
- **Rebuild behavior**: rebuilding is triggered by revision drift; stale reads
  return `STALE` health or the typed `PROJECTION_REBUILDING` state; no automatic
  browser retry loop.
- **PostgreSQL structures and migration**: migration **026** creates
  `frontend_knowledge_graph_snapshot_context` (immutable descriptor),
  `frontend_knowledge_graph_projection_health`,
  `frontend_knowledge_graph_overlay_health` and
  `frontend_knowledge_graph_continuation`. No migration is executed in this
  preparation round.
- **Snapshot-context lifecycle**: a snapshot descriptor is immutable once
  written; it expires by `expiresAt` TTL and is pruned with the health window.
  Overlay operations and deep-link restore resolve only current, unexpired
  descriptors.
- **Overlay artifact storage**: overlay results are ephemeral; only overlay
  health/identity rows are persisted. Overlay items are never persisted as
  Canonical graph edges.
- **Retention and cleanup**: health and snapshot-context rows are retained per
  Project with a bounded window; overlay health rows are pruned when the base
  snapshot is invalidated; continuation tokens expire via TTL and are purged.
- **Continuation-token stability**: tokens remain valid only while their binding
  (A.7) is unchanged; any revision or scope change invalidates them.
- **In-memory/PostgreSQL parity boundary**: the snapshot-context store, health
  registry, overlay health and continuation stores are the parity boundary;
  ephemeral computation is shared code, so parity tests cover the four storage
  adapters over the defined scenario set.
- **Stage 9 and NetworkX adaptation boundary**: Stage 9
  `GetKnowledgeGraph`/`GetKnowledgeImpact` and the NetworkX oracle are adapted
  behind the FE-P3-S3 `GraphReadPort` and `GraphImpactPort`; their identifiers
  are never exposed as FE-P3-S3 Canonical IDs.

### 7.3 E.3 — ADR decision (re-evaluated)

The hybrid model introduces server-side graph projection health, overlay
identity persistence and continuation-token storage that are **not** governed by
an existing accepted ADR. ADR-108 governs the typed read surface and accessible
fallback; ADR-106/ADR-119/ADR-124 do not decide the graph projection persistence
model.

Decision: **NEW_PROPOSED_ADR_REQUIRED — ADR-127** (`Semantic Graph Projection
Read Persistence, Health and Continuation Boundary`), created as
`PROPOSED`/unapproved. The unresolved decision is not silently incorporated into
the frozen contract; ADR-127 records the exact user decision required and the
Acceptance Criteria blocked by its acceptance:

- FE-P3-S3-AC-13 (overlay isolation and persistence)
- FE-P3-S3-AC-16 (cache isolation)
- FE-P3-S3-AC-27 (in-memory/PostgreSQL parity)
- FE-P3-S3-AC-31 (formal completion governance)

## 8. F — Security and scope hardening

### 8.1 F.1 — Disclosure versus masking

Two distinct categories:

- **DISCLOSABLE_MASKED**: the resource's existence may be disclosed; its content
  is masked. The node/edge is present with `accessMasking: 'MASKED'`, a masked
  placeholder label, and no payload/provenance/evidence content.
- **FULLY_HIDDEN**: the resource's existence is completely hidden. The
  node/edge is omitted from the response, counts, paths, neighborhoods and
  truncation reporting.

Count, path, neighborhood and truncation behavior:

- Hidden resources are excluded **before** counting and before truncation
  decisions, so truncation boundaries cannot reveal hidden existence.
- Masked resources are counted but their content is masked.
- Paths and neighborhoods never reference hidden nodes or edges.
- Node count, edge count and `omittedNodeCount`/`omittedEdgeCount` in truncation
  state exclude hidden resources.

### 8.2 F.2 — Cross-Project deep links

Cross-Project deep links are consistent with Active Project, Resource Project
and Effective Project rules:

- An accessible Resource Project must **not** silently replace the Active
  Project.
- A deep link whose root belongs to a different Project resolves only when the
  Active Project is the Effective Project for that root; otherwise it fails with
  `ACCESS_RESTRICTED` (typed) and never silently switches Project.
- Project switching is an explicit user action that re-reads under the new scope
  and never reuses another scope's cache.

### 8.3 F.3 — Cache keys

Two-phase cache keys avoid requiring an unknown response revision:

- **Scope-phase key (initial fetch)**: computed entirely from pre-request
  inputs — `activeProjectId`, `accessRevision`, `policyContextRevision`,
  request root/filters/view/overlay kinds/limits.
- **Snapshot-phase key (post-response)**: `scope-phase key` + `snapshotId` +
  `projectionRevision` (+ `overlaySnapshotId` + `overlayRevision` per active
  overlay), applied only after the first response and used for refresh,
  neighborhood, path and deep-link reads.

No cache key requires a response revision that is not yet known.

## 9. UI and layout ownership (D10)

- React owns interaction and presentation state.
- React Query owns read caching only.
- Cytoscape, when used, owns canvas rendering and layout only.
- Layout coordinates, zoom, pan and temporary selection are not server authority.
- Meaningful filters and selected resource references may be URL state.
- Large layouts must not block the main interaction thread without bounded
  behavior (see G, AC-23).
- Animation must respect reduced-motion preferences (see G, AC-22).
- Refreshing data must preserve selection and focus by stable resource identity
  (see G, AC-17).

## 10. Write and navigation boundaries (D11)

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

## 11. Failure and recovery (D12)

Typed handling is required for every `GraphUnavailableReasonV1` value:
`PROJECTION_UNAVAILABLE`, `PROJECTION_REBUILDING`, `SNAPSHOT_STALE`,
`CONTINUATION_EXPIRED`, `ACCESS_CHANGED`, `PROJECT_CHANGED`, `POLICY_CHANGED`,
`ROOT_RESOURCE_DELETED`, `ROOT_RESOURCE_ARCHIVED`, `OVERLAY_UNAVAILABLE`,
`ANALYZER_TIMEOUT`, `DEEP_LINK_TARGET_UNAVAILABLE`, `NETWORK_FAILURE`.

Snapshot and overlay reads are idempotent and may be retried safely. No write
command may be introduced merely to recover a graph read.

## 12. Performance boundary (D13)

Measurable limits and required evidence are defined in the Acceptance Criteria
(AC-23) with an approved baseline procedure. Where no repository baseline
supports a numerical threshold, the value is recorded as an explicit
implementation-time measurement requiring evidence, not an invented number.

## 13. Accessible equivalent views (D9)

Semantic equivalence is required across canvas, list, table and path
description. "Information equivalence" has an exact measurable meaning in AC-19:
the four views must expose the identical set of accessible `(nodeId, edgeId,
label, authority, baseViewMembership, overlayMemberships)` tuples rendered from
the same snapshot response. The fallback is not a reduced-information summary.

Frozen accessibility requirements: accessible names; headings and landmarks;
focus movement; selection announcements; expansion announcements; path
narration; truncation and stale-state announcements; return-focus behavior;
deep-link focus restoration; 200% zoom and reduced-motion behavior. The exact
keyboard operation set and announcement strings are frozen in AC-20 and AC-21.

## 14. G — Acceptance Criteria (objective)

Acceptance Criteria are frozen with stable IDs `FE-P3-S3-AC-01` through
`FE-P3-S3-AC-31`. None are marked passed in this preparation round. Ambiguous
wording has been replaced with the exact measurable meanings below.

| ID             | Acceptance criterion                                                                                                                                                                                                                                                                                                                                                                                                                                               | Objective evidence requirement                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-P3-S3-AC-01 | The exact V1 graph contracts (snapshot identity/response, node/edge references and payloads, provenance, evidence, temporal, revision binding, access/masking, projection health, result completeness, traversal and applied limits, continuation identity, overlay identity, neighborhood/path results, capabilities, unavailable reasons) exist with `schemaVersion: '1.0.0'`, unknown-field rejection, non-empty-ID validation, exhaustive unions and no `any`. | Contract unit tests: one positive and one negative decode test per shape; negative tests cover unknown field, empty ID, and unknown discriminant. |
| FE-P3-S3-AC-02 | Server-authoritative Project/access scope is enforced on every graph read; a browser-supplied Project, policy, access or revision value is rejected.                                                                                                                                                                                                                                                                                                               | Negative contract/integration tests: forged scope fields and revision override rejected with typed failure.                                       |
| FE-P3-S3-AC-03 | `getGraphSnapshot` returns a typed snapshot with nodes, edges, projection health, result completeness, applied limits and capabilities for the requested base view.                                                                                                                                                                                                                                                                                                | Contract + integration tests asserting the exact response shape and server-applied limits.                                                        |
| FE-P3-S3-AC-04 | Bounded traversal: server clamps or rejects depth/node/edge/budget/timeout; truncation is explicit with `GraphTruncationStateV1` and correct counts.                                                                                                                                                                                                                                                                                                               | Integration tests with requests above the cap asserting `clamped: true` and truncation state.                                                     |
| FE-P3-S3-AC-05 | `expandGraphNeighborhood` uses only server-issued snapshot context and returns bounded `addedNodes`/`addedEdges` with continuation when incomplete.                                                                                                                                                                                                                                                                                                                | Integration tests: continuation round-trip and binding-validity checks.                                                                           |
| FE-P3-S3-AC-06 | `findGraphPath` and `describeGraphPath` return typed paths and narration whose node/edge refs exist in the snapshot.                                                                                                                                                                                                                                                                                                                                               | Integration tests asserting every path segment reference resolves.                                                                                |
| FE-P3-S3-AC-07 | Provenance and Evidence summaries are returned with traceable `sourceIds`/`evidenceSpanIds` that resolve to existing Evidence records.                                                                                                                                                                                                                                                                                                                             | Contract + integration tests resolving each summary reference.                                                                                    |
| FE-P3-S3-AC-08 | Canonical and inferred edges render with distinct visual styling and distinct accessible labels/descriptions based on `authority`.                                                                                                                                                                                                                                                                                                                                 | Browser E2E snapshot of style + accessibility-tree label comparison.                                                                              |
| FE-P3-S3-AC-09 | `POSSIBLY_SAME` remains a typed edge; no code path merges nodes; a test attempts a merge-like operation and asserts no mutation occurs.                                                                                                                                                                                                                                                                                                                            | Unit negative test plus API read test.                                                                                                            |
| FE-P3-S3-AC-10 | Conflict overlay returns `CONFLICT` items bound to `overlaySnapshotId`/`overlayRevision`/`analyzerRevision` and never writes Canonical edges.                                                                                                                                                                                                                                                                                                                      | Integration test asserting overlay identity and a write-absence assertion.                                                                        |
| FE-P3-S3-AC-11 | Knowledge-gap overlay returns `KNOWLEDGE_GAP` items with overlay identity and no Canonical edge writes.                                                                                                                                                                                                                                                                                                                                                            | Integration test as AC-10 for gap.                                                                                                                |
| FE-P3-S3-AC-12 | Recursive-impact overlay returns bounded impact paths through the FE-P3-S3 impact port with truncation state when limits are reached.                                                                                                                                                                                                                                                                                                                              | Integration test with limits and truncation assertions.                                                                                           |
| FE-P3-S3-AC-13 | Overlay isolation and persistence: each overlay carries its own identity; overlay items are never persisted as Canonical edges; overlay health rows are the only persisted overlay state.                                                                                                                                                                                                                                                                          | Integration + database tests asserting the health store and absence of Canonical edge writes.                                                     |
| FE-P3-S3-AC-14 | FE-P3-S3 contains zero `ACTION_CANDIDATE` content: the contract defines no `ACTION_CANDIDATE` resource kind, node payload or authority value; every snapshot and overlay response contains zero such items; ActionCandidate rendering is deferred to FE-P4.                                                                                                                                                                                                        | Contract + browser tests scanning every snapshot/overlay response for absent ActionCandidate discriminator.                                       |
| FE-P3-S3-AC-15 | `STALE`, `PARTIAL`, `TRUNCATED`, `FAILED`, `UNAVAILABLE` and `ACCESS_RESTRICTED` responses carry the exact health/completeness discriminant and render a non-success announcement.                                                                                                                                                                                                                                                                                 | Unit + browser tests per state.                                                                                                                   |
| FE-P3-S3-AC-16 | Cache isolation: two Projects, two policy revisions, two snapshot revisions and two overlay revisions never reuse each other's cached result; the scope-phase and snapshot-phase keys are distinct.                                                                                                                                                                                                                                                                | Browser tests asserting distinct query keys and purge behavior.                                                                                   |
| FE-P3-S3-AC-17 | Deep-link restoration restores the snapshot and moves focus to the selected node by `resourceId`; after a refresh the same `resourceId` retains focus.                                                                                                                                                                                                                                                                                                             | Browser E2E asserting focus target after restore and after refresh.                                                                               |
| FE-P3-S3-AC-18 | Canvas renders exactly the typed snapshot nodes/edges without any write action; no write method is invoked during canvas interaction.                                                                                                                                                                                                                                                                                                                              | Browser E2E + network assertion that no write endpoint is called.                                                                                 |
| FE-P3-S3-AC-19 | Information equivalence: for one snapshot response, canvas, list, table and path views expose the identical set of accessible `(nodeId, edgeId, label, authority, baseViewMembership, overlayMemberships)` tuples.                                                                                                                                                                                                                                                 | Browser E2E computing the four accessible sets and asserting equality.                                                                            |
| FE-P3-S3-AC-20 | Keyboard operation set (exact): Tab/Shift+Tab moves between graph regions; Arrow keys move node focus within the active region; Enter activates the focused node/edge; Escape returns from overlay or path to overview; Alt+L switches to list view, Alt+T to table, Alt+P to path, Alt+V to canvas; Alt+1/2/3 selects base view; Alt+Shift+1/2/3 toggles conflict/gap/impact overlays. Each key is exercised in E2E.                                              | Browser E2E per key plus axe scan with zero critical violations.                                                                                  |
| FE-P3-S3-AC-21 | Screen-reader semantics: every node/edge has an accessible name; graph regions have landmarks; selection/expansion/path/truncation/stale states produce exact announcement strings (frozen in the implementation request); return-focus and deep-link focus restoration work.                                                                                                                                                                                      | Browser E2E with axe plus assertion of the frozen announcement strings.                                                                           |
| FE-P3-S3-AC-22 | Reduced motion: with `prefers-reduced-motion: reduce`, all graph transitions and layout animations are disabled (no CSS animation durations > 0). 200% zoom: at 200% viewport zoom the list/table/path views remain fully operable with no horizontal loss of primary content.                                                                                                                                                                                     | Browser E2E at reduced-motion and at 200% zoom.                                                                                                   |
| FE-P3-S3-AC-23 | Performance: initial snapshot renders ≤ 500 nodes / ≤ 1000 edges; layout completes ≤ 2000 ms and interaction response ≤ 100 ms on the repository reference runner; incremental expansion adds ≤ 200 nodes per request; memory cleanup on route change verified; `AbortController` cancellation stops in-flight reads. Pass thresholds require an approved baseline procedure (reference machine and methodology recorded before execution).                        | Performance evidence: Playwright performance API measurements plus memory and cancellation assertions.                                            |
| FE-P3-S3-AC-24 | Error recovery: each `GraphUnavailableReasonV1` maps to a typed client failure; snapshot and overlay reads retry safely; no write is issued during recovery.                                                                                                                                                                                                                                                                                                       | Unit + browser tests per reason.                                                                                                                  |
| FE-P3-S3-AC-25 | A correction action on a graph node/edge navigates to the Knowledge Editor with a typed DraftChangeSet seed carrying the same stable resource refs.                                                                                                                                                                                                                                                                                                                | Integration/browser test asserting the seed payload.                                                                                              |
| FE-P3-S3-AC-26 | Zero direct Canonical, Approval or Action writes: the Graph Workspace exposes no write method for Canonical, Approval or Action; negative tests assert no such endpoint is reachable.                                                                                                                                                                                                                                                                              | Negative contract + route tests.                                                                                                                  |
| FE-P3-S3-AC-27 | In-memory/PostgreSQL parity for the four storage adapters (snapshot-context descriptor, projection health, overlay health, continuation stores) with identical behavior on an identical scenario set.                                                                                                                                                                                                                                                              | Parity test suite comparing both adapters over the defined scenario set.                                                                          |
| FE-P3-S3-AC-28 | Product API contract tests cover all ten read operations with strict decoding and typed failures.                                                                                                                                                                                                                                                                                                                                                                  | Contract test suite (one suite per operation).                                                                                                    |
| FE-P3-S3-AC-29 | Required integration, database and browser scenarios: (a) snapshot with truncation; (b) neighborhood continuation round-trip; (c) path + path description; (d) conflict and gap overlays; (e) recursive-impact overlay; (f) cross-Project deep link denied; (g) masked vs hidden resource; (h) cache isolation; (i) refresh stale→new; (j) keyboard and screen-reader E2E; (k) performance E2E; (l) migration 026 apply/rollback.                                  | Each scenario in the corresponding integration/database/browser suite.                                                                            |
| FE-P3-S3-AC-30 | Exact-head remote gates green: Quality, Frontend and Required Gates all `success` on the final implementation head.                                                                                                                                                                                                                                                                                                                                                | CI run evidence at the exact head.                                                                                                                |
| FE-P3-S3-AC-31 | Formal completion governance: completion manifest, evidence registry update, user approval, and no Ready/Merge without separate authorization.                                                                                                                                                                                                                                                                                                                     | Governance record.                                                                                                                                |

Blocked by proposed ADR-127 (until accepted): AC-13, AC-16, AC-27, AC-31.

All criteria remain `NOT_RUN` for this preparation round. No Product
implementation criterion is marked passed.
