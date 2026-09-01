# ADR-152 — Discovery Authoring and Canonical Relation Change Authority

- Status: **PROPOSED / USER APPROVAL PENDING**
- Proposed at: 2026-09-01
- Decision owner: `USER`
- Work item: `AKP-8 WP2A — Discovery Authoring and Canonical Relation Authority`
- Subject base: `main@81ebe93b01fd74c13d3ace2a6c27f55333417648`
- Related ADRs: ADR-128, ADR-134, ADR-136, ADR-139, ADR-140, ADR-142, ADR-151
- Product implementation: **NOT AUTHORIZED BY THIS ADR**

## Authority gate

This is an implementation-enabling architecture proposal only. It remains
`PROPOSED / USER APPROVAL PENDING` until the User explicitly approves it. It
must never be treated as `ACCEPTED`, and it does not authorize Product/runtime,
schema, migration, test, dependency, UI, deployment, WP2, WP3, or AKP v1
completion work.

The current AKP-8 WP2 stop decision is preserved:

- AKP-8 WP2: `BLOCKED`
- Discovery Review → Draft handoff: `MISSING_PRODUCT_CAPABILITY`
- Draft `RELATION_ADD` → Canonical Relation: `BLOCKED_ARCHITECTURE_GAP`

Only a later bounded implementation request issued after this proposal is
approved may implement the contracts and sequence described below.

## Context and reproduced gap

ADR-139 requires a `RELATION_HYPOTHESIS` to pass through a staged typed
relation candidate/change, `DraftChangeSet`, Review, and Canonical commit. It
also forbids inventing a `SourceVersion`, making a raw Discovery card
Canonical, or bypassing the existing ADR-128 Review/Approval boundary.

The canonical baseline reproduces two separate missing handoffs:

1. `modules/frontend-review/src/product-api.ts:1080-1120` sets
   `acceptedForAuthoring = true` for a `DISCOVERY_CANDIDATE`, while the other
   target kinds create a `ReviewApprovalV1`. It does not materialize or link a
   Knowledge Draft.
2. `modules/frontend-review/src/review-domain.ts:177` maps a fully approved
   Discovery target to `ACCEPTED_FOR_AUTHORING`; this is a Review lifecycle
   state, not an Approval or Canonical state.
3. `modules/frontend-knowledge-draft/src/product-api.ts:399-437` accepts only
   one `CLAIM_ADD` or `NO_OP` as a Canonical-consumable approved operation and
   fails closed for all other operations. Its `RELATION_ADD` contract is
   therefore currently not consumable.
4. `modules/frontend-knowledge-draft/src/product-api.ts:977-1217` requires an
   existing `KNOWLEDGE_CANONICAL_CHANGE` Approval and maps the approved write to
   `ADD_CLAIM` or `NO_OP`; a Discovery acceptance cannot enter this consumer.
5. `modules/frontend-knowledge-draft/src/product-api.ts:537-615` and
   `assemblies/shotgun-app/src/product-api/frontend-knowledge-draft-routes.ts:114-121`
   start a seedless Draft from a Knowledge resource/page. They provide no
   Discovery-accepted candidate-to-Draft handoff.
6. `packages/contracts/src/canonical-knowledge.ts:16-150` models the Frontend
   commit write, Canonical result, revision, history, and `CanonicalCommitted`
   outbox only for `ADD_CLAIM | NO_OP`; there is no Canonical Relation record.

The source side already has the required typed relation semantics. The
authoritative `DiscoveryReviewResourceV1` normalizes
`RELATION_HYPOTHESIS` at `modules/discovery-reentry/src/index.ts:1858-1879`
from the Finding payload and preserves it at
`packages/contracts/src/discovery-reentry.ts:342-352`. Its fields are
`fromResource`, `toResource`, `relationType`, `direction`, optional temporal
qualification, and rationale. The normalized resource is persisted and
project-scoped by the PostgreSQL Review adapter at
`adapters/frontend-review-postgres/src/index.ts:778-960` and read only when
validation/lifecycle eligibility passes at `:1003-1098`.

This is not a request to reinterpret summary text, detail text, UI labels, or
model prose as relation semantics. It is a request to decide the missing
server-owned authoring and Canonical authority boundary.

## Decision

### 1. End-to-end authority chain

The approved architecture is:

```text
persisted Finding
  -> derived validation/re-entry manifest
  -> authoritative DiscoveryReviewResourceV1
  -> DISCOVERY_CANDIDATE Review
  -> ACCEPTED_FOR_AUTHORING
  -> server-owned DiscoveryAcceptedForAuthoringBridgeV1
  -> concrete Knowledge Draft with exactly one RELATION_ADD
  -> existing Knowledge Draft validation / impact preview
  -> existing Draft Review Context and item decision
  -> ReviewApprovalV1(purpose=KNOWLEDGE_CANONICAL_CHANGE)
  -> knowledge.draft.commit.v1
  -> Stage 6 Canonical ADD_RELATION transaction
  -> Canonical Relation + History + CanonicalCommitted outbox
  -> projections and Discovery reconciliation
```

The first Discovery Candidate Review answers “is this worth authoring?”. The
second Concrete Knowledge Draft Review answers “is this exact relation change
correct?”. Neither answer is merged with the other.

`ACCEPTED_FOR_AUTHORING` is never an Approval, never a Canonical commit, and
never an auto-commit trigger. The preferred behavior is idempotent automatic
materialization of the concrete Draft so the owner does not retype the
relation. The materialized Draft remains unapproved and uncommitted.

### 2. Server-owned DiscoveryAcceptedForAuthoringBridgeV1

The later Product implementation must expose an equivalent typed Port/Adapter
boundary, with the server as the only source of authoritative semantics:

```text
DiscoveryAcceptedForAuthoringBridgeV1

Input (server-resolved):
  persisted Review Context revision
  persisted terminal APPROVE decision for the Discovery item
  authoritative DiscoveryReviewResourceV1 at its resource revision
  project scope and current access/policy revisions

Output:
  MATERIALIZED { draftId, draftRevision, draftDigest, reviewResourceRef }
  IDEMPOTENT  { existing draft identity and its current revision }
  BLOCKED     { typed fail-closed reason; no partial Draft }
```

The browser may send only the Review Context identity, expected revision, and
idempotency envelope required by the existing command boundary. It may not send
`relationType`, endpoints, direction, temporal values, evidence, provenance,
Canonical base, project, or a proposed Canonical operation. The bridge loads
the persisted context, terminal decision, and `DiscoveryReviewResourceV1` from
server repositories, verifies they still belong to one project, and derives
the Draft from the server-owned resource.

Materialization is idempotent on the accepted candidate identity/revision plus
the bridge contract version and current authoritative base. A stale Finding,
Review Context, or resource causes revalidation/rebuild or a fail-closed
`STALE_AUTHORING_INPUT`; it cannot create a Draft from old text. The bridge
does not create a Review Approval and does not call Canonical.

### 3. Relation source and Draft contract

For `RELATION_HYPOTHESIS`, the bridge reads relation semantics only from:

```text
DiscoveryReviewResourceV1.content.normalizedMaterial.typeSpecific
  .fromResource
  .toResource
  .relationType
  .direction
  .temporalQualification.validFrom / validTo
  .rationale
```

The lineage must be checked against the resource's
`findingId/findingRevision`, `candidateId/candidateRevision`, manifest,
canonical base, discovery base, related approved resource revisions, Evidence
lineage, content digest, and project binding. A mismatch is a hard failure.

The implementation contract must introduce a versioned compatible relation
value, named here `RelationDraftValueV2`, rather than using a claim surrogate:

```text
RelationDraftValueV2
  schemaVersion: relation.v2
  relationType: string
  fromEndpoint: { projectId, canonicalEntityId, canonicalEntityRevision }
  toEndpoint:   { projectId, canonicalEntityId, canonicalEntityRevision }
  direction: DIRECTED | UNDIRECTED
  validFrom?: string
  validTo?: string
  rationale: string
```

The Draft operation is exactly one `RELATION_ADD` with this typed value. It is
never converted to `CLAIM_ADD`, `ENTITY_ADD`, or `NO_OP`. `validFrom` and
`validTo` are copied only when authoritative in the Discovery material and
validated for temporal consistency. A non-authoritative temporal description
is retained only in rationale/provenance; the implementation must not invent a
date.

