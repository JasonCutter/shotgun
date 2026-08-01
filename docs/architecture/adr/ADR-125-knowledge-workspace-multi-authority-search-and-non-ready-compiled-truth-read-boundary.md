# ADR-125 — Knowledge Workspace Multi-Authority Search and Non-Ready Compiled Truth Read Boundary

- Status: **Accepted**
- Proposal date: 2026-08-02
- Decision date: 2026-08-02
- Approved by: ChatGPT side-panel review `4835947919`
- Scope: FE-P3-S1 QX-P0 contract freeze and bounded QX-02 Stage 10 read handler
- Related ADRs: ADR-087, ADR-090, ADR-106, ADR-121

## Context

ADR-106 defines the Knowledge Workspace as a read, search and exploration view. It
requires server-owned ranking, visible projection status and traceability to
Canonical and source evidence. The existing Stage 7 `SearchCanonicalKnowledge`
Query is intentionally Canonical-Claim-only, while the existing Stage 10
`GetCompiledTruth` Query is intentionally READY-only and returns `NOT_FOUND` for
non-READY projections.

The FE-P3-S1 Product read contract needs a bounded domain boundary for four
authorities and for non-READY Compiled Truth visibility. The boundary must be
fixed before a Persistent Adapter or Product API can be implemented. QX-P0 was a
contract-first step. The accepted decision authorizes only the bounded QX-02
Stage 10 read handler described below; it does not authorize QX-01, a
Persistent Adapter or a Product API.

## Decision — QX-P0 contract freeze

### 1. Existing Query compatibility

The names, versions, input and output meanings of the following Queries remain
unchanged:

- `SearchCanonicalKnowledge@1.0.0` remains Canonical-Claim-only and keeps its
  existing READY/readiness behavior.
- `GetCompiledTruth@1.0.0` remains READY-only and keeps its non-READY
  `NOT_FOUND` behavior.

The new contracts are additive and do not silently widen either existing Query.

### 2. QX-01 — `SearchKnowledgeWorkspace@1.0.0`

The input is a server-context-free payload containing only the query, bounded
cursor/page size, resource scope and typed filters. Project, principal, session,
access scope, sensitivity clearance and policy context come from the server
Query envelope. Browser authority fields, including `projectId` and
`X-Project-Id` equivalents, are not accepted in the payload.

The output is a domain source-oriented result and does not depend on Frontend
`Knowledge*View` DTOs. Every match contains:

- one of `CANONICAL`, `APPROVED_KNOWLEDGE`, `COMPILED_TRUTH` or
  `DERIVED_INFERENCE` authority;
- stable source identity plus resource revision and projection identity where
  applicable;
- a server-owned score in the inclusive `[0, 1]` domain;
- a typed `matchType`;
- a deterministic 1-based `rank`; and
- the source lineage required for Canonical, Evidence, Compiled Truth or
  Derived Inference traceability.

Stage 7 `projection-search` is the only ranking owner. Its versioned ranking
metadata fixes the score normalization and tie-break rule. Stage 6, 9 and 10
data may be composed only through Query envelopes; the Adapter, Browser and
In-memory fixture must not rank or synthesize results.

The declared tie-break is executable, not descriptive. For equal scores the
result array must be ordered by `matchType`
`FULL_TEXT < TRIGRAM < SUBSTRING`, then by authority
`CANONICAL < APPROVED_KNOWLEDGE < COMPILED_TRUTH < DERIVED_INFERENCE`, then by
the authority-specific source key: `canonicalResourceId`, `candidateId`,
`compiledItemId` or `inferenceId`, respectively. Ranks remain strictly
increasing, and a nested source is valid only when
`match.projectId = source.projectId = result.projectId`.

Project, access, sensitivity and typed authority/kind/temporal/projection
filters are applied before a candidate is returned or ranked. A non-READY
source projection is represented in readiness metadata and may produce a
partial result; it is never normalized to `READY` and it does not erase results
from another authority.

Projection readiness is limited to the existing authoritative projection
boundaries `CANONICAL_SEARCH` and `COMPILED_TRUTH`. `KNOWLEDGE_MODEL` and
`DERIVED_INFERENCE` do not receive fabricated canonical-version/lag readiness
claims in this contract. If their availability becomes a Product requirement,
it must use a separately named discriminant that does not claim canonical
projection lag.

