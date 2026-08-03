## FE-P3-S3 — Semantic Graph and Relationship Exploration (Contract Preparation, revision 3)

Tracking issue: #58

Revision 3 is the focused contract correction round that resolves all five `CHANGES_REQUIRED` review blockers. It does **not** start Product implementation, Canonical graph writes, relation editing, Entity merge, Review/Approval, Action execution, FE-P4, Yjs/CRDT, new runtime dependencies, deployment or production verification.

### Resolved blockers (revision 3)
1. **Authority axis cleanup** — `GraphAuthorityClassificationV1` reduced to pure authority/provenance lineage: `CANONICAL | DERIVED_INFERENCE | DISCOVERY_CANDIDATE`. Edge semantic kinds, resource/candidate types, conflict/gap types and overlay membership stay on their own axes; edge semantic kinds are never node authority classifications.
2. **Exact operation contracts** — all ten operations now have exact V1 request/response/failure contracts frozen in the Contract Snapshot (D.1), with cross-field invariants in D.2: numeric ranges (maxDepth 1..10, maxNodes 1..500, maxEdges 1..1000, serverTimeoutBudgetMs 1000..30000), truncation binding, path edge binding, node-kind binding, masking payload binding, applied-limits binding, continuation request union, revision binding.
3. **Snapshot restoration** — resolved with an **immutable snapshot-context descriptor** store (no graph items). Migration 026 adds `frontend_knowledge_graph_snapshot_context`; subsequent operations resolve `snapshotId` → descriptor and reconstruct the identical computation. ADR-127 updated accordingly.
4. **Base-view terminology unified** — only `GraphBaseViewKindV1` exists; `GraphViewKindV1` removed; D2 no longer calls governance/operational base views "overlays".
5. **`ACTION_CANDIDATE` fully excluded** — no `ACTION_CANDIDATE` resource kind, node payload or authority value in FE-P3-S3; rendering deferred to FE-P4.

### Prepared artifacts
- Gap Audit: `docs/engineering/frontend-phase-3-section-3-semantic-graph-gap-audit-260804001.md`
- Contract Snapshot (revision 3): `docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`
- Implementation Request (revision 3): `docs/implementation/frontend-phase-3-section-3-implementation-request-260804001.md`
- Preparation Verification (revision 3): `docs/engineering/frontend-phase-3-section-3-contract-preparation-verification-260804001.md`
- Proposed ADR-127 (revision 2, PROPOSED, not accepted): `docs/architecture/adr/ADR-127-semantic-graph-projection-read-persistence-health-and-continuation-boundary.md`
- Evidence Registry: `docs/engineering/evidence-registry.json`

### ADR decision
`NEW_PROPOSED_ADR_REQUIRED` — **ADR-127** remains PROPOSED (not accepted). Revision 2 of the ADR resolves the snapshot-restoration gap via the immutable snapshot-context descriptor, making it approvable. Blocked criteria until acceptance: AC-13, AC-16, AC-27, AC-31.

### Evidence
- `npm run docs:validate` — PASS (ADR identifiers 1-127)
- `npx prettier --check` on all changed files — PASS
- `git diff --check` — PASS
- Final full gate `npm run check`: exit 0 (log redirected, not committed)
- Automatic CI run **#452** (run 30832265720) at exact head `e9a9021e3d5ed7f10127144bb68e0db5bc214054`: **success** — Quality, Frontend and Required Gates all green

### Status
- PR remains **OPEN and DRAFT**.
- `FE-P3-S3` is `IN_PROGRESS` and is **not** marked `COMPLETE`.
- All Product ACs remain `NOT_RUN`; Product implementation is **not authorized** and not started; no Ready/Merge/deployment/FE-P4 work was started.
