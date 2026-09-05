# ADR-160 — Stage 5 Semantic Comparison and Durable Multi-Relationship Boundary

- Status: **PROPOSED — Issue #203 design review**
- Proposed at: 2026-09-05
- Decision owner: Stage 5 architecture review / user approval required
- Work item: Issue #203 — ECAV Gate A comparison graduation
- Subject base: `main@fb209bffb5876ac3c717b429654be026dc1d84c3`
- Related decisions: ADR-037, ADR-038, ADR-039, ADR-041, ADR-042, ADR-045,
  ADR-046, ADR-047, ADR-048, ADR-084, ADR-085, ADR-096, ADR-133, ADR-135,
  ADR-147, ADR-148

## Context

ECAV-01B Gate A proved that the current Stage 5 implementation cannot establish
a durable relationship between a new Candidate and an existing Canonical Claim.
The current implementation deliberately follows the ADR-085 Stage 5 MVP:
`NEW_CLAIM`, `EXACT_DUPLICATE`, and `POSSIBLE_CONFLICT`, using normalized string
equality and character/word diff similarity. A semantically overlapping
First-Principles Candidate therefore becomes `NEW_CLAIM` with no Canonical
resource identity.

This is a capability boundary, not an accidental comparison bug. The approved
Phase 4 ADD already requires semantic comparison, multiple relationships per
Candidate, conflict/time/ambiguity preservation, and governed AI analysis. A
single winning `matchedClaim` cannot satisfy that contract.

ADR-085 remains the historical and authoritative decision for the Stage 5 MVP.
This ADR amends/supersedes **only** the mature comparison behavior that ADR-085
intentionally deferred. It does not rewrite ADR-085, change Canonical authority,
or authorize Product implementation by itself. Product work begins only after
this ADR is accepted and an implementation request is approved.

## Decision summary

The mature comparison contract is introduced as version 2. It keeps a bounded
candidate-level review disposition separate from zero, one, or many durable
semantic relationships. Existing v1 rows and consumers remain historical and
read-compatible; they are never reinterpreted in place.

The authoritative flow is:

```text
READY Candidate revision
  -> project/access/sensitivity policy filter
  -> exact normalized identity lookup
  -> bounded authorized Canonical shortlist
  -> governed semantic analysis (if required)
  -> immutable ComparisonResult v2 + immutable AnalysisRevision(s)
  -> zero/one/many Relationship records
  -> Review eligibility / DraftChangeSet v2
  -> explicit user decision
```

Retrieval similarity is a shortlist signal only. It never becomes a semantic
relationship or a conflict by itself. AI analysis remains analysis, not
Canonical truth, approval, Fact promotion, or relation write authority.

## 1. Contract shape: disposition plus relationships

The v2 shape is intentionally not a larger replacement enum:

```ts
type ComparisonDispositionV2 =
  | 'NEW'
  | 'EXACT_DUPLICATE'
  | 'REVIEW_REQUIRED'
  | 'ANALYSIS_PENDING'
  | 'SEMANTIC_UNAVAILABLE'
  | 'POLICY_BLOCKED'
  | 'STALE';

type SemanticRelationshipType =
  | 'SEMANTIC_DUPLICATE'
  | 'SUPPORTS'
  | 'REFINES'
  | 'NARROWS'
  | 'BROADENS'
  | 'UPDATES'
  | 'SUPERSEDES'
  | 'CONTRADICTS'
  | 'TEMPORALLY_COEXISTS'
  | 'AMBIGUOUS'
  | 'UNRELATED'
  | 'POLICY_BLOCKED';

type ComparisonResultV2 = {
  comparisonId: string;
  contractVersion: '2.0';
  projectId: string;
  candidate: {
    id: string;
    revision: number;
    digest: string;
    sourceVersionId: string;
    evidenceIds: readonly string[];
  };
  canonicalSnapshot: {
    id: string;
    version: number;
    digest: string;
  };
  disposition: ComparisonDispositionV2;
  reviewRecommendation: 'NO_OP' | 'ADD_CLAIM' | 'MODIFY_REVIEW' | 'HOLD';
  shortlist: ShortlistAudit;
  analysisRevisionIds: readonly string[];
  relationshipIds: readonly string[];
  accessScope: readonly string[];
  sensitivity: SecuritySensitivity;
  createdAt: string;
};

type ShortlistAudit = {
  canonicalSnapshot: {
    id: string;
    version: number;
    digest: string;
  };
  lexicalProjectionWatermark: string;
  lexicalProjectionBase: string;
  semanticGenerationId: string;
  semanticSourceProjectionDigest: string;
  semanticCanonicalBaseVersion: number;
  querySemanticReadiness: 'READY' | 'STALE' | 'DEGRADED' | 'UNAVAILABLE';
  policyRevision: string;
  k: number;
  selectedTargetIdentities: readonly string[];
  exclusionCounts: Readonly<Record<string, number>>;
  truncated: boolean;
  coverageStatus: 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT' | 'UNAVAILABLE';
};

type SemanticRelationshipV2 = {
  relationshipId: string;
  comparisonId: string;
  candidateId: string;
  candidateRevision: number;
  candidateDigest: string;
  candidateEvidenceIds: readonly string[];
  comparedResource: {
    resourceType: 'CLAIM' | 'FACT' | 'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION';
    resourceId: string;
    resourceRevision: number;
  };
  canonicalSnapshot: {
    snapshotId: string;
    version: number;
    digest: string;
  };
  type: SemanticRelationshipType;
  conflictKind?:
    | 'DIRECT_NEGATION'
    | 'QUANTITATIVE_VALUE'
    | 'SCOPE'
    | 'TEMPORAL'
    | 'DEFINITION_TERM'
    | 'ENTITY_IDENTITY'
    | 'SOURCE_OBSERVATION'
    | 'POLICY';
  analysisRevisionId: string;
  ruleIdentity: string;
  rationale: string;
  materialDigest: string;
  accessScope: readonly string[];
  sensitivity: SecuritySensitivity;
  revision: number;
  createdAt: string;
};
```

Field names are design names, not a license to expose internal storage types.
The implementation must preserve these identities and invariants even if the
wire representation is adapted. `matchedClaim` is not a v2 relationship model;
it may remain only as a read-only v1 compatibility field.

`NEW` is a candidate-level conclusion scoped to a successfully completed,
versioned bounded-comparison policy: within the valid comparison coverage, no
material relationship was established. It is not proof of absolute or global
corpus novelty and never creates a synthetic relationship to an arbitrary
Claim. A shortlist cap, truncation, stale projection, unavailable retrieval
channel, policy exclusion or unsupported resource type is not evidence of
`UNRELATED` or `NEW`.
`EXACT_DUPLICATE` is deterministic normalized identity and recommends `NO_OP`;
it does not require an LLM call. A Candidate may be `REVIEW_REQUIRED` while
having, for example, `SUPPORTS` C1, `REFINES` C2, and `UNRELATED` to a third
shortlisted resource at the same time.

`UNRELATED` is persisted only for eligible, actually analyzed shortlist targets
within the configured cap. Non-selected corpus members are not represented as
unrelated. `POLICY_BLOCKED` is a bounded disposition/diagnostic when policy
prevents comparison; a protected resource is never leaked merely to create a
relationship row.

### 1.1 Issue #203 activation scope

The mature v2 contract reserves the Phase 4 resource union, but the first
Issue #203 implementation and Gate A closure are explicitly **`CLAIM`-only**.
The implementation must not silently expand comparison to `FACT`, `ENTITY`,
`RELATION`, `EVENT`, or `DECISION`. `FACT` remains deferred under ADR-147 and
is not Product-eligible in this rollout.

