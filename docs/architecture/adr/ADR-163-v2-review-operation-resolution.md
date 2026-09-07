# ADR-163 — V2 Review Operation Resolution for `MODIFY_REVIEW`

- Status: **ACCEPTED**
- Proposed at: 2026-09-07
- Accepted: 2026-09-07
- Acceptance authority: Project Shotgun GPT/controller
- Decision owner: Project Shotgun architecture/controller approval
- Work item: Phase E follow-up after PR #228 (`MODIFY_REVIEW_HANDOFF_CONTRACT_GAP`)
- Subject base: `main@2d64936c08937788a801adeeb29c893abe1585f2`
- Previous correction: PR #228 — `COMPLETE / FINAL_AFTER_MERGE`
- Frozen acceptance DB: `shotgun_full_e2e_20260907_r8`
- Frozen project: `8a079162-a26f-43a0-a903-1eb5d0465fc9`
- Related decisions: ADR-085, ADR-086, ADR-118, ADR-126, ADR-147, ADR-148,
  ADR-152, ADR-160, ADR-161, ADR-162
- Product implementation: **NOT AUTHORIZED**
- Database migration: **NOT AUTHORIZED**

## Authority and scope

This ADR is an accepted architecture/design decision. It defines the missing
resolution boundary exposed by PR #228; it does not authorize Product code,
schema changes, provider execution, ECAV re-entry, r8 mutation, Phase F, or r9.
Product implementation and database migration still require a separate
implementation request with frozen contract versions, migration, rollback,
tests, and rollout authority.

The two historical r8 invalid approvals and their dead letters remain
immutable defect evidence. This ADR never repairs, retries, rewrites, or
reinterprets them.

## Context and problem

ADR-160 introduced the mature V2 comparison contract. A Candidate can have
multiple semantic relationships with existing Canonical Claims, while the
bounded review recommendation remains separate from those relationships. A
source-supported Candidate may therefore produce:

```text
REVIEW_REQUIRED
  -> reviewRecommendation = MODIFY_REVIEW
```

PR #228 corrected the first defect: a raw `MODIFY_REVIEW` Draft can no longer
be approved. `APPROVE` now fails closed as `BLOCKED /
REVIEW_NOT_ELIGIBLE` before decision, manifest, token, handoff, or Canonical
mutation.

That correction intentionally exposes a second boundary. A meaningful
relationship is not a reason to reject a source-supported Candidate, but the
relationship itself is not Canonical authority. The user must decide what
supported Canonical operation, if any, should follow the review. The system
must preserve the relationship, conflict, Candidate, Evidence, and analysis
lineage while preventing all of the following:

- false rejection of a source-supported Claim;
- AI-selected Canonical authority;
- implicit `MODIFY_REVIEW -> ADD_CLAIM` conversion;
- direct Canonical or Relation writes from comparison evidence;
- Claim-to-Fact promotion;
- loss of disagreement evidence;
- stale or concurrent resolution being silently rebased.

## Decision summary

Adopt an explicit, user-authorized, two-step resolution boundary:

```text
immutable MODIFY_REVIEW Draft revision N
  |
  | ResolveReviewOperationV2 (user chooses exactly one operation)
  v
durable OperationResolution record
  |
  v
immutable resolved Draft revision N+1
  operation = ADD_CLAIM | NO_OP
  |
  | existing Review APPROVE against revision N+1
  v
ApprovedChangeSetManifestV2 bound to the resolved revision
  |
  v
existing Stage 6 supported handoff
```

The original revision is never mutated. Resolution is not approval. The
existing PR #228 guard remains in force for raw `MODIFY_REVIEW`. Only the
server may derive the resolved Draft, its digest, its provenance, its
Canonical precondition, and the approval manifest.

The initial resolved operation set is deliberately closed:

| User choice | Meaning                                                         | Canonical effect after explicit APPROVE    |
| ----------- | --------------------------------------------------------------- | ------------------------------------------ |
| `ADD_CLAIM` | Preserve the Candidate as an independent Claim                  | Existing Stage 6 `ADD_CLAIM`; version `+1` |
| `NO_OP`     | Existing Canonical representation is sufficient for this review | Existing Stage 6 `NO_OP`; version `+0`     |
| `REJECT`    | Ordinary Review decision, not an operation resolution           | Canonical `+0`                             |
| `HOLD`      | Ordinary Review decision, not an operation resolution           | Canonical `+0`                             |