The chosen stable endpoint identity is the server-resolved, project-scoped
Canonical Entity identity (`canonicalEntityId` plus its authoritative revision),
not a display label, Discovery rank, Finding ID, candidate ID, Review resource
ID, or UI address. A `DiscoveryResourceRefV1` is accepted only when the server
can resolve its `projectId`, `resourceKind`, `resourceId`, and approved
`resourceRevision` to exactly one accessible Canonical Entity. Ambiguous,
unresolved, cross-project, or non-entity endpoints fail closed. This keeps
Knowledge Draft, Workspace, Graph, Compiled Truth, Knowledge Model relation
candidate, and Discovery resource adapters interoperable without exposing
their internal IDs as Canonical IDs.

### 4. Server-owned provenance and Evidence

`RelationDraftValueV2` is accompanied by a server-owned provenance extension.
It retains at least:

- `findingId`, `findingRevision`, `findingType`;
- re-entry manifest ID and revision/identity version;
- derived candidate ID and revision;
- validation artifact identity, revision, digest, and result/outcome;
- canonical base (`canonicalVersion`, snapshot digest) and Discovery projection
  base (revision and digest);
- source projection digest;
- all related approved resource references and revisions;
- Evidence IDs and inspectable Evidence/source lineage;
- derivation method, algorithm/generation version, and model/execution version
  when applicable;
- bridge and relation draft contract versions;
- materialization identity, actor, and timestamps.

The bridge resolves this information from persisted authoritative records. The
browser cannot create, replace, redact, or modify authoritative provenance.
Evidence lineage must be resolved through existing Evidence authority. No
synthetic `SourceVersion` is created, and multiple Evidence/source lineages
remain multiple lineages rather than being coerced into a Claim's single-source
shape.

### 5. Current-base, access, and Review lifecycle

Draft materialization and later commit must bind to the current authoritative
Canonical state and current `accessRevision` and `policyContextRevision`. The
accepted Finding/Review base is an input to freshness validation, not a license
to write against an old snapshot. The Draft must carry the current canonical
snapshot identity and the server-owned provenance of the accepted Finding.

The later implementation reuses the existing lifecycle:

1. validate Draft shape, endpoint resolution, Evidence, provenance, project and
   security scope;
2. generate the normal impact preview and validate the Draft;
3. submit the Draft to the existing `KNOWLEDGE_DRAFT_CHANGE_SET` Review;
4. issue the existing `ReviewApprovalV1` with purpose
   `KNOWLEDGE_CANONICAL_CHANGE`, bound to Draft ID/revision/digest, approved
   item IDs, Review Context ID/revision, project, access revision, and policy
   context revision;
5. run the existing `knowledge.draft.commit.v1` consumer, which derives the
   Canonical operation from the persisted Draft; the browser cannot choose it;
6. revalidate freshness, scope, Evidence, provenance, Approval status and
   command identity before commit.

The existing Approval states and consume/recovery semantics are reused. An
Approval is `CONSUMED` only after its durable Canonical result is known, and
the existing command ledger resolves replay or the crash window. The concrete
Draft Review remains the only source of Canonical-change Approval.

### 6. Canonical Relation authority

The preferred Canonical representation is a Stage 6-owned
`canonical.relations` append-only, current-version-addressable table. It is
not a Discovery table, Review table, Compiled Truth cache, Graph overlay, or
legacy Stage-5 manifest. A future migration is required after approval; WP2A
does not allocate or implement it (a future plan may evaluate the next
available migration, currently likely `059`, only under a separate request).

The Canonical Relation record is equivalent to:

```text
relationId
projectId
revisionNumber
relationType
fromEntityId / fromEntityRevision
toEntityId / toEntityRevision
direction
validFrom? / validTo?
evidenceIds[]
accessScope
sensitivity
frontendReviewApprovalAuthority { approvalId, authorityDigest }
discoveryProvenanceRef
createdAt
```

The record becomes Canonical only after validation, concrete Draft Review,
active Approval, current-base revalidation, and the atomic Stage 6 commit.
Discovery and Graph records remain non-Canonical precursors or projections.

Relation identity rules:

- A logical identity is the project plus normalized endpoint identities,
  relation type, direction, and exact authoritative validity interval. For an
  undirected relation the endpoint order is normalized; directed relations
  preserve direction.
- A revision identity is `relationId + revisionNumber`. The first bounded
  implementation supports only `ADD_RELATION` and creates revision `1`.
