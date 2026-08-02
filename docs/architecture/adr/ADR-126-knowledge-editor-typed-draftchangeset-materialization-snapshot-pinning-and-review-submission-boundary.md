# ADR-126 — Knowledge Editor Typed DraftChangeSet Materialization, Snapshot Pinning and Review Submission Boundary

- Status: **PROPOSED / REVIEW_PENDING**
- Revision: 2 after GPT `CHANGES_REQUIRED` review
- Proposal date: 2026-08-02
- Work item: `FE-P3-S2`
- Decision owner: pending user and GPT review
- Related ADRs: ADR-100, ADR-101, ADR-105, ADR-106, ADR-107, ADR-118, ADR-119, ADR-123, ADR-124, ADR-125
- Contract snapshot: `docs/architecture/contracts/snapshots/frontend-phase-3-section-2/frontend-phase-3-section-2-contract-snapshot-260802001.md`
- Migration: `REQUIRED_WITH_EVIDENCE` for the future server-authoritative implementation; no migration is included here
- Runtime dependency: `NOT_REQUIRED`

## Context

FE-P3-S2 requires a Knowledge Editor that authors a server-owned DraftChangeSet
without becoming a Canonical Editor. A0 found three separate existing surfaces:

1. Ask can persist an immutable, `PROPOSED` transition seed with request-id
   idempotency, but it has no Draft materialization contract.
2. Stage 5 can compare a Claim Candidate and create a narrow Claim-oriented
   DraftChangeSet, but it does not model typed Knowledge Editor operations.
3. FE-P3-S1 can read Knowledge Pages, lineage and projection state, but it has
   no Draft command or authoring API.

The existing surfaces must remain compatible. The Stage 5 Claim aggregate must
not be silently widened, browser state must not become authority, and no
operation may write Canonical knowledge before the separately governed approval
and commit boundary.

## Decision

### 1. Separate versioned aggregate

The Knowledge Editor uses a new versioned aggregate:

```text
FrontendKnowledgeDraftChangeSet v1
```

It is not a rename, widening, or replacement of the Stage 5
`DraftChangeSet`. The two aggregates may share only stable external identity
and digest primitives. Existing Stage 5 adapters remain claim-review adapters.

The canonical Product contract is the v1 Contract Snapshot linked above. The
snapshot is proposed until this ADR is accepted.

### 2. Draft start boundaries

The server exposes two explicit start paths:

```text
DraftChangeSetSeed -> materialize Draft
Knowledge Page     -> start seedless Draft
```

Seed materialization rules:

- One Seed produces at most one Draft.
- A repeated materialization command returns the same Draft identity when the
  Seed and fixed Resource Project match.
- A request for the same Seed under a different Resource Project fails closed
  with a project-binding conflict; it does not create a second Draft.
- Seed state and AnswerRun lineage remain available as provenance.
- Seed payload is an initial proposal only and is never Canonical authority.

Seedless start rules:

- The server resolves the accessible Knowledge Resource and pins the starting
  Canonical base.
- The browser cannot submit Principal, Project, Canonical revision, access
  revision or policy revision as authority.
- A Compiled Truth or Projection may provide read context only; it cannot be
  promoted to the Canonical target by the client.
- Seedless start is a distinct command and is not an implicit Draft creation
  during Knowledge read or Ask question submission.

### 3. Project and authority binding

The aggregate records the server-derived binding:

```text
Active Project      — current shell context at command acceptance
Resource Project    — project owning the Knowledge Resource and base
Draft Project       — project fixed when the Draft is materialized/started
Effective Project   — server-derived command scope, never browser authority
```

The first persisted Draft binding is immutable. Active Project changes do not
move the Draft. A Draft cannot be attached to another Project through a browser
payload. Access and policy changes cause revalidation or `STALE`/access failure;
they do not silently rewrite the pinned context.

### 4. Pinned base snapshot

