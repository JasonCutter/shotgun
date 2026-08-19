# AKP-1R R1 — Durable Semantic Profile & Exact-Pin Embedding Router

## Goal

Implement R1 of ADR-148 so Semantic embedding configuration is durable and actual provider embedding execution is bound to the exact resolved Project/provider/model/credential revision through `CredentialVault.withCredential()`.

R1 must remove the architectural split where a resolver approves one execution identity while an independently injected static execution adapter may perform another execution.

## Baseline

Repository: `JasonCutter/shotgun`

Branch:

```text
codex/akp-1r-semantic-runtime-repair
```

Canonical base:

```text
main@3ea9a8ec5aada6f026b8cccd8b72cdc3bae677a5
```

Governing documents on the branch:

- `docs/architecture/adr/ADR-148-akp-1-semantic-runtime-authority-unification.md`
- `docs/architecture/contracts/snapshots/akp-1/AKP-1-CONTRACT-AMENDMENT-SEMANTIC-RUNTIME-AUTHORITY-260819001.md`
- `docs/implementation/akp-1-hybrid-semantic-retrieval-implementation-request-260818001.md`
- `docs/implementation/akp-1-semantic-runtime-repair-detailed-design-260819001.md`
- ADR-133, ADR-135, ADR-147

The old PR #124 is CLOSED / SUPERSEDED / DO_NOT_MERGE. Do not copy that branch wholesale.

## Scope

### 1. Durable SemanticEmbeddingProfile repository

Add a PostgreSQL implementation of `SemanticEmbeddingProfileRepositoryPort` and the next free additive migration on this branch.

The durable profile record must preserve at least:

```text
projectId
profileId
profileRevision
providerId
embeddingModelId
credentialId
credentialRevision
representationVersion
dimension
distanceMetric
normalizationPolicy
status
createdAt
updatedBy
updatedAt
```

Profile revisions are Project-scoped and revision-CAS protected.

Do not make profile activation the Product semantic-generation cutover authority. Preparing/changing a profile must not retire or invalidate the profile revision referenced by a currently active generation.

You may minimally evolve the existing profile status/API now if required by R1, but do not implement R2/R3 lifecycle work. Prefer a clean `PREPARED`/exact-revision build-target semantic over preserving an obsolete `ACTIVE` meaning. If temporary compatibility is retained for already-merged WP3 code, isolate it and document its removal point in R3; do not add another authority.

### 2. Exact semantic execution contracts

Refactor semantic embedding contracts so provider execution consumes an exact immutable semantic execution pin rather than relying on a static adapter identity.

Keep immutable non-secret pin fields such as:

```text
projectId
providerId
embeddingModelId
embeddingProfileId
embeddingProfileRevision
credentialId
credentialRevision
providerRegistryRevision
capabilityCatalogRevision
representationVersion
createdAt
```

Build-time policy/audit identity may remain in the pin, but do not require future current authorization decisions to reproduce that historical fingerprint byte-for-byte.

No contract may contain plaintext credential material.

### 3. SemanticEmbeddingRouter

Add a production-capable semantic embedding router/service that:

1. accepts an exact semantic execution pin plus embedding payload(s);
2. revalidates current provider/model capability;
3. enforces current provider privacy/deployment eligibility for the supplied server-owned payload classification/sensitivity;
4. uses `CredentialVault.withCredential()` with the exact Project/provider/credential/revision from the pin;
5. invokes provider-specific embedding connectivity only inside the bounded credential callback;
6. validates returned provider/model/dimension against the pin/profile/model contract;
7. maps provider/auth/rate-limit/timeout/invalid-response failures to existing typed semantic errors without secrets;
8. supports single and bounded batch embedding.

The resolver and router must not become two independent credential authorities. The router must fail closed if the exact pinned credential revision is revoked, removed, mismatched or unavailable.

### 4. Real OpenAI embedding connectivity

Implement the first concrete external embedding connectivity adapter for the already-registered OpenAI embedding models.

Use the accepted semantic catalog entries; do not add a new provider family.

Connectivity owns HTTP/provider protocol only. It must:

- use HTTPS base URL validation consistent with existing OpenAI adapters;
- call the OpenAI embeddings endpoint;
- support requested Shotgun-approved dimensions where the model supports them;
- parse/validate vector count and dimension deterministically;
- return provider/model/token usage metadata where available;
- map 401/403, 429, 5xx, timeout, malformed response and network failure safely;
- never log or return the API key.

Do not use structured-generation request contracts for embeddings.

### 5. Fake boundary

`DeterministicFakeEmbeddingAdapter` may remain for low-level deterministic tests, but the new production router path must not select it by default.

