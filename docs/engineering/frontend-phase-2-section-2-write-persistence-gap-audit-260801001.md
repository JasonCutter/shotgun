# Frontend Phase 2 Section 2 — Ask Write & Persistence Gap Audit

**Date**: 2026-08-01  
**Repository**: `JasonCutter/shotgun`  
**Base Canonical Main SHA**: `e24725eac8c44722c7937eca5cb6a28122a4fef3`  
**Target Branch**: `codex/frontend-phase-2-section-2-write`

---

## 1. Summary of Requirements & Scope

This audit evaluates the gap for **Slices 4~5 (Submit Question Command & Persistence Foundation)** of Frontend Phase 2 Section 2 (Ask & Conversations Workspace).

### Included Scope

- **Slice 4 (Submit Question Command & Idempotency Boundary)**:
  - Protected Product API Route `POST /product-api/frontend/ask/questions`
  - Server Authority Derivation (Active Project for new questions, Conversation Resource Project for follow-up questions)
  - Command Gateway transaction sequence (`ACCEPT` -> `Domain Write` -> `COMPLETE` / `REJECT`)
  - Idempotency Replay (`clientRequestId`, `idempotencyKey`, `commandId`, `answerRunId`)
  - AnswerRun initial state model (`ACTION_REQUIRED` / `QUEUED`) without external AI execution
  - Outcome Resolution route `GET /product-api/frontend/ask/question-submissions/by-client-request/:clientRequestId`
- **Slice 5 (Persistence Foundation)**:
  - Aggregate persistence for `Conversation`, `Branch`, `Turn`, `AnswerRun`, `Statement`, `Citation`, `SourceSelection`
  - Revision & optimistic concurrency control (`conversationRevision`, `branchRevision`, `turnRevision`, `answerRevision`)
  - In-memory write adapter for contract & unit/integration testing
  - Formal Database Migration Proposal for user approval before DDL creation

### Excluded Scope (Strict Boundary)

- Zero streaming execution (`STREAMING` state stream consumption)
- Zero external AI provider SDKs or API keys
- Zero Cancel or Retry commands (`CANCEL`, `RETRY_SAME_CONTEXT`, `RETRY_CURRENT_POLICY`)
- Zero Export, Feedback, IntakeDraftSeed, DraftChangeSetSeed, UserDirectiveProposalSeed
- Zero automatic Canonical Knowledge commit

---

## 2. Existing Reusable Assets vs. Mandatory New Components

| Area                   | Existing Reusable Asset                                                                                                              | Mandatory New Component                                                                                                                |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **Command Gateway**    | `018_frontend_command_request_outcome_contract.sql`<br/>`buildPrincipalScopedCommandSemanticDigestInput`<br/>`rejectAcceptedCommand` | `SUBMIT_ASK_QUESTION` frontend command type & contracts                                                                                |
| **Product API Routes** | Fastify route pattern in `assemblies/shotgun-app/src/product-api/`                                                                   | `POST /product-api/frontend/ask/questions`<br/>`GET /product-api/frontend/ask/question-submissions/by-client-request/:clientRequestId` |
| **Read Projections**   | `InMemoryAskWorkspaceProjection`                                                                                                     | In-memory write mutation updates for `InMemoryAskWorkspaceProjection`                                                                  |
| **Client & UI**        | `@shotgun/api-client` Ask client & `AskWorkspaceRoute`                                                                               | `submitQuestion` API client method & UI Submit button enablement (`capabilities: ['SUBMIT_QUESTION']`)                                 |
| **Persistence**        | PostgreSQL DDL pattern in `020_frontend_phase2_sources_product_persistence.sql`                                                      | `InMemoryAskWriteAdapter`<br/>Migration Proposal `frontend-phase-2-section-2-persistence-migration-proposal-260801001.md`              |

---

## 3. Database Migration & Dependency Analysis

1. **Database Migration Status**:
   - PostgreSQL schema currently lacks Conversation/Branch/Turn/AnswerRun tables (`db/migrations/001`~`020`).
   - An `InMemoryAskWriteAdapter` will be built first for in-process application and contract/E2E test suite.
   - A detailed Database Migration Proposal document will be presented for explicit user review prior to creating any SQL migration files in `db/migrations`.
2. **Runtime Dependencies**:
   - Zero new runtime dependencies required. Node `crypto` (`randomUUID`, `createHash`), existing Fastify, and Vitest are completely sufficient.
3. **External Providers**:
   - Zero external AI providers required. `AnswerRun` initial state is set to `ACTION_REQUIRED` (`reason: MODEL_EXECUTION_NOT_CONFIGURED`) or `QUEUED`.

---

## 4. Acceptance Criteria Mapping (Slices 4~5 Target)

- **AC-01 (Protected versioned API & decoders)**: Add `decodeSubmitAskQuestionRequest` with unknown field & browser authority rejection.
- **AC-02 (Server-derived authority)**: Derives project binding and access revision strictly on server.
- **AC-03 (Active/Resource Project binding)**: New questions bind to Active Project; follow-up questions bind to Conversation Resource Project.
- **AC-04 (Resource identity & revision)**: Aggregate revision validation (`STALE_RESOURCE` on mismatch).
- **AC-05 (Browser-private Project-fixed Draft)**: Draft clears upon successful server submission.
- **AC-07 (Bounded validation)**: Rejects oversized text (>10,000 chars) or invalid ID lengths (>256 chars).
- **AC-09 (Authoritative AnswerRun Snapshot)**: AnswerRun initial state reflects actual runtime capability.
- **AC-13 (OUTCOME_UNKNOWN no resubmission)**: Browser outcome resolution without automatic duplicate resubmission.
- **AC-14 (Idempotency Replay)**: Identical key replays outcome; mismatched payload yields conflict.
- **AC-19 (Project switch & cache isolation)**: Non-active project deep-link follow-up keeps Active Project unchanged.
- **AC-20 (Offline & stale write safety)**: Stale revision or offline status blocks submit.
- **AC-24 (Gates)**: All contract, unit, integration, database, and browser E2E quality gates pass.

---

## 5. Next Steps

1. Create Submit Question command types & decoders in `packages/contracts/src/frontend-ask.ts`.
2. Implement in-memory Ask Write domain service & persistence adapter.
3. Add `POST /product-api/frontend/ask/questions` & outcome resolution routes.
4. Update `@shotgun/api-client` and UI `AskWorkspaceRoute` to enable `SUBMIT_QUESTION` capability.
5. Create Migration Proposal document for explicit user review.