- A same-command/retry with the same approval authority and semantic digest
  returns the original result without a second relation, history event, or
  outbox record.
- An exact logical duplicate from a different authority is a conflict requiring
  governed reconciliation; it is not silently converted to `NO_OP`.
- `RELATION_UPDATE`, `RELATION_REMOVE`, merge, split, and arbitrary relation
  CRUD are reserved/deferred and fail closed until a separate decision.

### 7. ADD_RELATION transaction, History, and Outbox

The Stage 6 implementation must use one transaction with this order:

```text
lock project_state
-> check commit/authority replay guard
-> validate project, access, Approval, Evidence, provenance and stale base
-> resolve endpoints and duplicate logical identity
-> persist Canonical Relation revision 1
-> persist Canonical commit result
-> persist revision
-> persist History(CANONICAL_RELATION_ADDED)
-> persist existing CanonicalCommitted outbox record
-> advance project_state/version/digest
-> COMMIT
```

The transaction is atomic. It never runs Discovery, model generation, or
projection work inside the Canonical write. History operation is
`ADD_RELATION`, event type is `CANONICAL_RELATION_ADDED`, and the event retains
`relationId`, relation revision, Approval authority, actor/reason, and the
Discovery provenance reference. The existing `CanonicalCommitted` outbox is
extended only enough to identify `ADD_RELATION` and the resulting relation
identity. No second relation-specific outbox is introduced.

`NO_OP` remains reserved for an explicit Draft `NO_OP` and exact command replay
semantics. An approved `RELATION_ADD` cannot become `NO_OP`, even when a stale,
duplicate, missing, or unsupported relation path is encountered. Those cases
return a typed duplicate/conflict/stale/not-found/unsupported failure or the
original exact replay result.

### 8. Projection and supersession rule

After the Canonical commit, the existing `CanonicalCommitted` delivery path
updates or rebuilds the Compiled Truth projection, semantic corpus,
Knowledge Workspace, Graph, and Discovery resource adapter according to their
existing Ports. A Canonical Relation is the authoritative relation in every
downstream projection; an approved Discovery `RELATION_CANDIDATE` is not a
second relation.

The projection key is the Canonical `relationId/revisionNumber`. An accepted
authoring precursor stores a server-owned `canonicalRelationId` only after the
commit result is known. Projectors use the relation authority/supersession
rule, not UI deduplication: before commit, the candidate is staged and visible
as such; after commit, the canonical relation is authoritative and the
precursor is marked or projected as superseded/linked. A replayed outbox or
rebuild cannot create a second edge.

Later Discovery reconciliation compares the original Finding/re-entry
manifest, canonical base, related resource revisions, and canonical relation
identity. It may move the Finding to the existing `RESOLVED`, `STALE`, or
`SUPERSEDED` lifecycle states according to ADR-139; it does not manufacture a
new relation or silently reopen an approved Draft.

### 9. UX boundary

The owner-facing flow is exactly:

```text
Review Discovery candidate
  -> Accept for authoring
  -> open automatically materialized Draft
  -> inspect typed endpoints, direction, time, Evidence, rationale and impact
  -> Review exact relation change
  -> approve concrete Draft
  -> Apply/commit through the existing governed command
```

The UI must not expose manifests, digests, commit objects, outbox records,
internal replay guards, or raw model output as owner controls. It may display
human-readable authority/provenance and a safe reason for a blocked or stale
transition.

### 10. Security and failure semantics

Every bridge, Draft, Review, and Canonical operation is bound to one Project.
Endpoints are server-resolved. The effective access scope is the intersection
of the actor's current scope, both endpoint scopes, and the Discovery lineage;
sensitivity is the highest required value. Cross-project or ambiguous access
fails closed without leaking hidden identities.

The following conditions fail closed and never partially materialize or commit:

- stale Finding, Review Context, Draft, Canonical base, access revision, or
  policy context;
- expired, revoked, invalidated, consumed, wrong-purpose, or mismatched
  Approval;
- unknown command/commit or unrecoverable outcome;
- cross-project or unresolved endpoint;
- missing/changed Evidence or provenance;
- malformed `DiscoveryReviewResourceV1` or unsupported relation direction/time;
- duplicate logical relation with conflicting authority/content;
- unsupported operation, including any attempt to coerce `RELATION_ADD` to
  another operation.

