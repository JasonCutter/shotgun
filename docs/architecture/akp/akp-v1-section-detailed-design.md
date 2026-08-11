# AKP v1 — Section Detailed Architecture Candidate

- Status: **CANDIDATE / WHOLE-DESIGN REVIEW REQUIRED**
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Master Program structure: **USER-CONFIRMED**
- Detailed Section decisions: **NOT YET ACCEPTED**
- Product implementation: **NOT_AUTHORIZED**
- Related proposed ADRs: ADR-134 through ADR-142

This document is the detailed architecture companion to `active-knowledge-productization-v1-master-design.md`. It intentionally designs AKP-0 through AKP-8 together before implementation so cross-Section omissions can be detected. It does not mutate the canonical Phase ADD.

---

# AKP-0 — Program Baseline & Completion Contract

## Purpose

Freeze the exact-main capability baseline, finite Program Acceptance Criteria, non-scope, dependencies, Section ownership, ADR inventory and completion gate before any AKP Product implementation.

## Inputs

- Canonical Knowledge Flow baseline and Detailed Map Steps 16, 17, 18/20, 22.
- Phase 5/6 ADD decisions.
- `main@f08ae632220ac613ae0e90c04930ceb323aac40b` code and migrations.
- Stage 6, 7, 10 engineering evidence.
- Existing Graph, Review, Activity, quality-evaluation and AI-provider architecture.
- PR #30 deferred architecture record.

## Outputs

1. exact-main capability matrix;
2. cross-Section Gap register;
3. AKP-PAC-01 through AKP-PAC-28 candidate set;
4. frozen candidate non-scope;
5. AKP-0~8 dependency map;
6. proposed ADR-134~142 inventory;
7. whole-design review gate.

## Completion candidate

AKP-0 becomes COMPLETE only after the user approves the whole-design baseline/PAC/non-scope and the resulting accepted decisions are recorded under normal architecture governance. No Product code is required.

## AKP-0 Acceptance Criteria

- **AKP0-AC-01**: exact canonical main SHA is recorded.
- **AKP0-AC-02**: every active-knowledge capability is classified COMPLETE/PARTIAL/MISSING/DEFERRED with repository evidence.
- **AKP0-AC-03**: existing foundations to reuse are identified so AKP does not duplicate Outbox, Review, Graph, Activity or provider authority.
- **AKP0-AC-04**: Program PAC and non-scope are finite and reviewable.
- **AKP0-AC-05**: every missing capability has one owning AKP Section.
- **AKP0-AC-06**: cross-Section contract gaps are recorded before Product implementation.
- **AKP0-AC-07**: ADR candidate ownership is unique and Product implementation remains unauthorized.
- **AKP0-AC-08**: ADD is not changed until user whole-design approval.

---

# AKP-1 — Hybrid Semantic Retrieval

## Goal

Complete Step 16 semantic retrieval as a rebuildable approved-knowledge projection while preserving Stage 7 lexical retrieval, citation and authority.

## Current gap

Stage 7 supports FTS/`pg_trgm`/substring retrieval and citations. No embedding/vector/hybrid Product implementation exists. PR #30 deferred technology choices pending a real semantic requirement.

## Architecture components

```text
Compiled Truth / approved knowledge
        |
SemanticRepresentationBuilder
        |
SemanticEmbeddingResolver
        |  resolves through ADR-133 authority
SemanticIndexRepositoryPort
        |
PostgresPgvectorSemanticIndexAdapter (first candidate)
        |
SemanticRetriever
        |
        +-----------------------+
        |                       |
LexicalRetriever          SemanticRetriever
        |                       |
        +---- HybridRetrievalCoordinator ----+
                            |
                     citation resolver
```

## Core contracts

### SemanticEmbeddingProfileV1

```text
profileId
projectId
profileRevision
providerCapabilityRef
modelRef
representationVersion
distanceMetric
normalizationPolicy
adapterMetadata
status = BUILDING | ACTIVE | RETIRED | FAILED
createdAt/activatedAt?
```

No secret is stored. Effective provider/model/credential/policy revisions are pinned per build/execution under ADR-133.

### SemanticIndexItemV1

```text
semanticItemId
projectId
resourceRef
resourceType
sourceProjectionDigest
canonicalVersion
semanticTextDigest
embeddingProfileId/revision
evidenceIds[]
accessScope[]
sensitivity
indexedAt
```

### HybridSearchResultV1

Contains the existing resource/citation identity plus:

```text
retrievalSignals[]
lexicalRank?
semanticRank?
hybridRank
semanticProfileRevision?
projectionFreshness
```

It does not contain `truthConfidence` derived from similarity.

## Semantic corpus

Included by default:

- current/eligible approved Claim/Fact/Entity/Relation/Event/Decision representations from Compiled Truth/approved knowledge;
- Evidence IDs only for lineage, not arbitrary Evidence text duplication unless required by an approved representation rule.

