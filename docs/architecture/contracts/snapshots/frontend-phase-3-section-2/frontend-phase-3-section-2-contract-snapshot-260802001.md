---
id: FRONTEND-PHASE-3-SECTION-2-CONTRACT-SNAPSHOT-260802001
classification: PRODUCT_CONTRACT_SNAPSHOT_PROPOSAL
status: REVIEW_PENDING
revision: 2
review_round: 1
review_result: CHANGES_REQUIRED
work_item: FE-P3-S2
governing_adr: ADR-126
base_commit_requested: cc3f50904f947c8d6d920c28e8ca542cb5d63569
actual_local_content_base: 917463a06749eab15ebab8dd3b511c2a3cb77b3d
branch: codex/frontend-phase-3-section-2-contract
implementation_authorized: false
---

# FE-P3-S2 Contract Snapshot — FrontendKnowledgeDraftChangeSet v1

## 1. Scope and authority

This snapshot freezes the proposed Product contract for Knowledge Editor and
DraftChangeSet Authoring. It covers Draft start, typed authoring, save,
validation, impact preview and review submission. It excludes Approval,
Canonical Commit, Review Center decisions, User Directive Proposal, external
Actions, Graph editing, Yjs/CRDT and FE-P3-S3.

The Knowledge Editor is not a Canonical Editor. Browser DOM, Markdown,
WYSIWYG state and local cache are not Canonical authority. Only the approved
DraftChangeSet Commit boundary may change Canonical knowledge.

Server-owned context includes Principal, Session, Active Project, Resource
Project, Draft Project, access revision, policy revision, Canonical revision,
Capabilities, Validation and Impact. Browser input may request an operation but
may not authoritatively create or replace those values.

## 2. Aggregate and identity

```ts
type FrontendKnowledgeDraftChangeSetV1 = {
  schemaVersion: '1.0.0';
  draftId: string;
  seedId?: string;
  answerRunId?: string;
  startMode: 'SEED_MATERIALIZATION' | 'KNOWLEDGE_PAGE';
  status:
    | 'DRAFT'
    | 'VALIDATING'
    | 'VALID'
    | 'INVALID'
    | 'STALE'
    | 'CONFLICT'
    | 'READY_FOR_REVIEW'
    | 'SUBMITTING'
    | 'SUBMITTED'
    | 'ABANDONED';
  revision: number;
  activeProjectId: string;
  resourceProjectId: string;
  draftProjectId: string;
  resourceId: string;
  base: FrontendKnowledgeDraftBaseV1;
  operations: readonly FrontendKnowledgeOperationV1[];
  validation?: DraftValidationArtifactRefV1;
  impactPreview?: DraftImpactArtifactRefV1;
  reviewResource?: ReviewResourceRefV1;
  reviewSubmission?: {
    reviewSubmissionId: string;
    draftId: string;
    draftRevision: number;
    operationDigest: string;
    validationArtifactRef: string;
    impactArtifactRef: string;
  };
  contentDigest: string;
  createdAt: string;
  updatedAt: string;
};
```

`principalId`, session identity, access scope and policy context are server
command-envelope authority. They may be represented in an internal binding or
response metadata, but are not accepted as browser authority.

Repeated materialization of the same Seed and Resource Project returns the
existing `draftId`. A Seed cannot create two Drafts. A different Resource
Project is a typed binding conflict.

## 3. Pinned base

```ts
type FrontendKnowledgeDraftBaseV1 = {
  resourceProjectId: string;
  canonicalResourceId: string;
  canonicalSnapshotId: string;
  canonicalRevisionId?: string;
  canonicalVersion: number;
  canonicalSnapshotDigest: string;
  revisionIdentityKind: 'RESOURCE_REVISION' | 'NEW_RESOURCE_SNAPSHOT';
  accessRevision: string;
  policyContextRevision: string;
  sourceLineage: readonly {
    sourceId: string;
    sourceVersionId: string;
    evidenceSpanIds: readonly string[];
  }[];
  projection?: {
    projectionId: string;
    projectionVersion: string;
    readiness: 'READY' | 'STALE' | 'DEGRADED' | 'NOT_BUILT';
    projectedCanonicalVersion: number;
    sourceSnapshotDigest: string;
    projectionDigest: string;
  };
};
```

The base is immutable after first materialization/start. A Projection is
reference/compare context and cannot replace the Canonical base.

