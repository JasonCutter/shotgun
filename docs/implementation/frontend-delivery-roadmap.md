# Shotgun Frontend Delivery Roadmap

- Status: **Accepted baseline**
- Decision date: 2026-07-18
- Applies after: Stage 12.1 Security Gate P0-1·P0-2 completion
- Canonical source: Notion `Frontend and Human Interaction Architecture (확정)`
- Related ADR: ADR-095

## 1. Purpose

This roadmap restores the previously selected frontend delivery sequence. It does not redesign the product or weaken any backend security, Evidence, Approval or Canonical boundary.

The current inline HTML in `assemblies/shotgun-app/src/server.ts` is a `Backend Vertical Slice UI`. Existing Stage 5, 7, 9 and 12 UI completion statements mean that minimum integration slices or mock contracts exist; they do not mean the final Product Frontend has been delivered.

## 2. Delivery sequence

### F0 — Frontend Foundation

Deliver:

- `apps/shotgun-web`
- `packages/shotgun-api-client`
- App Shell and navigation
- authenticated Session and CSRF consumption
- Principal, accessible Project list and active Project switching
- common error, loading, stale and recovery presentation
- typed Product View Models
- initial SSE Activity connection and snapshot reconciliation

Gate:

- no client-created authority headers
- login, CSRF rotation, project switching and logout browser flows pass
- cross-project cache and navigation tests pass
- framework, design system and client libraries are recorded through technical decisions

### F1 — Frontend MVP

Deliver:

- Home
- Sources
- Ask
- Knowledge
- Settings

Reference boundary:

- use selected `ddsyasas/llm-wiki` interaction and presentation patterns
- do not adopt its backend, database, filesystem authority or provider runtime

Gate:

- Phase 1 Section 1.9 Sources behavior passes browser E2E
- Ask shows Citation, Conflict, Gap and readiness correctly
- Knowledge provides a list fallback even before advanced graph delivery
- Settings cannot expand Membership or token scope

### F2 — Review and Activity

Deliver:

- Review Bundle
- Evidence and Source return
- Comparison, Conflict, Burst Diff and Impact
- approval, hold, reject and edit flows
- Activity and Job/Attempt timeline
- failure, retry, cancellation and OUTCOME_UNKNOWN presentation

Reference boundary:

- use selected OpenKnowledge Agent Activity and Burst Diff patterns
- UI state never represents Approval authority

Gate:

- stale Candidate, Evidence, Validation, Snapshot and Permission cases are blocked by the server and clearly shown by the UI
- approval security tests pass
- browser accessibility for Review and Activity passes

### F3 — Semantic Graph

Deliver:

- 2D Semantic Graph
- node and edge filters
- neighborhood exploration
- impact paths
- current, historical, scheduled and conflict states
- accessible list and table equivalents

Reference boundary:

- use OpenKnowledge 2D Graph interaction patterns
- reject 3D-only product navigation

Gate:

- graph and list use the same authorization and snapshot
- graph/list equivalence tests pass
- keyboard and screen-reader traversal paths exist

### F4 — Visual Editor

Deliver:

- Visual and Source modes
- typed semantic blocks
- Change Preview
- Draft ChangeSet save path
- Markdown round-trip and Evidence preservation fixtures

Reference boundary:

- use OpenKnowledge preservation patterns
- do not use Markdown or Yjs as Canonical storage

Gate:

- byte and semantic preservation fixtures pass
- Evidence and Citation positions are not silently damaged
- editor save creates Draft or Candidate state, never direct Canonical mutation

### F5 — Advanced Draft Collaboration

Deferred until a separate ADR.

Possible scope:

- Yjs-based Draft ChangeSet collaboration
- multi-user and Agent draft presence
- conflict resolution for draft-only state

It must not be enabled by the frontend foundation or Visual Editor work without explicit approval.

## 3. Stage record reconciliation

Historical Stage completion records remain intact but are interpreted as follows:

- Stage 5: minimum Review vertical slice and backend contract verification
- Stage 7: minimum Ask and cited-answer vertical slice
- Stage 9: graph projection and minimal UI/list verification
- Stage 12: UX mock contract and module reuse verification

Final Product Frontend completion is tracked only by F0~F5 gates in this roadmap.

## 4. Required testing

- unit tests
- Product API contract tests
- browser integration tests
- end-to-end tests
- accessibility tests
- authentication and CSRF tests
- project isolation and cache-leak tests
- stale-state tests
- reconnect and recovery tests
- editor preservation fixtures
- graph/list equivalence tests
- limited visual regression tests where useful

## 5. Branch and release rules

- Frontend work is developed on dedicated branches and reviewed before merge.
- Current P0-1·P0-2 security work is not modified by this roadmap.
- A new frontend screen replaces an inline screen only after equivalent behavior and security tests pass.
- Inline UI and `shotgun-web` are not both declared canonical final product surfaces.
- Real external Connectors remain disabled until their separate release gate passes.

## 6. Open decisions

Before F0 implementation, separately decide:

- framework and exact version
- SPA/SSR/desktop boundary
- route policy
- design system and component library
- server-state and form libraries
- typed client generation
- SSE reconnect/replay implementation
- browser E2E tool
- frontend build, deployment and update process
- mobile support level
