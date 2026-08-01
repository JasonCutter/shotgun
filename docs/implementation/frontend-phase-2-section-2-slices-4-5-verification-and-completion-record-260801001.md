# Frontend Phase 2 Section 2 — Slices 4–5 Verification and Completion Record

> **Correction note — 2026-08-01:** 이 기록의 Slices 4–5 구현·검증 증거는 유효하다. Parent Section `COMPLETE` 해석과 존재하지 않는 `FE-P2-S3` 경로는 [`Frontend Phase 2 Completion Status Reconciliation`](../engineering/frontend-phase-2-completion-status-reconciliation-260801001.md)에 의해 현재 상태 권위에서 대체된다. 원문과 Git 이력은 보존하며, 현재 Section 상태는 `docs/project/frontend-work-items.json`과 `docs/project/completions/FE-P2-S2.json`을 따른다.

- Record ID: `frontend-phase-2-section-2-slices-4-5-verification-and-completion-record-260801001`
- Date: 2026-08-01
- Repository: `JasonCutter/shotgun`
- Branch: `codex/frontend-phase-2-section-2-write`
- Draft PR: `#48`
- Canonical base: `main@e24725eac8c44722c7937eca5cb6a28122a4fef3`
- Verified implementation Head: `dc1506859fdae0bc5ff565e445b7f60005e61a3a`
- Exact implementation CI Run: `30659015382`
- Governing ADR: `ADR-123-ask-command-conversation-persistence-and-outcome-recovery-boundary.md`
- Governing contract: `frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md`
- Remediation request: `frontend-phase-2-section-2-slices-4-5-remediation-implementation-request-260801001.md`
- Status: **IMPLEMENTATION VERIFIED / USER AUTHORIZED PR READY, MERGE AND SECTION COMPLETION / FINAL EVIDENCE-COMMIT CI REQUIRED BEFORE TRANSITION**

## 1. Decision and transition authorization

The user approved the ADR-123 architecture and Frozen Implementation Contract, authorized remediation execution, and subsequently authorized PR Ready transition, merge and Frontend Phase 2 Section 2 completion.

The authorization is applied fail-closed:

1. no PR Ready transition before exact-head required gates pass;
2. no merge before the final evidence-only commit required gates pass;
3. no Section completion claim before merge is verified on `main`;
4. no Frontend Phase 2 Section 3 work is included or started by this record.

## 2. Confirmed implementation decisions

The verified implementation establishes the following decisions.

1. Submit Question is a protected Product API command using strict runtime decoders and Server-derived authority.
2. `AskCommandCoordinator`, Frontend Command Gateway, Ask aggregate repository and Ask query projection are separately testable responsibilities.
3. Transaction A durably accepts or replays the command through the existing Frontend Command Ledger.
4. Transaction B locks the accepted command and commits the Conversation aggregate plus Ledger `COMPLETED` transition with the same PostgreSQL transaction client.
5. New questions bind to the Server Active Project; follow-ups bind to the Conversation Resource Project without changing the Active Project.
6. Conversation, Branch, Turn and AnswerRun use globally unique opaque identities and durable revisions.
7. Follow-up writes require expected Conversation and Branch revisions; PostgreSQL row locks, optimistic predicates and Branch ordinal uniqueness prevent lost updates.
8. Idempotency uses all meaning-bearing fields, including ordered SourceSelections and ordered Evidence IDs.
9. Outcome recovery uses the existing Ledger command and `producedResources`, scoped by Principal and target Project; no parallel Ask command ledger or ad hoc outcome table is introduced.
10. Source, SourceVersion and Evidence existence, ownership, Project scope and sensitivity are validated before aggregate mutation.
11. Production runtime injects PostgreSQL Ask write, read and validation adapters. In-memory adapters remain test/local fixtures only.
12. Browser `OUTCOME_UNKNOWN` preserves the original `clientRequestId`, idempotency key and Draft; mutation is never automatically resubmitted.
13. With no approved model execution in Slices 4–5, the initial AnswerRun is `ACTION_REQUIRED / MODEL_EXECUTION_NOT_CONFIGURED`, not a false generated-answer success.
14. Ask results do not automatically create or modify Canonical knowledge or transition seeds.

## 3. Implementation evidence

### 3.1 Command and domain boundaries

- `modules/frontend-ask-write/src/index.ts`
  - owns structural Ask write ports rather than importing another Domain module directly;
  - derives target Project authority;
  - calls Command Gateway `accept` before validation/write execution;
  - records validation and revision failures as typed `REJECTED` outcomes;
  - completes Ledger outcome through the aggregate transaction.
