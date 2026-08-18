---
id: AKP-1-HYBRID-SEMANTIC-RETRIEVAL-CONTRACT-SNAPSHOT-260818001
classification: CANDIDATE
status: REVIEW_REQUIRED
revision: 1
created_at: 2026-08-18
subject_base: 4d4623ffde04b1f7d4ca2835b3a3cc0137578a96
program: AKP — Active Knowledge Productization v1
section: AKP-1 — Hybrid Semantic Retrieval
governing_adr: ADR-135
baseline_record: docs/architecture/add/phase-05-canonical-knowledge-and-discovery/akp-0-latest-main-revalidation-2026-08-18.md
product_implementation: NOT_AUTHORIZED
---

# AKP-1 — Hybrid Semantic Retrieval Contract Snapshot r1 Candidate

## 1. Authority

This is the AKP-1 implementation Contract candidate derived from accepted ADR-135 and the frozen AKP-0 latest-main baseline.

It does not change ADR-135, the AKP Master Program, AKP-PAC-01..30 or the frozen non-scope. It does not authorize Product code, migration, dependency, external provider calls, Ready, merge, deployment or Production Verification.

The Contract becomes FROZEN only after explicit USER acceptance.

## 2. Objective

Add semantic retrieval as a rebuildable, security-preserving knowledge projection and combine it with the existing Stage-7 lexical retrieval without changing Canonical authority, citation lineage or Fact/Evidence semantics.

The Section completes when approved/current knowledge can be represented, embedded, indexed, invalidated, retrieved and hybrid-ranked with deterministic lineage, fallback and quality evidence.

## 3. Current-main reuse baseline

AKP-1 must reuse rather than duplicate:

- Canonical/Compiled Truth as the approved knowledge source;
- existing Stage-7 PostgreSQL FTS + `pg_trgm` lexical retrieval;
- existing EvidenceSpan -> SourceVersion citation lineage;
- existing A1–A9 provider identity, CredentialVault and provider-specific privacy/deployment authority;
- ADR-144 server-derived durable Resource sensitivity/access scope;
- Stage-12 quality evaluation foundation;
- PostgreSQL as the primary Product persistence boundary.

AKP-1 does **not** use current `ProjectAIConfiguration.activeModelId` as embedding authority. Current generation-model capabilities do not include embeddings.

## 4. Capability-authority boundary

### 4.1 Ask generation configuration remains unchanged

`ProjectAIConfiguration` continues to own active Ask generation provider/model/credential selection. AKP-1 must not overload it with semantic embedding state and must not silently use the active Ask model for embeddings.

### 4.2 Independent semantic embedding capability

AKP-1 defines a server-owned semantic embedding capability boundary. The implementation may use names such as:

```text
SemanticEmbeddingCapabilityDescriptorV1
SemanticEmbeddingCapabilityRegistryPort
SemanticEmbeddingProfileV1
SemanticEmbeddingResolverPort
SemanticEmbeddingAdapterPort
```

The exact internal type names may refine during implementation, but the following meanings are frozen:

- embedding capability/model identity is independent from Ask generation model identity;
- the capability is server-registered and versioned;
- it binds to an existing provider identity where external egress is used;
- credential resolution uses the existing CredentialVault authority;
- provider-specific external-transfer/privacy/deployment eligibility is revalidated before each external embedding execution;
- no secret is stored in a semantic profile, index item, query cache, log or Product response;
- every external embedding execution pins provider/model/capability/profile/credential/policy revisions needed for reproducibility.

At least one operational embedding capability is required for AKP-1 final completion. Selecting the first concrete provider/model is registry configuration and adapter work inside this Contract; it does not authorize a new provider family or bypass ADR-133.

## 5. Semantic representation contract

A deterministic versioned `SemanticRepresentationBuilder` converts eligible typed approved knowledge resources into semantic text.

Initial resource types:

```text
Claim
Fact
Entity
Relation
Event
Decision
```

Required properties:

- one deterministic representation per eligible typed knowledge unit;
- no arbitrary fixed-token Raw Source chunking in the default AKP-1 corpus;
- representation version contributes to semantic text identity;
- representation digest changes when meaning-bearing serialized content or representation version changes;
- no unapproved/rejected Candidate or raw web/source bulk corpus is included;
- Resource security metadata is carried from server-owned authoritative state.

## 6. Semantic embedding profile contract

Logical `SemanticEmbeddingProfileV1` includes at least:

```text
profileId
projectId
profileRevision
embeddingCapabilityRef
representationVersion
distanceMetric
normalizationPolicy
status = BUILDING | ACTIVE | RETIRED | FAILED
createdAt
activatedAt?
```

Adapter-specific vector dimensions/index parameters may be recorded as non-Canonical profile/generation metadata. Profiles contain no secret.

Profile creation/activation is server-authoritative. A new profile does not replace an ACTIVE generation until its build is ready and explicitly switched.

## 7. Semantic projection item and generation contract

Logical `SemanticIndexItemV1` includes at least:

```text
semanticItemId
projectId
resourceRef
resourceType
sourceProjectionDigest
canonicalVersion
semanticTextDigest
embeddingProfileId
embeddingProfileRevision
evidenceIds[]
accessScope[]
sensitivity
indexedAt
```

A semantic generation additionally identifies the exact profile/revision, source projection/canonical base, lifecycle state and build/audit metadata needed for switch, rollback and pruning.

Vectors are rebuildable projection payloads. Governed knowledge, Evidence and Canonical history are not copied into vector authority.

## 8. Storage adapter boundary

`SemanticIndexRepositoryPort` isolates domain/application semantics from physical vector storage.

PostgreSQL + `pgvector` remains the first adapter candidate under ADR-135. The candidate implementation boundary is:

- additive projection-owned migration only;
- no embedding/vector column added to Canonical knowledge authority tables;
- no destructive change to Stage-7 lexical tables;
- no external vector database in AKP-1 v1 unless measured PostgreSQL limits force a separately approved amendment;
- current `pg` runtime remains sufficient unless WP2 proves a small adapter dependency is required and that dependency receives normal OSS/dependency review.

If the deployment/test PostgreSQL cannot support the `vector` extension, implementation must stop at the adapter boundary and record the environment blocker; it must not silently substitute another vector service.

## 9. Retrieval contract

`LexicalRetriever` and `SemanticRetriever` remain independently testable and independently available.

`HybridRetrievalCoordinator`:

1. resolves Project/security scope server-side;
2. obtains bounded lexical Top-K from the existing lexical authority;
3. obtains bounded semantic Top-K from the active semantic generation;
4. fuses ranks deterministically using a versioned policy;
5. resolves existing citation lineage;
6. returns separate lexical/semantic/hybrid signals and freshness metadata.

Initial deterministic fusion may be RRF. Final rank parameters and cutoffs are accepted from benchmark evidence rather than truth/confidence semantics.

No semantic similarity number becomes Fact confidence, Evidence strength or approval authority.

## 10. Security and privacy contract

Authorization is enforced before/in candidate retrieval, not after a global Top-K.

For every indexed item and query:

- Project identity is exact;
- access scope and sensitivity are server-derived;
- query and index embedding egress use provider-specific privacy/deployment authority;
- prohibited sensitivity classes fail/degrade without external transfer;
- no cross-Project vector search is performed and filtered afterward;
- raw query text is not globally logged or globally cached;
- any query-embedding cache is Project + profile + policy scoped and stores no unnecessary plaintext;
- vector payload retention follows the source sensitivity class.

## 11. Citation and result contract

Semantic retrieval selects an eligible knowledge resource; it does not create evidence.

Every hybrid result that represents citable knowledge must preserve the existing Knowledge -> EvidenceSpan -> SourceVersion lineage. Retrieval signals and ranks are auxiliary explanation data only.

If citation lineage required by the selected resource cannot be resolved, the result is not presented as a normal citable hybrid result.

## 12. Readiness, fallback and lifecycle

Lexical readiness and semantic readiness are separate.

Required semantic states include enough information to distinguish at least:

```text
BUILDING
READY/ACTIVE
STALE
FAILED
UNAVAILABLE
```

The exact persisted enum may refine, but Product/API behavior must distinguish healthy active semantic retrieval from degraded/unavailable semantic retrieval.

When lexical is healthy and semantic is unavailable, Search remains lexical-capable with explicit semantic degradation.

Incremental semantic projection must:

- upsert changed eligible resources;
- remove/tombstone superseded, retired, deleted or access-ineligible resources;
- prevent obsolete active retrieval;
- produce logically equivalent active membership to a full rebuild at the same Canonical/Compiled Truth base, representation version and embedding profile.

A new profile/generation builds side-by-side. Activation is explicit. A bounded last-known-good generation supports rollback. Old vector payload generations are pruneable after the rollback window without deleting Canonical knowledge.

## 13. Quality and performance contract

Reuse the existing quality-evaluation foundation.

Golden Query coverage includes:

- exact phrase;
- typo;
- synonym;
- paraphrase;
- Korean/English alias;
- temporal wording;
- ambiguous semantic neighbors;
- negative controls.

Evaluation compares lexical-only, semantic-only and hybrid retrieval and verifies:

- relevance/ranking evidence;
- citation correctness;
- security filtering;
- semantic degraded fallback;
- tombstone/invalidation correctness;
- incremental/full rebuild equivalence;
- generation switch/rollback behavior.

Performance budgets are measured and recorded during WP5; no universal similarity threshold is frozen in advance.

## 14. Frozen Acceptance Criteria candidate

The Contract freezes the already accepted AKP-1 criteria without adding new semantic requirements:

- **AKP1-AC-01** vectors are derived/rebuildable, never Canonical/Evidence/confidence.
- **AKP1-AC-02** corpus excludes unapproved/raw bulk content.
- **AKP1-AC-03** deterministic typed representation/digest/version exists.
- **AKP1-AC-04** embedding profile is independent and ADR-133 resolved.
- **AKP1-AC-05** vector store is behind a Port; pgvector is first adapter candidate only.
- **AKP1-AC-06** auth/sensitivity enforced before/in retrieval.
- **AKP1-AC-07** Hybrid results preserve EvidenceSpan/SourceVersion citation.
- **AKP1-AC-08** query/index embedding follows provider-egress policy.
- **AKP1-AC-09** semantic degradation falls back to lexical where allowed.
- **AKP1-AC-10** incremental invalidation/tombstone and full equivalence proven.
- **AKP1-AC-11** generation switch/rollback/pruning does not mutate Canonical.
- **AKP1-AC-12** Golden Query evidence approves final rank/cutoff policy.

## 15. Non-scope preserved

AKP-1 does not include:

- Raw Source bulk vectorization;
- Source Exploration semantic redesign;
- direct Discovery finding generation;
- Discovery scheduling/re-entry/Product/feedback;
- vector-derived truth or confidence;
- autonomous web research;
- new external vector service;
- unbounded all-pairs similarity;
- changing Claim/Fact/Canonical authority;
- using Ask generation configuration as embedding configuration.

## 16. Candidate decision state

```text
AKP-0 latest-main baseline: FROZEN
ADR-135: ACCEPTED
AKP-1 Contract Snapshot r1: CANDIDATE / REVIEW_REQUIRED
AKP-1 Product implementation: NOT_AUTHORIZED
Migration/dependency changes: NOT_AUTHORIZED
Ready/Merge/Deployment/Production Verification: NOT_AUTHORIZED
```