Compiled Truth source identity uses the actual Stage 10 logical projection
digest as `projectionLogicalDigest`; Derived Inference uses the existing
`sourceProjectionDigest`. The contract does not expose a free-form
`projectionId`, array-position ID, prefix-derived ID or other synthetic
projection identity. A Compiled Truth match requires a correlated
`COMPILED_TRUTH` status whose projected canonical version, source snapshot
digest and logical projection digest exactly match the source. Canonical matches
may carry only `CANONICAL_SEARCH` status, Approved Knowledge matches carry no
projection status, and Derived Inference matches do not synthesize a status;
their readiness meaning remains the explicitly defined Compiled Truth
inheritance boundary.

### 3. QX-02 — `GetCompiledTruthReadSnapshot@1.0.0`

The input contains only the schema version; Project and security context remain
server-envelope authority. The output always contains the authoritative
`CompiledTruthProjectionStatus` and contains an optional access-filtered
projection:

| Status      | Projection                                 |
| ----------- | ------------------------------------------ |
| `READY`     | Required current visible projection        |
| `STALE`     | Optional last persisted visible projection |
| `DEGRADED`  | Optional last persisted visible projection |
| `NOT_BUILT` | Forbidden; status only                     |

When a projection is present, Project, projector version, canonical version,
source snapshot digest, logical digest and build mode must match the status. For
`READY` and `STALE`, `status.updatedAt` is the persisted projection's
`projectedAt`. For `DEGRADED`, the two timestamps represent different facts:
`status.updatedAt` is the degradation occurrence time, while
`projection.projectedAt` is the last persisted projection creation time. The
decoder therefore keeps identity correlation for `DEGRADED` without requiring
timestamp equality. A non-READY projection remains a derived projection and
is never promoted to Canonical, Approved Knowledge or READY.

The existing Build, Discovery and write fail-closed behavior is unchanged.

### 4. Contract artifacts

QX-P0 freezes the following repository-owned artifacts:

- TypeScript domain types and strict decoders in
  `packages/contracts/src/knowledge-workspace-query.ts`;
- input/output JSON Schemas in `packages/contracts/schemas/`;
- contract, negative and compatibility tests; and
- this accepted ADR plus the global ADR registry and Frontend ADR index entry.

The decoder rejects unknown fields, browser authority fields, invalid
authority/source discriminants, fabricated lineage, cross-Project nested
sources, invalid score/rank/tie-break order, unsupported synthetic readiness,
free-form projection identities, status/source identity mismatches and
forbidden status/projection pairs.

## Not authorized by this proposal

- QX-01 Stage 7 handler implementation or any Stage 10 handler outside the
  QX-02 boundary in this ADR;
- a Persistent Knowledge Adapter or repository/schema/table change;
- local ranking, Product-result storage or direct SQL/repository access;
- new index, event fan-out, migration or runtime dependency;
- A3 API, Client, Cache or `/knowledge` UI;
- PR Ready transition, Merge, FE-P3-S1 completion or deployment.

If implementation requires any of these, work stops and a separate impact and
approval record is required.

## OSS integration decision

`NO_RELEVANT_OSS`. This is a repository-specific additive Query contract and
validation boundary. The existing Stage 6/7/9/10 modules and the previously
recorded OSS review remain the authorities; no external runtime or package is
introduced by QX-P0.

## Migration and rollback

QX-P0 and its QX-P0.1 hardening have no database or runtime migration. Rollback
is a Git revert of the additive contract and proposed-ADR commits. Existing
Query contracts remain available and are not rewritten by the rollback.

## Amendment history

- 2026-08-02: Side-panel review `4836032427` required QX-02.1 limited
  hardening. The PostgreSQL READY test now runs the real Stage 10 Build handler,
  a separate persisted STALE path is covered, and DEGRADED timestamp semantics
  preserve degradation time separately from the last projection time.

## Approval boundary

This record is an **ACCEPTED** ADR. Side-panel review `4835947919` accepted the
decision for implementation and authorized only the QX-02 Stage 10 handler:
`GetCompiledTruthReadSnapshot@1.0.0`, including its existing status, context,
access and approved sensitivity filtering boundaries. QX-01 remains HOLD;
Persistent Adapter, A3 API/Client/Cache, `/knowledge` UI, Ready, Merge and
deployment remain unauthorized.