No additional Canonical operation is introduced by this ADR. In particular,
there is no relation update, merge, delete, replace, conflict-resolution, or
Fact-promotion authority.

## 1. Authority invariants

The following invariants are frozen for every implementation and adapter:

1. `SemanticRelationshipV2` remains Analysis evidence. It cannot write
   Canonical.
2. AI may recommend, explain, or classify relationships, but cannot select the
   final Canonical operation.
3. The user is the authority selecting `ADD_CLAIM` or `NO_OP`.
4. Raw `MODIFY_REVIEW` remains non-Canonical and cannot be approved.
5. Stage 6 is not widened to accept raw `MODIFY_REVIEW`.
6. No automatic Claim merge, Claim deletion, Fact promotion, Canonical
   Relation write, conflict resolution, or source-Claim replacement occurs.
7. A source-supported conflict may preserve both Claims.
8. Candidate, EvidenceSpan, SourceVersion, ComparisonResult, AnalysisRevision,
   and SemanticRelationship identities remain immutable.
9. Compiled Truth remains a derived read Projection and cannot become the
   authority for resolution.
10. Browser state, UI labels, model rationale, similarity rank, or a caller-
    supplied manifest can never become operation authority.

## 2. Product-owned command boundary

The ChangeSet & Review module owns a new versioned command Port. The eventual
HTTP route is an implementation detail; a representative boundary is:

```text
ResolveReviewOperationV2@1.0.0
```

### 2.1 Caller input

The browser/caller supplies only:

```ts
type ResolveReviewOperationV2Request = {
  changeSetId: string;
  expectedDraftRevision: number;
  expectedDraftDigest: string;
  chosenOperation: 'ADD_CLAIM' | 'NO_OP';
  clientRequestId: string;
  idempotencyKey: string;
};
```

`expectedDraftDigest` is the immutable content digest observed by the caller;
the server recomputes the authoritative digest. The command envelope carries
the normal authenticated actor, project scope, access scope, sensitivity,
correlation, causation, and trace context. A service, system, or AI actor
cannot perform this user resolution.

The caller must not provide:

- project, actor, access, sensitivity, or policy authority;
- Candidate text or Evidence content;
- Candidate, Evidence, relationship, Comparison, AnalysisRevision, or
  Canonical IDs as substitutes for server-resolved references;
- Canonical version/digest or semantic generation identity;
- manifest, approval token, Stage 6 event, Claim identity, or relation value.

### 2.2 Server resolution and output

The server resolves and verifies, in one Product-owned boundary:

- Project and actor membership;
- current Draft aggregate and exact revision/digest;
- Candidate revision/digest and Evidence lineage;
- ComparisonResultV2 and all referenced relationship identities;
- current Canonical snapshot and snapshot digest;
- shortlist, semantic generation, AnalysisRevision, access, sensitivity and
  policy revisions;
- allowed operation set and the current V2 Review rollout state.

The safe output is metadata only:

```ts
type ResolveReviewOperationV2Result = {
  status: 'RESOLVED' | 'IDEMPOTENT_REPLAY';
  resolutionId: string;
  changeSetId: string;
  sourceDraftRevision: number;
  resolvedDraftRevision: number;
  resolvedDraftDigest: string;
  chosenOperation: 'ADD_CLAIM' | 'NO_OP';
  reviewResourceId?: string;
};
```

`reviewResourceId`, when required by the existing immutable Review Submission
contract, is a new resource for the resolved Draft revision. The original
Review resource is not mutated or reused as an approval authority.

Typed failures are explicit and non-successful:

```text
NOT_FOUND
FORBIDDEN
PROJECT_SCOPE_MISMATCH
INVALID_OPERATION
DRAFT_NOT_ELIGIBLE
DRAFT_REVISION_CONFLICT
STALE_REVIEW_INPUT
ACCESS_REVOKED
POLICY_CHANGED
RESOLUTION_CONFLICT
IDEMPOTENCY_KEY_REUSE
OUTCOME_UNKNOWN
```