Every Draft has an immutable base binding containing at least:

- Resource Project;
- Canonical Resource ID;
- Canonical Revision ID or Canonical Version;
- Canonical Snapshot ID, version and digest;
- access revision;
- policy context revision;
- EvidenceSpan and SourceVersion lineage used by the Draft;
- optional Compiled Truth Projection ID/version and readiness metadata;
- the Canonical revision from which any Projection context was produced.

Projection data is context for comparison and impact preview. It never replaces
the Canonical base. A newer server revision marks a dirty Draft `STALE`; the
client does not auto-refresh, merge, or overwrite the Draft.

Revision identity is fixed as follows:

- `canonicalSnapshotId`, `canonicalVersion` and
  `canonicalSnapshotDigest` are always mandatory;
- for an existing Canonical Resource being edited or withdrawn,
  `canonicalResourceId` and `canonicalRevisionId` are mandatory;
- a new Resource may have no `canonicalRevisionId`, but the pinned Snapshot ID,
  version and digest remain mandatory;
- an existing Resource without a provable `canonicalRevisionId` fails closed;
  `canonicalVersion` is not a substitute for a per-Resource revision;
- the browser may not choose a fallback or fabricate any revision identity;
- changing any pinned identity produces a new Draft base, never an in-place
  rewrite of an existing Draft.

Projection is optional for the Draft as a whole. It becomes mandatory when the
Draft starts from a Compiled Truth/Projection view, when an operation's
`before`, rationale or expected impact references Projection content, or when a
Projection block is retained as the focus/return target. In those cases the
Projection kind, ID, revision/version, digest, readiness, projected Canonical
version and source snapshot digest are all pinned. A non-ready Projection is
context only and cannot satisfy Review readiness.

### 5. Typed operations

The v1 operation union supports bounded authoring for:

- Fact: add, update, remove;
- Claim: add, update, remove;
- Entity: add, update, reference;
- Relation: add, update, remove;
- Event: add, update, remove;
- Decision: add, update, remove;
- Evidence link: attach, detach;
- temporal validity: change;
- Conflict or Knowledge Gap proposal: add or update;
- explicit `NO_OP`.

User Directive changes and external Actions are excluded. Graph editing,
Yjs/CRDT and Review Center decisions are also excluded.

Every operation contains:

```text
operationId
operationKind
typedTargetReference
baseRevision
before
after
rationale
evidenceReferences
expectedImpact
operationRevision
contentDigest
```

`before` and `after` are server-decoded typed values. `expectedImpact` is the
author's declared expectation; the authoritative Recursive Impact Preview is a
separate server-produced artifact.

### 6. Draft lifecycle and command outcome are separate

Draft lifecycle states are:

```text
DRAFT
VALIDATING
VALID
INVALID
STALE
CONFLICT
READY_FOR_REVIEW
SUBMITTING
SUBMITTED
ABANDONED
```

Command outcome is a separate dimension:

```text
ACCEPTED | COMPLETED | REJECTED | OUTCOME_UNKNOWN
```

Completion disposition remains separate:

```text
SUCCEEDED | FAILED | PARTIAL | NO_OP
```

`OUTCOME_UNKNOWN` never changes a Draft into a failure and never creates a new
command key. Resolution uses the existing Frontend Command Ledger, the
original `clientRequestId`, idempotency key and semantic digest. `STALE`,
`CONFLICT` remain distinguishable and are never auto-merged.

Validation and Impact artifacts use the separate status set
`COMPLETE | PARTIAL | FAILED | UNAVAILABLE`. A Draft may enter
`READY_FOR_REVIEW` only when all required artifacts are `COMPLETE`.

### 7. Command boundary

The following commands are distinct:

```text
Materialize Draft
Start Seedless Draft
Save Draft
Validate Draft
Generate Impact Preview
Submit Draft for Review
Abandon Draft
Resolve Command Outcome
```