The old 2026-08-09 Frontend Canonical commit clause is refined only for the
future bounded relation extension to read:

```text
Frontend Canonical commit supports ADD_CLAIM | ADD_RELATION | NO_OP.
All other unsupported operations fail closed.
```

The historical approved document is not silently rewritten. This ADR is the
explicit implementation-enabling refinement. ADR-139 remains the governing
epistemic and re-entry authority; ADR-152 does not amend its meaning.

### 11. Backup, restore, deletion, and retention

If `canonical.relations` is selected by the later implementation, relations,
their History, Approval authority reference, Discovery provenance reference,
and projection watermarks are included in the existing backup/restore,
project-deletion, and audit-retention policies. No second backup framework or
special retention store is created. Restore/replay must preserve relation
identity and outbox idempotency. Schema removal or relation-data deletion is a
separate governed migration and is not a rollback shortcut.

### 12. Rollback and replacement

Rollback of the later Product implementation disables the Discovery accepted-
authoring bridge and the `ADD_RELATION` operation mapping. It preserves already
committed Canonical Relations, Drafts, Review decisions, Approvals, History,
outbox records, and provenance. Existing readers must tolerate and explicitly
handle the versioned `ADD_RELATION` result; they must not silently coerce an
unknown operation. Removing the table or rewriting committed data requires a
separate migration and approval.

## Alternatives considered

| Alternative                                               | Decision    | Reason                                                                                                                                               |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Convert the relation to `CLAIM_ADD`                    | `REJECT`    | Loses typed endpoints/direction/time and violates ADR-139 and Claim/Evidence semantics.                                                              |
| B. Treat `ACCEPTED_FOR_AUTHORING` as Canonical Approval   | `REJECT`    | Violates ADR-128's separate Approval/Commit boundary and makes a Discovery decision approve an exact relation it has not reviewed.                   |
| C. Write only to Review or Compiled Truth                 | `REJECT`    | Leaves no Canonical authority, creates a projection-as-truth or Review-as-truth boundary, and cannot satisfy E2E-A.                                  |
| D. Coerce Frontend Draft into the legacy Stage-5 manifest | `REJECT`    | Reuses the wrong authority and cannot preserve typed relation provenance; ADR-128/2026-08-09 explicitly forbid legacy coercion.                      |
| E. Bounded Stage-6 `ADD_RELATION` extension               | `PREFERRED` | Preserves ADR-139, keeps Review/Approval/Canonical ownership explicit, supports typed relation identity, and limits scope to one additive operation. |

## OSS and replacement review

The required OSS-first review was performed against the existing pinned role
matrix and evaluation records. No external package is adopted, extracted,
augmented, or added by this architecture proposal.

