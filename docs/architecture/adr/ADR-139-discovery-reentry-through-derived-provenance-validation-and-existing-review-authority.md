# ADR-139 — Discovery Re-entry through Derived-Provenance Validation and Existing Review Authority

- Status: **ACCEPTED**
- Proposed at: 2026-08-11
- Decision date: 2026-08-12
- Accepted at: 2026-08-12
- Accepted by: `USER`
- Decision owner: `USER`
- Work item: `AKP-5 — Validation Re-entry & Governance`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-084, ADR-085, ADR-086, ADR-089, ADR-090, ADR-094, ADR-128, ADR-129, ADR-134, ADR-136, ADR-137, ADR-138
- Product implementation: **NOT_AUTHORIZED**

## Context

The existing Knowledge Flow requires Discovery to return to Phase 3 validation. Current Stage 10 records `reentryPhase: VALIDATION` and emits `DerivedInferenceReady`, but no production consumer closes that loop. Review Center already supports a `DISCOVERY_CANDIDATE` target kind, yet current server wiring supplies an empty in-memory Discovery reader rather than persisted Stage 10 findings.

A second gap is semantic: the existing Stage 4 `ClaimCandidate` is intentionally source-derived and direct-evidence only. It requires a SourceVersion and direct Evidence. A derived pattern/relation/conflict hypothesis built from several approved Canonical resources cannot truthfully use that contract by inventing a SourceVersion or weakening direct-evidence validation.

## Decision

### 1. Eligible Discovery findings automatically re-enter governance

Introduce a versioned `DiscoveryReentryManifestV1`. It binds:

```text
manifestId
projectId
findingId/findingRevision
findingType
sourceProjectionDigest
canonicalBaseVersion/digest
relatedResourceRefs[]
evidenceIds[]
derivationProvenance
accessScope
sensitivity
requestedReentryPurpose
createdAt
```

A manifest is created by a server-authoritative re-entry coordinator and is idempotent for the same finding revision/purpose/base.

Every eligible durably persisted finding automatically enters its type-appropriate derived validation/re-entry path under policy. The user does **not** have to click “send to validation” for the system to begin epistemic validation. User authority remains at the existing Review/Approval boundary.

A finding may be visible in the Discovery Product while `VALIDATING`; visibility does not mean Review eligibility.

### 2. Preserve direct-evidence Claim semantics

Do not change existing `ClaimCandidate.evidenceMode = DIRECT_EVIDENCE` or fabricate a source version for derived knowledge.

Add a separate derived-provenance validation input family, e.g. `DerivedKnowledgeCandidateV1`, whose origin is explicitly `DERIVED_DISCOVERY`. It references the Discovery finding, approved related resource revisions and inherited Evidence lineage. It receives its own validation profile/version.

Existing source-extraction candidates remain unchanged.

### 3. Candidate origin is discriminated

Where Product/Review needs a common view, normalize candidates through a discriminated origin model rather than treating a derived finding as source-extracted:

```text
SOURCE_EVIDENCE
  -> SourceVersion + direct Evidence

DERIVED_DISCOVERY
  -> finding/projection/canonical base + approved resource/evidence lineage
```

This origin remains visible in Review, audit and later ChangeSet provenance.

### 4. Type-specific mapping

After derived-provenance validation:

- `RELATION_HYPOTHESIS` maps to a staged Relation candidate/change operation with typed endpoints/direction/time.
- `PATTERN_HYPOTHESIS` maps to a derived Claim/knowledge proposal only after the pattern statement and member/evidence lineage validate.
- `CONFLICT_HYPOTHESIS` maps to the existing Conflict comparison/review path only after the competing resources/propositions and contradiction basis validate; the raw finding is not itself Canonical Conflict.
- `KNOWLEDGE_GAP` / `EVIDENCE_GAP` maps to Knowledge Gap/investigation work; absence of evidence is never converted into affirmative Fact support.
- `CLARIFICATION_QUESTION` creates investigation/question work and does not itself create Canonical knowledge.
- `ACTION_SUGGESTION` maps to Action Candidate governance and remains `CANDIDATE_ONLY`; any external execution still requires ADR-094/129 boundaries.

### 5. Real event consumer

Replace the terminal `DerivedInferenceReady` behavior with a versioned finding-ready/re-entry event contract and a real idempotent consumer. The consumer creates the persisted re-entry/validation resource and advances the finding lifecycle; it never auto-approves it.

### 6. Review consumes review-eligible derived resources, not raw model output

Implement the persistent project-scoped Discovery/re-entry adapters needed to replace the production empty in-memory source. The production `DiscoveryCandidateReviewTargetAdapter` must resolve the **review-eligible normalized resource produced after derived validation/comparison preparation**, with lineage back to the original persisted finding.

Raw findings that are still `NEW`, `VALIDATING`, failed validation, stale or otherwise not review-ready do not become approvable Review items merely because they exist in the Discovery store.

Review continues to use ADR-128 Context/Item/Decision/Purpose-bound Approval authority. AKP does not create a parallel Review system.

### 7. Stale-base protection

Before derived validation/re-entry, before Review context materialization and again before applying an approved change, compare the finding's source projection/canonical base with current authoritative state according to finding type/policy. If material changes invalidate the inference, mark/rebuild/revalidate the context; never silently reinterpret an old finding against a new Canonical base.

AKP-4 reconciliation may mark an obsolete finding `RESOLVED`, `STALE` or `SUPERSEDED`; the re-entry coordinator must honor that state.

### 8. Provenance and retention through ChangeSet and Canonical commit

If a Discovery result ultimately becomes an approved change, the DraftChangeSet/Review/Canonical History retains references to the originating finding, re-entry manifest, validation result, evidence/resource lineage and model/algorithm versions. Canonical stores the approved knowledge result, not the embedding or opaque model score.

Discovery findings that enter governance, re-entry manifests and validation/provenance links are durable non-Canonical records covered by normal backup/restore/project-deletion/audit-retention policy; they are not disposable semantic-cache rows.

### 9. No shortcut approval

A Discovery card or Review target cannot directly mutate Canonical. Approval means approval of a concrete governed change under the existing ChangeSet/Review/Canonical boundary, not approval of a raw model response.

## Consequences

- Discovery finally closes the designed Phase 3 re-entry loop automatically.
- Direct source claims remain semantically strict.
- Review sees validated/review-eligible derived material with full lineage rather than raw inference.
- Potential conflicts reuse the existing Conflict authority after validation instead of inventing a new authority.
- Additional derived-candidate/re-entry contracts and migration/adapters are required.

## Rejected alternatives

- Keep only `reentryPhase: VALIDATION` with no consumer.
- Require the user to manually start validation for every eligible persisted finding.
- Reuse `ClaimCandidate` by weakening `DIRECT_EVIDENCE` requirements.
- Invent a synthetic SourceVersion for Compiled Truth/Discovery.
- Treat every raw persisted finding as immediately Review-approvable.
- Let Review approval of a raw finding write Canonical directly.
- Add a separate Discovery approval center that bypasses ADR-128.
- Allow an Action Suggestion to execute because its finding was reviewed.