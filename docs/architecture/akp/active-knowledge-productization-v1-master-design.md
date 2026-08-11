# Active Knowledge Productization v1 — Master Architecture Candidate

- Status: **CANDIDATE / WHOLE-DESIGN REVIEW REQUIRED**
- Program: `AKP — Active Knowledge Productization v1`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Prepared at: 2026-08-11
- Decision owner: `USER`
- Master structure: **USER-CONFIRMED**
- Section decisions below: **CANDIDATE / NOT YET ACCEPTED**
- Product implementation: **NOT_AUTHORIZED**
- ADD mutation: **NOT_PERFORMED**

> This document productizes capabilities already present in the Shotgun Knowledge Flow. It does not create a new Knowledge Flow phase and does not authorize Product code, migration, dependency, Ready, Merge, Deployment or Production Verification. Individual architecture decisions are recorded as PROPOSED ADR-134 through ADR-142 for whole-design review.

## 1. Program purpose and finite completion boundary

AKP v1 closes the already-designed active-knowledge loop at real Product level:

```text
Canonical Commit
  -> Compiled Truth / Search / Graph projection update
  -> Hybrid semantic retrieval
  -> bounded active discovery
  -> derived finding with provenance
  -> Phase 3 validation re-entry
  -> comparison / conflict / impact
  -> human review
  -> approved change
  -> Canonical
  -> projection and discovery again

Explicit feedback
  -> epistemic correction -> validation/review path
  -> preference/utility -> ranking/suppression only
```

AKP v1 is complete only when this loop works through the persistent runtime and Product UI, including failure/recovery, access/sensitivity, evidence lineage, and user review. New model techniques, autonomous research or broader agent behavior after this closure belong to AKP v2 or a separately approved follow-up.

## 2. Canonical architecture that AKP must preserve

AKP preserves these existing decisions:

1. Canonical is the sole authority for approved knowledge and history.
2. Claim and Fact remain distinct; approval does not automatically promote a Claim to Fact.
3. Compiled Truth, search, graph, semantic indexes and Discovery are rebuildable projections or derived products, never Canonical authority.
4. AI output is candidate material until the existing validation/review/approval path accepts a change.
5. Discovery results re-enter Phase 3; Discovery cannot directly write Canonical or execute an external Action.
6. Access scope and sensitivity are inherited across projections, AI calls, Discovery, review and Product reads.
7. Existing Transactional Outbox, Review, Graph, Activity, typed failure and AI-provider authority are reused instead of recreated.

## 3. AKP-0 exact-main exhaustive capability audit

