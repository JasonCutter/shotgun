# ADR-144 — Source Classification Authority, Durable Pinning, and Security-Compatible Duplicate Boundary

- Status: **ACCEPTED**
- Proposed at: 2026-08-13
- Decision date: 2026-08-13
- Accepted at: 2026-08-13
- Accepted by: `USER`
- Decision owner: `USER`
- Work item: `A9 Blocking Repair #2 — Source Classification Authority`
- Subject base: `main@bf08e0bcc0e3ff98d16f7526c7fc6d3a7ad9ca5f`
- Related ADRs: ADR-093, ADR-094, ADR-122
- Product implementation: **AUTHORIZED ONLY FOR THE BOUNDED A9 REPAIR DESCRIBED HERE**

## Context

The Sources Product previously copied the authenticated membership's `sensitivityClearance` into a write scope field named `sensitivity`. That value was then persisted to Stage 2, SourceVersion, Transformation, and Evidence. This conflated a Principal's maximum clearance with the classification of a new Source Resource. It prevented an approved Principal with private clearance from intentionally creating a public Source and made the Browser's intended classification absent from the versioned Product contract.

The same conflation made retry, duplicate reuse, and Stage 3 propagation depend on mutable caller context instead of a durable SourceVersion identity. Existing accepted security architecture requires Principal clearance and Resource sensitivity to be independently represented and verified.

## Decision

### 1. Separate Principal clearance from Resource classification

`Principal.sensitivityClearance` remains an authorization ceiling. It is never copied as the classification of a new Source, SourceVersion, Transformation, or Evidence.

A Sources intake descriptor may carry an optional enum-only `requestedClassification` of `public`, `internal`, `private`, or `restricted`. It is a request, not authority. The Browser cannot provide access scope, effective sensitivity, clearance, Project policy, Source id, SourceVersion id, or a downgrade approval.

For each accepted item, the Server resolves immutable `effectiveResourceSecurity` before materialization:

```text
Browser requestedClassification (optional)
-> Server Principal clearance + server-owned Project policy
-> effectiveResourceSecurity { sensitivity, accessScope }
-> immutable intake item manifest
-> Stage 2 / SourceVersion
-> Transformation / Evidence
```

Omission defaults to `private`. The current single-owner Project policy may authorize `public`, `internal`, and `private`; `restricted` is denied. A requested classification above current clearance or outside current Project policy fails closed with `POLICY_DENIED`. The effective result is shown through the persisted Source projection, not synthesized from the Browser request.

### 2. Durable pinning and retries

The resolved non-secret `effectiveResourceSecurity` is stored in the immutable intake item manifest before any SourceVersion materialization. Existing schema support for immutable safe `input_manifest` is sufficient; this repair adds no destructive migration and never rewrites historical SourceVersions.

`RETRY_SAME_CONTEXT` reads and preserves the original pin. It does not recalculate classification. `RETRY_CURRENT_POLICY` revalidates the pinned classification and access scope against current server-owned policy and Principal clearance before creating a retry attempt; it does not substitute a new classification. A failed revalidation returns `POLICY_DENIED`.

Stage 3 recovery re-reads the durable pin from the intake item and passes it to Transformation and Evidence. A later Principal clearance or policy-context value cannot silently change a materialized SourceVersion's metadata.

### 3. Security-compatible exact duplicates

Exact-content detection remains content-hash based, but `REUSE_EXISTING_VERSION` is allowed only when the selected existing SourceVersion has exactly the same effective sensitivity and access scope as the new intake item's durable pin. The Server chooses a compatible same-content Version when one exists; otherwise it creates an explicit decision that omits reuse.

The repair also removes `CREATE_VERSION_CANDIDATE` from all newly issued exact-duplicate decision dispositions. The current PostgreSQL schema has `UNIQUE (source_id, original_asset_id)`, so creating a second Version for identical bytes on the same Source is not structurally valid. A client-forged candidate disposition is fail-closed because only the persisted server-issued decision's allowed dispositions may execute. For metadata-incompatible duplicate content, the permitted safe action is `CREATE_SEPARATE_SOURCE` or cancellation.

## Consequences

| Area                | Consequence                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| New Source creation | Approved private-clearance Principals can request public, internal, or private Source Resources within server policy. |
| Security            | Browser classification is an explicit typed request; Server policy produces the effective durable identity.           |
| Persistence         | No existing SourceVersion, Project, membership, or database state is mutated or reset.                                |
| Retry               | Same-context preserves the original identity; current-policy revalidates it without changing it.                      |
| Duplicate reuse     | Content equality alone is insufficient; Resource security metadata must match exactly.                                |
| Stage 3             | Transformation and Evidence receive the pinned Resource security, not Principal clearance.                            |

## Rejected alternatives

- Copy Principal clearance to every newly created Source Resource.
- Let the Browser submit access scope or effective security metadata.
- Default omitted classification to public or infer it from UI selection without server validation.
- Recalculate SourceVersion classification during retry, recovery, or Stage 3 replay.
- Reuse a Version solely because content hashes match.
- Offer `CREATE_VERSION_CANDIDATE` despite the existing SourceVersion uniqueness constraint.
- Reset, reseed, or mutate existing Project or Source data as a repair mechanism.

## Scope freeze

This ADR authorizes only the bounded Sources classification repair. It does not authorize private egress changes, live provider calls, deployment, production verification, A9 completion, or unrelated Sources lifecycle changes.
