---
id: AKP-1-SEMANTIC-RUNTIME-REPAIR-IMPLEMENTATION-PLAN-260819001
classification: ACCEPTED
status: AUTHORIZED_IN_PROGRESS
revision: 2
created_at: 2026-08-19
replaces_revision: 1
subject_base: 3ea9a8ec5aada6f026b8cccd8b72cdc3bae677a5
program: AKP — Active Knowledge Productization v1
section: AKP-1 — Hybrid Semantic Retrieval
repair: AKP-1R — Cross-WP Semantic Runtime Repair
governing_adrs: ADR-133, ADR-135, ADR-147, ADR-148
contract_snapshot: docs/architecture/contracts/snapshots/akp-1/akp-1-hybrid-semantic-retrieval-contract-snapshot-260818001.md
repair_contract_amendment: docs/architecture/contracts/snapshots/akp-1/AKP-1-CONTRACT-AMENDMENT-SEMANTIC-RUNTIME-AUTHORITY-260819001.md
detailed_design: docs/implementation/akp-1-semantic-runtime-repair-detailed-design-260819001.md
---

# AKP-1 — Semantic Runtime Repair Implementation Plan

## 1. Authority and replacement rule

This document **fully replaces** the former WP1–WP5 implementation request that previously occupied this path. The former implementation sequence is not an active implementation authority after 2026-08-19.

Git history preserves the former text for audit. The current repository tree keeps only the repair plan needed to finish AKP-1 correctly.

The USER authorized this repair on 2026-08-19 after a full WP1–WP4 cross-WP audit. The audit concluded that the AKP program direction and ADR-135 architecture remain correct, while the semantic runtime mechanics require repair before WP5 or AKP-2.

This authorization covers AKP-1R implementation only. It does **not** authorize Ready for Review, merge, deployment, Production Verification or AKP-2+.

## 2. Objective

Produce one operational, server-owned semantic sensor whose real production chain is:

```text
Durable Semantic Profile Revision
  -> exact Semantic Execution Pin
  -> CredentialVault bounded credential use
  -> real provider embedding connectivity
  -> coherent Semantic Corpus Source Snapshot
  -> candidate generation build
  -> persisted membership validation
  -> READY
  -> explicit CAS active-generation switch
  -> query-time source-watermark/readiness check
  -> current query-egress authorization
  -> query embedding
  -> security-before-Top-K pgvector retrieval
  -> Hybrid fusion
  -> authoritative resource + EvidenceSpan + SourceVersion validation
```

The repair must preserve Canonical authority, lexical independence, FACT deferral, citation authority, security-before-Top-K and rebuildable semantic projection semantics.

## 3. What is intentionally discarded

The repair may delete or replace code that exists only to support the superseded mechanics, including:

- mutable active-profile behavior that retires the profile still pinned by the active generation;
- production use of an independently injected static semantic execution adapter;
- whole-corpus query-time stale checks;
- duplicate readiness algorithms;
- membership validation that compares only the in-memory candidate list to the target list;
- production composition that requires manual semantic dependency injection;
- interfaces used only by tests and not by the intended runtime;
- duplicate/fallback representation code that bypasses the versioned builder;
- dead compatibility code introduced only for the unmerged WP4 Draft when the repair provides the governing replacement.

Accepted ADRs, Canonical data, Evidence, SourceVersion history, prior merged commit history and required audit records are never erased.

## 4. Preserved implementation assets

Prefer reuse when the code still matches ADR-148:

- semantic representation versioning/digest concept;
- semantic model capability registry concept;
- CredentialVault and provider privacy/deployment authorities from ADR-133;
- `PostgresSemanticIndexRepository` pgvector persistence and security-before-Top-K SQL;
- lexical retriever and Stage-7 FTS/pg_trgm authority;
- Hybrid RRF coordinator as the initial fusion policy;
- EvidenceSpan -> SourceVersion citation resolution;
- explicit generation pointer/LKG/pruning concept;
- ADR-147 FACT Product exclusion.

