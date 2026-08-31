# ADR-151 — Discovery Production Conflict Signal Authority

- Status: **PROPOSED / USER APPROVAL PENDING**
- Proposed at: 2026-09-01
- Decision date: **PENDING**
- Accepted at: **PENDING**
- Accepted by: **PENDING**
- Decision owner: `USER`
- Work item: `AKP-8 WP2R — Production Conflict Signal Authority Remediation`
- Subject base: `main@0077ddc90efe4b3756cce66ad31bbc021c49395b`
- Related ADRs: ADR-136, ADR-137, ADR-138, ADR-139, ADR-142, ADR-149, ADR-150
- Product implementation: **NOT_AUTHORIZED**

## Context

AKP-8 WP2 stopped before implementing acceptance tests because the frozen
ADR-142 E2E-M journey requires a real production `CONFLICT_HYPOTHESIS` path,
while the canonical composition exposes no production authority that supplies
the typed incompatibility signal consumed by the existing Discovery selector.

The existing ports and downstream safety gates are present, but the current
production assembly leaves `competingResource` and
`existingCanonicalConflict` optional. The WP2R Phase A audit found no safe
existing source that can be exposed through those ports without introducing a
new incompatibility authority or reconstructing typed participants from
lossy/free-form projections.

This proposal selects one bounded authority architecture. It does not amend
ADR-142, weaken E2E-M, or authorize Product implementation before user
approval and a subsequent bounded implementation request.

## Phase A audit conclusion

### Frozen mapping audit

| Frozen mapping                                    | Current source inspected                                                                                          | Current conclusion                                                                                                                                                                                             | Verdict                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `FACTUAL` → `TYPED_PROPOSITION`                   | Approved `RelationCandidate` payloads returned by `PostgresKnowledgeModelRepository.listApprovedItems(projectId)` | Endpoints, relation type and Evidence are retained, but no accepted production authority says which typed propositions are incompatible. “Same endpoints + different relation type” would be a new comparator. | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `TEMPORAL` → `TEMPORAL_QUALIFICATION`             | Approved relation `validFrom`/`validTo`/`temporalEvidenceIds` and Compiled Truth temporal state                   | Values and Evidence exist, but no accepted authority defines temporal incompatibility or overlap. `CURRENT`/`PAST`/`FUTURE`/`CONFLICT` projection state is not that comparator.                                | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `IDENTITY` → `IDENTITY_ASSIGNMENT`                | `EntityCandidate.resolution`                                                                                      | `NEW`, `EXACT_MATCH` and `POSSIBLY_SAME` do not expose a deterministic conflicting assignment pair or an identity-conflict reader.                                                                             | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |
| `MODEL_DISAGREEMENT` → `EXPLICIT_CONFLICT_SIGNAL` | `ModelAssessment` and `modelDisagreementView()`                                                                   | The view summarizes model output variants; it is not a server-issued incompatibility authority. Provider/model strings, wording or count cannot establish Conflict.                                            | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |

### Approved `ConflictCandidate` adjudication

**Verdict: `NOT_VALID_AS_DISCOVERY_INCOMPATIBILITY_AUTHORITY`.**

The current approved Knowledge `ConflictCandidate` is not selected as a
`DiscoveryCompetingResourcePortV1` authority and cannot be used for
`DiscoveryExistingCanonicalConflictPortV1`.

The evidence is structural and semantic:

1. `ConflictCandidate` contains `candidateId`, `subjectCandidateIds[]`,
   free-form `summary`, `conflictKind`, candidate Evidence and optional model
   outputs. It does not contain a typed left/right proposition pair, typed
   values, a server-issued incompatibility signal ID, or a conflict-specific
   provenance assertion.
2. The `knowledge-candidate.v1` schema only validates field shape and the
   generic Stage 9 `assertCandidates` path validates SourceVersion, Evidence
   binding, uniqueness and references. `ReviewKnowledgeGroup` records a
   user decision for the whole Atomic Group; it does not validate that a
   `ConflictCandidate`'s `conflictKind` is semantically proven.
3. Repository search found no production ConflictCandidate producer. The
   instances in the contract/database tests are fixtures for candidate and
   review contracts, not a server-authoritative comparison result.
4. `ConflictCandidate` is stored in `knowledge.review_groups`, while the
   Knowledge Model manifest has `canWriteCanonical: false`. Approval therefore
   means approval of a Knowledge Review Group, not registration of a
   Canonical Conflict or a typed incompatibility authority.
5. `subjectCandidateIds[]` cannot be safely converted to the exact current
   Discovery resource pair, and `summary`, labels, aliases, model output or
   `conflictKind` enum membership cannot fill that gap.

Accordingly, an approved `ConflictCandidate` may remain a governed review
record and may later be re-evaluated by a separately approved contract
refinement. It is not an active Discovery incompatibility source in V1, and
its four enum values do not imply support for the four frozen mappings.

## Decision

Subject to user approval, Shotgun v1 **will use Option B: a new governed typed
incompatibility assertion authority**.

### 1. Authority owner and boundary

