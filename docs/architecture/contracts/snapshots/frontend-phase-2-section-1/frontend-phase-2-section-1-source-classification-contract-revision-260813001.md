# Frontend Phase 2 Section 1 — Source Classification Contract Revision

- Revision ID: `frontend-phase-2-section-1-source-classification-contract-revision-260813001`
- Approval date: 2026-08-13
- Approved by: user
- Status: **APPROVED AND FROZEN**
- Classification: `ACTIVE_REVISION`
- Supersedes: `frontend-phase-2-section-1-contract-snapshot-260730001` only for the authority, security, retry, and duplicate clauses stated below
- Governing ADRs: ADR-122, ADR-144
- Product implementation: **AUTHORIZED ONLY FOR A9 Blocking Repair #2**

## 1. Scope of revision

This revision preserves all unmodified acceptance criteria in the active base snapshot. It replaces only the Source classification authority meaning that had been implicit in the earlier Sources Product implementation.

| Contract area             | Frozen revision                                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New Source classification | A Browser may submit optional enum-only `requestedClassification`: `public`, `internal`, `private`, or `restricted`. It is a request, never authoritative Resource metadata.                                                                                                                 |
| Server authority          | The Server derives `effectiveResourceSecurity { sensitivity, accessScope }` from authenticated Principal clearance and server-owned Project policy before any materialization. Browser access scope, effective sensitivity, clearance, policy, Source id, and SourceVersion id are rejected. |
| Default                   | Omitted request resolves to `private`; the default is server-side and fail-closed.                                                                                                                                                                                                           |
| Policy ceiling            | The current single-owner Project policy permits public, internal, and private classification for an approved owner; restricted, policy-forbidden, and above-clearance requests return `POLICY_DENIED`.                                                                                       |
| Durable pin               | The effective non-secret Resource security metadata is stored in immutable intake item metadata before Stage 2, SourceVersion, Transformation, or Evidence materialization.                                                                                                                  |
| Projection                | Persisted Source projection sensitivity is the authoritative result presented to the Product. The Browser request is not treated as the result.                                                                                                                                              |
| Retry same context        | Reuses the original immutable Resource security pin without recalculation.                                                                                                                                                                                                                   |
| Retry current policy      | Revalidates the original pin against current server policy and Principal clearance; it never changes the pin. A failed revalidation is `POLICY_DENIED`.                                                                                                                                      |
| Exact duplicate reuse     | Requires equal content hash **and** exact equal effective sensitivity/access scope. A security-incompatible match cannot offer `REUSE_EXISTING_VERSION`.                                                                                                                                     |
| Candidate disposition     | Newly created decisions omit `CREATE_VERSION_CANDIDATE`; PostgreSQL's existing same-Source/same-OriginalAsset uniqueness makes it structurally invalid. Forged or stale unsupported dispositions fail closed.                                                                                |

## 2. Required request and response semantics

The versioned staged Sources submit payload has the additive typed shape below. Existing callers that omit `requestedClassification` remain valid and receive the server-side private default.

```ts
type StagedSourcesIntakeInput = {
  itemId: string;
  kind: 'DIRECT_TEXT' | 'FILE' | 'URL';
  label: string;
  stagingReference: string;
  requestedClassification?: 'public' | 'internal' | 'private' | 'restricted';
};
```

Unknown fields and non-enum classifications are `INVALID_REQUEST`. A syntactically valid request that violates Principal clearance or Project policy is `POLICY_DENIED`. The request does not directly determine the persisted classification; the Server-resolved effective result does.

## 3. Security invariants

> Principal clearance is an authorization ceiling. Source classification is Resource metadata. They are independently stored, derived, and verified.

No input may use a Browser-selected access scope or copy a Principal's clearance as a Source classification. Existing UUIDs, SourceVersions, memberships, and Project state remain unchanged. There is no reset, reseed, or fallback to `DATABASE_URL` for test activity.

Stage 3 must receive the Resource pin that was stored with the intake item. This applies to initial materialization and recovery of a durable SourceVersion after Stage 3 failure.

## 4. Focused acceptance evidence

The repair must demonstrate all of the following on its exact head:

1. An approved private-clearance Principal can request and persist a public Source Resource without changing clearance.
2. Omitted classification persists as private.
3. Restricted, policy-forbidden, or above-clearance requests fail closed.
4. SourceVersion, Transformation, and Evidence receive the same pinned sensitivity/access scope.
5. `RETRY_SAME_CONTEXT` preserves the pin and `RETRY_CURRENT_POLICY` revalidates it without substituting a new identity.
6. Same content with compatible metadata can reuse an existing Version.
7. Same content with incompatible metadata cannot reuse an existing Version and uses a separate Source if the user elects to continue.
8. A new decision cannot offer `CREATE_VERSION_CANDIDATE` and a forged unsupported disposition is rejected.
9. Existing Sources and SourceVersions remain unchanged; no private egress or live provider call occurs.

## 5. Change control

Any change to classification authority, default, Project policy ceiling, retry identity, duplicate compatibility, durable metadata representation, or downstream propagation requires a new contract revision and an ADR amendment or successor. This revision does not authorize deployment, Production Verification, A9 completion, or expansion beyond the identified Source classification repair.