Preservation is not a reason to keep an interface that prevents the corrected authority model.

## 5. Repair sequence and gates

The repair uses six Work Packages. Work Packages are sequential. A later package must not compensate for an unresolved earlier package.

### R0 — Contract, plan and detailed design replacement

**Goal:** replace the obsolete implementation authority before code work.

Required outputs:

- ADR-148 accepted;
- this implementation plan replaces the former plan;
- Contract Amendment `SEMANTIC-RUNTIME-AUTHORITY-260819001`;
- detailed design `akp-1-semantic-runtime-repair-detailed-design-260819001.md`;
- implementation authorization updated for AKP-1R;
- ADR registry/index updated;
- old WP4 Draft PR classified as superseded and not mergeable as the repair vehicle.

**R0 completion:** one unambiguous current implementation authority exists in the repository tree.

### R1 — Durable profile and bounded embedding execution router

**Goal:** make profile/configuration and actual provider execution one durable production-capable authority chain.

Required work:

1. PostgreSQL-backed SemanticEmbeddingProfile repository and additive migration.
2. Immutable project-scoped profile revisions; no automatic retirement that breaks the active generation.
3. Build-target profile resolution by exact revision.
4. `SemanticEmbeddingRouter`/equivalent that consumes an exact semantic execution pin and uses `CredentialVault.withCredential()`.
5. Real embedding connectivity for at least one accepted provider. OpenAI is the baseline first concrete adapter because the semantic catalog already contains OpenAI embedding models; Gemini may follow without changing the domain contract.
6. Query/build execution results validate provider/model/dimension against the pin.
7. Historical build audit identity separated from current execution eligibility.
8. No raw secret in contract, log, audit or returned object.
9. `DeterministicFakeEmbeddingAdapter` remains test-only and is not selected by normal Product startup.

**Required proof:** real resolver + vault + fake network connectivity test proves exact credential revision usage; normal production composition selects a real router, not the fake adapter.

**R1 completion:** the system can resolve and execute an embedding through one bounded authority path without a static adapter diverging from the resolved pin.

### R2 — Coherent source snapshot and Semantic Representation v2

**Goal:** make generation membership derive from one coherent knowledge state and improve semantic meaning without weakening provenance.

Required work:

1. Add a server-owned `SemanticCorpusSourceSnapshot`/equivalent authority containing exact Canonical and approved-knowledge source identity.
2. PostgreSQL production reader uses a coherent transaction/snapshot boundary rather than unrelated moment-in-time reads.
3. Compiled Truth is enrichment only when READY and exact source identity matches.
4. Missing Canonical Claim can never be resurrected from Compiled Truth.
5. Product-eligible types remain CLAIM/ENTITY/RELATION/EVENT/DECISION; FACT excluded.
6. Introduce representation v2 through the single builder path.
7. Relation/Event/Decision semantic text includes human-semantic labels/aliases for referenced resources while stable IDs remain provenance fields.
8. Dependent label/alias changes participate in representation invalidation.
9. `SemanticCorpusItem` records authority/provenance (`CANONICAL`, `APPROVED_KNOWLEDGE`, allowed `COMPILED_TRUTH`) and source/base revision identity.
10. Add a cheap source watermark/digest reader for query-time stale checks.

**R2 completion:** a deterministic coherent source snapshot produces one provenance-aware semantic corpus, and the query path can check freshness without rebuilding it.

### R3 — Generation builder, persisted validation, CAS and lifecycle

**Goal:** make side-by-side generation replacement correct under concurrency and failure.

Required work:

1. Build request targets exact profile revision.
2. Candidate generation remains isolated from current ACTIVE generation.
3. Batch embedding respects provider/model batch limits.
4. Incremental reuse distinguishes vector payload identity from membership/security identity.
5. Security/evidence-only changes may reuse local vector payload when semantic text/profile are unchanged.
6. Adapter enforces complete item-to-generation identity, including source snapshot/projection digest.
7. Candidate generation is validated from persisted repository state using count + deterministic membership digest/readback.
8. READY transition only after persisted validation succeeds.
9. Activation CAS supports explicit first-pointer `NONE` and exact existing-pointer expectation.
10. Concurrent activation loser returns typed CONFLICT and keeps a valid candidate READY.
11. STALE active generation is not queried; known STALE fails before query embedding/Top-K.
12. Rollback cannot turn an incompatible/stale generation into healthy service merely by pointer movement.
13. Pruning protects ACTIVE/LKG/required BUILDING and deletes semantic projection assets only.
14. Data readiness and current execution capability are distinct internally.

**R3 completion:** full and incremental candidate generations are logically equivalent at the same source/profile, and activation/rollback/pruning cannot expose invalid membership.

### R4 — Product composition and operational refresh path

**Goal:** eliminate manual semantic wiring and make the sensor usable by the actual Product runtime.

Required work:

1. Normal `startShotgunApplication` constructs durable semantic profile/index/lifecycle authorities.
2. Normal startup constructs the semantic embedding resolver/router using existing provider registry, CredentialVault and privacy/deployment authority.
3. Normal `createApplication` receives/constructs a real `SemanticRetriever` through production composition; optional test injection remains bounded.
4. Hybrid coordinator always has the production semantic channel when configuration is available.
5. Add an explicit server-owned semantic refresh/rebuild command/service boundary. Browser does not select profile/generation/pin.
6. Query path uses cheap source watermark for stale detection.
7. Public readiness schema matches TypeScript status projection.
8. Hybrid result exposes authority/provenance identity and does not mislabel a projection base version as Canonical resource version.
9. Semantic failure preserves healthy lexical search.

**R4 completion:** a normal Product process, without manual test seeding of semantic service objects, owns the complete semantic runtime and rebuild boundary.

### R5 — Cross-WP production-chain proof

**Goal:** prove the actual composition rather than mocks that bypass cross-WP contracts.

The primary deterministic test chain is:

```text
Postgres profile authority
-> real SemanticEmbeddingAuthorityResolver
-> CredentialVault
-> real SemanticEmbeddingRouter
-> fake provider-network connectivity only
-> coherent corpus source snapshot
-> SemanticLifecycleCoordinator
-> Postgres semantic generation/items/pointer
-> normal Product composition
-> /search/hybrid
```

Required scenarios:

1. G1(P1) active; P2 prepared; G2 builds while G1 remains healthy; G2 READY; CAS switch; G2 healthy.
2. Credential revoked after build: generation data remains intact; new provider execution unavailable; lexical healthy.
3. Same Canonical version but approved/security/evidence source digest change: STALE before query embedding/Top-K; lexical result preserved.
4. Security/evidence-only change rebinds membership without unnecessary external re-embedding when vector payload identity is unchanged.
5. Concurrent first activation: exactly one pointer winner; loser candidate READY with CONFLICT.
6. Concurrent replacement activation: exact CAS behavior.
7. Stale/mismatched Compiled Truth is not corpus authority.
8. Provider policy denial performs zero provider-network calls.
9. Hybrid response preserves knowledge authority + EvidenceSpan + SourceVersion lineage.
10. FACT absent from Product semantic membership.
11. Restart/reconstruction consumes the durable active pointer/profile/generation.

Do not duplicate low-level tests already proving unchanged behavior.

**R5 completion:** no cross-WP Critical/High semantic runtime defect remains and the Product chain works from durable configuration to Hybrid result.

### WP5 — Existing AKP-1 quality/security/privacy/performance closure

WP5 begins only after R5 acceptance.

WP5 retains its original purpose, not its former implementation dependencies:

- Golden Query: exact, typo, synonym, paraphrase, Korean/English alias, temporal, ambiguous-neighbor, negative;
- lexical-only vs semantic-only vs hybrid comparison;
- RRF/cutoff evidence-based tuning;
- citation correctness;
- cross-Project/access/sensitivity negatives;
- query/index egress privacy tests;
- provider failure/degradation;
- full/incremental equivalence;
- measured performance and bounded budgets;
- final AKP1-AC matrix.