`canonicalSnapshotId`, `canonicalVersion` and `canonicalSnapshotDigest` are
always required. For an existing Resource being edited or withdrawn,
`canonicalResourceId` and `canonicalRevisionId` are mandatory. A new Resource
may have no `canonicalRevisionId`, but it must use
`revisionIdentityKind: NEW_RESOURCE_SNAPSHOT` with the pinned Snapshot ID,
version and digest. An existing Resource without a provable revision ID fails
closed; `canonicalVersion` is not a per-Resource revision substitute. The
browser cannot select the mode or fabricate an identity.

Projection is optional context. Draft creation and basic operation validation do
not require a Projection. When a Projection is supplied, all identity,
canonical-version, source-digest and readiness fields are pinned together. A
missing or non-ready Projection may make Compare/Impact partial or unavailable,
but it never changes the Canonical base and never becomes a fabricated READY
state.

Projection becomes mandatory when the Draft starts from a Projection view, when
an operation `before`, rationale or expected impact references Projection
content, or when a Projection block is retained as the focus/return target. The
pinned reference includes kind, ID, revision/version, digest, status, projected
Canonical version and source snapshot digest.

## 4. Typed operation contract

```ts
type FrontendKnowledgeOperationV1 = {
  operationId: string;
  kind:
    | 'FACT_ADD' | 'FACT_UPDATE' | 'FACT_REMOVE'
    | 'CLAIM_ADD' | 'CLAIM_UPDATE' | 'CLAIM_REMOVE'
    | 'ENTITY_ADD' | 'ENTITY_UPDATE' | 'ENTITY_REFERENCE'
    | 'RELATION_ADD' | 'RELATION_UPDATE' | 'RELATION_REMOVE'
    | 'EVENT_ADD' | 'EVENT_UPDATE' | 'EVENT_REMOVE'
    | 'DECISION_ADD' | 'DECISION_UPDATE' | 'DECISION_REMOVE'
    | 'EVIDENCE_ATTACH' | 'EVIDENCE_DETACH'
    | 'TEMPORAL_VALIDITY_CHANGE'
    | 'CONFLICT_PROPOSAL' | 'KNOWLEDGE_GAP_PROPOSAL'
    | 'NO_OP';
  target: {
    targetType: 'FACT' | 'CLAIM' | 'ENTITY' | 'RELATION' | 'EVENT' |
      'DECISION' | 'EVIDENCE' | 'TEMPORAL' | 'CONFLICT' | 'KNOWLEDGE_GAP';
    targetId?: string;
    resourceId: string;
  };
  baseRevision: number;
  before?: unknown;
  after?: unknown;
  rationale: string;
  evidenceReferences: readonly {
    sourceId: string;
    sourceVersionId: string;
    evidenceSpanId: string;
  }[];
  expectedImpact: {
    summary: string;
    targetIds?: readonly string[];
  };
  operationRevision: number;
  contentDigest: string;
};
```

The server strictly decodes the discriminated operation and validates typed
`before`/`after`, target Project/resource, evidence accessibility, revision and
digest. `before` is required for update/remove operations; `after` is required
for add/update operations. `NO_OP` has no Canonical mutation effect and is valid
only when it records an explicit typed review result; it is not an empty Draft
placeholder.

User Directive and Action operations are not part of v1.

## 5. Commands and API candidates

Each command uses the existing Frontend command envelope:

```ts
type DraftCommandEnvelopeV1 = {
  schemaVersion: '1.0.0';
  clientRequestId: string;
  idempotencyKey: string;
  expectedDraftRevision?: number;
  expectedCanonicalVersion?: number;
  semanticDigest?: string;
};
```

The server derives all authority context. The proposed protected Product API
command family is:

| Command | Request target | Result |
|---|---|---|
| Materialize Draft | Seed ID | authoritative Draft snapshot |
| Start Seedless Draft | Knowledge Resource/page identity | authoritative Draft snapshot |
| Save Draft | Draft ID + operations/revision | saved Draft snapshot |
| Validate Draft | Draft ID + expected revision | validation artifact + Draft status |
| Generate Impact Preview | Draft ID + expected revision | impact artifact + Draft status |
| Submit Draft for Review | Draft ID + expected revision | Review Resource reference |
| Abandon Draft | Draft ID + expected revision | abandoned Draft snapshot |
| Resolve Command Outcome | original command identity | existing command outcome/resource |

Save, Validate, Preview and Submit remain separate commands. No command in this
snapshot performs Approval, Review decision or Canonical Commit.

The seven frozen API contracts require the following error, retry and
compatibility rules:

| API | Mandatory input | Typed failure examples | Retry/compatibility |
|---|---|---|---|
| Materialize Draft | `seedId` and command envelope | `NOT_FOUND`, `FORBIDDEN`, `PROJECT_BINDING_CONFLICT`, `OUTCOME_INDETERMINATE` | no automatic retry; original idempotency key replays; Ask Seed remains unchanged |
| Start Seedless Draft | server-resolved Resource/page target and envelope | `NOT_FOUND`, `FORBIDDEN`, `ACCESS_REVOKED`, `BASE_UNAVAILABLE` | no automatic mutation retry; additive to Knowledge read |
| Save Draft | `draftId`, complete operation revision, expected Draft/base revisions, digest | `DRAFT_NOT_FOUND`, `DRAFT_REVISION_CONFLICT`, `BASE_REVISION_STALE`, `VALIDATION_FAILED` | no automatic retry; same key only; Stage 5 remains compatible |
| Validate Draft | `draftId`, expected Draft/base revisions | `STALE`, `CONFLICT`, `VALIDATION_FAILED`, `ACCESS_REVOKED` | resolves existing outcome only; no new Draft content |
| Generate Impact Preview | `draftId`, expected Draft revision and bounded options | `STALE`, `CONFLICT`, `IMPACT_PARTIAL`, `ANALYZER_UNAVAILABLE` | artifact replay; partial is visible and not silently promoted |
| Submit Draft for Review | immutable Draft revision, validation/impact refs, expected revisions | `NOT_READY_FOR_REVIEW`, `STALE`, `CONFLICT`, `ACCESS_REVOKED`, `OUTCOME_INDETERMINATE` | no automatic retry; original key resolves Review Resource/outcome |
| Resolve Command Outcome | original request identity and semantic digest | `OUTCOME_NOT_FOUND`, `DIGEST_MISMATCH`, `COMMAND_SCOPE_MISMATCH` | resolution only; never a new key |

Abandon is a separate lifecycle command but not part of the seven-contract
initial Product API freeze. It must preserve retention history and cannot delete
submitted Drafts.

`Submit Draft for Review` returns `reviewSubmissionId`, submitted `draftId` and
immutable `draftRevision`, operation/content digest, Validation and Impact
artifact references, Evidence lineage and accepted Project/Policy context. The
same `(draftId, draftRevision)` returns at most one `reviewSubmissionId`.
Authoring after submission creates a new Draft revision and requires new
validation and a new Review Submission; the submitted revision is never edited.

## 6. Validation, comparison and impact

Server validation must check operation schema, domain invariants, evidence
accessibility, source/version pins, Project binding, pinned Canonical revision,
typed target existence and dangling references. Current Canonical drift produces
`STALE`; semantic disagreement or concurrent Draft revision produces
`CONFLICT`; unavailable analyzers may produce `PARTIAL`.

Validation and Impact artifacts use `COMPLETE | PARTIAL | FAILED | UNAVAILABLE`.
`PARTIAL` is not a Draft lifecycle state. A Draft cannot transition to
`READY_FOR_REVIEW` until all required artifacts are `COMPLETE`.

Comparison uses the pinned Canonical base and current authoritative read. It
does not merge or rewrite the Draft. Recursive Impact is server-produced and
returns an artifact reference, bounded traversal metadata, affected typed
targets and explicit truncation/unavailability information.

## 7. State and recovery

Draft status and command outcome are separate. Draft statuses are:

```text
DRAFT, VALIDATING, VALID, INVALID, STALE, CONFLICT,
READY_FOR_REVIEW, SUBMITTING, SUBMITTED, ABANDONED
```

Command outcomes are:

```text
ACCEPTED, COMPLETED, REJECTED, OUTCOME_UNKNOWN
```

An unknown outcome is resolved by the original command identity and never by a
new key. A stale or conflicting Draft is never automatically refreshed, merged
or submitted.

Access loss fails closed: server data and affected cache entries are not reused
under a new Project or policy scope, and the Draft cannot be submitted until a
new authorized binding is explicitly established.

## 8. Client state and cache contract

- React Query owns read/query cache only.
- A route-scoped Draft State Machine owns operations, dirty state, immutable
  first-edit binding, validation, impact preview and command recovery.
- A dirty Draft survives background refetch without silent overwrite.
- Project/access/policy revision drift marks the Draft stale or inaccessible;
  it does not replace the pinned binding.
- Query keys include principal/session/active Project/resource Project/access
  revision/policy revision/sensitivity and relevant resource/base revision.
- Leave Guard blocks navigation for dirty Drafts or unresolved command outcome.
- Reset/discard is explicit and is the only path that releases the old binding.

## 9. Persistence contract

Future persistence must provide an additive boundary for:

- Draft aggregate and revisions;
- typed operations or a versioned operation document;
- Seed-to-Draft materialization with one-to-one uniqueness;
- pinned base and lineage;
- validation/impact artifact references;
- command replay and produced-resource identity;
- abandonment, retention and forward-repair metadata.

The legacy Stage 5 `review.change_sets` table and its Claim JSON document remain
unchanged. No SQL is part of this snapshot.

The proposed table ownership is:

```text
frontend_knowledge_drafts
frontend_knowledge_draft_materializations
frontend_knowledge_draft_revisions
frontend_knowledge_draft_operations
frontend_knowledge_draft_artifacts
frontend_knowledge_review_submissions
```

Required invariants are: `seed_id` is nullable for seedless start but unique
when non-null; `draft_id` is unique in materializations;
`UNIQUE(draft_id, revision_number)` for revisions;
`UNIQUE(draft_id, revision_number, operation_id)` for operations; and
`UNIQUE(draft_id, draft_revision)` for Review Submissions. Abandonment is a
state transition, not deletion. Seed mapping, append-only revisions, submitted
revisions and Review Submissions remain retained; only artifact payloads may be
cleaned by explicit policy while reference, digest and status remain.

## 10. Acceptance Criteria

All criteria below are `NOT_RUN` in A1. They become implementation gates only
after this snapshot and the related ADR are accepted.

| ID | Acceptance criterion | Expected evidence |
|---|---|---|
| AC-01 | Seed materialization returns an authoritative Draft | API/contract evidence |
| AC-02 | Repeated Seed materialization returns the same Draft identity | idempotency evidence |
| AC-03 | Same Seed under another Resource Project fails closed | security negative evidence |
| AC-04 | Seed lineage remains attached to Draft | contract/persistence evidence |
| AC-05 | Seedless Knowledge Page start pins a server-selected base | API/security evidence |
| AC-06 | Browser cannot authoritatively set Principal/Project/Revision | negative contract evidence |
| AC-07 | Active, Resource, Draft and Effective Project are distinct and fixed | domain/API evidence |
| AC-08 | Canonical and optional Projection snapshot pinning is explicit | contract/persistence evidence |
| AC-09 | Fact/Claim/Entity/Relation/Event/Decision operations decode strictly | contract tests |
| AC-10 | Evidence, rationale, before/after and expected impact bind to each operation | contract/domain evidence |
| AC-11 | Draft revision and semantic digest enforce optimistic concurrency | command evidence |
| AC-12 | Draft save is separate from validation, preview and submission | API evidence |
| AC-13 | Server validation owns schema, invariant, evidence and revision checks | validation evidence |
| AC-14 | Current base drift produces STALE without auto-merge | stale negative evidence |
| AC-15 | Concurrent edit produces CONFLICT without silent overwrite | conflict negative evidence |
| AC-16 | Partial analyzer availability remains visible as artifact PARTIAL/UNAVAILABLE and blocks review readiness when required | partial evidence |
| AC-17 | Recursive Impact Preview is server-produced and bounded | impact evidence |
| AC-18 | Review submission creates at most one immutable Review Submission per Draft revision and only a Review Resource reference | boundary evidence |
| AC-19 | Canonical write and Approval bypass are impossible | security/architecture evidence |
| AC-20 | Dirty Draft survives background refetch | frontend state evidence |
| AC-21 | Project/access/policy drift isolates or stales Draft/cache | frontend security evidence |
| AC-22 | OUTCOME_UNKNOWN resolves through the original command identity | recovery evidence |
| AC-23 | In-memory and PostgreSQL adapters preserve the same contract | adapter parity evidence |
| AC-24 | Accessibility and keyboard authoring behavior is verified | frontend accessibility evidence |
| AC-25 | Legacy Stage 5 Claim Draft behavior remains compatible | regression evidence |

## 11. Explicit exclusions

- Approval, Approval Manifest and Canonical Commit;
- Review Center UI or Review decisions;
- User Directive Proposal;
- external Action execution;
- Graph editing and relationship exploration UI;
- Yjs/CRDT;
- FE-P3-S3;
- deployment and production verification;
- SQL migration and runtime dependency changes in A1.

## 12. Status boundary

```text
Contract Snapshot: REVIEW_PENDING
ADR-126: PROPOSED / REVIEW_PENDING
FE-P3-S2 Product implementation: NOT_STARTED
Database Migration execution: NOT_STARTED
Runtime Dependency change: NONE
Ready: NOT_AUTHORIZED
Merge: NOT_AUTHORIZED
FE-P3-S3: NOT_STARTED
Deployment: NOT_STARTED
```