Audit base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`.

| Capability | Current state | Evidence-level conclusion | AKP disposition |
|---|---|---|---|
| Canonical commit + revision + HistoryEvent + Transactional Outbox | COMPLETE | Stage 6 commits Claim/Commit/Revision/History/Outbox in one transaction and publishes `CanonicalCommitted`; durable lease/retry/restart recovery already exists | REUSE; no new outbox |
| Compiled Truth projection + digest/version/readiness | COMPLETE | Stage 10 supports full/incremental build, logical/source digests and readiness/lag | REUSE |
| Lexical canonical retrieval | COMPLETE | Stage 7 uses PostgreSQL FTS + `pg_trgm` + substring matching behind `SearchProjectionRepositoryPort` | REUSE |
| Evidence-bound citation | COMPLETE | Search/Ask returns through Knowledge resource -> EvidenceSpan/SourceVersion citation lineage | REUSE |
| Semantic embedding/vector retrieval | MISSING / DEFERRED | No Product embedding/vector index implementation; PR #30 explicitly deferred provider/store/chunk/ranking choice | AKP-1 |
| Hybrid lexical + semantic ranking | MISSING | No semantic branch/fusion layer exists | AKP-1 |
| Semantic search quality benchmark | PARTIAL FOUNDATION | Stage 12.1 quality-evaluation foundation exists, but no semantic Golden Query benchmark | AKP-1 |
| Typed Semantic Graph Product contract | COMPLETE FOUNDATION | Frontend graph contract already separates `CANONICAL`, `DERIVED_INFERENCE`, `DISCOVERY_CANDIDATE` authority and edge semantics | REUSE |
| Real Discovery overlay data bridge into Product Graph | MISSING / PARTIAL | Contract anticipates derived/discovery authority; current Stage 10 persistent findings are not wired as the Product graph source | AKP-6 |
| Deterministic Knowledge Gap discovery | COMPLETE / NARROW | Current Stage 10 finds disconnected Entities and creates `KNOWLEDGE_GAP` derived inferences | REUSE + AKP-2/3 expansion |
| Discovery persistence | COMPLETE / NARROW | `projection.discovery_inferences` persists candidate JSON by project/fingerprint | REUSE + MIGRATE additively where needed |
| Duplicate suppression | COMPLETE / EXACT ONLY | project+fingerprint uniqueness prevents exact repeat proposals | REUSE; user suppression is separate |
| Discovery finding taxonomy beyond Knowledge Gap | MISSING | `DerivedInferenceCandidate.candidateType` is fixed to `KNOWLEDGE_GAP` | AKP-2 |
| Missing-evidence discovery | MISSING | No first-class derived finding contract/strategy | AKP-2/3 |
| Relation hypothesis discovery | MISSING / DESIGNED FOR LATER | Stage 10 engineering boundary explicitly deferred AI relationship proposals | AKP-2/3 |
| Pattern/trend discovery | MISSING | No typed finding or engine strategy | AKP-2/3 |
| Clarification/investigation suggestion | MISSING as first-class discovery result | Existing Knowledge Gap question is narrower than the Step 17 design | AKP-2/3 |
| Action suggestion discovery | MISSING as active-discovery output | Existing `ACTION` candidate and external-action governance exist, but Discovery does not generate/wire it | AKP-2/3/5 |
| Multi-signal discovery using lexical+semantic+graph+temporal/conflict | MISSING | Current algorithm uses only graph connectivity over the Compiled Truth projection | AKP-3 |
| Deterministic vs AI-assisted discovery authority distinction | PARTIAL FOUNDATION | Model and graph authority concepts exist, but current derived finding does not persist a typed generation method/model pin | AKP-2/3 |
| Manual Discovery execution | COMPLETE | `/knowledge/discovery/run` and list endpoints exist | REUSE |
| Post-Canonical automatic Discovery trigger | MISSING | Compiled-truth module consumes no events; no `CanonicalCommitted` -> Discovery consumer is wired | AKP-4 |
| Periodic Discovery scheduler | MISSING | Request `mode: WEEKLY` exists, but no persistent scheduler/job trigger exists | AKP-4 |
| Durable Discovery Job/Run/Attempt recovery | MISSING | Findings persist, but no durable Discovery run lifecycle/lease/restart contract exists | AKP-4 |
| Discovery scan bound | PARTIAL | maxNodes/maxSuggestions exist; AI token/cost/time/concurrency budgets do not | AKP-3/4 |
| Phase 3 re-entry declaration | PARTIAL | current finding carries `reentryPhase: VALIDATION` and produces `DerivedInferenceReady` | AKP-5 |
| Actual consumer from `DerivedInferenceReady` into validation | MISSING | repository search finds producer/manifest but no real consumer | AKP-5 |
| Direct Claim validation for source-derived claims | COMPLETE | Stage 4 `ClaimCandidate` is deliberately `DIRECT_EVIDENCE`, one SourceVersion, direct evidence | REUSE; do not weaken |
| Derived multi-source/projection provenance validation | MISSING | current direct ClaimCandidate cannot truthfully represent a derived hypothesis over multiple approved resources | AKP-5 |
| Review Center Discovery target contract | PARTIAL FOUNDATION | `DISCOVERY_CANDIDATE` target adapter exists | REUSE |
| Persistent Stage 10 Discovery -> Review bridge | MISSING | server currently constructs `DiscoveryCandidateReviewTargetAdapter(createInMemoryReviewDiscoveryCandidateReader())` with no persistent Stage 10 source | AKP-5 |
| Discovery Product inbox/detail | MISSING | backend manual API exists but no complete owner-facing Discovery workflow | AKP-6 |
| Discovery Graph overlay authority UI | PARTIAL FOUNDATION | graph types exist; real discovery projection binding is missing | AKP-6 |
| Discovery Activity/Job visibility | MISSING / REUSABLE FOUNDATION | FE-P5 Activity has Job/Run/Attempt/Stage patterns for existing domains; no Discovery domain adapter | AKP-4/6 |
| Discovery Attention/deep-link | MISSING | no active Discovery attention source | AKP-6 |
| Explicit Discovery feedback | MISSING | no persisted useful/not-relevant/error/snooze/suppress contract | AKP-7 |
| Epistemic vs preference feedback separation | MISSING | not implemented | AKP-7 |
| User-controlled suppression beyond exact fingerprint dedupe | MISSING | duplicate suppression is not user feedback/suppression | AKP-7 |
| Adaptive Discovery prioritization | MISSING | no ranking policy informed by explicit utility feedback | AKP-7 |
| Implicit behavior learning | MISSING | not implemented | EXCLUDED FROM AKP v1 |
| AI provider/model/credential authority | ACCEPTED ARCHITECTURE / NOT IMPLEMENTED | ADR-133 is accepted but Product implementation remains unauthorized | EXTERNAL DEPENDENCY; do not duplicate |
| End-to-end autonomous-but-governed knowledge loop | MISSING | individual foundations exist; full loop is not closed | AKP-8 |

## 4. Cross-section gaps revealed by whole-design review

The following are program-level gaps that are easy to miss when designing one Section at a time:

### XG-01 — Derived knowledge cannot masquerade as a direct source Claim

Stage 4 `ClaimCandidate` requires a SourceVersion and `DIRECT_EVIDENCE`. A pattern/relation hypothesis derived from several approved Canonical items cannot be represented by inventing a fake SourceVersion or relaxing the direct-evidence contract. AKP-5 therefore introduces a separate derived-provenance re-entry contract and validation profile while preserving Stage 4 direct-claim semantics.

### XG-02 — `WEEKLY` is a mode, not a scheduler

Current `DiscoveryRunResult.mode` and `/knowledge/discovery/run` accept `WEEKLY`, but Stage 10 consumes no trigger event and has no persistent periodic scheduler. AKP-4 must create a real trigger/runtime boundary.

### XG-03 — `DerivedInferenceReady` is currently terminal

Stage 10 emits `DerivedInferenceReady`, but no production consumer completes Phase 3 re-entry. AKP-5 owns that bridge.

### XG-04 — Review knows the target kind but not the persistent source

Review Center already has a `DISCOVERY_CANDIDATE` adapter contract, but current server wiring uses an empty in-memory reader. AKP-5 must provide a persistent project-scoped reader over the authoritative Discovery store.

### XG-05 — Graph contracts anticipated Discovery, data wiring did not

Graph authority and edge semantics already distinguish derived/discovery content. AKP-6 must bind persistent Discovery findings into that overlay without creating Canonical edges.

### XG-06 — Activity runtime exists, Discovery activity does not

Do not create a second activity system. Add a Discovery domain adapter and typed stages to the accepted Activity authority.

### XG-07 — Exact duplicate suppression is not user suppression

Current fingerprint persistence prevents exact repeats. It does not encode user dismissal, snooze or suppress-similar intent. AKP-7 separates duplicate identity, user suppression and feedback history.

### XG-08 — Security context must survive finding materialization

The current repository operation is project/security scoped, but the compact `DerivedInferenceCandidate` payload does not carry the full inherited access/sensitivity envelope needed for durable re-entry and review. AKP-2 makes this explicit in the finding envelope.

### XG-09 — Ask model authority and embedding/discovery profiles are different concerns

ADR-133 supplies server-owned provider/model/credential/privacy authority, but AKP must not assume the active Ask generation model is an embedding model or the best Discovery model. AKP-1 and AKP-3 define independently revisioned SemanticEmbeddingProfile and DiscoveryModelProfile that resolve through ADR-133 authority.

### XG-10 — Semantic readiness must not disable healthy lexical search

Stage 7 correctly blocks cited answers when its own lexical projection is not READY. AKP-1 introduces a separate semantic readiness dimension so semantic failure can degrade to lexical retrieval without making the existing healthy lexical projection unavailable.

### XG-11 — Durable Discovery is not the deferred general durable-import queue

AKP-4 needs durable Discovery Job state and restart recovery, but it must reuse the existing Outbox/Job/Activity foundations and must not silently promote PR #30's broader "Durable Knowledge Processing" queue into scope.

## 5. Frozen candidate Program Acceptance Criteria

The following set is the proposed finite AKP v1 completion contract. It becomes frozen only after user whole-design approval.

- **AKP-PAC-01**: AKP remains a Productization program over existing Knowledge Flow Steps 16, 17, 18/20 and 22; it does not create a new Canonical phase or philosophy.
- **AKP-PAC-02**: Embeddings and semantic indexes are rebuildable derived projections; they never become Canonical knowledge, Evidence or Fact confidence.
- **AKP-PAC-03**: Existing lexical retrieval remains independently available and Evidence/SourceVersion citations remain recoverable from every Hybrid result.
- **AKP-PAC-04**: Project, access-scope and sensitivity filtering is enforced before or within retrieval/discovery candidate selection; cross-project/resource existence is not leaked.
- **AKP-PAC-05**: AKP v1 supports typed derived findings for knowledge gap, missing evidence, relation hypothesis, pattern hypothesis, clarification/investigation question and action suggestion.
- **AKP-PAC-06**: Every finding records source projection/canonical base, related resources/evidence, generation method, algorithm/model provenance, security envelope, fingerprint version and derivation summary.
- **AKP-PAC-07**: Discovery and AI never directly write Canonical, promote Claim to Fact or execute an external Action.
- **AKP-PAC-08**: Discovery combines bounded typed signals from approved knowledge, Hybrid retrieval, graph, temporal/conflict/evidence state as applicable; unbounded whole-database LLM prompts are forbidden.
- **AKP-PAC-09**: Deterministic, AI-assisted and hybrid generation remain distinguishable in data, UI, audit and quality evaluation.
- **AKP-PAC-10**: A successful `CanonicalCommitted` path can schedule an idempotent incremental Discovery run after required projections are ready.
- **AKP-PAC-11**: A real persistent periodic full-scan trigger exists; a `WEEKLY` enum alone does not satisfy this criterion.
- **AKP-PAC-12**: User-initiated manual Discovery remains available with the same authority/budget policies.
- **AKP-PAC-13**: Discovery Job/Run/Attempt state is durable, restart recoverable, idempotent and observable; duplicate delivery cannot create duplicate logical work.
- **AKP-PAC-14**: Exact duplicate suppression and explicit user suppression are separate mechanisms with preserved history.
- **AKP-PAC-15**: Discovery findings actually re-enter validation/comparison/review; a label such as `reentryPhase: VALIDATION` without a consumer is insufficient.
- **AKP-PAC-16**: Derived hypotheses use a derived-provenance validation contract and never fake a SourceVersion or weaken the existing direct-evidence Claim contract.
- **AKP-PAC-17**: Review Center reads persistent Discovery candidates through a real project-scoped adapter and applies existing purpose-bound approval authority.
- **AKP-PAC-18**: Product UI explains why each finding exists, its evidence/provenance, authority, freshness and available next actions without presenting it as Canonical.
- **AKP-PAC-19**: Graph overlays can show derived/discovery nodes/edges using existing non-Canonical authority classifications and accessible list/table fallback.
- **AKP-PAC-20**: Discovery runs integrate with the existing Activity/Attention architecture; a second activity authority is forbidden.
- **AKP-PAC-21**: Feedback explicitly separates epistemic correction from preference/utility; usage, popularity or approval rate never changes Fact confidence or Evidence strength.
- **AKP-PAC-22**: AKP v1 adaptive prioritization is transparent, versioned and deterministic; ML/fine-tuning is not required for completion.
- **AKP-PAC-23**: External embedding/AI execution resolves through ADR-133 server authority once that Product capability exists; SemanticEmbeddingProfile and DiscoveryModelProfile are separately revisioned and execution-pinned.
- **AKP-PAC-24**: Semantic/AI degradation cannot corrupt Canonical; defined lexical/deterministic fallback, stale/readiness signals and safe failure behavior remain available.
- **AKP-PAC-25**: A Golden Query/Discovery evaluation compares lexical-only, semantic-only and hybrid behavior, including exact, typo, synonym, paraphrase, multilingual alias and temporal cases; final ranking thresholds are evidence-driven rather than hard-coded as truth confidence.
- **AKP-PAC-26**: End-to-end acceptance proves Canonical change -> projection -> automatic Discovery -> persistent finding -> Product review -> governed re-entry -> approval -> Canonical -> re-projection/re-discovery, plus suppression, stale-state, duplicate-event, restart, security, failure and Action non-execution cases.
- **AKP-PAC-27**: Program closure requires all frozen Section AC and PAC evidence, zero unresolved Critical/High architecture gaps, explicit disposition of every Deferred item, required exact-head CI evidence, and final user approval.
- **AKP-PAC-28**: Already-PASS evidence at the same exact head is reused; duplicate full test/CI runs are not a completion requirement.

## 6. Frozen candidate non-scope

AKP v1 does **not** include:

- autonomous AI Fact approval or direct Canonical mutation;
- automatic Canonical Relation creation without Review/Approval;
- automatic execution of external Action suggestions;
- generic autonomous web research or a general Internet agent;
- model fine-tuning, reinforcement learning, online self-training or self-modifying agents;
- truth-confidence changes from clicks, views, frequency, popularity or approval rate;
- implicit user-behavior telemetry as a required learning input;
- unconditional vectorization of Raw Sources or replacement of Source Exploration with a vector RAG corpus;
- mandatory Qdrant, OpenSearch, Pinecone or another external vector database;
- a new generalized durable-import/knowledge-processing queue merely to run Discovery;
- redesign of the Knowledge Flow, Claim/Fact boundary or Canonical authority;
- unbounded all-pairs semantic comparisons or unbounded iterative agent loops;
- multimodal image/audio/video semantic discovery as a v1 completion requirement;
- independent-provider challenger execution as a mandatory v1 gate (provenance must allow it later).

## 7. Section detailed architecture summary

### AKP-0 — Program Baseline & Completion Contract

Owns the exact-main Gap Audit, finite PAC set, non-scope, dependency map, cross-section gaps, ADR inventory and completion gate. No Product code. Proposed ADR: ADR-134.

### AKP-1 — Hybrid Semantic Retrieval

Owns approved-knowledge semantic representation, independently revisioned embedding profile, rebuildable semantic projection, vector-store port, PostgreSQL/pgvector first adapter candidate, Hybrid retrieval fusion, readiness/fallback, authorization filtering, citation preservation and Golden Query evaluation. Proposed ADR: ADR-135.

### AKP-2 — Discovery Finding Model

Owns a first-class `DiscoveryFindingEnvelope` rather than overloading `KnowledgeCandidateType`. Finding types are `KNOWLEDGE_GAP`, `EVIDENCE_GAP`, `RELATION_HYPOTHESIS`, `PATTERN_HYPOTHESIS`, `CLARIFICATION_QUESTION`, `ACTION_SUGGESTION`; every finding is `DERIVED_INFERENCE`, security/provenance bound and fingerprinted. Proposed ADR: ADR-136.

### AKP-3 — Active Discovery Engine

Owns bounded deterministic and AI-assisted strategies over Hybrid retrieval, graph, temporal/conflict/evidence signals; quality gates; relevance/novelty/evidence/impact/cost ranking dimensions; AI execution pinning and budgets. Proposed ADR: ADR-137.

### AKP-4 — Trigger, Scheduling & Durable Runtime

Owns `CanonicalCommitted` incremental trigger, persistent periodic full scan, manual trigger, projection-readiness wait, deterministic run identity, Job/Run/Attempt stages, leases/retry/restart, budget enforcement and Activity events. Reuses existing Outbox/Job foundations; does not introduce a general queue product. Proposed ADR: ADR-138.

### AKP-5 — Validation Re-entry & Governance

Owns `DiscoveryReentryManifest`, derived-provenance validation without weakening Stage 4 direct Claim semantics, real `DiscoveryFindingReady` consumer, persistent Discovery -> Review adapter, stale-base revalidation and existing Comparison/Impact/Review/Approval authority. Proposed ADR: ADR-139.

### AKP-6 — Discovery Product Experience

Owns Discovery Inbox/detail, reason/evidence/provenance/freshness presentation, Review/Investigate/Dismiss/Snooze/Suppress actions, Graph overlay binding, Activity domain integration, attention/noise policy, accessibility and server-authoritative Product APIs. Proposed ADR: ADR-140.

### AKP-7 — Feedback & Adaptive Prioritization

Owns append-only explicit feedback, epistemic vs preference/utility separation, exact/family suppression, snooze, transparent versioned `DiscoveryRankingPolicy` and explicit-feedback personalization. Implicit telemetry and ML ranking are deferred. Proposed ADR: ADR-141.

### AKP-8 — End-to-End Acceptance & Closure

Owns full-loop acceptance, quality/security/recovery/performance evidence, exact-head evidence reuse, unresolved-gap gate, Deferred register and the formal `AKP v1 COMPLETE` boundary. Proposed ADR: ADR-142.

## 8. Cross-section dependency order

```text
AKP-0
  -> AKP-1 Semantic Retrieval
  -> AKP-2 Finding Model
       -> AKP-3 Discovery Engine
            -> AKP-4 Trigger/Runtime
       -> AKP-5 Re-entry/Governance
            -> AKP-6 Product Experience
                 -> AKP-7 Feedback/Prioritization
                      -> AKP-8 E2E Closure