Mutation automatic retry is disabled. If ConnectorRuntime reports
`OUTCOME_UNKNOWN`, the handler is not replayed blindly. The existing
`ConnectorRuntime.reconcileOutcome` path first performs the authoritative
Review-domain lookup using the original `clientRequestId` and semantic command
identity, then reconciles the durable connector record. A new key never creates
a second resolution attempt.

## 3. Resolution preconditions

The command may resolve only a fresh, valid V2 review Draft that satisfies all
of the following:

| Preconditions     | Required proof                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Draft eligibility | Current Draft operation is `MODIFY_REVIEW`, review status is pending, and the comparison disposition is `REVIEW_REQUIRED`. |
| Claim-only scope  | Issue #203 activation is Claim-only; unsupported resource types fail closed.                                               |
| Candidate         | Exact Candidate ID, revision, digest, project, readiness, SourceVersion and Evidence IDs resolve server-side.              |
| Comparison        | Completed immutable ComparisonResultV2, AnalysisRevision(s), relationship IDs and material digests are readable.           |
| Canonical base    | Snapshot ID, version and digest still match the comparison and shortlist audit.                                            |
| Security          | Actor, project, access scope, sensitivity and policy context remain authorized.                                            |
| Freshness         | Candidate, Evidence, relationship, analysis, shortlist, semantic generation and Canonical identities have not drifted.     |
| Resolution state  | No prior successful resolution exists for this source Draft revision, except an exact idempotent replay.                   |
| Authority         | Actor is an authenticated user; Service/System/AI actors are denied.                                                       |

If any precondition fails, the command creates no resolution and no Draft
revision. It never silently refreshes, rebases, downgrades to V1, or converts
the relationship to `UNRELATED`/`NEW`.

`REJECT` and `HOLD` remain ordinary Review decisions. They do not create an
OperationResolution. Once a Draft has a terminal `REJECT`/`HOLD` decision, a
resolution is not available unless normal, explicit Product re-entry creates a
new eligible comparison and Draft.

## 4. Durable persistence model

### 4.1 OperationResolution is a new durable entity

Choose a new durable `OperationResolution` entity owned by the ChangeSet &
Review module. The resolution is not encoded by mutating the original Draft's
operation field.

Logical fields:

```text
resolutionId
contractVersion = review-operation-resolution.v1
projectId
changeSetId
sourceDraftRevision
sourceDraftDigest
resolvedDraftRevision
resolvedDraftDigest
comparisonId
candidateId / candidateRevision / candidateDigest
candidateEvidenceIds[]
canonicalSnapshotId / canonicalVersion / canonicalDigest
shortlistDigest
analysisRevisionIds[]
relationshipIds[]
chosenOperation = ADD_CLAIM | NO_OP
accessRevision
policyContextRevision
resolverActorId
clientRequestId
semanticCommandIdentity
idempotencyKey
commandDigest
resolutionDigest
state = RESOLVED
createdAt
```

All referenced identities are server-resolved references. The resolution does
not duplicate or become the owner of Candidate, Evidence, Comparison,
Analysis, or Canonical rows.

`idempotencyKey` and `semanticCommandIdentity` retain the incoming connector
and command identity for audit/reconciliation; they do not create a second
generic domain command ledger. Connector delivery state remains owned by the
existing ConnectorRuntime ledger.

`OperationResolution` is an immutable record of a successfully committed user
choice. `STALE` is a later freshness/read-eligibility result and is never a
rewrite of this record. `CONFLICTED` is a failed command outcome and creates no
`OperationResolution` row. If stale/conflict observability must be durable, it
is appended to the existing History/Audit event stream or a derived projection.

### 4.2 Resolved Draft revision

The same `DraftChangeSetV2` aggregate receives an append-only revision N+1.
The previous `MODIFY_REVIEW` revision N remains queryable with its original
operation and digest. Revision N+1:

- has `operation = ADD_CLAIM` or `operation = NO_OP`;
- remains a valid ordinary `DraftChangeSetV2` `contractVersion: 2.0` object;
- preserves `disposition = REVIEW_REQUIRED`,
  `reviewRecommendation = MODIFY_REVIEW`, comparison identity, Candidate/
  Evidence/relationship/Analysis lineage, and exact freshness preconditions;
- has a new deterministic content digest;
- remains unapproved and non-Canonical until an explicit user APPROVE;
- is the only revision eligible for a later approval.

The Draft aggregate's current pointer may advance atomically to N+1, but no
historical revision is updated. If the existing Review submission contract
requires one immutable Review Resource per submitted revision, the server
creates a new resource for N+1 using that existing boundary. No
`operationResolutionRef` is added to the strict V2.0 Draft or Manifest schema;
the separate `OperationResolution` binds the two through project, change-set,
revision, digest, and operation identity.

### 4.3 AI recommendation and user operation remain separate

The resolved N+1 Draft preserves the Comparison's
`disposition = REVIEW_REQUIRED` and `reviewRecommendation = MODIFY_REVIEW`.
The Comparison ID/digest, Candidate, Evidence, relationship IDs,
AnalysisRevision IDs, and freshness identity are copied by server-owned
resolution into the ordinary V2.0 Draft fields. Only the user-authorized Draft
`operation` changes from `MODIFY_REVIEW` to `ADD_CLAIM` or `NO_OP`.

Activity and Audit must show both facts independently:

```text
AI recommendation: MODIFY_REVIEW
user-resolved operation: ADD_CLAIM | NO_OP
final approval: separate user action
```

Neither the AI recommendation nor the semantic relationship is rewritten as
the user's operation choice.

### 4.4 Digest rules

`resolutionDigest` and `resolvedDraftDigest` are computed from a versioned,
canonical serialization of server-resolved fields, including:

- source Draft revision/digest;
- chosen operation;
- Candidate revision/digest and sorted Evidence IDs;
- Comparison and sorted relationship IDs/material digests;
- Canonical snapshot ID/version/digest;
- shortlist and AnalysisRevision identities;
- access/policy revisions;
- resolution contract version.

Caller text, UI order, timestamps, random run IDs, labels, rationale wording
from the browser, and unrelated projection fields are not digest inputs.
The serialization algorithm and field ordering must be frozen by the later
implementation contract before migration.

### 4.5 Ownership and migration boundary

The later implementation is expected to add an additive Review-owned
persistence boundary, for example:

```text
review.operation_resolutions_v2
review.change_set_revisions_v2             # immutable revision authority
review.review_submission_refs_v2           # existing boundary, additive fields only
```

The names are design names, not an authorization to create SQL now. Existing
V1/V2 rows remain readable and are not backfilled with invented resolutions.
Before enablement, each existing `review.change_sets_v2` current row is
deterministically copied as an exact immutable snapshot into
`review.change_set_revisions_v2` at its existing revision. This is historical
snapshot preservation, not semantic backfill or reinterpretation.

After migration, `review.change_sets_v2` remains the backward-compatible
current aggregate/head surface, while `review.change_set_revisions_v2` is the
immutable revision-history authority. Reader precedence and rollback behavior
must be frozen so there is never a dual-source ambiguity. A destructive down
migration is not permitted. Application rollback is a capability/rollout
decision that leaves immutable resolution history intact.

## 5. Transaction, idempotency, and concurrency contract

The ConnectorRuntime durable ledger and the Review domain transaction are two
distinct idempotency layers. They must not be forced into one atomic
transaction:

### 5.1 Connector/runtime layer

The existing Connector durable ledger remains the transport and delivery
authority for semantic command identity, duplicate delivery, `IN_PROGRESS`,
`COMPLETED`, `FAILED`, `OUTCOME_UNKNOWN`, fencing, and restart behavior. Its
normal lifecycle remains:

```text
connector dedup begin
  -> durable job
  -> invoke Review command handler
  -> handler returns
  -> connector dedup complete
```

The implementation must not create a parallel generic idempotency subsystem or
attempt to include connector completion in the Review database transaction.

