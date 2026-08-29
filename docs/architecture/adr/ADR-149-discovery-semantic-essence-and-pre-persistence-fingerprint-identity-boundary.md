# ADR-149 — Discovery Semantic Essence and Pre-Persistence Fingerprint Identity Boundary

- Status: **ACCEPTED**
- Proposed at: 2026-08-30
- Decision date: 2026-08-30
- Accepted at: 2026-08-30
- Accepted by: `USER`
- Decision owner: user
- Program: `AKP — Active Knowledge Productization v1`
- Section: `AKP-3 — Active Discovery Engine`
- Subject base: `main@67fbd06f6c52662a98975ca10335e32f02f90e0a`
- Related ADRs: ADR-121, ADR-136, ADR-137
- Product implementation: **AUTHORIZED FOR AKP-3 WP4 CORRECTION**

## Authority and history

ADR-149 was accepted under the user's standing delegation of Project Shotgun AKP implementation and architecture approval authority to GPT for completion of Active Knowledge Productization. GPT exercised that delegated authority in the current Project Shotgun conversation on 2026-08-30.

`Accepted by: USER` identifies the governing decision authority. The sentence above records the actual delegated decision path; this ADR does not claim that the user separately reviewed and manually approved the ADR-149 text in a dedicated approval turn.

## Context

ADR-136 froze `discovery-fingerprint:v1` around logical finding identity and established `semanticEssence` as a server-owned fingerprint input. AKP-3 WP1 already provides deterministic semantic essence for Knowledge Gap and Evidence Gap candidates. AKP-3 WP2 and WP3 subsequently introduced bounded Relation, Pattern and Conflict hypotheses plus Clarification Question and Action Suggestion generation, but those AI/HYBRID paths did not yet have a frozen server-owned rule for deriving `semanticEssence`.

AKP-3 WP4 must materialize a pre-persistence `DiscoveryFindingEnvelopeV1`, compute the accepted V1 fingerprint, and pass the candidate through the deterministic quality gate without making model wording, provider identity, run identity, evidence ordering, or other incidental execution details part of semantic identity.

Inventing a new payload hash or treating model wording as `semanticEssence` would silently create new fingerprint semantics. This ADR closes that missing semantic-identity boundary while preserving the existing fingerprint algorithm.

## Decision

### 1. `discovery-fingerprint:v1` remains frozen

The existing `discovery-fingerprint:v1` algorithm is unchanged.

The logical fingerprint inputs remain:

```text
findingType
relatedResourceRefs
semanticEssence
```

Production code continues to use the accepted `computeDiscoveryFingerprintV1` authority. No fingerprint v2, provider-specific fingerprint, model-specific fingerprint, or WP4-local alternative hashing algorithm is introduced.

### 2. Introduce a server-owned semantic projection

AKP-3 introduces the versioned semantic projection identity:

```text
discovery-semantic-essence:v1
```

The repository may expose this as `DiscoverySemanticEssenceProjectionV1` or an exact equivalent.

The final `semanticEssence` string is the deterministic stable JSON representation of the server-owned projection using the repository's accepted stable JSON and UTF-16 ordering rules.

The browser, client and model never supply authoritative `semanticEssence`.

### 3. Derivation timing

For AI/HYBRID findings, semantic essence is derived only after:

1. the WP2 bounded candidate identity has been accepted;
2. the WP3 strict structured output has been decoded;
3. server-owned resource membership, orientation, security and base authority have been restored;
4. bounded semantic enum classifications have been fixed.

The pre-persistence sequence is:

```text
WP3 proposal
  -> server derives semanticEssence
  -> computeDiscoveryFingerprintV1
  -> pre-persistence DiscoveryFindingEnvelopeV1
  -> WP4 deterministic quality gate
```

WP4 does not persist the finding or transition lifecycle state.

### 4. Incidental execution data is excluded

The semantic projection must not include incidental execution or provenance data, including:

- runId;
- findingId or findingRevision;
- createdAt or lifecycle state;
- evidence IDs;
- signal scores or ranks;
- semanticGenerationId;
- selector inputDigest;
- Discovery AI input digest;
- provider/model identity or version;
- AI configuration revision;
- credential identity/revision;
- provider/privacy/data policy revisions;
- prompt/output-schema revisions;
- provider response ID or raw model response;
- token usage or cost;
- ranking information;
- Canonical/discovery projection versions;
- rationale or derivationSummary.

A change only to one of these values does not create a new semantic identity.

### 5. Free-form AI wording is not fingerprint authority