ANN/HNSW/IVFFlat is added only if measured WP5 data shows it is needed. It is not a repair prerequisite.

## 6. Detailed design constraints

The companion detailed design is normative for R1–R5. Important fixed constraints are:

- active generation, not mutable profile state, governs Product query vector compatibility;
- no Browser-selected generation/profile/pin/sensitivity authority;
- no static fake production embedding path;
- query payload classification is server-owned and distinct from caller clearance;
- known STALE means zero query embedding and zero vector Top-K;
- full corpus construction is not performed on every query;
- Compiled Truth never outranks Canonical/Approved source authority;
- similarity/fusion scores are not Fact confidence;
- Vector data is rebuildable projection data;
- governed Canonical/Evidence/history is never pruned by semantic lifecycle work.

## 7. Migration strategy

Starting from canonical main `3ea9a8ec...`, the unmerged WP4 migration number is not authoritative. The repair uses the next migration number that is free on canonical main at implementation time.

R1 migration owns durable profile/configuration state. R3 migration may add/replace generation lifecycle pointer/index constraints required by ADR-148. Prefer one additive migration per Repair WP when separation improves rollback/debuggability; do not carry obsolete unmerged migration files merely to preserve their filenames.

No destructive Canonical, Evidence, SourceVersion or Stage-7 migration is permitted.

## 8. Deletion and cleanup rule

Remove code/docs/tests from the current repair branch when all are true:

1. they implement only superseded mechanics;
2. no accepted Product path depends on them;
3. their useful historical rationale is already preserved by Git/ADR history;
4. their removal reduces duplicate authority or test-only abstraction.

Do not preserve dead compatibility layers "just in case". Do not rewrite Git history or delete accepted ADR history.

The old WP4 Draft PR is not merged into the repair. Reusable ideas are reimplemented on this branch under ADR-148.

## 9. Verification discipline

- Same exact-head PASS evidence is never rerun.
- During R1–R4 use only focused tests for changed contracts/modules/migrations plus lint/typecheck/format when directly required.
- Push-triggered automatic PR CI is the section evidence for each new exact head; no manual duplicate workflow dispatch.
- R5 owns the cross-WP integration proof.
- WP5 owns the final Golden Query/security/privacy/performance matrix.
- Do not use paid live provider calls to prove deterministic mechanics already covered with fake provider-network connectivity.

## 10. Branch and PR strategy

Repair branch:

```text
codex/akp-1r-semantic-runtime-repair
```

Base:

```text
main@3ea9a8ec5aada6f026b8cccd8b72cdc3bae677a5
```

The previous WP4 Draft PR is superseded and must not be merged. The repair uses a new Draft PR after the first publishable repair implementation checkpoint.

Ready for Review and merge require separate explicit USER authorization.

## 11. Non-scope

- AKP-2 through AKP-8 implementation;
- Raw Source vectorization;
- external vector DB;
- autonomous web research/agent loop;
- Fact authority implementation;
- automatic Canonical mutation from AI/Discovery;
- Discovery scheduling/re-entry/Product UX;
- mandatory ANN index before measured need;
- deployment/Production Verification.

## 12. Completion definition

AKP-1R is complete when R0–R5 are accepted and no unresolved Critical/High semantic runtime authority defect remains.

AKP-1 itself is complete only after subsequent WP5 closure evidence and explicit USER approval.

Current state:

```text
AKP-0: COMPLETE / FROZEN
AKP-1 WP1-WP3 historical implementation: MERGED / SUBJECT TO AKP-1R REPAIR
AKP-1 old WP4 Draft: SUPERSEDED / DO_NOT_MERGE
ADR-148: ACCEPTED
AKP-1R R0: IN_PROGRESS
AKP-1R R1-R5: NOT_STARTED
AKP-1 WP5: BLOCKED_BY_AKP-1R
AKP-2+: NOT_STARTED
Ready / Merge: NOT_AUTHORIZED
```