| Candidate     | Official repository / reviewed pin / license                                                                                      | Decision for WP2A | Security, maintenance, and boundary conclusion                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| gbrain        | [garrytan/gbrain](https://github.com/garrytan/gbrain) / `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                          | `REFERENCE_ONLY`  | Job, lock, idempotency, and history patterns may inform implementation; its Runtime, DB, identity, and Canonical authority remain excluded. |
| lucas         | [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) / `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0       | `REFERENCE_ONLY`  | Conversion/Evidence patterns do not provide a relation authority or Canonical commit boundary; SQLite/FTS/VaultFS/runtime remain excluded.  |
| ddsyasas      | [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) / `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                      | `REFERENCE_ONLY`  | Action-oriented UX may inform the authoring flow; backend, SQLite, ingest/query/lint, and LLM client are excluded.                          |
| OpenKnowledge | [inkeep/open-knowledge](https://github.com/inkeep/open-knowledge) / `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later | `REFERENCE_ONLY`  | Cockpit/Graph/Diff presentation is reference-only; GPL runtime/storage, Git/MCP engines, Canonical, and Yjs are excluded.                   |

No relevant OSS supplies the missing server-owned Discovery-to-Draft or
Shotgun Approval-to-Canonical Relation authority. The selected relation
authority therefore remains Shotgun-owned through Ports and an independently
replaceable Stage 6 adapter. No new direct implementation may proceed until a
later request records the same boundary, exact version/commit choices for any
new dependency, Contract tests, Golden Corpus impact, security negatives, and
replacement/rollback exercise.

## Deferred Product implementation map

This ADR intentionally separates decisions from implementation. A later
bounded request must cover, in order:

1. contract additions and strict decoders for the bridge, `RelationDraftValueV2`,
   provenance, Canonical Relation, `ADD_RELATION`, History, and outbox;
2. PostgreSQL and in-memory repositories/transaction adapters, with a governed
   migration after approval;
3. the server-owned bridge and idempotent Draft materialization;
4. Draft validation, impact, Review submission, Approval binding, and commit
   operation mapping;
5. Stage 6 Canonical Relation write, replay guard, history, outbox, and
   project-state transaction;
6. Compiled Truth, semantic corpus, Workspace, Graph, and Discovery projection
   consumers plus precursor supersession;
7. backup/restore/deletion/retention and recovery behavior;
8. Contract, Golden Corpus, replay/idempotency, security/Approval-negative,
   adapter replacement, migration, rollback, and end-to-end tests;
9. UI wiring that exposes the governed flow without exposing internal
   manifests/digests/commit/outbox controls.

The following are explicitly outside this WP2A proposal: Product/runtime code,
schema or migration files, tests, dependencies/lockfiles, UI implementation,
WP2 acceptance fixtures, WP3, deployment, and AKP v1 completion.

## Acceptance criteria for this proposal

| ID         | Criterion                                                                 | WP2A disposition                                                |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| WP2A-AC-01 | Reproduce the two WP2 blockers from canonical repository evidence         | Satisfied by the Context section and companion audit.           |
| WP2A-AC-02 | Preserve Discovery approval as non-Canonical/non-Approval                 | Explicit in §§1, 2, and 5.                                      |
| WP2A-AC-03 | Select concrete server-owned Discovery→Draft materialization              | Bridge selected in §2; no user retyping required.               |
| WP2A-AC-04 | Preserve relation endpoints, direction, and authoritative time            | `RelationDraftValueV2` selected in §3.                          |
| WP2A-AC-05 | Define complete server-owned provenance                                   | §4 defines the mandatory lineage extension.                     |
| WP2A-AC-06 | Keep concrete Draft Review on `KNOWLEDGE_CANONICAL_CHANGE`                | §5 retains the existing Approval purpose and binding.           |
| WP2A-AC-07 | Reconcile ADR-139 with the old `ADD_CLAIM / NO_OP` implementation         | §§Context and 10 make the bounded refinement explicit.          |
| WP2A-AC-08 | Select a bounded Stage 6 Canonical Relation authority                     | §6 selects `canonical.relations`; future migration is required. |
| WP2A-AC-09 | Define ADD_RELATION identity, duplicate, replay, and reserved operations  | §6 specifies all four.                                          |
| WP2A-AC-10 | Fail closed for unsupported operations and never coerce relation to NO_OP | §§3, 7, and 10.                                                 |
| WP2A-AC-11 | Define transaction, History, and existing outbox behavior                 | §7.                                                             |
| WP2A-AC-12 | Define projections, authority, dedupe, and Discovery reconciliation       | §8.                                                             |
| WP2A-AC-13 | Define migration, backup/restore, retention, and rollback                 | §§6, 11, and 12.                                                |
| WP2A-AC-14 | Introduce no Product/runtime/schema implementation in this work           | Authority gate and Deferred Product map.                        |
| WP2A-AC-15 | Keep ADR-152 `PROPOSED / USER APPROVAL PENDING`                           | Frontmatter and Authority gate.                                 |
| WP2A-AC-16 | Keep WP2 blocked and do not start WP3 or AKP completion                   | Authority gate and matrix control update.                       |
| WP2A-AC-17 | Record OSS decisions and replacement boundary                             | OSS and replacement review.                                     |

## Status and next gate

ADR-152 is **PROPOSED / USER APPROVAL PENDING**. The companion WP2A audit and
acceptance matrix record are documentation/governance artifacts only. The next
permitted step is independent review and explicit User approval, followed by a
new bounded Product remediation request. Until then:

- WP2 remains `BLOCKED_PENDING_REMEDIATION`;
- E2E-A remains `BLOCKED_ARCHITECTURE_GAP`;
- WP2R remains merged and complete as previously recorded;
- no WP2, WP3, deployment, or AKP v1 completion work is authorized.