### 5.2 Review/domain layer

The Review-owned transaction atomically persists the domain outcome:

```text
lock current head N
  -> resolve and validate server-owned Comparison/Candidate/Evidence/base
  -> check rollout, actor, access and policy authority
  -> check one resolution per source revision
  -> insert OperationResolution
  -> insert immutable revision N+1
  -> advance current aggregate/head to N+1
  -> append Review History/Audit
  -> COMMIT
```

Database uniqueness on the resolution and immutable revision identities
guarantees one logical resolution. The transaction never calls Canonical, a
provider, Stage 6, or an external Action. The in-memory adapter must provide
equivalent clone/commit/rollback behavior.

### 5.3 Replay and the `OUTCOME_UNKNOWN` crash window

If the Review transaction commits but connector completion/acknowledgement is
lost, the connector record becomes the existing `OUTCOME_UNKNOWN` case. The
handler must not be blindly re-executed. Reconciliation performs a read-only
authoritative domain lookup using the stored project plus `clientRequestId`
and/or the exact semantic resolution identity. The lookup must prove:

- whether `OperationResolution` committed;
- `resolutionId`;
- source Draft revision/digest;
- resolved Draft revision/digest;
- `chosenOperation`.

Only after that observation may the existing
`ConnectorRuntime.reconcileOutcome` boundary reconcile the durable
`OUTCOME_UNKNOWN` record. It never creates a new idempotency key, second
resolution, or duplicate revision.

### 5.4 ADR-155 implementation prerequisite

ADR-155 remains the governing Connector authority for timeout,
commit/acknowledgement ambiguity, lost responses, and `OUTCOME_UNKNOWN`.
ADR-163 does not redefine or widen `ConnectorRuntime` semantics. Before any
ADR-163 Product implementation begins, the canonical `ConnectorRuntime` and
PostgreSQL adapter must be inspected against ADR-155 for the exact case where
the Review domain transaction commits and the handler result exists, but
connector completion or acknowledgement is lost or ambiguous. The semantic
command must not become ordinary retryable/`FAILED` replacement authority;
the same command must not invoke the domain mutation again; and the unresolved
execution must converge through `OUTCOME_UNKNOWN` before the authoritative
Review-domain lookup feeds the existing `ConnectorRuntime.reconcileOutcome`
boundary. If the current canonical Connector implementation does not already
satisfy this invariant, ADR-163 Product implementation stops and a separate,
narrow ADR-155 conformance-correction PR is required. ADR-163 does not silently
fix generic ConnectorRuntime semantics. R19 tests this existing ADR-155
invariant and grants no new Connector authority.

### 5.5 Concurrency rules

1. A same semantic command identity is resolved by the domain outcome lookup
   or returns the original resolution and resolved revision.
2. Reusing a connector key or `clientRequestId` with a different operation or
   digest fails with `IDEMPOTENCY_KEY_REUSE`; it never creates another revision.
3. Concurrent `ADD_CLAIM` and `NO_OP` commands against the same expected Draft
   revision serialize on the current head. Exactly one wins; the loser gets
   `DRAFT_REVISION_CONFLICT` or `RESOLUTION_CONFLICT` and creates no rows.
4. A process restart reconciles the connector outcome to the exact committed
   domain result; it never re-runs a provider or creates a second resolution.
5. A changed Canonical base, Candidate, Evidence, relationship, policy, access
   or governed analysis input makes the resolution stale. No automatic rebase
   occurs.

## 6. Explicit two-step approval flow

### Step 1 — Operation resolution

The user selects `ADD_CLAIM` or `NO_OP`. The server creates the durable
OperationResolution and Draft revision N+1. This is a Review operation choice,
not approval and not a Canonical write.

### Step 2 — Final approval

The user explicitly submits the existing V2 APPROVE command for revision N+1.
The Review module must verify:

- the stored operation is `ADD_CLAIM` or `NO_OP`;
- exactly one matching `OperationResolution` exists for project, change-set,
  resolved revision, resolved digest, and chosen operation;
- the matching resolution is immutable and `RESOLVED`;
- the approval binds to resolution ID, source revision, resolved revision and
  resolved digest;
