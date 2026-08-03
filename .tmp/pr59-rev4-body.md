## FE-P3-S3 — Semantic Graph and Relationship Exploration (Contract Preparation, revision 4)

Tracking issue: #58

Revision 4 is the second focused contract correction round. It resolves the two remaining `CHANGES_REQUIRED` blockers (exact operation contract internal consistency and snapshot restoration completeness) without adding new requirements. It does **not** start Product implementation, Canonical graph writes, relation editing, Entity merge, Review/Approval, Action execution, FE-P4, Yjs/CRDT, new runtime dependencies, deployment or production verification.

### Resolved blockers (revision 4)
1. **Exact operation contract internal consistency**
   - Path segments frozen as `ORIGIN` / `TRAVERSAL` discriminated unions (`GraphPathSegmentV1`, `GraphPathDescriptionSegmentV1`): origin has `step: 0` and no `edgeRef`; traversal has `step >= 1` and a required `edgeRef`.
   - Continuation semantics exact: snapshot **issues but never accepts** a continuation token; neighborhood and recursive-impact accept (and may issue); conflict/gap/path/path-description/evidence/refresh/restore reject it.
   - Route-specific overlay request types: `GraphConflictOverlayRequestV1`, `GraphKnowledgeGapOverlayRequestV1`, `GraphRecursiveImpactOverlayRequestV1` (only the last accepts continuation).
   - Revision binding closed: every response carries `projectionRevision` — added to `GraphPathDescriptionV1` and `GraphOverlayResultV1`.
   - Deep-link restore no longer resends root/root-set (the snapshot context owns it).
2. **Snapshot restoration completeness**
   - The snapshot-context descriptor now stores the **normalized `GraphFilterSetV1`** plus `filtersDigest` (for validation), so `snapshotId → descriptor → identical computation` is actually reconstructible (node/edge/authority/temporal/evidence filters are restorable).
   - `SnapshotContextStorePort` and its in-memory/PostgreSQL adapter responsibilities are explicit in the Implementation Request; migration 026 stores the normalized filter payload.

### Prepared artifacts
- Contract Snapshot (revision 4): `docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`
- Implementation Request (revision 4): `docs/implementation/frontend-phase-3-section-3-implementation-request-260804001.md`
- Preparation Verification (revision 4): `docs/engineering/frontend-phase-3-section-3-contract-preparation-verification-260804001.md`
- Proposed ADR-127 (revision 3, PROPOSED, not accepted): `docs/architecture/adr/ADR-127-semantic-graph-projection-read-persistence-health-and-continuation-boundary.md`
- Gap Audit + Evidence Registry: updated

### ADR decision
`NEW_PROPOSED_ADR_REQUIRED` — **ADR-127** remains PROPOSED (not accepted). Revision 3 stores the normalized filter set in the snapshot-context descriptor, making the restoration architecture complete. Blocked criteria until acceptance: AC-13, AC-16, AC-27, AC-31.

### Evidence
- `npm run docs:validate` — PASS (ADR identifiers 1-127)
- `npx prettier --check` on all changed files — PASS
- `git diff --check` — PASS
- Final full gate `npm run check`: exit 0 (log redirected, not committed)
- Automatic CI run **#453** (run 30834035318) at exact head `69bdc47426539391267cb82208e15e4d6656d935`: **success** — Quality, Frontend and Required Gates all green

### Status
- PR remains **OPEN and DRAFT**.
- `FE-P3-S3` is `IN_PROGRESS` and is **not** marked `COMPLETE`.
- All Product ACs remain `NOT_RUN`; Product implementation is **not authorized** and not started; no Ready/Merge/deployment/FE-P4 work was started.