Excluded:

- unapproved/rejected Candidates;
- raw external/web content;
- arbitrary full Source chunks;
- Discovery findings not yet Canonical.

## Representation rules

Each knowledge type has a deterministic representation template. Example relation representation includes typed subject label, relation type, object label, temporal qualifier and approved aliases. Representation templates are versioned so a template change forces a new semantic text digest/build.

## Storage and migration

Candidate additive schema:

```text
projection.semantic_profiles
projection.semantic_index_generations
projection.semantic_index_items
projection.semantic_projection_status
```

Physical pgvector columns/index types remain adapter-level. Active generation pointer is switched atomically only after build/readiness acceptance. Rebuild can drop/recreate derived rows without touching Canonical.

## Hybrid ranking

1. authorize corpus first;
2. retrieve bounded lexical Top-K;
3. retrieve bounded semantic Top-K;
4. fuse by deterministic versioned rank-fusion policy, initially RRF candidate;
5. resolve citation lineage;
6. return explanation signals.

A model similarity threshold may be used as a benchmarked retrieval-control parameter but never as truth/evidence confidence.

## Readiness/fallback

```text
LEXICAL READY + SEMANTIC READY -> HYBRID
LEXICAL READY + SEMANTIC STALE/FAILED/UNAVAILABLE -> LEXICAL_FALLBACK + semantic warning
LEXICAL NOT READY -> existing Stage 7 authority remains controlling for cited canonical search
```

Semantic projection health is separate from lexical projection health.

## Security

- Server derives project/access/sensitivity.
- Vector retrieval is scoped before Top-K/ranking.
- External embedding egress uses ADR-133 deployment ceiling + project/provider approval + credential vault.
- Restricted data cannot be sent externally.
- No vector/log/debug response contains hidden project content.

## Quality evaluation

Golden Query fixture set covers exact, typo, synonym, paraphrase, Korean/English alias, temporal wording, ambiguous near-neighbor and negative controls. Record lexical-only, semantic-only, hybrid Recall@K/Precision-like task outcomes and citation correctness. Adopt final fusion/cutoff only after measured improvement without unacceptable lexical regression.

## AKP-1 Acceptance Criteria

- **AKP1-AC-01**: embeddings/index are derived/rebuildable and no Canonical schema stores vector authority.
- **AKP1-AC-02**: semantic corpus excludes unapproved/rejected candidates and raw-source bulk vectorization.
- **AKP1-AC-03**: typed deterministic representation and digest/version exist.
- **AKP1-AC-04**: embedding profile is independent from Ask generation model and server-authoritative.
- **AKP1-AC-05**: vector store is behind a Port; pgvector is an adapter, not domain schema.
- **AKP1-AC-06**: project/access/sensitivity filtering occurs before/in retrieval.
- **AKP1-AC-07**: Hybrid results return existing Evidence/SourceVersion citation lineage.
- **AKP1-AC-08**: semantic similarity is not truth confidence.
- **AKP1-AC-09**: lexical fallback remains functional when semantic is degraded.
- **AKP1-AC-10**: profile switch builds before activation and supports bounded rollback.
- **AKP1-AC-11**: Golden Query benchmark proves the accepted rank policy.
- **AKP1-AC-12**: external embedding data policy follows ADR-133; no secret appears in projection/API/log.

## Proposed implementation Work Packages

- WP1 contracts + semantic representation + profile authority integration.
- WP2 additive projection persistence + pgvector adapter candidate.
- WP3 semantic retriever + hybrid coordinator + citation integration.
- WP4 rebuild/readiness/profile switch/fallback.
- WP5 Golden Query/security/performance evidence.

---

# AKP-2 — Discovery Finding Model

## Goal

Define what Shotgun v1 may proactively discover without turning every discovery observation into a new Canonical/Knowledge Candidate type.

## Current gap

Current durable derived inference is fixed to `KNOWLEDGE_GAP`. Security/provenance/generation method are not sufficiently explicit for broad derived findings and persistent re-entry.

## Core model

### DiscoveryFindingEnvelopeV1

```text
findingId
findingRevision
projectId
findingType
status = DERIVED_INFERENCE
generationMethod = DETERMINISTIC | AI_ASSISTED | HYBRID
lifecycleState
payload
relatedResourceRefs[]
evidenceIds[]
sourceProjectionDigest
canonicalBase
runId
signalSummary
rationale
derivationSummary
provenance
accessScope[]
sensitivity
fingerprint
fingerprintVersion
createdAt
supersedesFindingId?
```

### Finding types

1. `KNOWLEDGE_GAP`
   - missing fact
   - temporal gap
   - undefined term
   - unresolved conflict
2. `EVIDENCE_GAP`
   - absent/weak/insufficient coverage for an approved resource or proposition
3. `RELATION_HYPOTHESIS`
   - typed subject/object/relation/direction/temporal qualifier proposal