Activation of another resource type requires a separate authorization that
identifies its authoritative Canonical snapshot/read boundary, retrieval
eligibility, security lineage and comparison acceptance evidence. Until then,
an unsupported resource type must not be classified as `UNRELATED` or `NEW`,
and must not be sent to semantic analysis as though it were eligible. The
long-term Phase 4 vocabulary is therefore preserved while the first
implementation authorization remains narrowly scoped to `CLAIM`.

## 2. Immutable identity and persistence strategy

Use a hybrid durable model:

1. Keep `comparison.results` and v1 JSON unchanged for historical MVP rows.
2. Add an additive v2 comparison summary store owned by the Comparison module.
3. Store each semantic relationship in a normalized child store so one
   Candidate can relate to many Canonical resources without JSON-only lookup.
4. Store each governed model/rule execution as an immutable AnalysisRevision.

The eventual PostgreSQL structures are additive (exact names are implementation
work):

```text
comparison.results_v2
  (comparison_id, project_id, candidate identity/digest,
   canonical snapshot identity, disposition, recommendation,
   shortlist digest, status, security lineage, created_at)

comparison.relationships_v2
  (relationship_id, comparison_id, candidate identity,
   compared resource identity/revision, canonical snapshot,
   relationship type/conflict kind, analysis revision, rationale digest,
   security lineage, relationship revision, created_at)

comparison.analysis_revisions_v2
  (analysis_revision_id, comparison_id, input digest,
   provider/model/capability identity, prompt/schema/policy revisions,
   attempt/outcome, output/material digest, bounded output, created_at)
```

The summary is immutable. A retry or changed analysis creates a new Analysis
Revision and, when its result is accepted for review, a new ComparisonResult v2
revision linked to the same Candidate and a newly pinned snapshot. Old analysis
and relationship rows remain auditable and queryable. Database uniqueness must
make replay idempotent on
`project + candidate revision/digest + snapshot digest + analysis input digest`;
relationship uniqueness additionally includes compared resource revision and
analysis revision. An outcome-unknown attempt is reconciled before a new
attempt is accepted.

The persistence adapter is the only owner of these tables. Other modules use
versioned queries/events and never access the schema directly.

## 3. Semantic target shortlist

The Product constructs a bounded, server-owned shortlist in this order:

1. Validate Candidate readiness, project binding, access scope and sensitivity.
2. Perform deterministic normalized identity lookup. An exact hit ends semantic
   analysis and produces `EXACT_DUPLICATE -> NO_OP`.
3. Use the existing authority-safe lexical/hybrid retrieval Port, plus bounded
   entity/topic/time hints when available, against the pinned Canonical snapshot.
4. Apply access/sensitivity/provider-egress policy before ranking or prompt
   construction. Cap the eligible shortlist at an explicit configuration (K)
   and persist a `ShortlistAudit` containing the pinned Canonical snapshot,
   lexical projection watermark/base, semantic generation ID,
   `sourceProjectionDigest`, semantic Canonical base version, query readiness,
   policy revision, K/cap, selected target identities, exclusion counts,
   truncation and coverage status.

The pinned Canonical snapshot must be exactly compatible with the lexical
projection and semantic generation used to construct the shortlist. If the
semantic generation or any required retrieval channel is stale, degraded,
unavailable, based on another Canonical base, or otherwise ineligible for the
pinned snapshot, the comparison fails closed into an explicit incomplete or
unavailable state. It must not conclude `NEW`. If coverage is insufficient to
support a `NEW` disposition, Review receives `ANALYSIS_PENDING` or
`SEMANTIC_UNAVAILABLE` with `HOLD`; no DraftChangeSet or approval is produced
until a fresh eligible shortlist and completed comparison exist. This follows
the semantic stale/readiness behavior established by ADR-148.

The full project corpus is never sent to a provider. Ranking/similarity only
selects targets; it cannot create `SUPPORTS`, `REFINES`, `CONTRADICTS`, or any
other relationship. A target missing from the bounded shortlist is not evidence
of `UNRELATED` or `NEW`.

