# Frontend and Human Interaction Architecture

- Status: **Accepted**
- Decision date: 2026-07-18
- Canonical source: Notion `Frontend and Human Interaction Architecture (확정)`
- Related ADR: ADR-093, ADR-094, ADR-095
- Scope: Cross-cutting Product Frontend Architecture for Phase 1~6

## Decision summary

Shotgun's final user-facing product surface is a dedicated Shotgun-owned frontend application:

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

This decision connects the already accepted Phase 1~6 interaction policies without adding a new Knowledge Flow Phase or changing Evidence, Canonical, Approval, Security or Action authority.

## Authority boundary

Frontend owns App Shell, navigation, workspace composition, presentation state, server query cache, draft-only editor state, loading/error/retry/progress presentation, accessibility and responsive layout.

Server remains authoritative for Principal, Project Membership, scope and sensitivity, Source, Evidence, Validation, Candidate, Canonical Knowledge, History, Approval validity, Action risk/execution, Projection semantics, Audit and retry eligibility.

The browser must not construct authoritative Actor, Project, Scope or Sensitivity headers. UI state does not replace Approval or Canonical records. Approval, Canonical write and Action execution do not use optimistic client authority.

## Initial workspaces

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

- Sources implements the accepted Phase 1 Section 1.9 intake flow.
- Ask presents Statement-level Citation, Conflict, Gap, Uncertainty and readiness.
- Knowledge presents Compiled Truth, 2D Graph and accessible list/table alternatives.
- Review binds Candidate, Validation, Evidence, Snapshot, Comparison, Conflict, Diff, Impact and Approval capability.
- Activity presents Job/Attempt progress, failure, retry, cancellation and OUTCOME_UNKNOWN state.
- History presents revisions, decision reasons, Evidence, policies, Diff and rollback proposals.
- Settings consumes server-authorized Principal, Project, Session and API-token lifecycle contracts.

## Typed product boundary

`shotgun-api-client` provides versioned Product View Models. The frontend does not read database rows, ORM objects or module-internal records directly.

Queries are read-only. Commands apply CSRF, authorization, idempotency and expected revision. SSE is the initial candidate for Activity streaming and reconnects through cursor plus snapshot reconciliation.

## State boundary

Server-authoritative state includes authentication, active Project, Membership, scope, sensitivity, Intake/Job/Attempt, Evidence/Validation/Candidate, Review/Approval, Canonical/Projection and Action state.

Client state is limited to presentation state such as panels, tabs, temporary filters, sorting and non-authoritative preferences. Intake text, Review edits and Visual/Source edits are Draft state until an explicit server contract records them. Phase 1 Intake drafts are not automatically stored in browser local storage or on the server.

## Reference OSS strategy

### ddsyasas/llm-wiki

Use only selected Interaction and Presentation patterns for action-oriented Home, Paste/File/URL Intake, format preview, cost/model/settings and Ask·Chat. Do not adopt its backend, SQLite/filesystem authority, provider runtime, unrestricted path model, blocking progress or 3D-only graph.

Integration decision: `REFERENCE_ONLY` or Shotgun-owned `AUGMENT`.

### Inkeep OpenKnowledge

Use selected Human Cockpit patterns for Visual/Source UX, preservation gates, 2D Graph, Agent Activity, Burst Diff and Entity Vault templates. Do not adopt the complete runtime, local filesystem authority, canonical Markdown/Yjs, direct editor-to-Canonical mutation or initial Yjs collaboration.

Yjs remains deferred to a separate ADR.

## Current inline UI

HTML and JavaScript embedded in `assemblies/shotgun-app/src/server.ts` are classified as `Backend Vertical Slice UI`. They are temporary integration/diagnostic surfaces, not the final product frontend.

Replacement order:

1. Product API and Typed Client
2. Auth·Project App Shell
3. Sources
4. Ask
5. Knowledge
6. Review
7. Activity
8. History·Settings
9. Restrict inline UI to development-only
10. Decide final removal or diagnostic retention

Each screen must pass Product API contract, browser E2E, accessibility, authentication/CSRF, project-isolation, stale-state and recovery gates before replacement.

## Package target

Minimum:

```text
apps/shotgun-web
packages/shotgun-api-client
```

Optional, only when reuse evidence justifies separation:

```text
packages/editor-core
packages/graph-ui
packages/activity-ui
```

## Delivery sequence

1. Frontend Foundation
2. Frontend MVP: Home, Sources, Ask, Knowledge, Settings
3. Review and Activity
4. Semantic Graph
5. Visual Editor
6. Advanced Draft Collaboration through a separate ADR

Historical Stage 5, 7, 9 and 12 UI completion records represent minimum vertical slices or mock-contract verification. Final Product Frontend completion is tracked through the accepted Frontend Delivery Roadmap.

## Rejected alternatives

- attach an arbitrary UI after backend completion
- retain inline HTML as the final product UI
- fork the complete ddsyasas application
- adopt the complete OpenKnowledge runtime
- client-side authority headers
- UI-state Approval
- optimistic Canonical write
- 3D-only graph navigation
- visualization without accessible fallback
- initial real-time CRDT

## Open technical decisions

This decision does not select the frontend framework, exact version, SPA/SSR/desktop boundary, route policy, design system, state/form libraries, typed-client generation, SSE implementation details, visual editor technology, browser test tooling, mobile scope or deployment/update process.

Those decisions require later technical review or ADRs.

## Acceptance effect

This Section is accepted and recorded in the Notion Canonical ADD. Acceptance restores and formalizes the existing frontend strategy; it does not declare frontend implementation complete and does not modify the P0-1·P0-2 implementation branch.