For R1 integration tests, fake only the provider-network connectivity. Use the real profile service/resolver/privacy authority/CredentialVault/router chain.

### 6. In-memory parity

Keep/update the in-memory profile repository only if it remains useful as a faithful test adapter. Its profile revision/status semantics must match PostgreSQL. Remove auto-retirement behavior that conflicts with ADR-148.

## Core Contract

R1 must establish this authority chain:

```text
Durable profile revision
  -> SemanticEmbeddingAuthorityResolver (exact pin, no secret)
  -> SemanticEmbeddingRouter
  -> current privacy/deployment decision
  -> CredentialVault.withCredential(exact revision)
  -> OpenAIEmbeddingConnectivity
  -> validated embedding result
```

The following are forbidden:

```text
resolved pin A + unrelated static execution adapter B
plaintext secret returned by resolver
Browser-selected credential/profile authority
normal production DeterministicFakeEmbeddingAdapter
profile preparation that invalidates current active generation
```

## Out of Scope

Do not implement in R1:

- R2 coherent corpus snapshot;
- Semantic Representation v2;
- R3 generation lifecycle/CAS/persisted membership validation;
- R4 Product semantic refresh endpoint/composition completion;
- R5 cross-WP final integration chain;
- Golden Query tuning;
- ANN/HNSW/IVFFlat;
- AKP-2+;
- Raw Source vectors;
- FACT Product eligibility;
- external vector DB;
- Ready for Review, merge, deployment or Production Verification.

Do not import the superseded PR #124 migration/lifecycle code merely because it exists.

## Required Tests

Add only focused R1 evidence.

### Profile persistence

1. PostgreSQL profile revision survives repository reconstruction/restart.
2. expected revision CAS rejects stale profile creation.
3. Project/provider/credential ownership mismatch is rejected.
4. revoked/missing credential revision cannot create a usable profile.
5. preparing P2 does not retire/invalidate P1 merely because P2 is newer.
6. PostgreSQL and in-memory profile semantics match for R1 behaviors.

### Router / credential binding

7. Real resolver produces exact non-secret pin from durable profile revision.
8. Router invokes `CredentialVault.withCredential()` with exactly the pinned Project/provider/credential/revision.
9. Fake provider connectivity receives the secret only inside the vault callback and the returned public result contains no secret.
10. Revoked exact credential revision after pin creation causes execution failure; router does not substitute latest credential.
11. Provider/model/dimension mismatch from connectivity fails validation.
12. Current privacy/deployment denial causes zero provider connectivity calls.
13. Batch result cardinality/order/dimension is validated.

### OpenAI connectivity

14. Request uses `/embeddings`, expected model/input/dimension, and bearer credential.
15. Valid response is mapped deterministically.
16. 401/403, 429, 5xx, timeout, invalid JSON/schema and network failure map to safe typed failures.

Do not duplicate WP2 vector-storage or WP3 Hybrid tests.

## Verification Commands

Run only the focused R1 test files you add/change, then:

```text
npm run lint
npm run typecheck
npm run format:check
```

Run the relevant database test command only for the new profile migration/repository test. Do not manually run the full CI suite locally unless a directly affected repository rule requires it.

Do not rerun CI for the superseded PR #124 exact head.

## Submission Conditions

Before commit/push, inspect the complete diff and remove dead R1 compatibility code that is no longer needed.

Then commit and push to the same branch:

```text
codex/akp-1r-semantic-runtime-repair
```

Use the normal automatic Draft PR CI only. Do not manually dispatch CI.

Do not mark Ready for Review and do not merge.

## Completion Report

Report:

- starting exact head;
- final exact head;
- migration number/path;
- changed files;
- final durable profile state semantics;
- exact resolver -> router -> vault -> provider connectivity call chain;
- whether any plaintext credential crosses a repository/contract boundary;
- whether normal production path uses deterministic fake embeddings;
- focused test commands/results;
- automatic PR CI run number/ID and Quality/Frontend/Required Gates status if completed;
- working tree status.

Explicitly state:

```text
Durable profile persistence: PASS/FAIL
Preparing new profile preserves current-generation profile history: PASS/FAIL
Exact pin -> Vault credential revision binding: PASS/FAIL
Current privacy denial -> zero provider call: PASS/FAIL
Real OpenAI embedding connectivity implemented: PASS/FAIL
Plaintext credential in semantic contract/resolver result: NO/YES
Deterministic fake used by normal production semantic path: NO/YES
R2 started: NO
Ready: NOT PERFORMED
Merge: NOT PERFORMED
```