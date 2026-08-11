# ADR-136 — Typed Discovery Finding Envelope and Re-entry Mapping Boundary

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-2 — Discovery Finding Model`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-084, ADR-089, ADR-090, ADR-127, ADR-128, ADR-134, ADR-135
- Product implementation: **NOT_AUTHORIZED**

## Context

Current Stage 10 `DerivedInferenceCandidate` is intentionally narrow: status `DERIVED_INFERENCE`, type `KNOWLEDGE_GAP`, a question, related node IDs, evidence IDs, source projection digest and `VALIDATION` re-entry marker. The canonical Knowledge Flow Step 17 is broader: missing/weak knowledge, new relationships/patterns, contradictions, questions/investigations and Action candidates.

Directly adding every Discovery mode to `KnowledgeCandidateType` would mix two different concepts: a derived *finding* produced by Discovery and a typed knowledge/action/conflict *candidate* entering the existing governance pipeline.

## Decision

### 1. Introduce a first-class Discovery finding envelope

Define `DiscoveryFindingEnvelopeV1` as a durable non-Canonical derived record. Every finding has:

```text
findingId
findingRevision
projectId
findingType
status = DERIVED_INFERENCE
generationMethod
relatedResourceRefs[]
evidenceIds[]
sourceProjectionDigest
canonicalVersion/discoveryBase
runId
rationale
derivationSummary
signalSummary
provenance
accessScope
sensitivity
fingerprint
fingerprintVersion
createdAt
supersedesFindingId?
```

The envelope is not a Canonical knowledge type and does not itself grant Review approval or execution authority.

### 2. AKP v1 finding taxonomy

The v1 taxonomy is finite and contains seven types:

- `KNOWLEDGE_GAP`
- `EVIDENCE_GAP`
- `RELATION_HYPOTHESIS`
- `PATTERN_HYPOTHESIS`
- `CONFLICT_HYPOTHESIS`
- `CLARIFICATION_QUESTION`
- `ACTION_SUGGESTION`

`KNOWLEDGE_GAP` payload distinguishes at least missing fact, temporal gap, undefined term and an unresolved question about an already-known conflict. `EVIDENCE_GAP` identifies an approved resource whose support/coverage is insufficient. `RELATION_HYPOTHESIS` proposes typed endpoints/relation/direction/temporal qualification. `PATTERN_HYPOTHESIS` records a bounded cluster/trend/recurring-association/temporal-change statement and member resources. `CONFLICT_HYPOTHESIS` identifies a newly detected possible contradiction among approved/current knowledge; it is not yet a Canonical `CONFLICT`. `CLARIFICATION_QUESTION` represents a concrete question/investigation next step. `ACTION_SUGGESTION` is always candidate-only and cannot execute.

An already-registered unresolved Canonical Conflict may produce a Knowledge Gap such as “what evidence is missing to resolve this?”; that is distinct from detecting a previously unregistered potential contradiction.

### 3. Generation authority

`generationMethod` is one of:

- `DETERMINISTIC`
- `AI_ASSISTED`
- `HYBRID`

AI-assisted/hybrid findings persist an immutable AI execution/provenance pin; deterministic findings persist rule/algorithm version. This classification is visible in Review and Product surfaces.

### 4. Signals are not truth confidence

`signalSummary` may preserve semantic similarity/rank, graph distance/topology, temporal overlap, conflict state, evidence coverage, novelty or cost information. These are retrieval/discovery signals. No field is named or interpreted as Fact confidence merely because its numerical value is high.

### 5. Restrictive security composition

Unlike the current compact Stage 10 candidate payload, the durable finding explicitly carries project, access-scope and sensitivity required for re-entry, Review, Graph and Product reads. The server remains the authority for deriving this envelope.

A finding may combine multiple input resources only within one project. Its effective access scope is **no broader than the safe common/intersection audience authorized for all contributing resources and the execution context**. Its sensitivity is the most restrictive/highest effective classification among the contributing inputs and applicable policy. If the system cannot derive a safe common disclosure scope, the finding is not materialized.

This composed security classification also governs any AI-assisted Discovery egress. A model call cannot use the least restrictive source classification when the derived input combines more restrictive material.

### 6. Fingerprint and suppression identity

Fingerprint identity is based on normalized finding type, typed related resource identity and the semantic essence of the proposal/question, under a versioned fingerprint algorithm. Timestamps, incidental model wording and run IDs are excluded from logical duplicate identity.

Exact duplicate identity is distinct from explicit user suppression; AKP-7 owns the latter.

### 7. Lifecycle, reconciliation and history

Persistence tracks derived finding lifecycle separately from the immutable finding revision. V1 lifecycle may include:

```text
NEW
VALIDATING
REVIEW_READY
REENTERED
DISMISSED
SUPPRESSED
RESOLVED
STALE
SUPERSEDED
```

A state transition does not delete the original finding/provenance.

Canonical/projection changes trigger bounded reconciliation. If the proposed relation/knowledge/conflict is later accepted, rendered obsolete, or its source resources are materially superseded, the prior finding becomes `RESOLVED`, `STALE` or `SUPERSEDED` according to typed policy instead of remaining a fresh unresolved suggestion.

### 8. Durable retention classification

A generated proposal rejected before durable finding materialization need not be retained. Once a finding is durably materialized, its provenance/history follows the project’s derived-record retention policy. Findings that enter governance, their re-entry/validation lineage, and explicit user feedback/suppression are not treated like disposable vector-cache payloads; they participate in normal backup/restore, project-deletion and audit-retention behavior.

### 9. Re-entry mapping is explicit

The finding type maps to an existing governed path; it does not automatically become that candidate:

- relation hypothesis -> derived-provenance Relation candidate/change path;
- pattern hypothesis -> derived-provenance Claim/knowledge candidate path;
- conflict hypothesis -> derived-provenance existing `CONFLICT` comparison/review path;
- evidence/knowledge gap -> validation/investigation or Knowledge Gap candidate path;
- clarification question -> investigation/question path, optionally producing later Candidates;
- action suggestion -> `ActionCandidate` path and existing risk/approval/execution governance.

AKP-5 owns the actual `DiscoveryReentryManifest` and validation bridge.

## Consequences

- Discovery can expand without contaminating Canonical candidate semantics.
- Product/Review can explain how a finding was generated.
- Security and provenance survive persistence and multi-resource derivation.
- Potential contradictions gain an explicit route instead of being hidden inside generic Gap prose.
- Additional storage and migration are required beyond the current narrow JSON payload/fingerprint table.

## Rejected alternatives

- Keep every result as `KNOWLEDGE_GAP` and encode meaning in prose.
- Treat a newly detected contradiction as an already-authoritative Canonical Conflict.
- Add `PATTERN`, `QUESTION`, `SUGGESTION`, etc. directly to Canonical knowledge types simply because Discovery produces them.
- Treat semantic similarity or model confidence as Fact confidence.
- Use the least-restrictive input resource’s security classification for a multi-resource finding.
- Infer project/access/sensitivity only from ambient request context after the finding has been persisted.
- Leave obsolete findings permanently presented as fresh.
- Treat governed findings/feedback as disposable vector-cache data.
- Let a finding itself be executable or Canonical.