4. `PATTERN_HYPOTHESIS`
   - cluster/trend/recurring-association statement + bounded member refs
5. `CLARIFICATION_QUESTION`
   - question/investigation next step derived from a finding
6. `ACTION_SUGGESTION`
   - candidate-only action/rationale/risk preview; never executable by itself

## Provenance

Deterministic finding:

```text
ruleId
ruleVersion
input digests
```

AI-assisted/hybrid finding additionally records an immutable external/local AI execution pin, prompt/schema/policy versions, provider response reference and usage/cost where available, without secrets.

## Signal summary

Signal values remain typed and explainable, e.g. lexical match, semantic rank/similarity, graph topology, temporal overlap, conflict status, evidence coverage, novelty. No field is authoritative truth confidence.

## Fingerprint

The v1 fingerprint normalizes finding type + typed related resource refs + proposal/question semantic identity under a `fingerprintVersion`. Run ID, timestamp and incidental wording are excluded. Later algorithm changes use a new version, preserving prior suppression history.

## Lifecycle and history

Current state may include:

```text
NEW
QUEUED_FOR_REVIEW
REENTERED
DISMISSED
SUPPRESSED
SUPERSEDED
```

Finding revision/provenance stays immutable/append-only. State changes do not erase the original finding.

## Persistence

Evolve current `projection.discovery_inferences` additively or replace behind a repository Port with versioned migrations such that existing Stage 10 findings remain readable/migratable. Suggested logical stores:

```text
projection.discovery_findings
projection.discovery_finding_state
```

AKP-7 owns feedback/suppression tables.

## Re-entry mapping

Finding is pre-governance derived material. Mapping is explicit:

- relation -> derived Relation proposal path;
- pattern -> derived Claim/knowledge proposal path;
- gap/evidence gap -> Knowledge Gap/investigation path;
- question -> investigation path;
- action -> Action Candidate governance.

AKP-5 performs the mapping after validation.

## AKP-2 Acceptance Criteria

- **AKP2-AC-01**: six v1 finding types are discriminated by schema.
- **AKP2-AC-02**: every finding is explicitly `DERIVED_INFERENCE`, never Canonical.
- **AKP2-AC-03**: generation method and provenance are durable.
- **AKP2-AC-04**: project/access/sensitivity are persisted in the durable finding envelope.
- **AKP2-AC-05**: Evidence/resource/projection/canonical-base lineage is sufficient for revalidation.
- **AKP2-AC-06**: fingerprint identity is versioned and independent from timestamps/run wording.
- **AKP2-AC-07**: finding lifecycle does not delete history.
- **AKP2-AC-08**: signal scores cannot be interpreted as Fact confidence.
- **AKP2-AC-09**: Action suggestions are structurally non-executable.
- **AKP2-AC-10**: re-entry mapping is explicit and does not make the finding itself a governed Candidate.

## Proposed implementation Work Packages

- WP1 finding contracts/taxonomy/provenance/security envelope.
- WP2 persistence migration/repository compatibility.
- WP3 fingerprint/state evolution.
- WP4 serialization/contract tests and existing Stage 10 migration compatibility.

---

# AKP-3 — Active Discovery Engine

## Goal

Produce useful v1 findings from bounded approved signals using deterministic and AI-assisted strategies.

## Signal architecture

```text
Compiled Truth
Hybrid Retrieval
Semantic Graph
Temporal/Conflict state
Evidence coverage
       |
DiscoverySignalFacade
       |
Strategy Registry
       |
Candidate neighborhood selection
       |
optional AI classification/explanation
       |
Quality Gate
       |
DiscoveryFindingAssembler/Repository
```

The engine reads through Ports and never scans unauthorized database tables directly.

## V1 strategies

### S1 Knowledge Gap

- disconnected/under-connected Entity;
- missing expected typed relationship by deterministic domain-neutral rule where valid;
- temporal gap/unresolved conflict candidate.

### S2 Evidence Gap

- approved item has empty/invalid Evidence lineage;
- important current Claim has support coverage below explicit rule/policy;
- competing views lack enough evidence to resolve.

This is a gap finding, not proof the Claim is false.

### S3 Relation Hypothesis

1. semantic-neighbor shortlist;
2. graph says no equivalent Canonical relation;
3. type/temporal/access compatibility checks;
4. optional AI proposes relation type/qualifier and explanation;
5. deterministic schema/duplicate/evidence gate;
6. persist `RELATION_HYPOTHESIS`.

### S4 Pattern Hypothesis

Use bounded neighborhoods to propose explainable cluster/trend/recurring-association hypotheses. Persist member refs and derivation summary. V1 does not require opaque clustering training or unbounded corpus-wide autonomous iteration.

### S5 Clarification Question

Generate a concrete question/investigation task only from a persisted/qualified gap/hypothesis context. Question generation cannot claim the answer is true.

### S6 Action Suggestion