- Candidate, Evidence, Comparison, relationships, AnalysisRevision,
  Canonical snapshot, access and policy are still fresh;
- the approval actor is an authorized user under the normal approval policy and
  the approval reason is recorded.

The manifest and approval token bind to the resolved operation. A caller cannot
override it with a different operation. Raw `MODIFY_REVIEW + APPROVE` remains
blocked by PR #228 before persistence. The existing Stage 6 handoff consumes
only the supported `ADD_CLAIM` or `NO_OP` manifest and remains unchanged.

The resolver and approver are independently authorized user actions. Their
`resolverActorId` and `approverActorId` are preserved in audit provenance and
may be the same user, but this ADR does not require actor identity equality.

## 7. Operation semantics

### 7.1 `ADD_CLAIM`

When the user resolves `MODIFY_REVIEW -> ADD_CLAIM` and then approves:

- the existing Stage 6 `ADD_CLAIM` path is used;
- Canonical version advances exactly once (`+1`);
- the new Claim retains Candidate, SourceVersion, Evidence and project
  lineage;
- semantic relationships and conflict subtype remain Analysis/provenance;
- no Canonical Relation is created;
- no Fact is created or promoted;
- an existing Claim is not overwritten, merged, deleted, or replaced;
- a duplicate or changed base is a typed conflict/stale result requiring fresh
  comparison, not an implicit `NO_OP`.

This is the safe path for a source-supported independent proposition,
including a later proposition that contradicts an older source-supported Claim.

### 7.2 `NO_OP`

When the user resolves `MODIFY_REVIEW -> NO_OP` and then approves:

- the existing supported `NO_OP` semantics are used;
- Canonical version advances by zero (`+0`);
- no Claim, Fact, Relation, merge, deletion, or replacement is created;
- Candidate, Evidence, Comparison, relationship and analysis history remain
  inspectable;
- the review and resolution history records that the user determined the
  existing Canonical representation was sufficient;
- `NO_OP` never means that the Candidate was false, deleted, or invalidated.

The implementation must use the current Stage 6 `NO_OP` contract rather than
inventing a second no-op path.

### 7.3 `REJECT` and `HOLD`

`REJECT` and `HOLD` remain ordinary Review decisions for a raw
`MODIFY_REVIEW` Draft. They do not create an OperationResolution and do not
advance Canonical. They must remain available after this design and are not
silently changed into `ADD_CLAIM` or `NO_OP`.

## 8. Freshness and re-entry

Resolution and approval bind to the exact identity chain:

```text
Candidate revision/digest
  + Evidence IDs/revisions/digests
  + ComparisonResultV2
  + relationship IDs/material digests
  + AnalysisRevision identities
  + shortlist/retrieval identity
  + semantic generation/base and provider capability identity
  + Canonical snapshot ID/version/digest
  + access/policy revisions
```

If Canonical changes before resolution, resolution fails `STALE_REVIEW_INPUT`.
If Canonical changes after resolution but before approval, approval fails the
existing stale approval contract (`STALE_APPROVAL` or the V2 typed equivalent).
The resolved revision remains historical; it is not rebased in place.

Normal Product re-entry follows ADR-160:

```text
legitimate Canonical advance
  -> original Comparison/Draft becomes stale
  -> RecompareClaimCandidate@1.0.0
  -> new snapshot-scoped Comparison/Analysis/relationships
  -> new MODIFY_REVIEW Draft
  -> new user operation resolution
  -> normal approval
```

A changed governed input intentionally creates a new analysis and Comparison
identity. No stale resolution is copied to the new Draft.

## 9. Conflict preservation example

For the blind-E2E conflict case:

```text
Source A supports: Tesla CEO = 2008
Source B supports: Tesla CEO = 2009
Product analysis: CONTRADICTS / QUANTITATIVE_VALUE or TEMPORAL conflict
```

The Review flow may resolve the later source-supported Candidate as
`ADD_CLAIM`. Stage 6 then stores both Claims without overwriting either one.
The conflict relationship remains inspectable Analysis/provenance for Ask and
Review surfaces. The system does not select factual truth automatically,
create a Canonical Relation, or promote either Claim to Fact. A `NO_OP` choice
is also possible when the user determines the current Canonical representation
already suffices; that choice does not delete or invalidate the later source.

