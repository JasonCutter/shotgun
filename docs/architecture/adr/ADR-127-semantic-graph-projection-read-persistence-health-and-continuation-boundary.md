# ADR-127 — Semantic Graph Projection Read Persistence, Health and Continuation Boundary

- Status: **PROPOSED** (not accepted)
- Proposed by: FE-P3-S3 contract preparation (2026-08-04; revision 4 — the
  snapshot-context descriptor stores the normalized filter set, snapshot refresh
  is descriptor-based, and the exact continuation/restoration semantics are
  frozen in the contract snapshot)
- Work item: `FE-P3-S3`
- Related ADRs: ADR-106, ADR-107, ADR-108, ADR-119, ADR-124, ADR-125
- Contract snapshot:
  `docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`
  (revision 5)
- Product implementation: `NOT_AUTHORIZED`
- Decision owner: pending user review

## Context

FE-P3-S3 (Semantic Graph and Relationship Exploration) must serve typed graph
projections as a read-only exploration Workspace. ADR-108 governs the typed read
surface and the mandatory accessible fallback, but no accepted ADR decides how
the server stores or derives graph projection state:

1. whether base-view graph snapshots are ephemeral computations, materialized
   projections, immutable persisted snapshots, or a hybrid;
2. whether projection-health and overlay-identity state is persisted and where;
3. whether continuation tokens are stored server-side, how they expire, and to
   what they are bound;
4. how overlay results are retained or pruned without ever becoming Canonical
   edges.

Compiled Truth (Stage 10) is a materialized projection, but its persistence
decision does not transfer automatically to the graph read surface, which
combines ephemeral traversal with health and overlay bookkeeping.

## Decision (proposed)

Adopt an **explicit hybrid** model with an immutable snapshot-context
descriptor:

1. **Base-view snapshots** are ephemeral computations at read time over
   Canonical / Stage 9 / Compiled Truth read sources, bounded by server limits.
   No full graph snapshot rows are persisted.
2. **Immutable Snapshot Context descriptor**: for every issued snapshot, an
   immutable descriptor row is persisted (no graph items): `snapshotId`,
   `projectId`, `viewKind`, `overlayKinds`, `rootRefs`,
   `normalizedFilters` (the actual normalized `GraphFilterSetV1`), `filtersDigest`
   (for validation), `limits`, `accessRevision`, `policyContextRevision`,
   `projectionRevision`, `generatedAt`, `expiresAt`. Subsequent operations
   (neighborhood, path, path description, evidence detail, refresh, deep-link
   restore) resolve `snapshotId` → descriptor and reconstruct the identical
   computation; an unknown or expired `snapshotId` returns `SNAPSHOT_STALE` /
   `DEEP_LINK_TARGET_UNAVAILABLE`. Storing the normalized filter set (not only
   its digest) is required so the identical computation is actually restorable.
   This closes the ephemeral-restoration gap: no full snapshot is stored, but
   every snapshot's meaning is restorable.
3. A **materialized projection-health registry** is persisted per Project
   (`projectId`, `viewKind`, `projectionRevision`, `status`, `generatedAt`,
   `lag`, `rebuildState`, `accessRevision`, `policyContextRevision`).
4. **Overlay health/identity** is persisted per
   (`projectId`, `baseSnapshotId`, `overlayKind`) with
   `overlaySnapshotId`, `overlayRevision`, `analyzerRevision`,
   `policyContextRevision`, `generatedAt`, `completeness`, `truncation`,
   `unavailableReason`. Overlay items are never persisted as Canonical edges.
5. **Continuation tokens** are opaque, server-issued, expiring, and stored
   server-side, bound to Principal/Session, Project, access and policy
   revisions, snapshot, root and filters, view and overlay, and traversal
   limits.
6. Migration **026** creates `frontend_knowledge_graph_snapshot_context`
   (immutable descriptor storing the normalized `GraphFilterSetV1` plus
   `filtersDigest`), `frontend_knowledge_graph_projection_health`,
   `frontend_knowledge_graph_overlay_health` and
   `frontend_knowledge_graph_continuation`.
7. In-memory and PostgreSQL adapters cover the snapshot-context, health and
   continuation stores; ephemeral computation is shared code. The parity
   boundary is therefore the four storage adapters.
8. Stage 9 `GetKnowledgeGraph`/`GetKnowledgeImpact` and the NetworkX oracle are
   adapted behind the FE-P3-S3 `GraphReadPort`/`GraphImpactPort`; their
   identifiers are never exposed as FE-P3-S3 Canonical IDs.

## User decision required

Approve or reject ADR-127. Approval accepts the hybrid persistence model,
migration 026 requirement, overlay health persistence and server-side
continuation-token storage for FE-P3-S3. Rejection requires a replacement model
(ephemeral-only, fully materialized, or immutable persisted snapshots) to be
frozen before FE-P3-S3 implementation.

## Blocked Acceptance Criteria

Until ADR-127 is accepted, these FE-P3-S3 Acceptance Criteria remain blocked:

- FE-P3-S3-AC-13 (overlay isolation and persistence)
- FE-P3-S3-AC-16 (cache isolation)
- FE-P3-S3-AC-27 (in-memory/PostgreSQL parity)
- FE-P3-S3-AC-31 (formal completion governance)

## Consequences

Ephemeral snapshots keep Canonical and overlay meaning separated and avoid
replicating Canonical state; the persisted health and continuation stores keep
reads deterministic, revision-bound and resumable; overlay results can never
leak into Canonical. The cost is one new migration and a bounded health-store
retention policy.