Generate only when a finding has an actionable consequence and sufficient context. Include rationale/risk/affected resources and keep execution status `CANDIDATE_ONLY`.

## DiscoveryModelProfileV1

Separate from Ask active model and SemanticEmbeddingProfile. Contains project/profile revision and model capability reference; external execution resolves through ADR-133. AI output uses strict structured schema. Effective execution pin is persisted in finding provenance.

## Quality gates

- project/access/sensitivity match;
- typed references exist;
- no canonical duplicate relation/finding;
- no invalid self-reference;
- temporal qualifiers valid;
- Evidence lineage resolvable when the finding claims positive support;
- gap semantics explicitly allow missing evidence;
- schema output valid;
- exact/suppression policy checked;
- run budget available.

## Budget model

`DiscoveryBudgetV1` includes max scanned resources, neighbors/resource, pair/group candidates, emitted findings, AI calls, input/output tokens, estimated cost, wall-clock deadline and concurrency. Truncation/partial completeness is durable and visible.

## Ranking vector

Store explainable dimensions such as novelty, evidence coverage, impact, urgency, relevance, redundancy penalty, risk and cost. AKP-7 may alter non-epistemic prioritization; no score is truth probability.

## Degraded execution

If AI is unavailable and strategy supports deterministic generation, run records the reduced effective strategy set and may succeed `PARTIAL`. An AI-required strategy is skipped/fails with typed reason; the system does not fabricate an AI result.

## AKP-3 Acceptance Criteria

- **AKP3-AC-01**: strategy registry is versioned and bounded.
- **AKP3-AC-02**: all signal reads are server-authorized and projection-version bound.
- **AKP3-AC-03**: deterministic/AI/hybrid findings remain distinguishable.
- **AKP3-AC-04**: relation candidate space is bounded before AI call.
- **AKP3-AC-05**: at least one executable v1 generation strategy exists for every finding type frozen for v1, or an explicit non-blocking deferred disposition is approved at AKP-0 scope level.
- **AKP3-AC-06**: AI output passes deterministic quality gates before persistence.
- **AKP3-AC-07**: DiscoveryModelProfile is separate and execution-pinned via ADR-133 authority.
- **AKP3-AC-08**: token/cost/time/concurrency budgets are enforced and partial/truncated state is explicit.
- **AKP3-AC-09**: no strategy creates Canonical/Fact/external execution authority.
- **AKP3-AC-10**: quality evaluation includes positive and negative fixtures for relation/pattern/gap generation.

## Proposed implementation Work Packages

- WP1 signal Ports/facade + deterministic strategies.
- WP2 relation/pattern neighborhood generation.
- WP3 AI discovery adapter/profile/structured output integration.
- WP4 quality gates/budget/ranking dimensions.
- WP5 evaluation fixtures and failure/degradation evidence.

---

# AKP-4 — Trigger, Scheduling & Durable Runtime

## Goal

Make Discovery actually proactive and recoverable: after Canonical change, on periodic schedule, and on explicit user request.

## Current gap

`RunKnowledgeDiscovery` exists and supports `INCREMENTAL|WEEKLY`, but Stage 10 consumes no events and no real scheduler/job lifecycle exists.

## Trigger architecture

```text
CanonicalCommitted Outbox ----+
Persistent Schedule ----------+--> DiscoveryTriggerCoordinator
Manual Product Command -------+          |
                                         v
                               DiscoveryJob Repository
                                         |
                                lease/worker coordinator
                                         |
                                   AKP-3 engine
```

## Trigger types

### Canonical commit

Consumer records an idempotent incremental Job after the authoritative commit. It waits for required projection versions rather than running inside the Canonical transaction.

### Scheduled full scan

Persistent `DiscoverySchedulePolicy` defaults to weekly architecture semantics. Exact local day/time is configuration, not a hard-coded midnight. Scheduler state must survive restart.

### Manual

Authorized project-scoped Product command. Browser may request an allowed mode/profile but cannot supply project/provider authority or unbounded budget.

## Job identity

Deterministic logical identity binds:

```text
projectId
triggerType/triggerId
canonicalBase
required projection base/policy
strategy/ranking/profile revisions
```

Duplicate `CanonicalCommitted` delivery returns/continues the same logical Job.

## Job state

```text
QUEUED
WAITING_FOR_PROJECTION
RUNNING
PARTIAL
SUCCEEDED
FAILED_RETRYABLE
FAILED_TERMINAL
CANCELLED
```

Run/Attempt/Stage semantics follow ADR-130. Domain Retry creates a new Attempt; transport retry/redelivery does not.

## Stage examples

```text
WAIT_FOR_PROJECTION
LOAD_SIGNALS
GENERATE_FINDINGS
QUALITY_GATE
PERSIST_FINDINGS
PUBLISH_REENTRY
```

## Persistence/recovery

