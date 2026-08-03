---
id: FRONTEND-PHASE-3-SECTION-3-IMPLEMENTATION-REQUEST-260804001
classification: IMPLEMENTATION_REQUEST_PROPOSAL
status: PENDING_USER_APPROVAL
revision: 1
review_round: 0
contract_basis_status: CONTRACT_SNAPSHOT_PROPOSED
contract_basis_commit: 69cd0f0ccc03ba487b954b8f8f53fb1f54d2e9ab
work_item: FE-P3-S3
governing_adr: ADR-108
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md
implementation_authorized: false
approved_by: null
approved_at: null
branch: codex/frontend-phase-3-section-3-contract-preparation
---

# FE-P3-S3 Implementation Request (Proposal)

This document is the executable implementation request for FE-P3-S3 — Semantic
Graph and Relationship Exploration. It is **not yet approved** and must not be
executed. After user approval it is intended to run as **one large
implementation round**.

The request is bounded by ADR-108 and the FE-P3-S3 Contract Snapshot
(`docs/architecture/contracts/snapshots/frontend-phase-3-section-3/frontend-phase-3-section-3-contract-snapshot-260804001.md`)
and the Gap Audit
(`docs/engineering/frontend-phase-3-section-3-semantic-graph-gap-audit-260804001.md`).

## Authorized dependency order

1. Contracts and strict decoders: typed graph snapshot/node/edge/reference/kind/
   authority/provenance/evidence/temporal/revision/health/access/overlay/budget/
   path/neighborhood/capability shapes plus request/response contracts and
   typed failure mapping.
2. Domain read orchestration: server-authoritative graph projection read
   coordinator bound to `FrontendReadScope`.
3. In-memory and PostgreSQL adapters: graph projection read parity, projection
   health, overlay artifact reads and PostgreSQL parity.
4. Protected Product routes: versioned graph read routes with the existing
   guard/CSRF/decoder pattern.
5. Typed API client: graph snapshot/neighborhood/path/overlay client with strict
   identity validation.
6. Semantic snapshot and bounded traversal: server-enforced limits and
   continuation tokens.
7. Neighborhood and path exploration: server-issued snapshot context only.
8. Conflict and Gap overlays: isolated, revision-bound, read-only overlays.
9. Recursive Impact overlay integration: reuse the impact analyzer behind the
   new port.
10. React Graph Workspace: route, state machine, view-kind selection, overlays.
11. Cytoscape presentation adapter: canvas rendering/layout only.
12. List, Table and Path fallback: information-equivalent accessible views.
13. Deep links, cache isolation and recovery: scope/revision-aware keys,
    deep-link restoration, typed failure states.
14. Accessibility and performance: keyboard/screen-reader equivalence, reduced
    motion, zoom, bounded render, `AbortController`, measured performance.
15. Contract, parity, integration, database and browser tests.
16. Completion evidence preparation (governance record, no Ready/Merge).

## Work packages

The implementation is grouped into a small number of substantial work packages
(not many tiny slices):

- **WP1 — Contracts, domain orchestration, adapters, routes and client**:
  package 1–5 above with strict decoders and negative tests.
- **WP2 — Snapshot, traversal, neighborhood, path and overlays**:
  packages 6–9 above with integration and parity tests.
- **WP3 — React Graph Workspace, Cytoscape adapter and accessible fallback**:
  packages 10–13 above with browser E2E and accessibility tests.
- **WP4 — Accessibility, performance, tests and completion evidence**:
  packages 14–16 above.

## Reusable surfaces

- `FrontendReadScope` and server-derived Product scope
  (`modules/frontend-product-read`).
- Stage 9 `GetKnowledgeGraph`/`GetKnowledgeImpact` and `KnowledgeGraphView`
  behind new FE-P3-S3 ports.
- `adapters/networkx-impact-oracle` for the recursive impact overlay.
- Compiled Truth projection status semantics for graph projection health.
- FE-P3-S1/FE-P3-S2 protected route, typed client, decoder and cache-key patterns.
- Knowledge Workspace/Editor UI components and accessibility primitives.

## Deliberate non-reuse / exclusions

- No Canonical graph writes, graph relation editing, automatic Entity merge,
  Review decisions, Approval, Canonical Commit, User Directive Proposal
  implementation, or external Action execution.
- No `ACTION_CANDIDATE` in the default Knowledge graph.
- No Yjs/CRDT and no new runtime dependencies (Cytoscape is already declared).
- No deployment or production verification.

## Implementation gates

The future implementation must include:

- focused tests during development;
- one final full `npm run check`;
- redirected full-check output (not committed);
- one final push where practical;
- exact-head CI evidence (Quality, Frontend, Required Gates);
- no Ready or Merge without separate user authorization.

## Do not execute

This request is not executed in the FE-P3-S3 contract preparation round. It is
presented for user review and approval.