The following free-form model-generated wording is excluded from V1 semantic essence:

- Relation: `proposedRelationType`;
- Pattern: `patternIdentity`, `patternStatement`;
- Conflict: `possibleContradiction`;
- Clarification: `question`, `context`, `proposedNextStep`;
- Action: `suggestedAction`, `rationale`, `riskContext`.

The full AI payload must not be hashed as semantic identity, and normalized model prose must not be substituted for server-owned semantic essence.

This is an intentional V1 deduplication rule. A later server-owned semantic vocabulary may refine identity only through an explicit future architecture decision.

### 6. Relation Hypothesis semantic essence

For `RELATION_HYPOTHESIS`, the server-owned projection is equivalent to:

```text
{
  essenceVersion: "discovery-semantic-essence:v1",
  findingType: "RELATION_HYPOTHESIS",
  direction: "DIRECTED" | "UNDIRECTED",
  directedRoles?: {
    sourceResourceKey,
    targetResourceKey
  },
  temporalScope?: {
    validFrom?,
    validTo?
  }
}
```

For `DIRECTED`, exact server-owned source/target resource roles are included because `relatedResourceRefs` are normalized as set-like fingerprint input and cannot preserve direction by themselves.

For `UNDIRECTED`, source/target authority is not added; endpoint identity remains represented by `relatedResourceRefs`.

Only server-authorized `validFrom`/`validTo` values participate in temporal identity. Free-form temporal descriptions do not.

`proposedRelationType` is excluded. Until a server-owned canonical relation-type vocabulary is separately approved, alternate free-form relation labels over the same structural relation identity intentionally collapse to one V1 fingerprint.

### 7. Pattern Hypothesis semantic essence

For `PATTERN_HYPOTHESIS`, the projection is equivalent to:

```text
{
  essenceVersion: "discovery-semantic-essence:v1",
  findingType: "PATTERN_HYPOTHESIS",
  patternKind: "CLUSTER" | "TREND" | "RECURRING_ASSOCIATION" | "TEMPORAL_CHANGE"
}
```

Member identity remains represented by `relatedResourceRefs`.

`patternIdentity` and `patternStatement` are excluded. For one member set and one `patternKind`, alternate model-generated names or statements intentionally collapse to the same V1 semantic identity.

### 8. Conflict Hypothesis semantic essence

For `CONFLICT_HYPOTHESIS`, the projection is equivalent to:

```text
{
  essenceVersion: "discovery-semantic-essence:v1",
  findingType: "CONFLICT_HYPOTHESIS",
  contradictionKind: "FACTUAL" | "TEMPORAL" | "IDENTITY" | "MODEL_DISAGREEMENT"
}
```

Participant identity remains represented by `relatedResourceRefs`.

`possibleContradiction`, incompatibility signal IDs, evidence IDs and semantic similarity are excluded.

`contradictionKind` remains deterministic WP2 authority and is not model-owned.

### 9. Existing WP1 gap identity is preserved

The existing WP1 semantic-essence rules for:

- `KNOWLEDGE_GAP`;
- `EVIDENCE_GAP`

remain authoritative and unchanged.

ADR-149 extends the missing semantic-identity rule for WP3-derived types and does not retroactively alter existing deterministic gap fingerprints.

### 10. Follow-up origin identity

Clarification and Action generation require a server-owned upstream semantic identity equivalent to:

```text
DiscoveryFollowUpOriginIdentityV1 {
  schemaVersion: "1.0.0"
  originFindingType:
    "KNOWLEDGE_GAP"
    | "EVIDENCE_GAP"
    | "RELATION_HYPOTHESIS"
    | "PATTERN_HYPOTHESIS"
    | "CONFLICT_HYPOTHESIS"
  fingerprintVersion: "discovery-fingerprint:v1"
  fingerprint: "sha256:<64 lowercase hex>"
}
```

The origin fingerprint is server-computed. The browser and model cannot supply or alter it as authority.

If the origin is a valid durable Discovery finding, reuse its verified V1 fingerprint. If the origin is still pre-persistence, derive its semantic essence under this ADR and invoke the existing V1 fingerprint authority without persisting the origin.

For WP1 gap origins, use the existing WP1 semantic essence. For WP3 hypothesis origins, use the Relation, Pattern or Conflict projection defined above.

Do not use model prose, run ID, semantic generation ID, selector digest or AI input digest as origin identity.

### 11. Qualified follow-up context

The server-owned qualified follow-up context carries the exact `originIdentity` before provider invocation.

Allowed origin types are exactly:

- KNOWLEDGE_GAP;
- EVIDENCE_GAP;
- RELATION_HYPOTHESIS;
- PATTERN_HYPOTHESIS;
- CONFLICT_HYPOTHESIS.

`CLARIFICATION_QUESTION` and `ACTION_SUGGESTION` remain forbidden recursive origins.

### 12. Clarification Question semantic essence

For `CLARIFICATION_QUESTION`, the projection is equivalent to:

```text
{
  essenceVersion: "discovery-semantic-essence:v1",
  findingType: "CLARIFICATION_QUESTION",
  origin: {
    findingType,
    fingerprintVersion,
    fingerprint
  }
}
```

The target resource set remains represented by `relatedResourceRefs`.

Generated question wording is excluded. Paraphrased clarification questions from the same semantic origin and the same target resource set intentionally collapse to one V1 finding identity.

### 13. Action Suggestion semantic essence

For `ACTION_SUGGESTION`, the projection is equivalent to:

```text
{
  essenceVersion: "discovery-semantic-essence:v1",
  findingType: "ACTION_SUGGESTION",
  origin: {
    findingType,
    fingerprintVersion,
    fingerprint
  }
}
```

Affected resource identity remains represented by `relatedResourceRefs`.

`suggestedAction`, `rationale`, `riskContext` and `executionStatus` are excluded from semantic identity.

`executionStatus` remains structurally forced to `CANDIDATE_ONLY`; it is not fingerprint authority.

Alternate model wording for the same semantic origin and affected resource set intentionally collapses to one V1 finding identity.

### 14. Fail closed

If the server cannot derive the required semantic essence deterministically, it must not create a fingerprint or materialize a publish-ready envelope.

At minimum, fail closed for:

- missing directed Relation endpoint roles;
- invalid Pattern kind;
- missing deterministic Conflict contradiction kind;
- missing or invalid follow-up origin fingerprint;
- unsupported semantic-essence version.

There is no fallback to model prose.

## Consequences

### Positive

- `discovery-fingerprint:v1` remains stable.
- AI wording cannot manufacture new semantic identities through paraphrase.
- Provider/model/run/provenance changes do not alter logical finding identity.
- Relation direction and bounded temporal semantics remain distinguishable where structurally necessary.
- Follow-up findings are tied to a server-computed upstream semantic identity without recursive AI authority.
- WP4 can deterministically bridge WP3 proposals to the common quality gate while remaining pre-persistence.

### Intentional V1 limitations

- Free-form Relation labels are not separate fingerprint identities.
- Pattern names/statements are not separate fingerprint identities.
- Conflict explanation wording is not separate fingerprint identity.
- Clarification and Action paraphrases over the same origin/resource set collapse.

These are deliberate V1 deduplication choices. Refining them requires a future explicit architecture decision rather than silent fingerprint drift.

## Rejected alternatives

1. **Hash the complete AI payload** — rejected because model wording would become identity authority.
2. **Use model/provider/run provenance as semantic identity** — rejected because execution mechanics are not knowledge semantics.
3. **Reuse semanticGenerationId or selector inputDigest** — rejected because those identify generation/input execution, not final semantic meaning.
4. **Create discovery-fingerprint:v2 during WP4** — rejected because no algorithm change is required.
5. **Reuse WP1 gap semantic essence for all finding types** — rejected because WP1 gap semantics do not represent Relation/Pattern/Conflict/follow-up identity.

## Implementation constraints

AKP-3 WP4 may implement this ADR only as part of the already-authorized Product-path correction. It must continue to preserve:

- one accepted fingerprint authority;
- no durable finding save or lifecycle transition in WP4;
- no executable Action authority;
- no AKP-4 scheduler/runtime leakage;
- no AKP-7 adaptive suppression/ranking policy.

## Validation evidence required

Focused tests must establish at minimum:

1. identical semantic identity produces identical semantic essence;
2. execution/provenance changes alone do not change it;
3. evidence changes alone do not change it;
4. model wording changes alone do not change it;
5. resource-set changes alter final fingerprint through `relatedResourceRefs`;
6. reversing a directed Relation changes identity;
7. undirected endpoint order does not;
8. Relation temporal bounds affect identity while free-form temporal description does not;
9. free-form proposedRelationType does not affect identity;
10. Pattern kind affects identity while free-form Pattern wording does not;
11. Conflict kind affects identity while explanation wording does not;
12. follow-up wording does not affect identity for the same origin/resource set;
13. changing origin fingerprint changes follow-up identity;
14. recursive follow-up origin is rejected.