Reuse PostgreSQL and existing Job/Outbox patterns. Store job/run/attempt/stage current state and necessary event observations. Workers use bounded leases. Lease expiry/process restart makes safe work reclaimable. No new generic queue product is required for v1.

## Projection readiness

A Job can wait for Compiled Truth/semantic/graph versions. Policy defines whether semantic degradation permits deterministic/lexical fallback. Effective projection versions and strategy set are recorded for reproducibility.

## Coalescing

Rapid commits may be coalesced only when lineage proves a later pending base fully subsumes earlier pending work. Never debounce away the latest canonical version.

## Activity

Publish domain-owned snapshots/events into the existing federated Activity read projection. Do not make Activity the Discovery state authority.

## AKP-4 Acceptance Criteria

- **AKP4-AC-01**: `CanonicalCommitted` creates/awakens one idempotent incremental logical Job.
- **AKP4-AC-02**: periodic full scan exists as persistent scheduler behavior, not enum-only behavior.
- **AKP4-AC-03**: manual trigger remains available and server-authorized.
- **AKP4-AC-04**: Discovery never runs inside Canonical commit transaction.
- **AKP4-AC-05**: projection readiness wait/fallback policy is explicit and version-bound.
- **AKP4-AC-06**: Job/Run/Attempt/Stage state survives restart.
- **AKP4-AC-07**: duplicate event/transport retry cannot create duplicate Domain Attempt/logical Job.
- **AKP4-AC-08**: retry/lease recovery is bounded and preserves prior failure context.
- **AKP4-AC-09**: AKP-3 cost/work budgets remain enforced across retries.
- **AKP4-AC-10**: existing Activity projection can display Discovery lifecycle without becoming authority.
- **AKP4-AC-11**: no BullMQ/RabbitMQ/Temporal/general durable-import queue is added without a separate proven need/ADR.

## Proposed implementation Work Packages

- WP1 trigger/job contracts and persistence.
- WP2 CanonicalCommitted consumer + projection wait.
- WP3 persistent scheduler + manual command normalization.
- WP4 lease/retry/restart/idempotency.
- WP5 Activity adapter/events and runtime evidence.

---

# AKP-5 — Validation Re-entry & Governance

## Goal

Close the actual designed path from persistent derived finding to Phase 3 validation, comparison/impact, Review, approval and Canonical change without weakening source-derived Claim rules.

## Current gap

- `reentryPhase: VALIDATION` exists but has no real consumer.
- `DerivedInferenceReady` has no production re-entry consumer.
- Review target kind exists but server wires an empty in-memory reader.
- Stage 4 direct ClaimCandidate cannot correctly represent multi-resource derived hypotheses.

## Re-entry architecture

```text
DiscoveryFindingReady
       |
DiscoveryReentryCoordinator
       |
DiscoveryReentryManifest
       |
DerivedProvenanceValidation
       |
Typed derived candidate/change proposal
       |
Comparison / Impact
       |
Existing Review Center (ADR-128)
       |
Approved ChangeSet
       |
Canonical commit (existing authority)
```

## DiscoveryReentryManifestV1

```text
manifestId
projectId
findingId/findingRevision
findingType
sourceProjectionDigest
canonicalBase
relatedResourceRefs[]
evidenceIds[]
derivationProvenance
accessScope[]
sensitivity
requestedReentryPurpose
createdAt
```

Idempotency binds finding revision + purpose + base.

## Derived provenance validation

Do not alter Stage 4 `ClaimCandidate` direct-evidence contract.

Introduce a distinct derived input family with origin:

```text
origin = DERIVED_DISCOVERY
findingRef
projection/canonical base
approved resource revisions[]
inherited evidence lineage[]
derivation provenance
```

Validation dimensions include schema, lineage existence/access, derivation consistency, current-base compatibility, relation/entity identity, temporal validity, policy/security and semantic coherence appropriate to finding type.

## Type mapping

### Relation

Validated relation hypothesis becomes a typed Relation proposal/change operation only after endpoints and qualifiers validate. It is not inserted into the Canonical Graph by Discovery.

### Pattern

Validated pattern may materialize a derived Claim/knowledge proposal whose statement and member/evidence lineage are explicit. The system never pretends it was directly quoted from one SourceVersion.

### Knowledge/Evidence Gap

Becomes Knowledge Gap/investigation work or a request for evidence; lack of evidence does not become affirmative Claim evidence.

### Question

Creates an investigation/question task and may later produce normal source-derived/derived candidates based on actual results.

### Action

Maps to existing Action Candidate governance. Review of the finding is not execution approval.

## Persistent Review bridge

Implement `ReviewDiscoveryCandidateReader` against the authoritative persistent Discovery repository. Remove production reliance on `createInMemoryReviewDiscoveryCandidateReader()` for Discovery sources. Test-only in-memory adapter remains.

## Stale-base protection

Before Review context materialization and before approved mutation, compare relevant canonical/projection/resource revisions. If finding meaning is stale, mark context stale/revalidate/rebuild. No silent reinterpretation.

