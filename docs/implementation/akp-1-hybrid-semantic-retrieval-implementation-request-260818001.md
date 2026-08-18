---
id: AKP-1-HYBRID-SEMANTIC-RETRIEVAL-IMPLEMENTATION-REQUEST-260818001
classification: CANDIDATE
status: REVIEW_REQUIRED_PRODUCT_IMPLEMENTATION_NOT_AUTHORIZED
revision: 1
created_at: 2026-08-18
subject_base: 4d4623ffde04b1f7d4ca2835b3a3cc0137578a96
program: AKP — Active Knowledge Productization v1
section: AKP-1 — Hybrid Semantic Retrieval
governing_adr: ADR-135
contract_snapshot: docs/architecture/contracts/snapshots/akp-1/akp-1-hybrid-semantic-retrieval-contract-snapshot-260818001.md
baseline_record: docs/architecture/add/phase-05-canonical-knowledge-and-discovery/akp-0-latest-main-revalidation-2026-08-18.md
---

# AKP-1 — Hybrid Semantic Retrieval Implementation Request r1 Candidate

## 1. Authority

This request is **CANDIDATE / NOT AUTHORIZED FOR PRODUCT IMPLEMENTATION**.

It defines the bounded implementation sequence that may be frozen after USER review. It does not authorize Product code, database migration, PostgreSQL extension installation, dependency addition, external embedding calls, Ready, merge, deployment, Production Verification or AKP-2.

Only one Work Package may be implemented and reviewed at a time after separate Product authorization.

## 2. Objective

Implement ADR-135 on the current Canonical baseline by adding an independent semantic embedding projection and deterministic Hybrid Retrieval while preserving existing lexical Search, Evidence/SourceVersion citation authority, Project security, provider privacy and Canonical semantics.

## 3. Frozen inputs candidate

- `docs/architecture/adr/ADR-135-hybrid-semantic-retrieval-as-rebuildable-derived-projection.md`
- `docs/architecture/adr/ADR-133-runtime-selectable-ai-provider-model-and-credential-authority.md`
- `docs/architecture/adr/ADR-144-source-classification-authority-durable-pinning-and-security-compatible-duplicate-boundary.md`
- `docs/architecture/add/phase-05-canonical-knowledge-and-discovery/akp-0-latest-main-revalidation-2026-08-18.md`
- `docs/architecture/contracts/snapshots/akp-1/akp-1-hybrid-semantic-retrieval-contract-snapshot-260818001.md`
- existing Stage-7 cited search and Stage-10 Compiled Truth implementations;
- existing Stage-12 quality-evaluation foundation;
- current A1–A9 AI provider/credential/privacy runtime authority.

## 4. WP1 — Contracts, semantic representation, embedding capability and profile

### Scope

Implement only the semantic contracts and provider-facing embedding boundary required by ADR-135.

Required work:

- deterministic `SemanticRepresentationBuilder` for Claim, Fact, Entity, Relation, Event and Decision;
- representation version and semantic text digest;
- server-owned `SemanticEmbeddingProfile` contract/repository boundary;
- independent embedding capability/model descriptor and registry Port;
- embedding execution Port and deterministic fake adapter for focused tests;
- resolver that reuses existing provider identity, CredentialVault and provider privacy/deployment authority;
- immutable embedding execution pin/audit metadata without secret material;
- typed failures for configuration required, capability unavailable, policy denied, provider failure, validation failure and timeout where applicable;
- explicit proof that current Ask generation model/configuration is not used as embedding authority.

### Current-main compatibility rule

Do **not** simply add semantic behavior to `ProjectAIConfiguration.activeModelId`. Current A1–A9 generation catalog assumes `text/image/audio/structuredOutput` and structured-generation validation. AKP-1 embedding capability is independent.

Internal implementation may either:

1. add a dedicated semantic embedding capability registry/profile boundary; or
2. generalize the shared provider registry only if the change preserves all existing A1–A9 generation contracts and does not make embedding a valid Ask-generation capability.