## 10. Historical r8 artifact policy

These pre-PR-228 artifacts are retained exactly as historical evidence:

- `comparison-v2:70edfccf-01a7-494c-adb1-e83888fb7363`;
- `comparison-v2:5bb5b01b-33b9-421a-bc40-7d8660f2d9ee`.

Their APPROVED Review rows, manifests, failed Stage 6 handoffs, non-retryable
DLQs, and absence of a Canonical commit are never rewritten, retried, cleaned,
or given fabricated commits. Once their original Comparison is stale, normal
Product re-entry creates a new snapshot-scoped Comparison and Draft. The new
resolution records may reference the old comparison as historical context but
never mutate it.

## 11. Compatibility, migration, rollback and replacement

### Compatibility

- ADR-085 V1 rows and consumers remain historical/read-compatible.
- ADR-160 V2 Comparison/Relationship identities remain unchanged.
- PR #228's raw `MODIFY_REVIEW` approval guard remains unchanged.
- Existing `ADD_CLAIM`, `NO_OP`, `REJECT`, and `HOLD` contracts remain the
  supported meanings.
- Existing strict `DraftChangeSetV2` and `ApprovedChangeSetManifestV2`
  `contractVersion: 2.0` shapes and `additionalProperties: false` identity
  remain unchanged; no `operationResolutionRef` is added.
- Approval matches the separate resolution by project, change-set, resolved
  revision, resolved digest, and chosen operation before constructing the
  existing manifest/token.
- A V1 consumer must never receive a lossy V2 downcast or fabricated
  `NEW_CLAIM`.

### Migration

The later implementation requires an additive migration for the durable
OperationResolution and append-only Draft revision linkage. The migration must:

1. add nullable/standalone structures without altering historical V1/V2 rows;
2. add uniqueness for one logical resolution per source Draft revision and
   semantic resolution identity; connector dedup remains outside this
   transaction;
3. preserve existing Review/Manifest/Stage 6 rows unchanged;
4. support readers before enabling the command;
5. include forward verification and a clean restore/replay drill;
6. provide no destructive down migration.

No migration is included in this design branch.

### Rollback

Rollback is application-level and fail-closed:

- disable new `ResolveReviewOperationV2` commands through a project-scoped
  capability/rollout flag;
- keep existing resolution and Draft revisions readable and auditable;
- do not revert N+1 to `MODIFY_REVIEW` in place;
- permit an already resolved revision to proceed only if the supported
  approval/freshness contract remains available, otherwise block with a typed
  feature-disabled/stale result and require explicit re-entry;
- leave all immutable resolution records for audit and future replay policy.

### Replacement

OperationResolution is behind a Review module Port. In-memory and PostgreSQL
adapters must implement the same command, digest, transaction, idempotency,
stale, and audit contract. A future transport or persistence replacement must
not expose its internal IDs or schema as Canonical IDs.

## 12. OSS and dependency decision

This design introduces no runtime dependency and no provider requirement.
`NO_RELEVANT_OSS` is recorded for semantic review-operation authority: no
reviewed candidate supplies the required Shotgun Canonical/Approval boundary.

