## FE-P3-S3 — Semantic Graph and Relationship Exploration (Contract Preparation, revision 5)

Tracking issue: #58

Revision 5 is the third focused contract correction round. It resolves the two remaining `CHANGES_REQUIRED` items (snapshot refresh contract consistency and revision document linkage) without adding new requirements. It does **not** start Product implementation, Canonical graph writes, relation editing, Entity merge, Review/Approval, Action execution, FE-P4, Yjs/CRDT, new runtime dependencies, deployment or production verification.

### Resolved items (revision 5)
1. **Snapshot refresh consistency** — `GraphSnapshotRefreshRequestV1` is now descriptor-based:
   ```ts
   type GraphSnapshotRefreshRequestV1 = {
     schemaVersion: '1.0.0';
     snapshotId: string;              // the snapshot context to refresh
     projectionRevision: string;      // the revision the browser currently holds
     expectedSnapshotRevision: string; // required; mismatch -> SNAPSHOT_STALE
   };
   ```
   The full request is never resent. Refresh resolves the snapshot context, recomputes the identical computation, and issues a **new snapshot context (new `snapshotId`) and `projectionRevision`**. This removes the conflicting "full request resend" model and aligns refresh with the persistence contract (`snapshotId → descriptor → identical computation`).
2. **Revision document linkage** — the Implementation Request body and ADR-127 now reference the current Contract Snapshot **revision 5**.

### Previously resolved (revisions 3–4, all PASS)
- Authority axis reduced to `CANONICAL | DERIVED_INFERENCE | DISCOVERY_CANDIDATE`.
- Path segments frozen as `ORIGIN`/`TRAVERSAL` discriminated unions.
- Exact continuation semantics and route-specific overlay request types.
- `projectionRevision` on every response; deep-link root owned by snapshot context.
- Snapshot-context descriptor stores the normalized `GraphFilterSetV1` (+ `filtersDigest`); `SnapshotContextStorePort` boundary explicit.
- `ACTION_CANDIDATE` fully excluded from FE-P3-S3; base-view terminology unified on `GraphBaseViewKindV1`.

### Prepared artifacts
- Contract Snapshot (revision 5): `docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`
- Implementation Request (revision 5): `docs/implementation/frontend-phase-3-section-3-implementation-request-260804001.md`
- Preparation Verification (revision 5): `docs/engineering/frontend-phase-3-section-3-contract-preparation-verification-260804001.md`
- Proposed ADR-127 (revision 4, PROPOSED, not accepted): `docs/architecture/adr/ADR-127-semantic-graph-projection-read-persistence-health-and-continuation-boundary.md`
- Gap Audit + Evidence Registry: updated

### ADR decision
`NEW_PROPOSED_ADR_REQUIRED` — **ADR-127** remains PROPOSED (not accepted). Architecture is approvable after this alignment. Blocked criteria until acceptance: AC-13, AC-16, AC-27, AC-31.

### Evidence
- `npm run docs:validate` — PASS (ADR identifiers 1-127)
- `npx prettier --check` on all changed files — PASS
- `git diff --check` — PASS
- Final full gate `npm run check`: exit 0 (log redirected, not committed)
- Automatic CI run **#454** (run 30835257611) at exact head `b0dc85199a9949015946dc3c08e40336afa40825`: **success** — Quality, Frontend and Required Gates all green

### Status
- PR remains **OPEN and DRAFT**.
- `FE-P3-S3` is `IN_PROGRESS` and is **not** marked `COMPLETE`.
- All Product ACs remain `NOT_RUN`; Product implementation is **not authorized** and not started; no Ready/Merge/deployment/FE-P4 work was started.