Option 1 is the baseline because it minimizes cross-program semantic change.

### WP1 completion candidate

- AKP1-AC-03 and AKP1-AC-04 have direct deterministic evidence;
- secrets are absent from contracts/logs/audit projections;
- provider/privacy resolution is shared rather than duplicated;
- no vector storage or Product Search cutover yet.

## 5. WP2 — Projection persistence and PostgreSQL/pgvector adapter

### Scope

Add the derived semantic projection storage behind `SemanticIndexRepositoryPort`.

Required work:

- use the next verified additive migration sequence;
- verify PostgreSQL `vector` extension availability in the guarded Product/test environment;
- add projection-owned profile/generation/index-item/status persistence required by the frozen Contract;
- add vector column/index only inside the semantic projection schema/boundary;
- preserve Project/resource/security/profile/generation identity and deterministic active membership;
- implement semantic nearest-neighbor search scoped by exact Project and server-authorized security eligibility before/in Top-K;
- implement generation-aware writes, reads and active-generation selection;
- deterministic test fixtures and cleanup;
- no Canonical or Stage-7 destructive migration.

### Dependency boundary

- `pgvector`: first storage adapter candidate from ADR-135;
- external vector DB: prohibited in WP2;
- new JavaScript runtime dependency: not assumed; current `pg` is the baseline;
- if an extra adapter package is demonstrably required, stop and record the dependency/OSS decision before adding it;
- if PostgreSQL `vector` is unavailable, record an environment blocker rather than silently switching technologies.

### WP2 completion candidate

- AKP1-AC-01, AC-05 and storage portions of AC-10/11 are directly evidenced;
- vectors remain rebuildable and non-Canonical;
- Project/security isolation is proven at repository level.

## 6. WP3 — Semantic retrieval, Hybrid coordinator and citation preservation

### Scope

Wire semantic retrieval alongside the existing lexical path without replacing it.

Required work:

- `SemanticRetriever` over the active semantic generation;
- adapter around/reuse of existing lexical retrieval rather than a duplicate lexical engine;
- `HybridRetrievalCoordinator` with bounded lexical and semantic Top-K;
- deterministic versioned fusion policy, RRF as the initial candidate;
- Hybrid result contract with lexical/semantic/hybrid signals and separate ranks;
- existing EvidenceSpan -> SourceVersion citation resolution;
- explicit failure when required citation lineage cannot be resolved;
- query embedding through the same semantic profile/provider/privacy authority;
- no global/cross-Project query vector search.

### Product API boundary

AKP-1 may extend the current Search Product contract only as needed to expose Hybrid result/freshness/degraded semantics. It must not expose raw vectors, secrets, credential identifiers, provider-policy internals or similarity-as-confidence.

### WP3 completion candidate

- AKP1-AC-06, AC-07, AC-08 and core Hybrid behavior are directly evidenced;
- lexical-only operation remains independently functional.

## 7. WP4 — Incremental lifecycle, invalidation, readiness and generation switch

### Scope

Make semantic retrieval operationally correct across Canonical/Compiled Truth changes and embedding profile changes.

Required work:

- full semantic rebuild for an exact base/profile;
- incremental upsert for changed eligible resources;
- removal/tombstone for superseded, retired, deleted or access-ineligible resources;
- active semantic generation pointer;
- side-by-side build before activation;
- bounded last-known-good rollback generation;
- stale/failed/unavailable semantic readiness independent from lexical readiness;
- lexical fallback when allowed;
- bounded pruning of old vector payload generations;
- deterministic logical equivalence check between incremental and full active membership at the same base/profile;
- no Canonical rollback or deletion as part of semantic recovery/pruning.

### WP4 completion candidate

- AKP1-AC-09, AC-10 and AC-11 are directly evidenced;
- obsolete vector retrieval is impossible from the active generation.

## 8. WP5 — Quality, security, privacy, performance and Section closure evidence

### Scope

Produce the final AKP-1 quality and safety evidence once, on the final Section exact head.