The authority owner will be `stage9.knowledge-model` / Shotgun Knowledge Model.
It will own the user-governed assertion record and its lifecycle while
retaining `canWriteCanonical: false`. Discovery will consume the source only
through a versioned `TypedIncompatibilityAssertionReaderPort`; it will not read
the table directly.

The authority's durable source will be:

```text
knowledge.typed_incompatibility_assertions
```

This is a durable, non-Canonical, project-scoped governed record. It is not a
Compiled Truth item, a Canonical Claim, a Discovery finding, a replacement for
the Conflict Review path, or a semantic cache.

### 2. Authoritative producer and creation condition

The only V1 producer will be a new server-side
`TypedIncompatibilityReviewAuthority` in the Knowledge Model. It creates an
assertion only from a dedicated user-bound typed review decision
(`APPROVE_TYPED_INCOMPATIBILITY_ASSERTION`) that names two exact approved
participant revisions and explicitly records that the pair is incompatible.

The producer must verify all of the following before writing an assertion:

- the actor is a user with the required owner/review scope;
- both participants belong to the same project and resolve to two distinct
  exact approved/current typed resources in one pinned source snapshot;
- the participants are typed Relation resources represented by exact
  `DiscoveryResourceRefV1` identities, with the candidate ID and revision
  resolved by server data rather than labels or text;
- each participant has attached Evidence, and the assertion Evidence is a
  bounded subset of the participants' inspectable Evidence lineage;
- the reviewer explicitly selects `kind = FACTUAL` and
  `source = TYPED_PROPOSITION` for this V1 path;
- the authority records the review decision ID, source/canonical bases and
  security composition needed to reproduce the decision.

The user review decision is the semantic authority for the explicit pair. The
server enforces the typed identity, Evidence, security, freshness and
completeness constraints. No automatic relation-type comparison is performed.
The current generic `ConflictCandidate` approval path is not this producer and
cannot be silently upgraded into it.

### 3. `TypedIncompatibilityAssertionV1` contract

The persisted assertion is versioned and contains, or is contract-equivalent
to, the following fields:

```text
schemaVersion = typed-incompatibility-assertion.v1
assertionId
assertionRevision
projectId
leftResourceRef
rightResourceRef
kind = FACTUAL
source = TYPED_PROPOSITION
evidenceIds[]
provenance
accessScope
sensitivity
sourceAuthorityId = stage9.typed-incompatibility-review
sourceAuthorityRevision = 1.0.0
canonicalBase
sourceBase
status = ACTIVE | SUPERSEDED | RETIRED
createdAt
supersededAt?
retiredAt?
```

`leftResourceRef` and `rightResourceRef` are exact typed resource identities;
they are not labels, names or free-text claims. The assertion's stable
Discovery signal identity is server-owned and derived from the immutable
assertion identity and revision, for example
`{assertionId}:r{assertionRevision}`. It is never derived from model wording,
ranking or a similarity score.

`provenance` includes the explicit review decision ID, actor/audit reference,
participant resource revisions, Evidence lineage, source authority version and
the algorithm/contract version used to bind the record. The assertion does not
manufacture Evidence or change Canonical state.

### 4. Supported V1 mapping

V1 supports exactly one honest mapping:

```text
FACTUAL -> TYPED_PROPOSITION
```

The assertion is created only when the dedicated typed review decision names
the exact two Relation participant revisions and explicitly governs them as an
incompatible factual proposition pair. Discovery may then read an active
assertion through `TypedIncompatibilityAssertionReaderPort` and project it to
one `DiscoveryCompetingResourceV1` with the same typed pair and stable signal
ID. A first Discovery projection can therefore produce a new non-Canonical
`CONFLICT_HYPOTHESIS`, which continues through ADR-136/ADR-139 derived
validation and the existing Conflict comparison/review path.

This is not recycling an already registered Canonical Conflict: the assertion
is a separate non-Canonical governed input, the Canonical conflict reader is
not used, and Discovery never treats the assertion or finding as Canonical.
The assertion's prior governance does not bypass the required derived
validation, Review, mandatory visibility or suppression boundaries.

The following mappings remain explicitly unavailable/reserved in V1:

- `TEMPORAL -> TEMPORAL_QUALIFICATION`: no date-overlap or temporal
  incompatibility comparator is approved by this ADR.
- `IDENTITY -> IDENTITY_ASSIGNMENT`: no deterministic identity-assignment
  conflict authority is present.
- `MODEL_DISAGREEMENT -> EXPLICIT_CONFLICT_SIGNAL`: model output variants,
  provider/model identity and wording are not conflict truth.

The current `ConflictCandidate.conflictKind` enum does not authorize any of
these mappings.

### 5. Persistence, rebuild and migration

The selected architecture requires a new durable `knowledge` table or
equivalent append-only storage for `TypedIncompatibilityAssertionV1`. The
assertion is non-Canonical and is retained under the normal project deletion,
backup/restore and audit-retention policy. The immutable assertion revision and
its explicit review decision are the governed source of truth; the Discovery
reader output is rebuildable from them and the pinned source/base identities.

