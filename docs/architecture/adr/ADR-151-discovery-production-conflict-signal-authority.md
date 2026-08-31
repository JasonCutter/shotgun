# ADR-151 — Discovery Production Conflict Signal Authority

- Status: **PROPOSED / USER APPROVAL PENDING**
- Proposed at: 2026-09-01
- Decision date: **PENDING**
- Accepted at: **PENDING**
- Accepted by: **PENDING**
- Decision owner: `USER`
- Work item: `AKP-8 WP2R — Production Conflict Signal Authority Remediation`
- Subject base: `main@0077ddc90efe4b3756cce66ad31bbc021c49395b`
- Related ADRs: ADR-136, ADR-137, ADR-138, ADR-139, ADR-142, ADR-149, ADR-150
- Product implementation: **NOT_AUTHORIZED PENDING THIS DECISION**

## Context

AKP-8 WP2 stopped before implementing acceptance tests because the frozen
ADR-142 E2E-M journey requires a real production `CONFLICT_HYPOTHESIS` path,
while the canonical composition exposes no production authority that supplies
the typed incompatibility signal consumed by the existing Discovery selector.

The existing ports and downstream safety gates are present, but the current
production assembly leaves `competingResource` and
`existingCanonicalConflict` optional. The WP2R Phase A audit found no safe
existing source that can be exposed through those ports without introducing a
new incompatibility comparator or reconstructing typed participants from
lossy/free-form projections.

This proposal does not amend ADR-142, weaken E2E-M, or authorize an
implementation. It records the architecture decision required before the
missing authority may be created.

## Audit conclusion

| Frozen mapping                                    | Existing candidate source                                                                                         | Why it is not currently sufficient                                                                                                                                                                                                   | Verdict                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `FACTUAL` → `TYPED_PROPOSITION`                   | Approved `RelationCandidate` payloads returned by `PostgresKnowledgeModelRepository.listApprovedItems(projectId)` | `fromCandidateId`, `toCandidateId`, and `relationType` are retained, but no accepted production rule declares which typed relation values are incompatible. `CanonicalClaim` retains only `claimText`.                               | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `TEMPORAL` → `TEMPORAL_QUALIFICATION`             | Approved relation `validFrom`/`validTo` and `temporalEvidenceIds`; Compiled Truth temporal state                  | The values and evidence are retained, but no current production authority defines temporal incompatibility or an overlap rule. Compiled Truth `CURRENT`/`PAST`/`FUTURE`/`CONFLICT` state is not a temporal qualification comparator. | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `IDENTITY` → `IDENTITY_ASSIGNMENT`                | `EntityCandidate.resolution` (`NEW`, `EXACT_MATCH`, `POSSIBLY_SAME`)                                              | The current candidate field does not provide a deterministic conflicting assignment pair or a production identity-conflict reader. Treating differing names or resolution values as conflict would invent identity semantics.        | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |
| `MODEL_DISAGREEMENT` → `EXPLICIT_CONFLICT_SIGNAL` | `ModelAssessment` and `modelDisagreementView()`                                                                   | Multiple model output strings are a read view, not an explicit incompatibility authority. Model disagreement cannot be inferred from provider output, wording, or count.                                                             | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |

The separate `DiscoveryExistingCanonicalConflictPortV1` audit has the same
boundary. `ConflictCandidate` is an approved Knowledge Review candidate in
`knowledge.review_groups`, not a Canonical Conflict. The Knowledge Model
manifest explicitly has `canWriteCanonical: false`. `ConflictProposalValueV1`
is Draft data, and the current Frontend Draft → Canonical path persists a
`CanonicalClaim` with free-form `claimText`; it does not preserve typed conflict
participants for a Canonical conflict reader. Participant identities must not
be reconstructed from labels or claim text.

## Proposed decision

Before any production implementation, approve a single server-owned authority
for typed incompatibility. The authority must be a persisted or otherwise
explicitly governed source with a versioned contract; it must not be a
heuristic derived from semantic retrieval, labels, model output, ranking,
feedback, missing graph edges, or absence of a Canonical Conflict.

The approved authority must define, at minimum:

1. The owner and lifecycle of incompatibility truth.
2. The persisted data it reads for each supported mapping.
3. Exact participant identity resolution and duplicate/known-conflict behavior.
4. Project binding, restrictive common access scope, highest effective
   sensitivity, Canonical base, Discovery base, and source projection binding.
5. Required Evidence and provenance, including stable server-owned signal IDs.
6. The semantics for typed propositions, temporal qualifications, identity
   assignments, and explicit model-disagreement signals; unsupported mappings
   must remain unavailable rather than guessed.
7. Completeness and unavailable-source behavior, including fail-closed
   semantics for incomplete authority.
8. Versioning, migration, adapter replacement, and rollback consequences.
9. A future re-evaluation path that does not rewrite historical findings or
   silently promote a Discovery finding to Canonical truth.

Once approved, the narrowest implementation may expose only the mappings whose
authority is actually available through the existing
`DiscoveryCompetingResourcePortV1` boundary. The existing
`DiscoveryExistingCanonicalConflictPortV1` remains a separate duplicate/known
conflict guard and cannot substitute for new competing-resource detection.

## Explicitly not proposed

- No semantic-similarity, label, string-inequality, date-overlap, ranking or
  model-confidence comparator.
- No parsing of `CompiledTruthItem.label` or `CanonicalClaim.claimText` to
  recover typed participants.
- No promotion of `ConflictCandidate`, Draft conflict data, or a Discovery
  finding into Canonical truth.
- No change to the four frozen mapping identities.
- No weakening or removal of ADR-142 E2E-M.

## Security and ownership boundary

The future reader must consume only project-authorized data and compose
multi-resource access using the restrictive common audience and highest
effective sensitivity. Cross-project pairs must fail closed without disclosing
resource existence. Evidence and provenance remain owned by their existing
Shotgun authorities; the future reader may expose bounded references but may
not manufacture Evidence, Facts, Claims, or Canonical state.

## Consequences and rollback

Until this proposal is approved, there is no production conflict reader and
Discovery remains safely degraded for unsupported conflict signal classes. No
rollback is needed for the audit-only state. A future implementation must be
disable-able at the adapter/assembly boundary, preserve existing Canonical and
finding history, and leave unsupported mappings fail-closed during rollback.

## Approval gate

This ADR remains **PROPOSED / USER APPROVAL PENDING**. It must not be marked
accepted by the WP2R implementation branch. After approval, GPT must issue a
bounded implementation request that names the approved source, migration
decision, contract tests, and rollback plan. Only then may WP2R Product work
resume; WP2 must remain blocked until the remediation is canonical, and WP3
must not start.