Save, Validate, Preview and Submit are not combined. Commands carry server
context plus `clientRequestId`, `idempotencyKey`, typed preconditions, expected
Draft revision, expected Canonical base revision and semantic digest. The
browser cannot create Principal, Project, Revision, Capability, Validation or
Impact authority.

### 8. Server validation and review submission

The server owns:

- strict operation schema validation;
- domain invariant validation;
- evidence accessibility and version-pin validation;
- current Canonical versus pinned-base comparison;
- typed conflict and dangling-reference detection;
- Recursive Impact Preview;
- partial/unavailable analyzer reporting;
- immutable submitted Draft revision creation.

Review submission returns a Review Resource identity bound to the submitted
Draft revision, operation digest, validation result, impact result, evidence
lineage, Resource Project and accepted policy context.

Review submission does not:

- create an Approval or Approval Manifest;
- record a Review decision;
- perform a Canonical Commit;
- execute partial approval;
- execute an external Action.

FE-P3-S2 may create the immutable Review Resource reference as the output of
`Submit Draft for Review`. Phase 4 owns Review Center presentation, Review
decision, Approval and Approval Manifest. The S2 submission resource is a
handoff boundary, not an S2 implementation of Review Center.

### 9. Persistence and migration

The future implementation uses an additive persistence boundary. The exact SQL
is intentionally outside this ADR, but the schema must represent:

- Draft aggregate identity and immutable Project binding;
- typed operation revisions or a versioned operation document;
- Seed-to-Draft materialization identity and one-to-one uniqueness;
- pinned base snapshot and access/policy revisions;
- validation and impact artifact references;
- command replay and produced-resource identity;
- append-only revision history, abandonment and retention;
- forward-repair and rollback metadata.

The proposed additive ownership split is:

```text
frontend_knowledge_drafts
frontend_knowledge_draft_materializations
frontend_knowledge_draft_revisions
frontend_knowledge_draft_operations
frontend_knowledge_draft_artifacts
frontend_knowledge_review_submissions
```

The minimum invariants are one materialization per non-null `seed_id`, one
materialization per `draft_id`, one Draft revision per `(draft_id, revision)`,
one operation revision per `(draft_id, revision, operation_id)`, and one Review
Submission per `(draft_id, draft_revision)`. Seedless materializations have a
null `seed_id` and remain idempotent by the command identity. A Seed bound to
another Resource Project returns `PROJECT_BINDING_CONFLICT` rather than creating
a second row. Draft and operation history is append-only. Abandoned Drafts
remain addressable for the configured audit-retention horizon; Seed mapping is
preserved, submitted revisions and Review Submissions are immutable, and
artifact payload cleanup retains the reference, digest and status. Forward
repair creates a new revision and records the prior artifact identity.

The existing Stage 5 tables are not widened in place as a compatibility
shortcut. Migration is `REQUIRED_WITH_EVIDENCE` for the future implementation,
but no migration or runtime change is authorized by this proposal.

### 10. Client state and cache

ADR-119 is reused as follows:

- React Query owns authoritative server state and cache;
- a route-scoped Knowledge Draft State Machine owns edits, dirty state, pinned
  context, validation, impact preview and recovery state;
- Draft content is not stored as authoritative React Query cache data;
- background refetch cannot overwrite a dirty Draft;
- Project, access revision or policy revision drift preserves the Draft and
  marks it stale or inaccessible;
- reset is explicit and discards the old binding only after user action;
- leave guards use the existing unsaved-draft and unknown-command boundary.

### 11. OSS and dependency boundary

No new runtime dependency is required. Existing React Query, React Router,
Frontend Command Gateway/Ledger, Product API, validation/comparison/knowledge
ports and In-memory/PostgreSQL adapter patterns are reused.

The previously reviewed OSS references may inform UI or workflow patterns only:
gbrain, lucasastorian/llmwiki, ddsyasas/llm-wiki and Inkeep OpenKnowledge are
`REFERENCE_ONLY` for this A1. No OSS runtime, database, Canonical model or
Yjs/CRDT is adopted. Exact upstream adoption metadata is therefore not claimed.