An implementation must add a separately reviewed, versioned migration and
contract adapter. This WP2R correction writes **no migration, table or schema**.
The migration must preserve assertion revisions, reject content changes under
an existing assertion identity, and support status/supersession without
rewriting historical assertions.

### 6. Security and disclosure

The producer and reader require project equality. For a multi-resource
assertion, effective access scope is the restrictive intersection/common
audience authorized for both participants and the execution context; effective
sensitivity is the highest/most restrictive participant classification and
applicable policy. If there is no safe common audience, the assertion is not
created or exposed. Cross-project and unauthorized participants fail closed
without disclosing resource existence.

Evidence and provenance references remain inspectable through their existing
authorities without exposing hidden participant content. Discovery may expose
bounded references and signal metadata only; it cannot manufacture Facts,
Claims, Evidence or Canonical records.

### 7. Completeness and fail-closed behavior

The reader uses the existing Discovery completeness vocabulary
`COMPLETE | TRUNCATED`:

- `COMPLETE` means the authority was available, the pinned source/base was
  valid, all bounded eligible assertion rows for the requested resource set
  were read, and no security or budget truncation occurred.
- `TRUNCATED` means the configured bound/budget was reached or the source/base
  could not provide a complete bounded read. It is not proof that no conflict
  exists.
- An unavailable authority, unsupported contract or invalid source/base must
  not be returned as `COMPLETE` with an empty list. The existing optional Port
  remains absent/degraded and the selector returns no positive Conflict
  candidate. Unsupported mappings remain unavailable rather than being
  inferred.

The reader must not turn missing source, missing Canonical Conflict, graph
absence, empty search results or a projection lag into affirmative evidence of
no incompatibility.

### 8. History and re-evaluation

Assertions are append-only by revision. A participant becoming superseded or
retired, Evidence changing, a stale source base, or a later Canonical update
causes a new status/re-evaluation record; it does not rewrite the prior
assertion or historical Discovery finding. Existing reconciliation remains
responsible for `RESOLVED`, `STALE` and `SUPERSEDED` finding lifecycle states.

If a later Canonical typed Conflict is registered, the separate
`DiscoveryExistingCanonicalConflictPortV1` path may suppress/route the known
conflict according to its own approved authority. It does not rewrite the
assertion or conflate the two ports. An assertion that is no longer current
must stop producing an active competing-resource signal after revalidation,
while its history remains auditable.

### 9. Existing Canonical Conflict decision

`DiscoveryExistingCanonicalConflictPortV1` remains
`UNAVAILABLE_IN_CURRENT_PRODUCT`. `CanonicalClaim` and the current
Frontend Draft → Canonical path do not retain a typed Conflict kind and exact
participant list. `ConflictProposalValueV1` and an approved Knowledge
`ConflictCandidate` cannot be reconstructed into that reader. A future
Canonical typed-conflict persistence decision is separate from this ADR and is
not required for the selected V1 competing-resource source.

### 10. Rollback and replacement

Rollback disables/removes the new reader from normal assembly and leaves the
assertion store dormant/read-only. Existing assertion, review, Evidence,
Canonical and Discovery history remains preserved; Canonical is not mutated.
The selector returns the existing safe degraded/no-positive-candidate result
for unsupported or unavailable conflict signals. Deleting the new table, if
ever required, is a separately governed migration and is not part of rollback.

The reader is behind the existing
`DiscoveryCompetingResourcePortV1` boundary. A replacement adapter must pass
the same contract, security, completeness, identity and provenance tests and
must be able to read the same versioned assertion source or perform an
explicitly governed migration.

## Explicitly rejected

- Using an approved `ConflictCandidate` as authority without the dedicated
  typed assertion contract and review semantics described above.
- Treating `ConflictCandidate.conflictKind` enum membership as proof of a
  typed proposition, temporal qualification, identity assignment or model
  disagreement.
- Semantic similarity, embedding distance, labels, aliases, string
  inequality, date overlap, ranking, feedback, graph absence or model output
  as conflict truth.
- Parsing `CompiledTruthItem.label` or `CanonicalClaim.claimText` to recover
  participants or typed values.
- Promoting an assertion, a Discovery finding or Draft conflict data into
  Canonical truth.
- Wiring `DiscoveryExistingCanonicalConflictPortV1` from the current lossy
  Canonical Claim projection.
- Weakening or removing ADR-142 E2E-M.

## Approval gate and implementation boundary

This ADR remains **PROPOSED / USER APPROVAL PENDING**. It must not be marked
accepted by the WP2R correction branch, and no user approval may be recorded
by the repository.

After user approval, GPT must issue a separate bounded implementation request
that names the migration, exact contract/schema, repository adapter, normal
`startShotgunApplication` wiring, Contract/Golden Corpus/Security/Replacement
tests and rollout/rollback steps. Until that request exists:

- Product/runtime/test/schema implementation is **NOT AUTHORIZED**;
- no migration/table/dependency/lockfile is written;
- WP2 remains `BLOCKED_BEFORE_IMPLEMENTATION`;
- E2E-M remains unproven and is not weakened or removed;
- WP3, deployment and AKP v1 completion must not start or be declared.
