# ADR-148 — AKP-1 Semantic Runtime Authority Unification

- Status: **ACCEPTED**
- Proposed at: 2026-08-19
- Decision date: 2026-08-19
- Accepted at: 2026-08-19
- Accepted by: `USER`
- Decision owner: user
- Program: `AKP — Active Knowledge Productization v1`
- Section: `AKP-1 — Hybrid Semantic Retrieval`
- Subject base: `main@3ea9a8ec5aada6f026b8cccd8b72cdc3bae677a5`
- Related ADRs: ADR-133, ADR-135, ADR-144, ADR-147
- Relationship to ADR-135: **IMPLEMENTATION-MECHANICS REFINEMENT; ADR-135 CORE ARCHITECTURE REMAINS ACCEPTED**
- Product implementation: **AUTHORIZED FOR AKP-1R REPAIR ONLY**

## Context

AKP-1 WP1 through WP3 were merged and WP4 reached a Draft implementation, but a cross-WP audit found that the individually tested components do not yet form one operational semantic sensor. The upper AKP architecture remains correct: semantic retrieval is a rebuildable derived projection, Canonical remains authority, lexical search remains independently usable, citation lineage is preserved, and semantic similarity is never truth confidence.

The implementation defect is in runtime authority composition. The existing code can resolve an embedding profile, persist vectors, retrieve semantic neighbors, fuse lexical and semantic results, and manage a candidate generation, but the following concerns are not yet unified into one production authority chain:

1. durable SemanticEmbeddingProfile revision authority;
2. exact provider/model/credential/privacy execution authority;
3. actual provider embedding execution;
4. coherent source-corpus snapshot authority;
5. generation build/validation/activation lifecycle;
6. query-time stale/readiness authority;
7. provenance authority in Hybrid results.

The audit also found concrete cross-WP contradictions: WP4 generation build asks the WP1 resolver for `restricted` execution even though external restricted egress is denied; query clearance is confused with query payload classification; new profile activation can retire the profile still pinned by the currently active generation; production startup does not create a real semantic lifecycle or real external embedding path; and the generation membership validation compares in-memory intent rather than the persisted candidate generation.

This ADR corrects those mechanics without changing the AKP philosophy or creating a new Knowledge Flow phase.

## Decision

AKP-1 will be repaired as one bounded cross-WP runtime unit named **AKP-1R — Cross-WP Semantic Runtime Repair**. The previous WP1–WP4 implementation sequence is not used as the remaining implementation authority. The replacement implementation plan and detailed design are the canonical implementation instructions for this repair.

### 1. Active generation is the Product retrieval authority

The Product semantic query path resolves the currently active semantic generation first. That generation pins the exact embedding profile revision, provider, model, credential revision, representation version, dimension and build-time audit identity that produced its vectors.

A mutable "currently active embedding profile" must never silently reinterpret an already-active generation. Query compatibility is validated against the generation's exact immutable pin.

### 2. SemanticEmbeddingProfile is durable, project-scoped and revisioned

SemanticEmbeddingProfile revisions are persisted in PostgreSQL. A profile revision is immutable configuration for a generation build target. It is independent from Ask `ProjectAIConfiguration`.

A profile revision may be prepared while another generation remains active. Preparing a new profile must not retire or invalidate the profile used by the current active generation.

The profile lifecycle therefore represents configuration readiness/history, not Product retrieval cutover. Product cutover occurs only through the semantic generation pointer.

### 3. Build targets an explicit profile revision

`BuildGeneration` must resolve an explicit target profile revision. It may not infer a new build target from a mutable latest/active profile when that would change Product execution authority before the generation is ready.

Side-by-side transition is:

```text
G1(profile P1) ACTIVE
P2 prepared
G2(profile P2) BUILDING
G2 persisted and validated
G2 READY
atomic pointer switch
G2 ACTIVE / G1 retained as bounded LKG
```

G1 remains queryable until the generation switch succeeds.

### 4. Resolver decision and provider execution are one bounded authority chain

Production semantic embedding execution follows the ADR-133 pattern:

```text
exact semantic execution pin
  -> SemanticEmbeddingRouter
  -> CredentialVault.withCredential(exact revision)
  -> provider embedding connectivity
  -> validated embedding result
```

The normal Product path must not use `DeterministicFakeEmbeddingAdapter` and must not keep a static production execution adapter that can diverge from the resolved pin.

At least one real external embedding provider adapter must be operational before AKP-1 final closure. Fake connectivity is allowed in deterministic tests at the provider-network boundary.

### 5. Current eligibility and historical build audit are separate

A generation records immutable build-time audit identity, including the policy inputs used when its vectors were produced. Query-time provider/privacy/credential eligibility is reevaluated independently.

A harmless current policy revision change must not reinterpret vector meaning or force a generation mismatch solely because an audit fingerprint string changed. Conversely, a revoked credential or newly denied egress must block new provider execution without deleting or corrupting the persisted generation.

### 6. Caller clearance and query payload classification are separate

`SecurityContext.sensitivity`/caller clearance determines which resources the caller may receive. It is not automatically the classification of the user's query text for external egress.

Query embedding uses a server-owned query egress classification policy. The Browser cannot supply a sensitivity label as proof. Restricted external egress remains denied where ADR-133/ADR-135 require it.

### 7. Corpus build uses one coherent source snapshot authority

Semantic generation membership is derived from one coherent server-owned source snapshot containing the exact Canonical base plus approved Product-eligible knowledge state. Independent reads from different moments must not be silently combined into one authoritative corpus.

Compiled Truth may be used only as a derived enrichment when its readiness and source snapshot identity match the exact source snapshot being built. Stale or mismatched Compiled Truth cannot become corpus authority and cannot resurrect deleted Canonical Claims.

