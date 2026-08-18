---
id: AKP-1-CONTRACT-AMENDMENT-FACT-AUTHORITY-260818001
classification: ACCEPTED
status: CONTRACT_AMENDED
accepted_at: 2026-08-18
accepted_by: USER
decision_owner: USER
program: AKP — Active Knowledge Productization v1
section: AKP-1 — Hybrid Semantic Retrieval
governing_adr: ADR-135
amending_adr: ADR-147
original_contract_acceptance: AKP-1-CONTRACT-ACCEPTANCE-260818001
---

# AKP-1 — Contract Amendment: FACT Authority Deferral and Semantic Product Eligibility

## 1. Authority & Scope

This document records the user-approved contract amendment to the frozen AKP-1 Contract Snapshot (`akp-1-hybrid-semantic-retrieval-contract-snapshot-260818001.md`) pursuant to **ADR-147**.

The original frozen Contract Snapshot is preserved without silent historical rewriting. This amendment governs the Product semantic eligibility of the `FACT` resource type discovered during WP3 implementation.

## 2. Amended Semantic Product Eligibility

1. **Forward-Compatible Vocabulary**:
   The full six-type semantic vocabulary remains defined for forward compatibility across schemas, representation builders, and projection storage:
   - `CLAIM`
   - `FACT`
   - `ENTITY`
   - `RELATION`
   - `EVENT`
   - `DECISION`

2. **Current AKP-1 v1 Product-Eligible Semantic Corpus**:
   The active, Product-eligible semantic knowledge corpus is strictly:
   - `CLAIM`
   - `ENTITY`
   - `RELATION`
   - `EVENT`
   - `DECISION`

3. **FACT Status**:
   `FACT` is **RESERVED / DEFERRED / NOT_PRODUCT_ELIGIBLE** until a separately approved backend Fact authority and persistence model exist.
   - `ProductKnowledgeResourceResolver` returns `undefined` for `FACT` resolution requests and must never match or relabel `CLAIM` or arbitrary Compiled Truth items as `FACT`.
   - Semantic retrieval results unexpectedly containing `FACT` candidates trigger bounded semantic degradation for that request, ensuring no `FACT` candidate is emitted in Product Hybrid search results while preserving healthy Stage-7 lexical retrieval.

## 3. Preservation of Acceptance Criteria

All twelve AKP-1 acceptance criteria (`AKP1-AC-01` through `AKP1-AC-12`) remain frozen and active with their original numbering and intent.

Any reference to "the initial approved semantic knowledge corpus" across `AKP1-AC-01..12` is interpreted as:
> "all currently authoritative and Product-eligible approved/current semantic resource types (`CLAIM`, `ENTITY`, `RELATION`, `EVENT`, `DECISION`)"

No acceptance criterion is removed, renumbered, or weakened.