- `modules/frontend-command-gateway/src/index.ts`
  - exposes command lock and transaction-bound completion operations.
- `adapters/frontend-command-gateway-postgres/src/index.ts`
  - locks the Ledger row and transitions to `COMPLETED` using the caller's `PoolClient`.

### 3.2 Persistence and query projection

- `adapters/frontend-ask-write-postgres/src/index.ts`
  - implements transactional aggregate create/append;
  - implements PostgreSQL Ask query projection;
  - implements SourceSelection authority validation.
- `db/migrations/021_frontend_phase2_ask_product_persistence.sql`
  - creates managed `frontend_ask` schema;
  - defines aggregate ownership, global identifiers, revisions, foreign keys and Branch ordinal uniqueness;
  - connects AnswerRun creation to the existing Frontend Command Ledger;
  - preserves SourceVersion and Evidence pins with database constraints.
- `scripts/database.ts`
  - registers `frontend_ask` for reset and verification.
- `assemblies/shotgun-app/src/main.ts`
  - injects PostgreSQL Ask write, read and SourceSelection validation adapters in the persistent runtime;
  - contains no silent production fallback to the in-memory Ask aggregate.

### 3.3 Browser recovery

- `packages/shotgun-api-client/src/ask-client.ts`
  - applies the protected mutation CSRF contract;
  - decodes authoritative submission and outcome responses.
- `apps/shotgun-web/src/routes/ask-workspace.tsx`
  - retains unresolved command identity and Draft;
  - performs outcome lookup without mutation resubmission;
  - clears Draft only after verified completion;
  - submits durable expected revisions for follow-ups.

### 3.4 History preservation

The earlier duplicate ADR-123 candidate was removed from the ADR owner namespace and preserved as:

`docs/architecture/history/ask-conversation-boundary-adr-123-candidate-260731.md`

The accepted ADR-123 remains the sole authoritative ADR owner. The original Migration proposal and original remediation request remain preserved as historical intent and execution instructions; this record is their evidence-backed successor.

## 4. S45-G01–S45-G18 verification matrix

| Gate | Result | Executable or structural evidence |
| --- | --- | --- |
| S45-G01 | **PASS** | Protected POST and outcome GET routes, strict request/response decoders, CSRF-protected Browser mutation. |
| S45-G02 | **PASS** | Principal, Active/Resource Project, access and policy revisions are derived from Server read scope; Browser authority fields fail closed. |
| S45-G03 | **PASS** | Ask read projection exposes reads only; command orchestration and persistence are separate ports/adapters. |
| S45-G04 | **PASS** | Every Submit Question path calls the existing Frontend Command Gateway before aggregate mutation. |
| S45-G05 | **PASS** | Ledger ACCEPT is durable; aggregate write and Ledger COMPLETED use one PostgreSQL transaction client. |
| S45-G06 | **PASS** | Full semantic digest, exact replay, idempotency mismatch and clientRequestId meaning conflict are tested. |
| S45-G07 | **PASS** | Outcome resolution uses Principal-scoped Ledger lookup, target Project access check and original produced resource identities. |
| S45-G08 | **PASS** | New Conversation, initial Branch, Turn, AnswerRun, revisions, SourceSelections and completed outcome are committed atomically. |
| S45-G09 | **PASS** | Follow-up requires expected Conversation/Branch revisions; stale and concurrent append behavior is tested against PostgreSQL. |
| S45-G10 | **PASS** | UUID-based opaque identities and Conversation/Branch/Turn/Answer revisions are persisted. |
| S45-G11 | **PASS** | PostgreSQL Source validator checks Source/Version/Evidence relationship, Project scope and sensitivity; invalid selection fails before aggregate mutation and is recorded as rejection. |
| S45-G12 | **PASS** | PostgreSQL repository, query projection and validator are injected in production assembly; in-memory aggregate is not the production path. |
| S45-G13 | **PASS** | Managed migration reset/verification succeeds; pool close/reopen database test proves Conversation and outcome recovery after restart. |
| S45-G14 | **PASS** | Completed submission and replay reload AnswerRun/Workspace from the committed query projection. |
| S45-G15 | **PASS** | Browser preserves Draft and original request identity during uncertainty, never auto-resubmits, and exposes explicit outcome resolution. |
| S45-G16 | **PASS** | Initial run is `ACTION_REQUIRED / MODEL_EXECUTION_NOT_CONFIGURED`; no false answer success is presented. |
| S45-G17 | **PASS** | No automatic Canonical commit, DraftChangeSetSeed or UserDirectiveProposalSeed is created. |
| S45-G18 | **PASS** | Exact-head docs, format, lint, typecheck, dependency audit, SBOM, migration reset, Stage 12, full CI, database tests, frontend unit/build and Chromium E2E all pass. |

