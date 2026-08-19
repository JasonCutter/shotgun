# AKP-1 Contract Amendment — Semantic Runtime Authority Unification

- Status: **ACCEPTED / FROZEN**
- Accepted at: 2026-08-19
- Accepted by: `USER`
- Governing ADR: ADR-148
- Amends: `akp-1-hybrid-semantic-retrieval-contract-snapshot-260818001.md`
- Preserves: ADR-135, ADR-147 and existing AKP1-AC-01 through AKP1-AC-12 intent
- Product implementation: **AUTHORIZED FOR AKP-1R ONLY**

## 1. Purpose

This amendment fixes implementation-discovered cross-WP gaps without redefining AKP-1's semantic purpose. It is additive/clarifying where possible and supersedes only implementation mechanics that conflict with ADR-148.

## 2. Frozen semantic runtime invariants

### AKP1R-C01 — Active generation authority

The active semantic generation is the Product query compatibility authority. A mutable/latest profile cannot reinterpret an active generation.

### AKP1R-C02 — Durable profile revisions

SemanticEmbeddingProfile revisions are durable, project-scoped and exact-build-target configuration. Preparing a new profile cannot invalidate the profile pinned by the current active generation.

### AKP1R-C03 — Exact bounded embedding execution

Production embedding invocation must consume an exact semantic execution pin and use the exact credential revision through CredentialVault bounded access. Resolver decision and provider execution cannot be independent authorities. The deterministic fake adapter is test-only in normal Product composition.

### AKP1R-C04 — Current eligibility separate from build audit

Historical build policy/audit identity is immutable generation metadata. Current query/build egress eligibility is reevaluated immediately before provider execution. A current authorization revision change alone does not change vector semantic identity.

### AKP1R-C05 — Query classification separate from caller clearance

Caller sensitivity clearance controls returned resource eligibility. External query-text classification is separately server-owned. Browser input is not authority for either provider policy or payload sensitivity.

### AKP1R-C06 — Coherent source snapshot

A semantic generation is built from one coherent server-owned Canonical + approved-knowledge source snapshot. Stale/mismatched Compiled Truth is not semantic corpus authority. Deleted/missing Canonical Claims cannot be resurrected by a derived projection.

### AKP1R-C07 — Product eligibility

Product semantic membership is exactly:

```text
CLAIM, ENTITY, RELATION, EVENT, DECISION
```

FACT remains excluded under ADR-147.

### AKP1R-C08 — Single representation path

All Product-eligible semantic resources use the versioned SemanticRepresentationBuilder. Representation v2 may enrich stable references with authoritative human-semantic labels/aliases. Dependency label changes that affect semantic text must invalidate dependent representation identity.

### AKP1R-C09 — Vector vs membership identity

External re-embedding depends on semantic payload/profile identity. Evidence, accessScope, sensitivity and source-base changes remain active-membership invalidators, but when semantic text/profile identity is unchanged the vector may be locally reused in the new candidate generation.

### AKP1R-C10 — Persisted candidate validation

READY requires validation of the persisted candidate generation, not only an in-memory intended list. Repository identity/readback proves exact logical membership count/digest against the target source snapshot.

### AKP1R-C11 — Item-generation binding

Repository persistence rejects semantic items whose source snapshot/projection identity, profile revision, representation version, dimension or other generation-bound identity does not match the referenced generation.

### AKP1R-C12 — Explicit first/replacement CAS

Activation distinguishes first-pointer `NONE` from existing-pointer exact expectation. Concurrent activation loser receives typed CONFLICT and a valid candidate remains READY.

### AKP1R-C13 — Stale before provider/vector work

Known STALE semantic state performs zero query embedding and zero vector Top-K. Healthy lexical retrieval remains usable.

### AKP1R-C14 — Query readiness does not rebuild corpus

Normal query freshness uses a cheap server-owned source watermark/digest authority. Full corpus construction is build/rebuild work, not per-query work.

### AKP1R-C15 — Readiness axes

Persisted semantic data readiness and current provider execution capability are distinct internal states. Temporary credential/provider/policy unavailability does not corrupt or falsely mark a valid persisted generation as build FAILED.

### AKP1R-C16 — Provenance-preserving Hybrid result

Hybrid results preserve knowledge authority/provenance: CANONICAL, APPROVED_KNOWLEDGE or permitted COMPILED_TRUTH. Projection base version is not mislabeled as a Canonical resource revision. EvidenceSpan -> SourceVersion citation authority remains required.

### AKP1R-C17 — Operational Product composition

Normal Product startup owns the semantic profile, resolver/router, lifecycle, index, source-readiness and retriever composition. Semantic functionality cannot require manual test-only object seeding. Missing configuration yields typed degraded/not-configured behavior while lexical remains usable.

### AKP1R-C18 — Operational refresh boundary

AKP-1 exposes a server-owned semantic refresh/rebuild boundary that resolves generation/profile/provider authority on the server. Browser cannot select generation/profile/pin. Automatic Discovery scheduling remains AKP-4.

### AKP1R-C19 — Provider operational requirement

Before AKP-1 final closure, at least one real external embedding connectivity adapter is operational through the bounded router/vault path. Deterministic fake embeddings alone do not satisfy AKP-1 final semantic capability.

### AKP1R-C20 — Cross-WP proof

AKP-1R completion requires a production-chain integration proof that uses real profile service, resolver, privacy authority, CredentialVault semantics, lifecycle, source snapshot logic, PostgreSQL persistence and Product composition. Only the external provider network may be replaced by a deterministic fake connectivity in this proof.

## 3. Required cross-WP scenarios

The repair must prove at minimum:

1. current active generation remains healthy while a different profile generation is BUILDING;
2. exact READY switch changes Product semantic authority only after successful CAS;
3. credential revocation blocks new provider execution without corrupting vector data and lexical retrieval;
4. same Canonical version plus changed approved/security/evidence source identity causes semantic STALE before query embedding/Top-K;
5. security/evidence-only membership change can reuse vector payload when semantic text/profile are unchanged;
6. concurrent first activation and replacement activation are conflict-safe;
7. stale Compiled Truth is excluded from corpus authority;
8. provider policy denial makes zero network calls;
9. Hybrid result retains authority + EvidenceSpan + SourceVersion lineage;
10. restart/reconstruction uses durable profile/generation/pointer;
11. FACT remains absent.

## 4. Superseded implementation assumptions

The following assumptions from the former implementation request are no longer authoritative:

- `SemanticEmbeddingProfile ACTIVE` as Product retrieval cutover;
- production static `SemanticEmbeddingExecutionPort` independent from an exact resolved pin;
- highest caller clearance as automatic query egress sensitivity;
- full corpus read as normal query stale check;
- in-memory candidate fingerprint as sufficient persisted generation validation;
- automatic re-embedding for every evidence/accessScope/sensitivity change regardless of semantic payload identity;
- manual dependency injection as sufficient Product semantic runtime composition.

## 5. Unchanged AKP-1 boundaries

This amendment does not authorize or introduce:

- AKP-2+ implementation;
- Raw Source vectorization;
- FACT Product authority;
- external vector DB;
- automatic Canonical mutation;
- similarity-as-confidence;
- weakening of Project/access/sensitivity filtering;
- weakening of EvidenceSpan/SourceVersion citation lineage;
- deployment or Production Verification.

## 6. Completion authority

AKP-1R R0–R5 must complete before the existing AKP-1 WP5 quality/security/privacy/performance closure begins. AKP-1 remains incomplete until WP5 evidence and explicit USER closure approval.