```

AKP-1 and AKP-2 are architecturally separable after AKP-0. AKP-3 requires both. AKP-5 can prepare its contracts after AKP-2/3 but full proof requires AKP-4. AKP-6 depends on actual runtime/re-entry surfaces. AKP-8 depends on all preceding Sections.

External dependency: ADR-133 Product implementation is required before external embedding and AI-assisted Discovery can be accepted. AKP does not duplicate that implementation authority.

## 9. Technology posture

### First implementation candidates

- PostgreSQL remains the primary database.
- `pgvector` is the first semantic-index adapter to validate because it preserves the existing PostgreSQL operational boundary and can remain behind a Vector/Semantic Index Port.
- Existing FTS + `pg_trgm` remains the lexical path.
- Hybrid fusion starts with a deterministic rank-fusion strategy such as RRF and is finalized by benchmark rather than a fixed similarity percentage.
- Existing in-process connector/outbox/job foundations remain the baseline runtime; durable Discovery state is persisted without adding BullMQ/RabbitMQ/Temporal solely for AKP.

These are implementation candidates, not permission to change dependencies before the relevant Section contract is accepted.

## 10. ADR candidate inventory

| ADR | Section | Candidate title | Status |
|---|---|---|---|
| ADR-134 | AKP-0 | Active Knowledge Productization v1 Boundary and Completion Contract | PROPOSED |
| ADR-135 | AKP-1 | Hybrid Semantic Retrieval as a Rebuildable Derived Projection | PROPOSED |
| ADR-136 | AKP-2 | Typed Discovery Finding Envelope and Re-entry Mapping Boundary | PROPOSED |
| ADR-137 | AKP-3 | Bounded Multi-Signal Active Discovery Engine Boundary | PROPOSED |
| ADR-138 | AKP-4 | Durable Triggered Discovery Runtime over Existing Outbox and Job Foundations | PROPOSED |
| ADR-139 | AKP-5 | Discovery Re-entry through Derived-Provenance Validation and Existing Review Authority | PROPOSED |
| ADR-140 | AKP-6 | Discovery Workspace, Graph Overlay and Activity Product Boundary | PROPOSED |
| ADR-141 | AKP-7 | Explicit Feedback Separation, Suppression and Non-Epistemic Adaptive Ranking | PROPOSED |
| ADR-142 | AKP-8 | Finite End-to-End Acceptance Gate and AKP v1 Closure Boundary | PROPOSED |

## 11. Whole-design review gate

Before any ADR becomes ACCEPTED or any AKP Product implementation is authorized, the user reviews this complete design as one system and resolves:

1. any missing capability or unintended scope expansion;
2. cross-Section contract conflicts;
3. ADR-133 dependency timing;
4. final finding taxonomy;
5. semantic corpus/ranking acceptance policy;
6. derived-provenance re-entry contract;
7. periodic Discovery policy;
8. Product notification/attention noise policy;
9. final PAC/non-scope set.

Only accepted decisions are then reflected into the canonical Phase ADD/architecture records. This candidate branch deliberately does not alter the Phase 5/6 ADD text.