## 4. Semantic analysis authority

Semantic comparison uses the existing governed AI runtime and capability-based
provider routing. The v2 contract is provider-neutral and must not name
OpenAI, DeepSeek, GPT, Gemini or Claude as a required implementation.

Every AnalysisRevision records immutable reconstruction identity:

- provider/model/capability selection and credential revision reference;
- prompt/template, output-schema and semantic-policy revision;
- Candidate digest, shortlist/Canonical snapshot digest and compared resources;
- structured output/material digest, attempt number, timing and terminal outcome;
- model disagreement/challenger analysis references where used.

Sensitive material is retained only behind the same access/sensitivity boundary
as the Candidate and Canonical resources. Secrets, credentials and raw protected
content are not written to general logs or sent to an unauthorized provider.

AI output cannot merge or write Canonical, create a Canonical Relation, promote a
Claim to Fact, or replace explicit user approval. Deterministic validation checks
that every referenced resource and Evidence identity exists in the pinned
snapshot before a relationship is durable.

## 5. Fail-closed availability and recovery

The following v2 comparison states are distinct:

```text
PENDING -> ANALYZING -> COMPLETED
                    -> SEMANTIC_UNAVAILABLE
                    -> FAILED_RETRYABLE
                    -> FAILED_TERMINAL
                    -> POLICY_BLOCKED
```

`SEMANTIC_UNAVAILABLE` is never converted to `NEW`. If semantic analysis is
required, only `COMPLETED` emits `ComparisonCompletedV2`. Unavailable, policy,
retryable and terminal outcomes emit the corresponding explicit incomplete or
failure event carrying a safe code and durable AnalysisRevision identity; they
do not emit a success completion event.

No `DraftChangeSetV2` is produced for `SEMANTIC_UNAVAILABLE`, `PENDING`, or
`POLICY_BLOCKED`, and Review approval is blocked until a fresh `COMPLETED`
comparison exists. Retry reuses the same semantic idempotency key for an
outcome-unknown attempt and creates a new immutable analysis revision only after
reconciliation. A provider/model/prompt/policy change is a new analysis input,
not an overwrite of the old result.

`FAILED_RETRYABLE` remains observable and retryable; `FAILED_TERMINAL` requires
operator/user re-entry. These states are safe operational results, not Claims,
Facts, or novelty conclusions.

## 6. Relationship and conflict semantics

The Phase 4 vocabulary is preserved exactly. A Candidate may have multiple
different relationships, and no “winning match” is selected. Conflict requires
semantic evidence and an explicit subtype: direct negation, quantitative/value,
scope, temporal, definition/term, entity identity, source-observation, or policy
conflict. Similarity thresholds and diff lengths are never conflict rules.

`TEMPORALLY_COEXISTS` is used when propositions can both be true in distinct
valid intervals. `AMBIGUOUS` preserves unresolved meaning or model disagreement.
`SUPERSEDES` and `UPDATES` do not delete historical Canonical state. The Review
layer decides which supported operation, if any, is appropriate.

## 7. Security and provenance boundary

The Project and Canonical snapshot are server-authoritative. Scope and
sensitivity are checked before shortlist selection, prompt creation, provider
egress, persistence, and read projection. Unauthorized Canonical resources do
not appear in a shortlist, prompt, rationale, result, or error message.

Candidate Evidence IDs, SourceVersion, compared-resource identity, snapshot
identity, access scope and sensitivity are inspectable together. Provider policy
is evaluated before egress. The v2 module keeps `canWriteCanonical = false` and
cannot execute external Actions.

## 8. Freshness, staleness and idempotency

Comparison v2 pins immutable Candidate revision/digest, Canonical snapshot
id/version/digest, shortlist digest, policy identity and AnalysisRevision. Any of
the following invalidates a result for approval without deleting history:

- Candidate text, Evidence, revision or digest changes;
- Canonical snapshot version/digest changes;
- shortlist policy or access/sensitivity changes;
- provider/model/capability, prompt/schema, or semantic-policy revision changes.

The freshness query returns a typed stale reason. Approval cannot proceed against
a stale v2 comparison. A new comparison is a new durable revision and emits a
new completion event. Duplicate CandidateValidated delivery, process restart,
and concurrent workers converge on the same immutable result by database
uniqueness and idempotency keys.

## 9. Review and ChangeSet behavior

Review remains the user authority:

- deterministic `EXACT_DUPLICATE` may recommend `NO_OP`;
- `SEMANTIC_DUPLICATE` may recommend no-op, but still requires user review;
- `SUPPORTS`, `REFINES`, `NARROWS`, `BROADENS`, `UPDATES` and `SUPERSEDES`
  may inform the existing ADD/MODIFY-style review operations;
- `CONTRADICTS`, `AMBIGUOUS`, unresolved temporal states and model disagreement
  remain visible and default to `HOLD`/review;
- unavailable or policy-blocked semantic analysis cannot produce an approving
  Draft ChangeSet.

`DraftChangeSetV2` and `ApprovedChangeSetManifestV2` must carry the immutable
comparison/relationship IDs and freshness digests. No new Canonical mutation
operation is invented here; unsupported operations remain review suggestions
until a separate Canonical decision defines their authority. User actor,
reason, approval token, optimistic version check and Stage 6 handoff remain as
specified by ADR-085/ADR-086.

## 10. Versioning and compatibility

Introduce versioned v2 contracts rather than expanding the v1 enum in place:

- `ComparisonResultV2`, `ComparisonCompletedV2` and v2 query/freshness schemas;
- v2 DraftChangeSet/ApprovedManifest fields or a separately versioned contract;
- v2 module capability and adapter methods negotiated explicitly.

Historical v1 rows remain `legacy_mvp` and continue to be readable by v1
consumers. They are not semantically reclassified. There is no lossy automatic
downcast from a multi-relationship v2 result to a v1 `matchedClaim` or
`POSSIBLE_CONFLICT`. Existing v1 producers remain available during rollout; a
project switches to v2 only after its v2 contracts, migration, Review consumer,
and rollback checks pass. API consumers must request/declare the contract
version. A v1 read of a v2-only result returns an explicit unsupported-version
error, never a fabricated `NEW_CLAIM`.

Migration is additive: deploy schema/tables and readers first, backfill no
semantic conclusions, then enable v2 comparison for an explicitly selected
project/capability flag. Rollback disables v2 production and leaves v2 rows for
audit; it does not rewrite v1 or Canonical data. Removal of v1 requires a later
ADR, two compatible releases, consumer evidence, and a separate migration plan.

### 10.1 Mutually exclusive Review authority rollout

The rollout is an explicit project-scoped state machine:

| State       | Review-authoritative path                      | Allowed v2 behavior                                                                                                                                                |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `V1_ONLY`   | v1 only                                        | v2 does not process production-authoritative comparisons                                                                                                           |
| `V2_SHADOW` | v1 only                                        | v2 may persist shadow Comparison/Analysis/Relationship evidence, but may not emit a Review-authoritative completion or create Draft, Approval or Canonical handoff |
| `V2_ACTIVE` | v2 only for newly eligible Candidate revisions | v1 remains historical/read-compatible and cannot create a second Draft/Approval path for the same Candidate revision                                               |

The invariant is strict: **exactly one comparison contract version is
Review-authoritative for a given project and Candidate revision**. Dual v1/v2
approval paths are forbidden. Disabling v2 stops new v2 authority but leaves
historical v2 evidence readable; a Candidate already completed or approved
under v2 is not automatically replayed through v1. Any manual re-entry after
rollback must be explicit, user-authorized and auditable.

