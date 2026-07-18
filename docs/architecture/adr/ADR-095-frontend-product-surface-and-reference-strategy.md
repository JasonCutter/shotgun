# ADR-095: Frontend Product Surface and Reference Strategy

- Status: Accepted
- Decision date: 2026-07-18
- Decision owners: Project Shotgun architecture review
- Canonical ADD: Notion `Frontend and Human Interaction Architecture (확정)`
- Related documents:
  - `docs/shotgun_reference_architecture_strategy_ko.html`
  - `docs/implementation/implementation-roadmap.md`
  - `docs/implementation/oss-integration-roadmap.md`
  - `docs/implementation/frontend-delivery-roadmap.md`
  - `docs/engineering/frontend-strategy-reconciliation.md`
  - `docs/architecture/module-architecture/frontend-product-surface-amendment.md`
  - ADR-093 HTTP Identity and Authorization Boundary
  - ADR-094 Server-bound Action Preview, Approval and Execution

## Context

Shotgun's reference architecture already defined a dedicated frontend product surface, but implementation progressed primarily through backend modules and minimal HTML vertical slices embedded in `assemblies/shotgun-app/src/server.ts`.

The existing strategy selected:

- `ddsyasas/llm-wiki` as a reference for product workflows such as Source Intake, Ask·Chat, cost and model selection, Settings and an action-oriented Home.
- Inkeep OpenKnowledge as a reference for the Human Cockpit, including Visual/Source editing, 2D Graph, Agent Activity and Burst Diff.
- A new Shotgun-owned `shotgun-web` application rather than either reference project's complete runtime.

The strategy was present in reference and implementation documents but was not promoted into a single explicit frontend architecture decision. This created a traceability gap: Stage completion records mentioned minimal UI slices, while the planned frontend packages and application boundary were not implemented.

## Decision

### 1. Dedicated Shotgun frontend

Shotgun will use a dedicated product frontend named `shotgun-web`.

```text
Browser / future approved desktop wrapper
  -> apps/shotgun-web
    -> packages/shotgun-api-client
      -> Shotgun Gateway / HTTP API / SSE event stream
        -> Shotgun application modules
```

The frontend is a Shotgun-owned product surface. It is not a maintained fork or embedded runtime of either reference project.

### 2. ddsyasas reference boundary

Use `ddsyasas/llm-wiki` only for selected Interaction and Presentation patterns:

- action-oriented Home
- Paste, File and URL Source Intake
- format preview
- cost preview and model-selection UX
- Ask·Chat composer and result layout
- Settings, project, privacy and cost UX
- command-palette patterns

Do not adopt its SQLite, Markdown-folder storage, ingest/query/lint backend, unrestricted path model, blocking progress model or 3D canvas-only graph as Shotgun product infrastructure.

The allowed integration decisions are `REFERENCE_ONLY` and Shotgun-owned `AUGMENT` implementations behind Shotgun contracts.

### 3. OpenKnowledge reference boundary

Use Inkeep OpenKnowledge only for selected Human Cockpit patterns:

- Visual/Source mode UX
- Markdown round-trip preservation gates
- 2D Graph interaction, filters and neighborhood exploration
- Agent Activity and changed-item grouping
- Burst Diff
- Entity Vault templates
- optional future Draft ChangeSet collaboration patterns

Do not adopt the complete OpenKnowledge runtime, local filesystem API, MCP/search/Git-sharing runtime, canonical Markdown/Yjs storage, direct canonical mutation from editor state or the tightly coupled editor as a whole.

Yjs remains deferred and may only be introduced for Draft ChangeSet collaboration through a separate ADR.

### 4. Server authority

The frontend does not own or derive authoritative security or knowledge decisions.

The server remains authoritative for:

- authenticated Principal
- Project Membership
- Scope and sensitivity clearance
- Source, Evidence and Validation records
- Canonical writes
- Approval validity
- Action risk and execution authority
- Compiled Truth projection semantics

The frontend must consume the trusted Session, CSRF and Project Context boundary established by ADR-093. It must consume server-bound Action Preview, Approval and Execution records established by ADR-094.

The browser must not construct authoritative Actor, Project, Scope or Sensitivity headers.

### 5. Current inline UI status

The HTML and JavaScript embedded in `assemblies/shotgun-app/src/server.ts` are classified as `Backend Vertical Slice UI`.

They are retained temporarily for contract and integration verification, but they are not the canonical final product surface. They will be replaced screen by screen after equivalent `shotgun-web` flows pass typed contract, browser, accessibility and security tests.

### 6. Intended package boundary

The minimum target structure is:

- `apps/shotgun-web`
- `packages/shotgun-api-client`

Optional focused packages may include:

- `packages/editor-core`
- `packages/graph-ui`
- `packages/activity-ui`

Optional packages are created only when reuse and coupling evidence justify separation. Exact framework, library and deployment choices are not decided by this ADR.

### 7. Workspace model

The initial product workspaces are:

- Home
- Sources
- Ask
- Knowledge
- Review
- Activity
- History
- Settings

Each workspace consumes versioned Product View Models rather than module tables, ORM objects or raw internal message records.

### 8. Delivery sequence

Preserve the previously documented sequence:

1. Frontend Foundation
2. Frontend MVP: Home, Sources, Ask, Knowledge, Settings
3. Review and Activity
4. Semantic Graph
5. Visual Editor
6. Advanced Draft Collaboration through a separate ADR

Historical Stage 5, 7, 9 and 12 UI completion records describe minimum vertical slices or mock-contract verification. Final Product Frontend completion is tracked by the Frontend Delivery Roadmap.

## Consequences

### Positive

- Restores the previously confirmed frontend strategy without inventing a new product direction.
- Separates the product UI from backend assembly and module implementation.
- Prevents reference-project runtime and storage models from becoming parallel Shotgun authorities.
- Makes authentication, project context, approval and canonical boundaries explicit in the UI architecture.
- Provides a migration path from current vertical slices without discarding working API and module contracts.

### Negative

- Requires a new application and typed client package.
- Requires browser, accessibility and frontend security testing in addition to existing module tests.
- Temporarily maintains two presentation surfaces during migration.
- Requires Stage 5, 7, 9 and 12 completion language to distinguish minimal UI verification from final product frontend delivery.

## Rejected alternatives

1. Keep inline HTML in `server.ts` as the final product frontend.
2. Adopt the complete `ddsyasas/llm-wiki` application and backend.
3. Adopt the complete OpenKnowledge runtime.
4. Allow client state to represent Approval or Canonical truth.
5. Allow the browser to set trusted Actor, Project, Scope or Sensitivity headers.
6. Use a 3D canvas-only graph without an accessible list fallback.
7. Enable Yjs collaboration in the initial frontend foundation.
8. Treat previous minimum UI vertical slices as final product frontend completion.

## Open decisions

The following require later Section review and must not be silently inferred from this ADR:

- frontend framework and exact version
- SSR, SPA and desktop-wrapper boundary
- route and URL policy
- design system and component library
- server-state and form libraries
- typed client generation strategy
- SSE reconnect and replay UX
- visual editor technology
- browser E2E tool
- mobile support level
- frontend packaging, deployment and update process

## Acceptance record

ADR-095 became Accepted after the user confirmed the `Frontend and Human Interaction Architecture` Section on 2026-07-18.

The decision was synchronized to:

- the Notion Canonical ADD hub
- the Canonical `Frontend and Human Interaction Architecture (확정)` page
- the Module Architecture frontend amendment
- the Frontend Delivery Roadmap
- the repository ADD completion snapshot

This acceptance does not declare frontend implementation complete and does not modify the P0-1 or P0-2 implementation branch.