Required work:

- Golden Query set: exact, typo, synonym, paraphrase, Korean/English alias, temporal, ambiguous-neighbor and negative cases;
- lexical-only vs semantic-only vs hybrid comparison;
- evidence-based fusion/cutoff policy selection;
- citation correctness checks;
- cross-Project/access/sensitivity negative tests;
- private/restricted query/index egress policy tests;
- no raw query global logging/cache leakage;
- semantic provider failure/degradation and healthy lexical fallback;
- invalidation/tombstone and full/incremental equivalence;
- generation switch and rollback;
- deterministic performance measurements and bounded budgets appropriate to the test corpus;
- final AKP1-AC-01 through AKP1-AC-12 evidence matrix.

No universal similarity percentage may be promoted to truth/confidence.

## 9. Migration boundary candidate

Migration is expected to be **REQUIRED / IMPLEMENTATION_NOT_AUTHORIZED** for the PostgreSQL semantic projection.

Allowed after authorization:

- additive semantic projection schema/tables/indexes;
- PostgreSQL `vector` extension use after environment verification;
- generation/profile/status metadata;
- vector payload storage and indexes owned only by the derived projection.

Forbidden:

- vector columns in Canonical knowledge tables;
- destructive changes to Stage-7 lexical search;
- Raw Source vector corpus;
- external vector service adoption;
- schema changes for AKP-2+.

## 10. Provider and live-call boundary candidate

- Current A1–A9 credentials/privacy/deployment authority is reused.
- At least one external embedding capability must be operational before AKP-1 final completion.
- The first concrete provider/model adapter is selected inside WP1 from verified provider capability; no new provider family is introduced without separate approval.
- Deterministic fake embedding is allowed for contract/unit/database evidence but does not by itself satisfy final semantic quality behavior.
- Paid/live external embedding verification, if needed, requires the normal explicit bounded verification instruction; do not repeatedly call providers merely to duplicate deterministic evidence.

## 11. Verification discipline

- Do not rerun a previously passed exact head.
- During WP1–WP4, run only focused checks needed for changed contracts/modules/migrations plus automatically triggered CI for the new exact head.
- Do not manually dispatch duplicate CI.
- Do not run the full final AKP-1 matrix after every WP.
- Run the Section-wide Golden Query/security/lifecycle closure once in WP5 on the final implementation head.
- Reuse existing Stage-7, A1–A9, ADR-144 and Stage-12 evidence where the exact unchanged authority is being reused.

## 12. Acceptance Criteria candidate

Implementation must satisfy exactly the already accepted:

```text
AKP1-AC-01 through AKP1-AC-12
```

from the Contract Snapshot. A semantic change or new mandatory criterion requires an explicit Contract amendment before continuing.

## 13. Exclusions

- AKP-2 Finding Envelope;
- AKP-3 Discovery generation;
- AKP-4 scheduling/durable Discovery runtime;
- AKP-5 derived re-entry/Review bridge;
- AKP-6 Discovery Product UX;
- AKP-7 feedback/suppression;
- AKP-8 final active-loop closure;
- Raw Source semantic exploration;
- external vector DB;
- new autonomous agents;
- deployment and Production Verification.

## 14. Current decision state

```text
AKP-0: COMPLETE / BASELINE_REVALIDATED_FROZEN
ADR-135: ACCEPTED
AKP-1 Contract Snapshot r1: CANDIDATE / REVIEW_REQUIRED
AKP-1 Implementation Request r1: CANDIDATE / REVIEW_REQUIRED
AKP-1 Product implementation: NOT_AUTHORIZED
Migration: EXPECTED_REQUIRED / NOT_AUTHORIZED
New JS dependency: NOT_ASSUMED / NOT_AUTHORIZED
PostgreSQL pgvector adapter: FIRST_CANDIDATE / NOT_AUTHORIZED
External live embedding calls: NOT_AUTHORIZED
AKP-2+: NOT_STARTED
```