## Provenance continuity

If accepted, History/ChangeSet keeps links to finding, re-entry manifest, derived validation, resource/evidence lineage and model/rule versions.

## AKP-5 Acceptance Criteria

- **AKP5-AC-01**: a real persistent consumer closes `FindingReady -> re-entry`.
- **AKP5-AC-02**: re-entry manifest is versioned/idempotent/project-authoritative.
- **AKP5-AC-03**: direct `ClaimCandidate` evidence rules are unchanged.
- **AKP5-AC-04**: derived hypotheses have a separate derived-provenance validation profile.
- **AKP5-AC-05**: no fake SourceVersion is created for derived knowledge.
- **AKP5-AC-06**: every v1 finding type has an explicit governed mapping/disposition.
- **AKP5-AC-07**: Review reads real persistent findings, not an empty production in-memory reader.
- **AKP5-AC-08**: stale finding/base fails closed or revalidates before approval.
- **AKP5-AC-09**: Review/approval remains ADR-128 authority; Discovery has no parallel approval authority.
- **AKP5-AC-10**: Action suggestion cannot execute without existing Action governance.
- **AKP5-AC-11**: accepted Canonical change retains originating derived provenance/history.

## Proposed implementation Work Packages

- WP1 re-entry/derived-candidate contracts + validation profile.
- WP2 finding-ready consumer/idempotent coordinator.
- WP3 persistent Review reader/target integration.
- WP4 type mapping into Comparison/Impact/Review flows.
- WP5 stale-base/provenance/security negative tests.

---

# AKP-6 — Discovery Product Experience

## Goal

Make active Discovery understandable and governable through the Product without duplicating Knowledge, Graph, Review or Activity authority.

## Product surfaces

### Discovery Inbox

Integrated under Knowledge Workspace with filters:

- finding type;
- lifecycle/review state;
- priority/attention;
- generation method;
- freshness/completeness;
- risk/actionability.

### Finding detail

Shows:

- derived/non-Canonical authority;
- summary/detail;
- why surfaced;
- signal/derivation explanation;
- related knowledge refs;
- Evidence/Source lineage;
- source projection/canonical base/freshness;
- generation method and safe provenance metadata;
- Activity run status;
- Review status/next action.

### Graph overlay

Persisted relation/pattern/gap findings appear as existing `DERIVED_INFERENCE`/`DISCOVERY_CANDIDATE` overlays. Candidate edges never use `CANONICAL_RELATION` authority/style. Accessible list/table carries same semantics.

### Activity

Discovery Job/Run/Attempt/Stage joins the existing federated Activity projection via an adapter. User can inspect progress/failure/retry/partial/truncation without Activity mutating Discovery state.

## Owner actions

- review;
- inspect Evidence/Source;
- inspect related Graph;
- investigate/Ask;
- dismiss;
- snooze;
- suppress exact/similar (AKP-7).

No direct Canonical mutation. Action suggestions require normal Action governance.

## Attention/noise

Only findings that meet versioned actionability/priority policy create Action Center attention. Low/medium findings are batched/grouped. No notification/toast per background finding.

## API boundary

Server-authoritative Product API provides list/detail/filters, capability-derived actions, feedback/suppression commands, review deep links and activity references. Client does not provide project/model/ranking authority.

## Readiness

The UI distinguishes current/stale/partial/truncated/rebuilding/unavailable states. It can state that semantic/AI enhancement is unavailable while lexical/deterministic knowledge remains usable.

## Accessibility

Keyboard operation, text labels, non-color-only authority state, focus-preserving refresh, bounded live announcements, list/table fallback and meaningful deep links are mandatory.

## AKP-6 Acceptance Criteria

- **AKP6-AC-01**: Discovery is usable from Product UI, not backend-only.
- **AKP6-AC-02**: every finding visibly indicates derived/non-Canonical authority.
- **AKP6-AC-03**: why/evidence/provenance/freshness is inspectable subject to masking.
- **AKP6-AC-04**: Review is deep-linked/reused, not duplicated.
- **AKP6-AC-05**: candidate Graph edges cannot be mistaken for Canonical edges and have accessible fallback.
- **AKP6-AC-06**: existing Activity shows Discovery lifecycle through an adapter.
- **AKP6-AC-07**: Attention is bounded/grouped; not every finding creates notification noise.
- **AKP6-AC-08**: all commands are server-authoritative/capability-derived.
- **AKP6-AC-09**: degraded/partial/readiness states are explicit.
- **AKP6-AC-10**: keyboard/focus/list/table accessibility is proven.
- **AKP6-AC-11**: project/access cache isolation and non-disclosure are proven.

## Proposed implementation Work Packages

- WP1 Product read contracts/API + client decoders.
- WP2 Inbox/detail + filters/readiness.
- WP3 Graph overlay persistent binding.
- WP4 Activity/Attention integration.
- WP5 actions/deep links/accessibility/E2E.

