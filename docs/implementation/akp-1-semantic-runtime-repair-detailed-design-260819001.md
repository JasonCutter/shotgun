# AKP-1R — Semantic Runtime Repair Detailed Design

- Status: **ACCEPTED / IMPLEMENTATION AUTHORITY**
- Program: `AKP — Active Knowledge Productization v1`
- Section: `AKP-1 — Hybrid Semantic Retrieval`
- Repair: `AKP-1R — Cross-WP Semantic Runtime Repair`
- Base: `main@3ea9a8ec5aada6f026b8cccd8b72cdc3bae677a5`
- Governing ADRs: ADR-133, ADR-135, ADR-147, ADR-148
- Implementation plan: `docs/implementation/akp-1-hybrid-semantic-retrieval-implementation-request-260818001.md`

## 1. Design goal

The repaired AKP-1 runtime has exactly one production authority path for semantic generation and query execution. Tests may replace the provider network boundary, clock and persistence adapters, but they must not replace the semantic authority decisions being tested.

The target runtime is:

```text
SemanticEmbeddingProfileRepository (durable)
  -> SemanticEmbeddingProfileService
  -> SemanticEmbeddingAuthorityResolver
  -> SemanticEmbeddingRouter
       -> CredentialVault.withCredential()
       -> ProviderEmbeddingConnectivity
  -> SemanticCorpusSourceSnapshotReader
  -> SemanticGenerationBuilder / LifecycleCoordinator
  -> SemanticIndexRepository
  -> SemanticGenerationPointer
  -> SemanticSourceWatermarkReader
  -> SemanticRetriever
  -> HybridRetrievalCoordinator
  -> EvidenceSpan / SourceVersion / Knowledge authority validation
```

## 2. R1 detailed design — durable profile and embedding execution

### 2.1 Profile persistence model

Persist immutable revisions in a semantic-owned table. Minimum logical fields:

```text
project_id
profile_id
profile_revision
provider_id
embedding_model_id
credential_id
credential_revision
representation_version
dimension
distance_metric
normalization_policy
status
created_at
created_by
updated_at
updated_by
```

Allowed status meaning for repair:

- `PREPARED`: valid configuration revision available for a generation build;
- `FAILED`: configuration revision rejected/failed validation and cannot be used for a new build;
- `RETIRED`: no longer a desired build target, retained for history because a retained generation may still reference it.

Do not use `ACTIVE` profile as Product query cutover authority. If compatibility requires retaining the enum temporarily, Product query logic must not use it to reinterpret an active generation. New code should prefer explicit `getBuildTargetRevision` / `getRevision` semantics.

A unique project revision constraint enforces linear profile revision history. `profile_id` is stable per revision record identity and is never Browser authority.

### 2.2 Profile creation

Profile creation validates:

- project ID;
- registered semantic provider/model;
- model-supported dimension/distance/normalization;
- exact credential metadata belongs to project/provider and is active at creation time;
- representation version is supported;
- expected current profile revision CAS.

Creation persists `PREPARED`. It does not mutate the semantic generation pointer and does not retire the profile referenced by the active generation.

### 2.3 Execution authority types

Split the current concerns into:

```text
SemanticEmbeddingBuildPin
SemanticEmbeddingQueryAuthorization
SemanticEmbeddingInvocation
```

`SemanticEmbeddingBuildPin` is immutable audit identity stored with a generation. It includes provider/model/profile/credential revisions, capability revisions, representation version, dimension and build policy audit fingerprint.

`SemanticEmbeddingQueryAuthorization` is a current decision made immediately before external query embedding. It answers whether this query payload may use the provider/credential pinned by the active generation now. It is not required to reproduce the old build fingerprint byte-for-byte.

`SemanticEmbeddingInvocation` is passed to the router and contains the exact immutable pin plus classified payload. It contains no plaintext secret.

### 2.4 Query payload classification

Introduce a server-owned `SemanticQueryClassificationPort` or equivalent policy.

Inputs may include:

- project;
- trusted actor/security context;
- query text;
- selected search surface.

Output is the egress sensitivity/classification used only for provider privacy evaluation. It is never accepted directly from Browser authority.

For v1 the implementation may use a deterministic conservative policy. The important invariant is that caller clearance and payload classification are distinct variables.

