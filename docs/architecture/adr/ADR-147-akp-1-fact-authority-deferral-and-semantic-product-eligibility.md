# ADR-147 — AKP-1 FACT Authority Deferral and Semantic Product Eligibility

- Status: **ACCEPTED**
- Proposed at: 2026-08-18
- Decision date: 2026-08-18
- Accepted at: 2026-08-18
- Accepted by: `USER`
- Decision owner: `USER`
- Work item: `AKP-1 — Hybrid Semantic Retrieval / WP3`
- Subject base: `main@18ef9c12758624c08f2415b7d57a5545942c27ba`
- Related ADRs: ADR-086, ADR-089, ADR-090, ADR-134, ADR-135, ADR-144
- Product implementation: **AUTHORIZED ONLY FOR THE BOUNDED WP3 CORRECTION DESCRIBED HERE**

## Context

During the implementation review of AKP-1 WP3 (Hybrid Retrieval Coordinator and Resource Resolution), an architecture gap was discovered regarding the semantic resource type `FACT`.

ADR-135 (Section 3) specified that `SemanticRepresentationBuilder` produces deterministic textual representations for typed knowledge units such as Claim, Fact, Entity, Relation, Event, and Decision. The frozen AKP-1 Contract Snapshot accordingly included `FACT` in `SemanticResourceType` (`'CLAIM' | 'FACT' | 'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION'`).

However, an exhaustive repository audit of current canonical `main` established the following facts:

### Discovered Repository State

1. **Existing Backend Knowledge Authorities**:
   - `CanonicalClaim`: Authoritative canonical statement stored in `canonical_claims` (Stage 6).
   - Approved `KnowledgeCandidate`: Authoritative typed candidates (`ENTITY`, `RELATION`, `EVENT`, `DECISION`, `ACTION`, `CONFLICT`, `KNOWLEDGE_GAP`) stored in `knowledge_candidates` (Stage 9).
   - `CompiledTruthItem`: Authoritatively typed as `'CLAIM' | KnowledgeCandidateType` (Stage 10), containing only Canonical Claims and Approved Knowledge Candidates.
2. **Missing Backend FACT Authority**:
   - No `CanonicalFact` model, persistence table (`canonical_facts`), or owner module exists.
   - No backend `FactRepositoryPort` or read authority exists.
   - No stable backend `factId` authority or commit/promotion path exists. Committing a frontend draft containing `FACT_ADD` (`fact.v1` / `FactValueV1`) explicitly fails closed in current `main` with `UNSUPPORTED_OPERATION` ("A fact with no Canonical representation").
   - Compiled Truth contains no `FACT` discriminator or Claim-to-Fact promotion logic.

### Rejected Workaround

An implementation workaround that matched arbitrary `CompiledTruthItem` entities by ID when `resourceType === 'FACT'` (e.g. matching an item whose actual type is `CLAIM` and relabeling it as `FACT`) was identified during review and is **explicitly rejected**. Relabeling disparate domain resources violates Shotgun's typed resource identity invariants and the epistemic boundary requiring Claims and Facts to remain distinct.

## Decision

### 1. FACT is Reserved / Deferred for Current Product Retrieval

`FACT` is classified as **RESERVED / DEFERRED** and is **NOT Product-eligible** for AKP-1 v1 semantic retrieval.

The current AKP-1 v1 Product-eligible semantic corpus is strictly:

- `CLAIM`
- `ENTITY`
- `RELATION`
- `EVENT`
- `DECISION`

### 2. Forward-Compatible Contract & Schema Preservation

This decision does not require a destructive rollback of WP1 contracts or WP2 persistence:

- `SemanticResourceType` retains `'FACT'` as a valid enum member for forward compatibility.
- `SemanticFactInput` and `SemanticRepresentationBuilder.buildFact()` are retained for deterministic representation formatting.
- `projection.semantic_items` database table schema and vector storage retain support for `FACT` rows.

These surfaces represent forward-compatible capabilities, not proof of current Product eligibility.

### 3. Server-Side Retrieval & Degradation Behavior

- `ProductKnowledgeResourceResolver` must not resolve `FACT` by relabeling `CLAIM` or any other Compiled Truth item; resolution requests for `FACT` return `undefined` (unresolvable authority).
- If a semantic retrieval index query unexpectedly returns a candidate with `resourceType: 'FACT'`, the Hybrid Coordinator must not emit that candidate as a normal Hybrid result.
- Because a candidate set containing unexpected `FACT` items represents an incompatible/stale projection state, the semantic channel for that request is treated as `DEGRADED` (or `UNAVAILABLE`) with a safe sanitized reason, while healthy Stage-7 lexical retrieval results remain fully available.

### 4. Future Activation Gate

`FACT` may become Product-eligible only after a future user-approved architecture decision defines at least:

- Fact domain classification and schema;
- Stable Fact resource identity and owner module;
- Ingestion, write/approval, or derivation authority;
- Evidence and SourceVersion lineage binding;
- Access scope and sensitivity security authority;
- Persistence and read Port boundaries;
- Compiled Truth relationship and Claim-versus-Fact epistemic semantics.

No such Fact authority is created or designed in AKP-1 WP3.

## Consequences

| Area                        | Consequence                                                                                                                                                                         |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product Semantic Corpus** | Exactly five resource types (`CLAIM`, `ENTITY`, `RELATION`, `EVENT`, `DECISION`) are active and eligible in Product retrieval.                                                      |
| **Domain Epistemics**       | No synthetic Claim $\rightarrow$ Fact promotion or type-relabeling is permitted; Claims remain Claims.                                                                              |
| **Forward Compatibility**   | Contracts, schemas, and builders maintain forward-compatible `FACT` definitions without code removal.                                                                               |
| **ADR-135 Relationship**    | Refines ADR-135 solely regarding current Product eligibility of `FACT`; all other ADR-135 projection, retrieval, citation, security, and lifecycle decisions remain fully accepted. |