---

# AKP-7 — Feedback & Adaptive Prioritization

## Goal

Improve usefulness/noise over time using explicit feedback while preventing preference from becoming truth authority.

## Feedback contract

`DiscoveryFeedbackEventV1` is append-only and records project/finding revision/actor/class/kind/reason/scope/time.

### Epistemic kinds

```text
INCORRECT_RELATION
INSUFFICIENT_EVIDENCE
WRONG_ENTITY
TEMPORAL_ERROR
MISLEADING_PATTERN
```

These route to validation/correction/review work.

### Preference/utility kinds

```text
USEFUL
NOT_RELEVANT
ALREADY_KNOWN
TOO_FREQUENT
SNOOZE
SUPPRESS_EXACT
SUPPRESS_SIMILAR
```

These affect ordering/timing/grouping/suppression only.

## Storage

Logical additive stores:

```text
projection.discovery_feedback_events
projection.discovery_suppression_rules
projection.discovery_ranking_policy
```

Feedback is append-only. Suppression/ranking current views are derived from events/config revisions.

## Suppression

### Exact

User explicitly suppresses logical fingerprint/family identity. System duplicate suppression remains separate and automatic.

### Similar

Only explicit `SUPPRESS_SIMILAR` creates semantic-family suppression. Rule records scope, matching policy/version and optional expiry. It must not silently hide contradictory evidence solely because a similar finding was rejected.

### Snooze

Temporary expiry-based state. No history deletion.

## Ranking policy

V1 uses deterministic versioned weights/rules over novelty, explicit relevance, evidence coverage, impact, urgency, redundancy, cost/risk and explicit feedback utility. Store effective policy revision with ordered result/read snapshot.

No hidden ML training is required. Approval rate is a product-quality metric only, not Truth Probability.

## Implicit behavior

Clicks/views/search frequency are explicitly outside AKP v1 completion. A future proposal requires privacy/telemetry architecture and still cannot alter epistemic confidence.

## AKP-7 Acceptance Criteria

- **AKP7-AC-01**: feedback events are append-only/auditable.
- **AKP7-AC-02**: epistemic and preference classes are schema-distinct.
- **AKP7-AC-03**: epistemic feedback routes to validation/correction, not ranking-only treatment.
- **AKP7-AC-04**: preference feedback cannot change Evidence/Fact/Claim confidence/status.
- **AKP7-AC-05**: exact duplicate suppression and user suppression are separate.
- **AKP7-AC-06**: snooze is temporary and preserves history.
- **AKP7-AC-07**: suppress-similar requires explicit user intent and versioned scope/matcher.
- **AKP7-AC-08**: ranking policy is deterministic/versioned/explainable for v1.
- **AKP7-AC-09**: approval/rejection history is not used to hide opposing Evidence or learn truth.
- **AKP7-AC-10**: implicit behavior telemetry/ML is not required v1 scope.
- **AKP7-AC-11**: project/principal access controls prevent cross-project feedback/suppression leaks.

## Proposed implementation Work Packages

- WP1 feedback/suppression/ranking contracts + storage.
- WP2 Product commands and derived suppression state.
- WP3 ranking-policy integration.
- WP4 epistemic-feedback re-entry integration.
- WP5 UI controls/audit/security tests.

---

# AKP-8 — End-to-End Active Knowledge Acceptance

## Goal

Prove that all Section hand-offs form one safe persistent active-knowledge loop and define an irreversible v1 completion boundary.

## Mandatory scenario matrix

### A Canonical-triggered relation loop

Approved change -> CanonicalCommitted -> projection -> semantic/graph -> incremental Job -> relation finding -> UI -> derived validation -> Review -> approved change -> Canonical -> next projection/discovery.

### B Periodic full scan

Persistent scheduler runs without a user request and records durable Activity.

### C Feedback/suppression

Dismiss/snooze/suppress survives rerun/restart and does not modify truth confidence.

### D Semantic/AI degradation

Lexical/deterministic fallback behaves per policy; Canonical remains untouched; Product displays degraded/partial.

### E Restart recovery

Queued/running Job survives restart/lease expiry with no duplicate logical outcome.

### F Duplicate event

Duplicate CanonicalCommitted does not create duplicate Job/finding.

### G Stale-base review

Finding generated on old base is revalidated/fails closed before approval.

### H Security

Cross-project/access/sensitivity and external-provider egress policy are enforced across search/discovery/graph/review/activity/feedback.

### I Embedding profile switch/rollback

New semantic generation builds before activation and can rollback without Canonical mutation.

### J Action non-execution

Action Suggestion cannot execute without normal external Action governance.

### K Authority presentation

Derived findings/edges never appear as Canonical due to score or UI styling.

### L Feedback routing

Epistemic feedback creates correction/validation work; utility feedback only changes priority/suppression.

## Evidence dimensions