## 11. ECAV acceptance target

The implementation must later prove the following durable evidence in the
existing `shotgun_ecav01b_r2` corpus without manually inserting result rows:

| Case                           | Required relationship                                                                                                | Negative control                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| N1 First-Principles definition | N1 Candidate ↔ C1 Claim, strongest relationship in `SEMANTIC_DUPLICATE`, `SUPPORTS`, `REFINES`, or `BROADENS` family | not `UNRELATED` without rationale                                    |
| N2 assumption questioning      | N2 Candidate ↔ C2 Claim, meaningful `SUPPORTS`/`REFINES`/duplicate relationship                                      | not a C3 duplicate                                                   |
| N3 fundamentals decomposition  | N3 ↔ C1 with material rationale                                                                                      | no fabricated conflict                                               |
| N4 ground-up solution          | N4 ↔ C1 with material rationale                                                                                      | no fabricated conflict                                               |
| N5–N7 examples                 | eligible example relationships only where justified                                                                  | not exact duplicates of C0–C3 solely due to First Principles context |

At least one accepted comparison must durably contain Candidate ID/revision/
digest/Evidence, existing Canonical Claim ID/revision, snapshot identity,
relationship type, AnalysisRevision identity and rationale/material digest in
the same inspectable evidence chain. Tests must also prove fail-closed
unavailable behavior, stale invalidation, scope filtering, restart durability,
duplicate delivery, and multi-resource relationships.

## 12. OSS integration decision

`NO_RELEVANT_OSS` is recorded for a semantic comparison authority. The reviewed
references remain bounded as follows:

| Candidate                                                                                                                             | Decision                       | Boundary                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain), commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                         | `REFERENCE_ONLY`               | Job/idempotency/history patterns; no Runtime, DB, Brain or Canonical authority         |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki), commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0      | `REFERENCE_ONLY` for this role | Transformation/Evidence parts do not provide semantic Candidate-to-Canonical authority |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki), commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT                     | `REFERENCE_ONLY`               | Review/action UX only; backend/SQLite/LLM client excluded                              |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge), commit `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`               | Review/activity/diff patterns only; GPL Runtime/storage/Yjs excluded                   |

The existing `diff@9.0.0` adapter remains the deterministic v1 text-diff
implementation under ADR-085. No new dependency, provider SDK, lockfile, or
OSS runtime is adopted by this design-only change.

## 13. Implementation work packages and gates

Implementation, after acceptance, must proceed in this order:

1. **Contract package:** freeze v2 TypeScript/JSON schemas, events, queries,
   failure codes, digest rules, module capability ranges, Claim-only initial
   activation and the mutually exclusive Review-authority state machine.
2. **Persistence package:** additive migration, normalized relationship and
   analysis repositories, uniqueness/idempotency, restart/recovery and rollback.
3. **Shortlist package:** authority-safe retrieval adapter, policy-before-egress
   filtering, exact snapshot/projection/generation compatibility, complete
   `ShortlistAudit`, cap/digest audit and deterministic exact-match path.
4. **Analysis package:** provider-neutral governed capability, immutable
   AnalysisRevision, schema validation, retry/outcome-unknown and fail-closed
   state machine.
5. **Comparison package:** v2 orchestration, multi-resource relationships,
   conflict subtypes, freshness, and `ComparisonCompletedV2` acknowledgement.
6. **Review package:** v2 Draft/Manifest materialization, user-only decisions,
   stale/insufficient-coverage blocking, Claim-only eligibility and mutually
   exclusive v1/v2 consumer negotiation.
7. **Observability/security package:** safe status codes, scope redaction,
   metrics/audit, migration and replacement documentation.
8. **Acceptance package:** contract, golden ECAV corpus, replay/idempotency,
   security-negative, restart, stale, replacement and bounded performance tests.
9. **ECAV re-entry:** rerun only Gate A, then B and C, after all previous gates
   are green. No DeepSeek/live provider call is implied by this ADR.

