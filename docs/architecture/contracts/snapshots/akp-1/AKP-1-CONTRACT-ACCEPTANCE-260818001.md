---
id: AKP-1-CONTRACT-ACCEPTANCE-260818001
classification: ACCEPTED
status: CONTRACT_FROZEN
accepted_at: 2026-08-18
accepted_by: USER
program: AKP — Active Knowledge Productization v1
section: AKP-1 — Hybrid Semantic Retrieval
subject_base: 4d4623ffde04b1f7d4ca2835b3a3cc0137578a96
accepted_candidate_head: 6c3fd8ba927e804ef2b5e52b3e09bdd55ba25eea
governing_adr: ADR-135
product_implementation: NOT_AUTHORIZED
---

# AKP-1 — Hybrid Semantic Retrieval Contract Acceptance and Freeze

## 1. Authority

The USER explicitly accepted the AKP-1 Contract candidate on 2026-08-18.

This record freezes the Contract Snapshot and bounded Implementation Request exactly as reviewed at candidate head:

```text
6c3fd8ba927e804ef2b5e52b3e09bdd55ba25eea
```

The historical candidate files retain their original `CANDIDATE / REVIEW_REQUIRED` headers so the review history is not silently rewritten. For current AKP-1 governance, this acceptance record is the authoritative disposition and binds those candidate artifacts as **FROZEN**.

This acceptance does **not** authorize Product implementation, database migration, PostgreSQL extension installation, dependency changes, live external embedding calls, Ready for Review, merge, deployment, Production Verification, or AKP-2.

## 2. Frozen artifacts

The following reviewed artifacts are accepted and frozen without semantic amendment:

- `docs/architecture/contracts/snapshots/akp-1/akp-1-hybrid-semantic-retrieval-contract-snapshot-260818001.md`
- `docs/implementation/akp-1-hybrid-semantic-retrieval-implementation-request-260818001.md`
- `docs/architecture/add/phase-05-canonical-knowledge-and-discovery/akp-0-latest-main-revalidation-2026-08-18.md`

The frozen governing architecture remains ADR-135 and the accepted AKP v1 Master/ADR-134 through ADR-142 authority.

## 3. Frozen implementation sequence

AKP-1 implementation, once separately authorized, must proceed one Work Package at a time:

1. **WP1 — Contracts, semantic representation, embedding capability and profile**
2. **WP2 — Projection persistence and PostgreSQL/pgvector adapter**
3. **WP3 — Semantic retrieval, Hybrid coordinator and citation preservation**
4. **WP4 — Incremental lifecycle, invalidation, readiness and generation switch**
5. **WP5 — Quality, security, privacy, performance and Section closure evidence**

No later Work Package starts before the preceding Work Package is reviewed and accepted.

## 4. Frozen acceptance criteria

AKP-1 completion is governed by exactly the previously accepted criteria:

```text
AKP1-AC-01 through AKP1-AC-12
```

No criterion is added, removed, or semantically weakened by this freeze.

## 5. Current-main integration rules frozen by acceptance

The following latest-main compatibility rules are now part of the frozen implementation Contract:

- A1–A9 provider identity, CredentialVault, provider privacy/deployment authority and runtime pinning are reused.
- Current Ask `ProjectAIConfiguration.activeModelId` is **not** embedding model authority.
- Current generation provider capabilities do not include embeddings; AKP-1 WP1 owns the independent embedding capability/profile boundary.
- ADR-144 server-derived Resource sensitivity/access scope is reused and cannot be widened by Browser-authored state.
- Existing Stage-7 PostgreSQL FTS + `pg_trgm` lexical retrieval remains independently available.
- Existing EvidenceSpan -> SourceVersion lineage remains citation authority.
- Semantic similarity never becomes Fact confidence, Evidence strength or approval authority.
- Semantic vectors remain rebuildable derived projection data, not Canonical knowledge.
- PostgreSQL + `pgvector` remains the first storage adapter candidate; an external vector database is outside AKP-1 unless separately amended.
- Raw Source bulk vectorization and Source Exploration semantic redesign remain outside AKP-1.

## 6. Verification discipline

The frozen request preserves the project-wide non-duplication rule:

- do not rerun tests already proven on the same exact head;
- use focused checks for changed WP scope;
- use automatically triggered CI for each new exact head;
- do not manually dispatch duplicate full CI;
- run the final AKP-1 Golden Query/security/lifecycle closure matrix once in WP5 on the final Section implementation head;
- reuse unchanged Stage-7, A1–A9, ADR-144 and Stage-12 evidence where applicable.

## 7. Authority boundary after freeze

```text
AKP-0: COMPLETE / BASELINE_REVALIDATED_FROZEN
AKP-1 Contract Snapshot r1: ACCEPTED / FROZEN
AKP-1 Implementation Request r1: ACCEPTED / FROZEN
AKP-1 Product implementation: NOT_AUTHORIZED
Migration / pgvector extension: NOT_AUTHORIZED
New runtime dependency: NOT_AUTHORIZED
External live embedding calls: NOT_AUTHORIZED
AKP-2+: NOT_STARTED
Ready / Merge / Deployment / Production Verification: NOT_AUTHORIZED
```

The next governance gate is a separate explicit **AKP-1 Product Implementation Authorization**. After that authorization, implementation begins with WP1 only.

## 8. Subsequent accepted amendments

- **2026-08-18 (ADR-147 / AKP-1-CONTRACT-AMENDMENT-FACT-AUTHORITY-260818001)**: An architecture audit during WP3 discovered that current canonical `main` has no backend `FACT` authority model. The user approved [ADR-147](../../../adr/ADR-147-akp-1-fact-authority-deferral-and-semantic-product-eligibility.md) and [AKP-1-CONTRACT-AMENDMENT-FACT-AUTHORITY-260818001](AKP-1-CONTRACT-AMENDMENT-FACT-AUTHORITY-260818001.md), classifying `FACT` as **RESERVED / DEFERRED** and defining the current Product-eligible semantic corpus as `CLAIM`, `ENTITY`, `RELATION`, `EVENT`, and `DECISION`. The original contract freeze remains authoritative for all other terms.