- Contract/schema compatibility.
- Migration/rebuild/rollback.
- Persistence/restart/retry/idempotency.
- Security/non-disclosure/sensitivity.
- Semantic Golden Query quality.
- Discovery positive/negative quality fixtures.
- Review/re-entry authority.
- Graph/Activity authority separation.
- Accessibility/focus.
- Performance/cost bounds.
- Degraded/failure recovery.
- Provenance/history/audit.

## Test policy

Focused tests follow changed risk per Work Package. Same-exact-head PASS evidence is reused. Full repository required check runs at final candidate/automatic CI boundaries rather than repeated manually after every minor substep.

## Program closure record

`AKP v1 COMPLETE` requires:

- all AKP-PAC and Section AC accepted/passing;
- mandatory E2E scenarios passing on final exact Product head;
- zero unresolved Critical/High architecture/security gaps;
- every Deferred item explicitly outside v1;
- required CI PASS on exact head;
- user completion approval;
- normal merge/post-merge governance closure.

After closure, new "more proactive" ideas are AKP v2/follow-up unless they demonstrate v1 evidence was incorrect.

## AKP-8 Acceptance Criteria

- **AKP8-AC-01**: scenarios A-L have explicit evidence.
- **AKP8-AC-02**: all PAC/Section AC have PASS or approved disposition.
- **AKP8-AC-03**: no unresolved Critical/High cross-section gap remains.
- **AKP8-AC-04**: security and degraded/restart cases are proven, not happy-path only.
- **AKP8-AC-05**: performance/cost is bounded with representative data.
- **AKP8-AC-06**: evidence matrix reuses exact-head prior PASS results rather than duplicate runs.
- **AKP8-AC-07**: user explicitly approves final completion.
- **AKP8-AC-08**: merge/post-merge governance records `AKP v1 COMPLETE`; future scope does not silently reopen it.

## Proposed implementation Work Packages

- WP1 cross-section AC/evidence matrix.
- WP2 end-to-end fixtures A-L.
- WP3 security/recovery/degraded/performance evidence.
- WP4 final gap audit + Deferred register.
- WP5 completion authorization/merge/post-merge closure.

---

# Cross-Section Contract Map

| Producer | Contract | Consumer | Critical rule |
|---|---|---|---|
| Canonical Stage 6 | `CanonicalCommitted` | AKP-4 Trigger Coordinator | Existing durable Outbox reused |
| Compiled Truth | projection digest/version | AKP-1/3/4 | Discovery binds exact projection base |
| AKP-1 | Hybrid retrieval + semantic readiness | AKP-3 | Retrieval signal != truth confidence |
| AKP-2 | DiscoveryFindingEnvelope | AKP-3/4/5/6/7 | Derived + provenance/security preserved |
| AKP-3 | persistent findings/run result | AKP-4/5 | Bounded strategy and quality gate |
| AKP-4 | Discovery Job/Run/Attempt/Stage + FindingReady | AKP-5/6 | Idempotent durable trigger/runtime |
| AKP-5 | derived validation/re-entry/Review resources | existing Review/Canonical + AKP-6 | No fake direct Evidence or auto approval |
| AKP-6 | Product feedback commands | AKP-7 | UI not authority |
| AKP-7 | feedback/suppression/ranking policy | AKP-3/6 | preference cannot modify epistemic authority |
| all | acceptance evidence | AKP-8 | whole-loop closure required |

# External Dependency Map

## ADR-133

AKP-1 external embedding and AKP-3 AI-assisted Discovery depend on Product implementation of accepted ADR-133 provider/model/credential/privacy authority. AKP defines embedding/discovery profiles but does not implement a competing credential/provider authority.

## PR #30 Durable Knowledge Processing

The broad durable import/queue work remains outside AKP v1. AKP-4 may add only the durable state required for Discovery and reuse existing Job/Outbox/Activity patterns.

## Existing Stage 12.1 Quality Evaluation

Reuse it for semantic/discovery evaluation rather than creating an independent generic evaluation platform.

# Whole-design omission check result

The combined design currently has explicit ownership for all identified gaps. The most important corrections produced by whole-design analysis are:

1. derived knowledge requires a separate provenance validation origin;
2. semantic and AI Discovery profiles cannot be aliases of the active Ask model;
3. periodic mode must become a real persistent scheduler;
4. `FindingReady` needs a production consumer;
5. Review needs a persistent Discovery source adapter;
6. Graph needs real Discovery overlay binding;
7. Activity needs a Discovery adapter, not another activity system;
8. user suppression must be distinct from fingerprint dedupe;
9. finding security envelope must survive persistence/re-entry;
10. semantic readiness must be independent from lexical readiness;
11. durable Discovery must not expand into the deferred generalized queue;
12. explicit feedback is sufficient for v1; implicit behavior telemetry is intentionally excluded.

Any additional gap found during user review is handled as an amendment to this candidate before ADR acceptance; it does not silently enter Product implementation.