## 5. Exact-head CI evidence

Implementation Head `dc1506859fdae0bc5ff565e445b7f60005e61a3a` was evaluated by GitHub Actions CI Run `30659015382`.

### Quality job

The Quality job completed successfully, including:

- Knowledge Flow generated-baseline verification;
- documentation governance validation;
- formatting validation;
- lint;
- repository-wide TypeScript typecheck;
- dependency audit;
- SBOM generation and verification;
- database reset with migration 021;
- Stage 12 reuse and operations gate;
- complete CI test suite;
- database test suite.

### Frontend job

The Frontend job completed successfully, including:

- frontend TypeScript typecheck;
- frontend unit tests;
- production build;
- frontend test database reset;
- Chromium end-to-end tests, including Ask submission and Draft clearing.

### PostgreSQL Ask evidence

`tests/database/frontend-ask-write-postgres.database.test.ts` verifies:

- aggregate and Ledger outcome commit;
- four produced resource identities;
- application-pool close/reopen restart recovery;
- durable outcome resolution by original clientRequestId;
- follow-up append with expected revisions;
- stale revision rejection without a new Turn;
- concurrent valid follow-ups producing one success and one typed rejection;
- final ordered Turn ordinals without lost update.

## 6. Migration 021 final disposition

The initial Migration proposal is retained as a historical candidate. Its original DDL was not activated unchanged.

Final disposition after ADR-123 remediation:

- managed schema: `frontend_ask`;
- transaction owner: repository migration runner;
- application transaction owner: `PostgresAskConversationRepository` with the Frontend Command Gateway sharing the same `PoolClient` for Transaction B;
- identifiers: Server-generated opaque UUID-based strings;
- revision strategy: persisted Conversation, Branch, Turn and Answer revisions with optimistic predicates;
- reset/verify: registered and executed by repository database tooling;
- rollback/forward repair: migration 021 remains editable before its first merge; after merge, changes require a new additive migration;
- restart compatibility: verified by PostgreSQL pool close/reopen test;
- activation: **AUTHORIZED WITH PR #48 MERGE AFTER THE FINAL EVIDENCE-COMMIT REQUIRED GATES PASS**.

## 7. Excluded alternatives and reasons

The following alternatives remain rejected:

- command or outcome ownership in an in-memory read projection;
- a parallel Ask-specific command ledger or `submission_outcomes` table;
- completing the Ledger outside the aggregate transaction;
- response construction from uncommitted local objects;
- Follow-up append without expected revisions;
- unlocked array-length ordinal allocation in production;
- SourceVersion/Evidence string acceptance without authoritative relationship checks;
- generating a new request key after an uncertain response;
- presenting `QUEUED` as meaningful progress when no model execution is configured;
- automatic Canonical knowledge mutation from Ask output.

## 8. Explicitly excluded future scope

The following remain outside Frontend Phase 2 Section 2 Slices 4–5 and are not implied by completion:

- external AI provider activation for Ask;
- final model answer generation and model routing;
- streaming and partial-event recovery;
- Cancel;
- Domain Retry;
- model and cost disclosure completion;
- Export;
- Feedback;
- `IntakeDraftSeed`;
- `DraftChangeSetSeed`;
- `UserDirectiveProposalSeed`;
- automatic Canonical commit;
- Frontend Phase 2 Section 3 implementation.

## 9. Impact scope

- Product API: Submit Question and outcome resolution become durable protected operations.
- Command infrastructure: existing Frontend Command Ledger gains transaction-bound completion support without changing its authority model.
- Database: managed `frontend_ask` aggregate schema is activated on merge.
- Browser: unresolved command recovery is explicit and fail-closed.
- Canonical knowledge: no automatic effect.
- Existing Slices 1–3 read semantics: preserved, with production reads moved to the durable PostgreSQL projection.

## 10. Open issues after this Section

No blocker remains for the Frozen Slices 4–5 contract at the verified implementation Head.

The future-scope items listed in Section 8 remain intentionally unresolved and require separate Section review and approval. They are exclusions, not defects in Slices 4–5.

## 11. Completion rule

After this evidence record is committed, its exact Head must pass the repository required gates. Once that condition is met, the already granted user authorization permits the following sequence without another approval request:

1. update PR #48 from Draft to Ready for review;
2. merge PR #48 to `main` using the repository's established merge method;
3. verify the merged commit on `main`;
4. record Frontend Phase 2 Section 2 as **COMPLETE** in the Project Shotgun architecture record;
5. do not begin Frontend Phase 2 Section 3 until it is separately opened under the Knowledge Flow process.
