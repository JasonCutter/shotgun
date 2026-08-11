# ADR-135 — Hybrid Semantic Retrieval as a Rebuildable Derived Projection

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-1 — Hybrid Semantic Retrieval`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-087, ADR-090, ADR-098, ADR-125, ADR-127, ADR-133, ADR-134
- Product implementation: **NOT_AUTHORIZED**

## Context

Current Stage 7 canonical search is PostgreSQL FTS + `pg_trgm` with Evidence-bound citation. It is intentionally lexical. PR #30 recorded Hybrid Semantic Retrieval as deferred work and explicitly avoided pre-selecting pgvector, an embedding provider, chunking or ranking. AKP v1 now makes semantic retrieval a Product requirement because active Discovery needs a semantic sensor for synonym/paraphrase and cross-expression relationships.

Semantic retrieval must not contaminate Canonical authority, weaken security, replace citation lineage, or make existing healthy lexical search unavailable when an embedding provider/index is degraded.

## Decision

### 1. Semantic data is a projection

Embeddings and vector indexes are rebuildable derived projection data. No embedding column is added to Canonical Claim/Fact/Entity/Relation authority as part of the knowledge model. Embedding values are not Evidence, Fact confidence or source strength.

### 2. Initial semantic corpus

AKP v1 semantic retrieval indexes approved/current knowledge representations derived from Compiled Truth and approved knowledge resources. Unapproved/rejected Candidates and arbitrary Raw Source chunks are not part of the default Canonical semantic corpus.

Source Exploration remains a separate Product mode and may receive a separately approved semantic implementation later; AKP v1 does not collapse Canonical Search and Source Exploration into one vector corpus.

### 3. Deterministic semantic representation

A `SemanticRepresentationBuilder` produces a versioned deterministic textual representation for typed knowledge units such as Claim, Fact, Entity, Relation, Event and Decision. The representation version is persisted with the semantic item digest so representation changes trigger rebuilds.

The unit is the typed knowledge resource, not an arbitrary fixed-token chunk by default.

### 4. Independent embedding profile

Define a revisioned `SemanticEmbeddingProfile` owned by the Server/project configuration boundary. It records a profile identifier/revision, provider/model capability reference, representation version, vector/distance metadata needed by the adapter, and activation state. It contains no secret.

The embedding profile is independent of the active Ask generation model. External provider/model/credential/privacy authority resolves through ADR-133 once that Product capability is implemented. Every embedding build pins its effective provider/model/credential/policy revisions for reproducibility.

### 5. Projection item lineage

A semantic index item carries at least:

```text
semanticItemId
projectId
resourceRef/resourceType
sourceProjectionDigest
semanticTextDigest
embeddingProfileId/revision
accessScope
sensitivity
evidenceIds
indexedAt
```

Physical vector dimensions and index parameters belong to profile/adapter metadata, not Canonical contracts.

### 6. Vector-store Port and first adapter candidate

Define a `SemanticIndexRepositoryPort`. PostgreSQL + `pgvector` is the first adapter candidate because it preserves the current operational database boundary and can be benchmarked without introducing another service. pgvector is not a Canonical dependency and can later be replaced behind the Port.

Qdrant/OpenSearch/Pinecone are not selected for AKP v1 unless measured PostgreSQL limits require a separately approved change.

### 7. Hybrid retrieval

Keep `LexicalRetriever` and `SemanticRetriever` independent. A `HybridRetrievalCoordinator` executes authorized retrieval in both paths and fuses ranked candidate lists. Initial fusion is deterministic rank fusion such as Reciprocal Rank Fusion; exact weights/cutoffs are finalized by the Golden Query benchmark rather than a universal similarity percentage.

Each result preserves retrieval signals (`EXACT`, `FULL_TEXT`, `TRIGRAM`, `SEMANTIC`, `HYBRID`) separately from knowledge authority/evidence strength.

### 8. Authorization before ranking

Project, access scope and sensitivity eligibility is applied inside/before each retrieval corpus selection. The system must not retrieve globally and then filter an unauthorized Top-K result set.

External embedding egress obeys ADR-133 deployment/project/provider policy. If a sensitivity class cannot use the configured external embedding provider, the operation fails/degrades according to policy; it cannot silently send the text elsewhere.

The same rule applies to **query embedding**. A semantic query may itself contain private or restricted knowledge, so query text cannot bypass provider/privacy approval simply because it is not being indexed. Raw semantic-query text is not placed in global caches or logs. Any query-embedding cache is project/profile/policy scoped and stores no unnecessary plaintext.

### 9. Citation remains authoritative lineage

Semantic matching only selects a knowledge resource. The returned result must still traverse existing Knowledge -> EvidenceSpan -> SourceVersion lineage. Similarity is never presented as citation or truth confidence.

### 10. Readiness and fallback

Lexical and Semantic projections expose separate health/readiness. If lexical is healthy and semantic is stale/failed/unavailable, Product Search falls back to lexical and exposes degraded semantic capability. Semantic failure must not make healthy Stage 7 lexical search unavailable.

### 11. Incremental invalidation, full-rebuild equivalence and tombstones

Semantic projection eligibility follows the authoritative Canonical/Compiled Truth state. Incremental projection updates must deterministically upsert changed eligible items and remove/tombstone items that become superseded, retired, access-ineligible or otherwise outside the active semantic corpus. An obsolete vector may not remain retrievable merely because a previous generation indexed it.

For the same canonical/projection base, representation version and embedding profile, an incremental projection and a full rebuild must be logically equivalent in active retrievable membership and resource identity.

### 12. Build/switch/rollback and retention

A new embedding profile builds a new semantic generation before activation. Active pointer switch is explicit; prior generation can remain available for bounded rollback. Model/profile changes do not destructively overwrite the currently active index before the new generation is ready.

Vector payloads are rebuildable projection assets and inherit the sensitivity of their source material. Retain the active generation and a bounded last-known-good generation according to policy; older vector payloads may be pruned after the rollback window. Minimal build/audit metadata may be retained longer where needed for reproducibility and governance. Canonical data is never deleted as part of semantic-index pruning.

### 13. Quality gate

Reuse the existing quality-evaluation foundation to build Golden Queries covering exact phrase, typo, synonym, paraphrase, Korean/English alias and temporal-language cases. Compare lexical-only, semantic-only and hybrid behavior. Thresholds/rank policy are accepted from evidence, not hard-coded as Fact confidence.

The quality gate also verifies incremental/full-rebuild equivalence and proves that retired/superseded/ineligible resources do not remain retrievable from the active generation.

## Consequences

- Active Discovery gains semantic neighbors without turning embeddings into knowledge authority.
- Existing FTS/`pg_trgm` remains useful and independently recoverable.
- Model changes require projection rebuild planning and storage for generations.
- External indexing and query embedding availability depends on ADR-133 Product implementation and data policy.
- Projection invalidation/tombstone behavior is part of correctness, not merely performance optimization.

## Rejected alternatives

- Add `embedding vector(...)` to Canonical knowledge rows.
- Replace lexical search with vector-only retrieval.
- Use the active Ask generation model automatically as the embedding model.
- Use a fixed 0.7/0.85 similarity number as a universal quality/truth threshold.
- Search all projects first and apply access filtering after Top-K.
- Send query text to an external embedding provider outside normal egress policy.
- Leave retired/superseded vectors searchable until a later full rebuild.
- Retain every historical vector generation indefinitely as if it were audit authority.
- Vectorize all Raw Sources as part of AKP v1.
- Adopt an external vector database before PostgreSQL limits are measured.