### 2.5 Router

`SemanticEmbeddingRouter` receives an exact pin and payload. It:

1. verifies provider/model route exists;
2. checks current provider registry/capability availability;
3. verifies current privacy/deployment eligibility for the classified payload;
4. invokes `CredentialVault.withCredential()` for the exact project/provider/credential/revision;
5. passes the secret only to provider connectivity inside the vault callback;
6. validates returned provider/model/dimension;
7. zeroizes transient legacy buffers where applicable;
8. maps provider errors to semantic typed errors.

No router method returns plaintext secret. No resolver returns `credentialSecret`.

### 2.6 Provider connectivity

Add provider-specific embedding connectivity behind a small port:

```text
embed({ modelId, input, dimension?, apiKey, signal? })
embedBatch(...)
```

The domain/router owns identity and policy; connectivity owns HTTP/provider protocol only.

OpenAI embedding connectivity is the first required concrete runtime adapter. It must use the model already accepted in the semantic catalog and must not reuse structured-generation request contracts.

Test doubles replace connectivity, not the resolver/router/vault chain.

## 3. R2 detailed design — coherent corpus source snapshot

### 3.1 Source snapshot authority

Introduce a source-level snapshot object separate from the final vector corpus:

```text
SemanticCorpusSourceSnapshot {
  projectId
  canonicalVersion
  canonicalSnapshotDigest
  approvedKnowledgeDigest
  sourceSnapshotDigest
  effectiveAt
  resources[]
}
```

Each resource includes:

```text
resourceType
resourceId
authority
resourceRevision/base identity
sourceVersionId?
evidenceIds
accessScope
sensitivity
typed semantic source data
```

Authority enum:

```text
CANONICAL
APPROVED_KNOWLEDGE
COMPILED_TRUTH
```

`COMPILED_TRUTH` is allowed only as exact-match enrichment and never as a substitute for a missing Canonical Claim.

### 3.2 Coherent PostgreSQL read

Production implementation should use a transaction or equivalent snapshot-consistent adapter so Canonical snapshot, Canonical Claim records and approved Knowledge groups are read from one coherent database view.

The adapter computes `sourceSnapshotDigest` from stable source identities, not read timestamps.

### 3.3 Compiled Truth rule

Use Compiled Truth only when all are true:

- projection status READY;
- projection canonical version equals source snapshot Canonical version;
- projection source snapshot digest equals the exact expected source digest;
- resource is Product-eligible;
- underlying Canonical/Approved authority remains resolvable.

Otherwise ignore it for corpus construction and expose it only through its normal independent Product projection path.

### 3.4 Semantic Representation v2

Create a new representation version rather than silently changing v1 output.

Recommended v2 payloads:

**Claim**

```text
resource_type: CLAIM
statement: <claim text>
subject_name: <resolved label when authoritative and available>
stable_subject_ref: <id when available>
```

**Entity**

```text
resource_type: ENTITY
entity_type: <kind>
name: <name>
aliases: <sorted aliases>
```

**Relation**

```text
resource_type: RELATION
relation_type: <type>
from_name: <human label>
to_name: <human label>
stable_from_ref: <id>
stable_to_ref: <id>
direction: <...>
valid_from / valid_to when present
```

**Event**

```text
resource_type: EVENT
event_type: <type>
title: <title>
subject_name / stable_subject_ref
participant_names / stable_participant_refs
occurred_at
```

**Decision**

```text
resource_type: DECISION
decision_type: <type>
decision: <text>
actor_name / stable_actor_ref
```

All collections use deterministic UTF-16 ordinal ordering. No `localeCompare` in logical digests/tie-breaks.

### 3.5 Dependency invalidation

The corpus source adapter records representation dependencies. If an Entity label/alias changes, Relations/Events/Decisions whose semantic v2 text includes that label must obtain a new semanticTextDigest even when their own stable IDs are unchanged.

## 4. R3 detailed design — vector payload and membership lifecycle

### 4.1 Separate identities

Define:

```text
VectorPayloadIdentity =
  semanticTextDigest
  + representationVersion
  + providerId/modelId/profileRevision
  + dimension/normalization

MembershipIdentity =
  resourceType/resourceId
  + sourceSnapshotDigest/base identity
  + semanticTextDigest
  + evidenceIds
  + accessScope
  + sensitivity
  + authority/revision provenance
```