No work package may silently expand the Canonical or Fact authority boundary.
Each stage must pass the Module, Flow, Product, Architecture and OSS gates in
the Definition of Done before the next package begins.

## 14. Focused acceptance matrix

| Area               | Required proof                                                                                                            | Failure classification            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Contract           | v2 schema rejects missing candidate/snapshot/resource/analysis identity and accepts multiple relationships                | `CONTRACT_FAILURE`                |
| Exact duplicate    | normalized exact identity produces one idempotent `EXACT_DUPLICATE -> NO_OP` with zero semantic call                      | `DETERMINISTIC_PATH_FAILURE`      |
| Semantic relation  | N1/C1 and N2/C2 durable multi-resource evidence with rationale/material                                                   | `GATE_A_RELATIONSHIP_NOT_PROVEN`  |
| Negative controls  | C3 and N5–N7 do not become unjustified duplicates/conflicts                                                               | `SEMANTIC_FALSE_POSITIVE`         |
| Fail closed        | unavailable analysis is explicit, no success event/Draft/approval/NEW fallback                                            | `SEMANTIC_AVAILABILITY_LEAK`      |
| Conflict           | similarity alone never emits conflict; subtype is preserved                                                               | `CONFLICT_CLASSIFICATION_FAILURE` |
| Security           | unauthorized targets are absent before prompt, output, rationale and errors                                               | `COMPARISON_SCOPE_LEAK`           |
| Freshness          | candidate/snapshot/policy/model changes stale old result and require recomparison                                         | `STALE_COMPARISON_ACCEPTED`       |
| Shortlist coverage | snapshot/projection/generation compatibility, readiness, truncation and scoped `NEW`; insufficient coverage blocks Review | `SHORTLIST_COVERAGE_FAILURE`      |
| Resource scope     | Issue #203 is Claim-only; unsupported types cannot become `NEW`/`UNRELATED` or enter analysis                             | `RESOURCE_SCOPE_LEAK`             |
| Replay             | duplicate delivery, restart and concurrent workers yield one durable result                                               | `COMPARISON_IDEMPOTENCY_FAILURE`  |
| Durability         | PostgreSQL restart restores summary, relationships and analysis lineage                                                   | `COMPARISON_RECOVERY_FAILURE`     |
| Review             | only user approval can create a v2 manifest; ambiguous/conflict/unavailable states block approval                         | `REVIEW_AUTHORITY_FAILURE`        |
| Compatibility      | v1 rows retain original meaning; v1 consumers cannot receive lossy v2 downcast                                            | `LEGACY_REINTERPRETATION`         |
| Rollout authority  | V1_ONLY/V2_SHADOW/V2_ACTIVE enforce exactly one Review-authoritative path per Candidate revision                          | `DUAL_REVIEW_AUTHORITY`           |
| Replacement        | in-memory/test and alternate provider adapters pass the same Port contract                                                | `ADAPTER_REPLACEMENT_FAILURE`     |
| ECAV               | Gate A proof contains both Candidate and pre-existing Canonical identity in one chain                                     | `GATE_A_CAPABILITY_GAP`           |

## Consequences

The mature comparison boundary becomes auditable and capable of expressing
cross-corpus meaning without turning similarity into truth. It adds durable
analysis and relationship state, migration work, version negotiation and a
strict unavailable path. Existing MVP rows remain valid historical evidence but
cannot claim semantic relationships they never tested. Canonical, Fact,
Evidence, Approval, Projection and Action ownership remain unchanged.

## Implementation status and approval gate

This is a design-only proposal for Issue #203. It authorizes no Product code,
database migration, schema change, ECAV rerun, provider execution, merge or
Ready-for-Review transition. Acceptance requires explicit architecture/user
approval, followed by a separate implementation request that names the exact
contract versions, migration, rollback, tests and rollout flag.