Product-eligible semantic resource types remain exactly:

```text
CLAIM, ENTITY, RELATION, EVENT, DECISION
```

`FACT` remains reserved/deferred under ADR-147.

### 8. Representation is single-path and provenance-aware

All Product-eligible resources use one versioned SemanticRepresentationBuilder path. Relation/Event/Decision representations include human-semantic labels for referenced entities/participants/actors while retaining stable IDs for provenance.

Stable representation input dependencies participate in invalidation. A referenced label/alias change that changes semantic meaning must change the dependent representation identity.

### 9. Vector payload identity and membership/security identity are distinct

Vector reuse is allowed only when semantic payload identity is unchanged:

```text
semanticTextDigest + representationVersion + embedding profile/model/dimension
```

Membership/security identity additionally includes resource identity, source base, evidence, access scope and sensitivity.

A security/evidence-only change creates a new generation membership item but may reuse the locally persisted vector without external re-embedding when the semantic payload identity is unchanged. Reuse must never weaken current security filtering.

### 10. Candidate generation is validated from persisted state

A candidate generation becomes READY only after its persisted membership is read back or summarized by the repository and proven logically equivalent to the exact target corpus.

The validation identity includes resource type/id, source/base identity, semantic text digest, evidence identity, normalized access scopes, sensitivity, representation version and profile identity. Row order and timestamps do not affect equivalence.

The adapter also enforces item-to-generation binding, including `sourceProjectionDigest`/source snapshot identity.

### 11. Activation uses explicit CAS for existing and first pointer creation

Generation activation requires an explicit expectation:

```text
NONE
```

for first activation, or the exact current active generation plus pointer revision for replacement activation. Concurrent first activation and concurrent replacement activation both produce a typed `CONFLICT` for the loser. A valid READY losing candidate remains READY rather than being rewritten to FAILED.

### 12. Readiness separates data state from execution capability

Internal readiness distinguishes at least:

- data state: `NOT_BUILT`, `BUILDING`, `READY`, `STALE`, `FAILED`;
- execution capability: `READY`, `NOT_CONFIGURED`, `POLICY_BLOCKED`, `PROVIDER_UNAVAILABLE`, `CREDENTIAL_UNAVAILABLE`.

A healthy persisted generation is not marked FAILED merely because current provider execution is temporarily unavailable. Lexical retrieval remains independently usable.

The public Hybrid contract may project these internal states into a bounded compatible Product status, but TypeScript and JSON schema must agree.

### 13. Query stale check is O(1)-style source-watermark comparison

Normal semantic queries must not rebuild the entire corpus merely to decide staleness. The Product query path compares the active generation's exact source snapshot identity with a cheap current source watermark/digest authority. Full corpus construction is reserved for build/rebuild work.

Known STALE state fails before query embedding and before vector Top-K.

### 14. Hybrid results preserve knowledge authority/provenance

Hybrid results explicitly identify whether the authoritative resource came from `CANONICAL`, `APPROVED_KNOWLEDGE`, or an allowed `COMPILED_TRUTH` projection, together with the relevant revision/base/source projection identity. A Canonical resource version is not conflated with a projection base version.

Citation lineage remains Knowledge -> EvidenceSpan -> SourceVersion. Similarity/fusion scores remain retrieval scores only.

### 15. Production owns an operational refresh path

AKP-1 is not complete when the lifecycle exists only as directly-instantiated test classes. The Product/server composition must own a real semantic runtime that can:

- resolve durable profile configuration;
- build/rebuild a candidate generation;
- validate and activate it;
- expose readiness;
- keep lexical service usable on semantic failure;
- respond to an explicit server-owned refresh trigger. Canonical-triggered proactive Discovery remains AKP-4, but AKP-1 must have an operational semantic refresh/rebuild boundary before AKP-2/3 depend on it.

## Rejected alternatives

- Rewriting the entire AKP program: rejected because AKP-2 through AKP-8 architecture remains correct and depends only on a trustworthy semantic sensor.
- Treating the newest profile as Product retrieval authority: rejected because it breaks side-by-side generation safety.
- Browser-selected profile/generation/sensitivity: rejected because authority must remain server-owned.
- Static production fake embeddings: rejected because they do not implement semantic capability.
- Full-corpus recomputation on every query: rejected because readiness must remain operational at project scale.
- Re-embedding unchanged semantic text solely because evidence/access scope changed: rejected because it adds cost/egress without changing vector meaning.
- Using stale Compiled Truth as corpus fallback: rejected because a derived projection cannot silently become authority for a newer source state.
- Hiding the old implementation history by rewriting Git history: rejected. Obsolete current-tree implementation instructions may be replaced/deleted, while Git/ADR history remains auditable.

## Consequences

AKP-1 implementation becomes a smaller number of stronger production authorities rather than many independently mocked components. Some WP1–WP4 code will be reused, some will be deleted, and some will be rewritten. The repair intentionally prefers one end-to-end runtime chain over preserving obsolete interfaces.

AKP-2 and later Sections remain blocked until AKP-1R is complete and the existing AKP-1 quality/security/performance closure passes.

## Implementation sequence

The authorized repair sequence is:

```text
R0 — Contract/plan/design replacement
R1 — Durable profile + execution router
R2 — coherent corpus snapshot + representation v2
R3 — generation builder/persisted validation/CAS/lifecycle
R4 — Product composition + operational refresh path
R5 — cross-WP production-chain proof
WP5 — existing AKP-1 Golden Query/security/privacy/performance closure
```

Only one Repair Work Package is advanced at a time. Ready, merge, deployment, Production Verification and AKP-2+ remain separately unauthorized.
