# Frontend Product Surface Amendment

- Status: **Accepted**
- Decision date: 2026-07-18
- Amends: `shotgun-module-architecture-add.md`
- Related: ADR-093, ADR-094, ADR-095
- Canonical ADD: Notion `Frontend and Human Interaction Architecture (확정)`

## 1. Reason for amendment

The Module Architecture ADD defined Assemblies, reusable Modules, Kernel and Adapters, but did not show the user-facing Client Product as an explicit container. Phase 1~6 already contained detailed interaction policies, and the reference architecture already selected a Shotgun-owned frontend. This amendment restores that previously decided boundary without changing any Knowledge Flow, Canonical, Evidence, Approval or Security semantics.

## 2. Accepted container boundary

```text
Browser / future approved desktop wrapper
        ↓
apps/shotgun-web
        ↓
packages/shotgun-api-client
        ↓
Shotgun HTTP Command·Query API + SSE Activity Stream
        ↓
Shotgun Personal Knowledge OS Assembly
        ↓
Reusable Modules / Kernel / Adapters
```

`shotgun-web` is the final user-facing Product Surface. The HTML and JavaScript embedded in `assemblies/shotgun-app/src/server.ts` are classified as `Backend Vertical Slice UI`; they remain only as temporary integration and diagnostic surfaces until equivalent frontend flows pass the required gates.

## 3. Ownership boundary

Frontend owns:

- App Shell and navigation
- Workspace composition
- presentation and non-authoritative client state
- server query cache
- draft-only editor state
- loading, error, retry, cancellation and progress presentation
- browser accessibility and responsive layout

Server owns:

- authenticated Principal and Project Membership
- scope and sensitivity clearance
- Source, Evidence, Validation and Candidate authority
- Canonical Knowledge and History
- Approval validity
- Action risk and execution authority
- Compiled Truth and projection semantics
- Audit and retry eligibility

The browser must not construct authoritative Actor, Project, Scope or Sensitivity headers. UI state does not replace Approval or Canonical records.

## 4. Product workspaces

The initial workspace model is:

```text
Home
Sources
Ask
Knowledge
Review
Activity
History
Settings
```

Each workspace consumes versioned Product View Models through `shotgun-api-client`; it does not read module tables, ORM records or internal message payloads directly.

## 5. Reference OSS boundary

`ddsyasas/llm-wiki` remains `REFERENCE_ONLY` or Shotgun-owned `AUGMENT` for Source Intake, Ask·Chat, cost/model/settings and action-oriented Home interaction patterns. Its backend, SQLite/filesystem authority, unrestricted paths and 3D-only graph are excluded.

Inkeep OpenKnowledge remains a Human Cockpit reference for Visual/Source UX, 2D Graph, Agent Activity, Burst Diff, Entity Vault templates and preservation tests. Its complete runtime, local filesystem authority, canonical Markdown/Yjs and direct editor-to-Canonical mutation are excluded. Yjs remains deferred to a separate ADR.

## 6. Package target

Minimum:

```text
apps/shotgun-web
packages/shotgun-api-client
```

Optional packages, only when reuse and coupling evidence justify separation:

```text
packages/editor-core
packages/graph-ui
packages/activity-ui
```

## 7. Required gates

A screen replaces the current vertical-slice UI only after passing:

- Product API contract tests
- browser integration and end-to-end tests
- authentication, CSRF and project-isolation tests
- stale-state and recovery tests
- accessibility tests
- graph/list equivalence or editor-preservation tests when applicable

Approval, Canonical writes and Action execution must not use optimistic client authority.

## 8. Open technical decisions

This amendment does not select:

- frontend framework or exact version
- SPA, SSR or desktop-wrapper boundary
- route policy
- design system or component library
- server-state, form or validation library
- typed client generation mechanism
- SSE reconnect details
- visual editor technology
- browser E2E tooling
- mobile support and deployment/update process

Those decisions require later technical review or ADRs.
