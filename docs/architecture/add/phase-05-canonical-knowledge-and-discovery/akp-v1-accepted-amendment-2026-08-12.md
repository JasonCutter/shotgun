# Phase 5 ADD — AKP v1 Accepted Amendment

- Status: **ACCEPTED**
- Accepted at: 2026-08-12
- Accepted by: `USER`
- Applies to: Step 16–17 Productization
- Related accepted ADRs: ADR-134, ADR-135, ADR-136, ADR-137, ADR-138, ADR-139
- Product implementation: **NOT_AUTHORIZED**

## Amendment purpose

This amendment records the accepted Product-level completion design for active knowledge capabilities already present in the Phase 5 ADD. It does not replace ADR-049–ADR-060 or redefine Canonical authority. Where the original Phase 5 design was intentionally high-level, the accepted AKP v1 ADRs provide the implementation-level boundary.

## Step 16 refinement — Semantic retrieval as projection

- Existing FTS/`pg_trgm` lexical retrieval remains independently available.
- Semantic embeddings/vector indexes are rebuildable derived projections over approved/current knowledge, not Canonical fields, Evidence or Fact confidence.
- Canonical and Source Exploration semantic corpora remain separate in AKP v1.
- Typed knowledge resources use versioned deterministic semantic representations rather than mandatory arbitrary token chunking.
- Provider/model/credential/privacy authority resolves through ADR-133; `SemanticEmbeddingProfile` is independently revisioned from Ask generation models.
- PostgreSQL + `pgvector` is the first adapter candidate behind a Port, not a permanent Canonical dependency.
- Hybrid ranking combines bounded authorized lexical and semantic candidates; weights/cutoffs are benchmark-driven.
- Citation remains Knowledge -> EvidenceSpan -> SourceVersion lineage.
- Query embedding is also provider egress and follows project/sensitivity/privacy policy.
- Incremental projection must upsert changed eligible items and remove/tombstone superseded, retired or access-ineligible items. Full and incremental builds at the same base/profile must be logically equivalent.
- Semantic failure may degrade to healthy lexical retrieval where policy permits; it cannot corrupt Canonical.

## Step 17 refinement — Finite typed Discovery finding model

AKP v1 Discovery has exactly seven first-class non-Canonical finding types:

1. `KNOWLEDGE_GAP`
2. `EVIDENCE_GAP`
3. `RELATION_HYPOTHESIS`
4. `PATTERN_HYPOTHESIS`
5. `CONFLICT_HYPOTHESIS`
6. `CLARIFICATION_QUESTION`
7. `ACTION_SUGGESTION`

Each durable finding records generation method, related approved resources, Evidence lineage, Canonical/projection base, derivation/rationale, algorithm/model provenance, versioned fingerprint, project/access/sensitivity and lifecycle/history.

A multi-resource finding is limited to one Project, uses no broader than the safe common/intersection disclosure scope of its inputs and uses the highest effective sensitivity. Unsafe composition is rejected.

`CONFLICT_HYPOTHESIS` represents a newly detected possible contradiction and remains distinct from an already-authoritative Canonical `CONFLICT` until governed validation/comparison/review.

## Step 17 refinement — Bounded multi-signal engine

Discovery reads approved state through bounded typed signal Ports for Compiled Truth, Hybrid Retrieval, Graph, temporal/conflict state and Evidence coverage. Deterministic code selects bounded candidate neighborhoods before optional AI classification/explanation.

AI-assisted Discovery:

- uses a separately revisioned `DiscoveryModelProfile`;
- treats knowledge content as data, never as executable instructions;
- has no tool, external Action, credential or policy-changing authority;
- persists provider/model/prompt/schema/policy provenance;
- passes deterministic schema/security/identity/Evidence gates before durable finding materialization.

Every run has explicit scan, neighbor, candidate, finding, provider-call, token/cost, time and concurrency budgets. Exhaustion yields typed partial/truncated status rather than silent incompleteness.

## Step 17 refinement — Trigger and durable runtime

Reuse the existing `CanonicalCommitted` Transactional Outbox. Do not create a second Discovery Outbox.

AKP v1 has three trigger classes:

- Canonical commit -> bounded incremental Discovery after required projection readiness;
- persistent scheduled full scan, with weekly as the architecture default cadence and actual clock time configurable;
- explicit authorized manual run.

Discovery uses durable Job/Run/Attempt/Stage identity with lease/retry/restart/idempotency behavior. `WAITING_FOR_PROJECTION` has a bounded deadline and ends in an explicitly allowed degraded, retryable or terminal disposition.

Canonical/projection changes also reconcile prior findings to `RESOLVED`, `STALE` or `SUPERSEDED` where appropriate while preserving history.

## Step 17 refinement — Automatic Phase 3 re-entry

Eligible persisted findings automatically enter a dedicated derived-provenance validation/re-entry path. The user is not required to click a button merely to start validation.

The existing Stage 4 `ClaimCandidate.evidenceMode = DIRECT_EVIDENCE` contract is not weakened and no synthetic SourceVersion is invented. Derived material uses a discriminated `DERIVED_DISCOVERY` provenance origin and versioned validation profile.

Type-specific validated results map into the existing governed Relation, Claim/knowledge, Conflict, Knowledge Gap/investigation and Action Candidate paths. Review/Approval remains the user authority boundary. Discovery never directly writes Canonical and an Action Suggestion never executes merely because it was discovered or reviewed.

## Change-history rule

This amendment supplements the 2026-07-16 Phase 5 decisions. It does not silently rewrite them. Any future change to the AKP v1 boundary requires an explicit AKP Master Scope Amendment and affected ADR history.