## API contract completion rules

The seven Product API contracts in the snapshot declare mandatory inputs,
authoritative result, typed failures, retry behavior and compatibility behavior.
Mutation automatic retry remains disabled. A repeated request with the original
idempotency key may replay an existing result; a new key is never generated for
an unknown outcome.

| API contract | Mandatory input | Typed failures | Retry and compatibility |
|---|---|---|---|
| Materialize Draft | `seedId`, command envelope | `NOT_FOUND`, `FORBIDDEN`, `PROJECT_BINDING_CONFLICT`, `OUTCOME_INDETERMINATE` | no automatic retry; original key resolves; Ask Seed schema unchanged |
| Start Seedless Draft | server-resolved Resource/page target, command envelope | `NOT_FOUND`, `FORBIDDEN`, `ACCESS_REVOKED`, `BASE_UNAVAILABLE` | no automatic retry; additive endpoint; Knowledge read contracts unchanged |
| Save Draft | `draftId`, full operation revision, expected Draft/base revisions, semantic digest | `DRAFT_NOT_FOUND`, `DRAFT_REVISION_CONFLICT`, `BASE_REVISION_STALE`, `VALIDATION_FAILED` | no automatic mutation retry; same key replays; legacy Stage 5 unchanged |
| Validate Draft | `draftId`, expected Draft/base revisions | `DRAFT_NOT_FOUND`, `STALE`, `CONFLICT`, `VALIDATION_FAILED`, `ACCESS_REVOKED` | resolves existing outcome only; no Draft mutation on retry |
| Generate Impact Preview | `draftId`, expected Draft revision, bounded preview options | `DRAFT_NOT_FOUND`, `STALE`, `CONFLICT`, `IMPACT_PARTIAL`, `ANALYZER_UNAVAILABLE` | artifact replay by command identity; partial remains visible |
| Submit Draft for Review | immutable Draft revision, validation and impact references, expected revisions | `NOT_READY_FOR_REVIEW`, `STALE`, `CONFLICT`, `ACCESS_REVOKED`, `OUTCOME_INDETERMINATE` | no automatic retry; original key resolves Review Resource or outcome |
| Resolve Command Outcome | original `clientRequestId`, idempotency key and semantic digest | `OUTCOME_NOT_FOUND`, `DIGEST_MISMATCH`, `COMMAND_SCOPE_MISMATCH` | resolution only; never creates a new command key |

Abandon remains a separate lifecycle command but is not required for the first
seven-contract Product API freeze. If implemented, it must use the same command
envelope, be idempotent, preserve retention history and never delete a Draft
that has already been submitted.

`FrontendKnowledgeDraftChangeSet v1` and the Stage 5 `DraftChangeSet` are
separate aggregates. Any relationship is through an explicit compatibility
Adapter; the Stage 5 Claim `ADD_CLAIM`/`NO_OP` model is not widened. A submitted
Draft revision is immutable. Further authoring creates a new Draft revision,
revalidates and creates a new Review Submission.

## Rejected alternatives

- Widening the Stage 5 Claim DraftChangeSet in place.
- Treating Browser DOM, Markdown or WYSIWYG state as Canonical authority.
- Auto-creating a Draft during Ask question submission.
- Auto-merging stale bases or refreshing dirty Draft content.
- Letting the client provide Project, Revision, Capability, Validation or
  Impact authority.
- Direct Ask-to-Review or Draft-to-Canonical mutation.
- Adding Yjs/CRDT or another runtime dependency before a separate ADR.

## Approval boundary

This is a proposal for GPT/user review. It does not mark FE-P3-S2 complete,
does not authorize Product implementation, migration SQL, tests, CI, Ready,
Merge, deployment or FE-P3-S3.