| Candidate                                                                                                                      | Decision             | Boundary and reason                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain), `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                         | `REFERENCE_ONLY`     | Job/idempotency/history patterns only; no Runtime, DB, or Canonical authority.                        |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki), `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0      | `REFERENCE_ONLY`     | Evidence/locator parts do not resolve Candidate-to-Canonical operations.                              |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki), `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT                     | `REFERENCE_ONLY`     | Review/action UX only; backend and SQLite excluded.                                                   |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge), `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`     | Activity/diff UX patterns only; GPL Runtime, storage and Yjs excluded.                                |
| Existing PostgreSQL, JSON Schema/Ajv and Transactional Outbox decisions                                                        | `ADOPTED` / existing | Reuse existing Shotgun Ports and pins in the later implementation; no new dependency is adopted here. |

The Open-source Role Matrix does not require a status change because no OSS is
being newly adopted, extracted, or augmented by this design.

## 13. Later implementation acceptance matrix

The implementation request must freeze and prove at least:

| ID  | Scenario                                           | Required result                                                             |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| R1  | Raw `MODIFY_REVIEW + APPROVE`                      | `BLOCKED`; no persistence or handoff                                        |
| R2  | Resolve `MODIFY_REVIEW -> ADD_CLAIM`               | N+1 resolved revision; N preserved                                          |
| R3  | Resolved `ADD_CLAIM + APPROVE`                     | Stage 6 commit; Canonical `+1`; lineage valid                               |
| R4  | Resolve `MODIFY_REVIEW -> NO_OP`                   | N+1 resolved revision; N preserved                                          |
| R5  | Resolved `NO_OP + APPROVE`                         | Canonical `+0`; no Claim/Fact                                               |
| R6  | Raw `MODIFY_REVIEW + REJECT`                       | Allowed; Canonical `+0`                                                     |
| R7  | Raw `MODIFY_REVIEW + HOLD`                         | Allowed; Canonical `+0`                                                     |
| R8  | Canonical changes before resolution                | Resolution stale/blocked                                                    |
| R9  | Canonical changes after resolution before approval | Approval stale/blocked                                                      |
| R10 | Replay same resolution idempotency key             | One logical resolution/result                                               |
| R11 | Concurrent conflicting resolutions                 | One winner; other blocked; no second revision                               |
| R12 | Process restart after command                      | Exact resolution/audit state restored                                       |
| R13 | Tesla 2008 + 2009 conflict                         | Both source-supported Claims can coexist; disagreement inspectable          |
| R14 | Relationship evidence                              | No automatic Canonical Relation                                             |
| R15 | Claim authority                                    | No automatic Fact                                                           |
| R16 | Historical r8 invalid approvals                    | Untouched, unretried, unrewritten                                           |
| R17 | Contract compatibility                             | Resolved N+1 validates as existing strict V2.0; Stage 6 unchanged           |
| R18 | Immutable revision migration                       | Existing current row is exact revision snapshot; N remains retrievable      |
| R19 | Domain commit then connector ack loss              | `OUTCOME_UNKNOWN` lookup/reconcile; no duplicate resolution/revision        |
| R20 | Recommendation/operation separation                | `REVIEW_REQUIRED` + `MODIFY_REVIEW` preserved; only Draft operation changes |
| R21 | Resolver/approver provenance                       | Both authorized actors audited; same and different actors supported         |

Required later tests include Contract, Review bridge unit, Product/PostgreSQL
boundary, Security Negative, Replay/Idempotency, concurrency, restart,
Migration/Rollback, Adapter Replacement, Connector `OUTCOME_UNKNOWN`
reconciliation, immutable revision migration, and the bounded ECAV conflict
corpus. No such test runs are authorized by this ADR branch.

## 14. Consequences

Positive consequences:

- a source-supported Candidate is not forced into false rejection;
- user operation authority is explicit and auditable;
- raw unsupported approval remains fail-closed;
- ADD_CLAIM and NO_OP reuse existing Stage 6 contracts;
- stale and concurrent choices cannot silently overwrite each other;
- conflict evidence and Claim/Fact separation remain intact;
- V1/V2 history and r8 defect evidence remain readable.

Costs and limits:

- an additive resolution entity and Draft revision migration are required;
- Review UI must present a second explicit user action;
- approval and resolution require additional freshness and audit checks;
- Phase E cannot resume until the ADR is accepted and the implementation gates
  pass;
- no relation-authority operation is defined by this ADR.

## 15. Approval gate

This ADR is `ACCEPTED` on 2026-09-07 by the Project Shotgun GPT/controller.
Acceptance is limited to the architecture and contract decisions recorded
here. It does not authorize Product implementation, migration SQL, provider
calls, Product/database tests, CI as an implementation gate, Ready, Merge,
deployment, r8 re-entry, Phase F, or r9. Product implementation and database
migration remain **NOT YET AUTHORIZED** and require a separate explicit
implementation request.