Only VectorPayloadIdentity controls external re-embedding. MembershipIdentity controls active generation correctness.

### 4.2 Build algorithm

1. capture active pointer expectation;
2. read exact source snapshot;
3. resolve explicit target profile revision;
4. validate build execution eligibility per resource/payload classification policy;
5. create BUILDING candidate generation;
6. build v2 representations;
7. for each item, attempt local vector reuse from the active generation only when VectorPayloadIdentity matches;
8. batch remaining embedding work by compatible provider/model/dimension/classification constraints;
9. persist candidate items atomically/bounded batches;
10. query repository for persisted membership summary;
11. compare persisted membership digest/count with target source corpus membership digest/count;
12. mark READY only on exact match;
13. recheck source watermark before activation; if source advanced, leave candidate READY-or-STALE according to implementation policy but do not activate it as current;
14. perform pointer CAS;
15. on pointer conflict, keep valid candidate READY.

### 4.3 Persisted membership summary

Repository port must expose a bounded identity-only operation such as:

```text
readGenerationMembershipSummary(projectId, generationId)
```

returning deterministic ordered/count/digest information without loading every vector payload.

The digest must include authority/provenance and security identity, not timestamps or vector floating-point bytes.

### 4.4 Adapter invariants

`SemanticIndexRepository` rejects item write if any generation-bound field mismatches, including:

- project/generation;
- source snapshot/projection digest;
- embedding profile ID/revision;
- representation version;
- provider/model where stored on item identity;
- dimension;
- normalization requirements.

Project isolation remains enforced in every query.

### 4.5 Pointer CAS

Represent first activation explicitly. Avoid an optional-argument API where `undefined`, `null`, `0` and missing pointer overlap semantically.

Preferred contract:

```text
expectedPointer:
  { kind: 'NONE' }
  or
  { kind: 'EXISTING', activeGenerationId, pointerRevision }
```

PostgreSQL implementation must convert concurrent first insert unique collision into semantic `CONFLICT` and leave the losing generation READY.

### 4.6 Rollback

Rollback is a pointer operation only after checking target generation compatibility with current source watermark and current execution requirements. A stale target may be selected only into an explicitly degraded/stale state if diagnostics require it; it must not be advertised READY merely because it is LKG.

## 5. R4 detailed design — Product runtime composition

### 5.1 Normal startup construction

`startShotgunApplication` owns default construction of:

- PostgreSQL profile repository/service;
- semantic embedding model registry;
- semantic authority resolver;
- semantic query classification policy;
- semantic provider embedding connectivity registry/router;
- PostgreSQL semantic index/lifecycle repository;
- source snapshot reader + source watermark reader;
- lifecycle coordinator;
- semantic retriever;
- hybrid coordinator.

Tests may override these through bounded options, but undefined normal options must not result in an accidentally lexical-only Product merely because semantic objects were never constructed.

If semantic prerequisites such as credential/profile are not configured, Product returns `NOT_CONFIGURED`/execution-unavailable while lexical remains healthy.

### 5.2 Operational refresh boundary

Add a server-owned command/service such as `RefreshSemanticProjection` with Browser payload that does not contain generation/profile/provider/credential authority. Server resolves the configured desired profile revision and current project authority.

The refresh boundary may be invoked manually/administratively in AKP-1. Automatic Canonical-triggered active Discovery scheduling remains AKP-4.

### 5.3 Query path

Query sequence:

1. trusted Project/security context;
2. lexical retrieval;
3. read active semantic generation;
4. cheap current source watermark comparison;
5. if STALE: semantic stops, no query embedding/Top-K;
6. classify query payload for egress;
7. authorize current execution against the active generation pin;
8. route query embedding through vault/router;
9. pgvector security-before-Top-K;
10. authoritative knowledge re-resolution;
11. evidence/source lineage validation;
12. deterministic fusion.

### 5.4 Hybrid result contract

Add explicit fields for semantic/knowledge authority without exposing provider secrets:

```text
authority: CANONICAL | APPROVED_KNOWLEDGE | COMPILED_TRUTH
authorityRevision / resourceRevision
baseCanonicalVersion
sourceProjectionDigest? / sourceSnapshotDigest?
```

A Canonical Claim may expose its Canonical version. An approved Entity/Relation/Event/Decision must not imply that the base Canonical version is its own Canonical resource version.

### 5.5 Readiness projection

Internal two-axis readiness is projected to the Product contract deterministically. JSON schema and TypeScript union must match exactly. Public reasons are sanitized and contain no credential/provider secret material.

## 6. R5 detailed design — cross-WP proof strategy

### 6.1 Test boundary policy

Do not mock:

- profile service logic;
- semantic authority resolver;
- privacy/deployment decision;
- CredentialVault callback semantics;
- lifecycle coordinator;
- source snapshot/readiness logic;
- Product composition.

May fake:

- provider HTTP connectivity response;
- clock;
- external network timing.

### 6.2 Primary integration fixture

Use PostgreSQL test database where available. Seed a real Project, credential metadata/vault record, profile revision, Canonical Claim/approved Knowledge/Evidence/SourceVersion. Build through the real lifecycle and then call `/search/hybrid` through normal application composition.

The test must reconstruct application/repositories to prove durable pointer/profile/generation survival.

### 6.3 Negative proof

Instrument provider connectivity and `findNearestNeighbors` counters. Known STALE and policy-denied paths must prove zero calls at the appropriate boundary.

## 7. Cleanup design

Delete obsolete code when replaced, rather than wrapping it indefinitely.

Expected cleanup candidates during R1–R4 include:

- in-memory active-profile assumptions used as production contract semantics;
- duplicated profile `ACTIVE` coupling if no longer needed;
- static semantic execution-port production wiring;
- whole-corpus readiness union/callback branches used only to support the superseded WP4 shape;
- string-parsed readiness fallback once typed readiness is authoritative;
- stale unmerged WP4 migration/code that is not reused by the repair;
- tests that only duplicate a stronger cross-WP proof and no longer protect a distinct invariant.

Keep in-memory adapters that are useful as faithful parity test adapters, but their contracts must match PostgreSQL semantics.

## 8. Security invariants

- Project scope is server-derived.
- Access scope and sensitivity filtering happen before semantic Top-K.
- Restricted external egress remains denied under governing provider policy.
- Query text is external egress and receives a server-owned classification decision.
- Raw query text is not globally logged or persisted by semantic runtime unless a separately accepted audit contract requires it.
- Raw vectors are not Product API data.
- Credentials never leave CredentialVault as generic plaintext values.
- Browser cannot select provider/model/profile/generation/credential/policy revision.

## 9. Canonical and epistemic invariants

- Semantic vectors are rebuildable derived projection data.
- Similarity/fusion scores are ranking signals only.
- FACT remains excluded from AKP-1 Product membership.
- AI output does not become Canonical automatically.
- Compiled Truth is derived and cannot resurrect deleted Canonical knowledge.
- Hybrid retrieval never weakens direct EvidenceSpan -> SourceVersion lineage.

## 10. Performance design

Before ANN adoption, remove avoidable O(project-size)-per-query work:

- source watermark read instead of full corpus rebuild at query time;
- batch provider embedding;
- local vector reuse when semantic payload unchanged;
- bounded/batched authoritative resource and evidence resolution where practical.

WP5 measures corpus size/latency. HNSW/IVFFlat is added only on measured need.

## 11. Migration plan

From canonical base `3ea9a8ec...`, choose the next free migration number on the repair branch.

Expected migration ownership:

- R1: durable semantic profile revision persistence;
- R3: durable active generation pointer/CAS constraints and any semantic generation schema hardening not already canonical.

If an unmerged Draft used the same migration number, its filename has no canonical ownership and may be replaced on this new branch.

## 12. Completion checkpoints

```text
R0: docs/contract/design authority replaced
R1: durable profile + bounded real execution path
R2: coherent provenance-aware corpus + representation v2
R3: persisted-safe generation lifecycle
R4: normal Product composition + refresh boundary
R5: real cross-WP chain proof
WP5: final AKP-1 quality/security/privacy/performance closure
```

AKP-2 remains blocked until AKP-1 is explicitly closed by the USER.