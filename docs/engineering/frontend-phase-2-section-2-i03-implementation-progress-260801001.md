# Frontend Phase 2 Section 2 I03 Implementation Progress

Status: `IN_PROGRESS`
Work item: `FE-P2-S2-I03`
Implementation approval: 2026-08-01

## Implemented boundary

- `AskAnswerProviderPort` and the existing pinned Gemini adapter boundary;
- PostgreSQL and in-memory execution repositories;
- additive AnswerRun attempt, event, export, feedback, and transition-seed
  persistence in migrations `022_frontend_phase2_ask_execution.sql`,
  `023_frontend_phase2_ask_execution_recovery.sql`, and
  `024_frontend_phase2_ask_execution_sensitivity.sql`;
- server-derived AnswerRun Project scope and command-ledger-backed mutation
  routes for cancel, retry, export, feedback, and transition seeds;
- authoritative mode-aware context resolution for Canonical, SourceVersion, and
  Hybrid execution with immutable attempt Evidence snapshots;
- provider data-policy enforcement before provider invocation, actual Gemini
  interaction streaming with AbortSignal propagation, and durable attempt audit;
- PostgreSQL worker claim/lease/heartbeat/restart recovery; HTTP enqueue is only
  a wake hint;
- per-resource Project authority resolution for active-project questions versus
  Conversation-resource follow-ups, with the authority revision/scope persisted
  into the command, AnswerRun, and execution attempt;
- fail-closed SourceVersion pinning and pinned-version question search for
  Source Exploration, which remains hidden from the product UI until a
  server-backed selector is available;
- transaction commit/rollback outcome states, lease-owner CAS for heartbeat and
  terminal writes, periodic expired-lease recovery, and UUID worker identity;
- Gemini stream completion requires `interaction.completed`; the browser keeps
  AnswerRun attempt-aware polling and preserves command identity while resolving
  `COMPLETED`, `REJECTED`, or `OUTCOME_UNKNOWN` mutation outcomes;
- transactional command mutation plus ledger completion, commit-outcome
  resolution without blind rejection, idempotent read-only replay resolvers,
  and produced-resource links for AnswerRun/attempt/export/feedback/seed;
- shared PostgreSQL transaction state handling for Question Submit, command
  ledger, and Answer Execution, including commit/rollback acknowledgement-loss
  `OUTCOME_UNKNOWN` behavior and post-commit callback isolation;
- shared SourceSelection contract validation in both in-memory and PostgreSQL
  validators, with empty/duplicate SOURCE_EXPLORATION pinning rejected before
  persistence;
- AnswerRun command semantic digests and outcome resolution bound to the
  target AnswerRun precondition, including client-side target-resource checks;
- bounded worker concurrency with interval recovery/queue scans that do not
  wait for provider completion, in-flight attempt tracking, and attempt-safe
  AbortController cleanup;
- resource Conversation Workspace revisions resolved from the resource
  Project authority, with missing Ask execution authority failing closed;
- browser polling of durable partial events with AnswerRun-scoped incremental
  ordinals, follow-up restart, stale-response guards, and terminal cleanup;
- contract, service, and PostgreSQL regression coverage.

No Canonical Knowledge write is performed by I03. Transition operations create
explicit `PROPOSED` seeds only.

## Current evidence

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:unit` (37 files, 201 tests)
- `npm.cmd run test:contract` (25 files, 201 tests)
- `npm.cmd run test:integration` (15 files, 52 tests)
- `npm.cmd run frontend:test` (10 files, 32 tests)
- `npm.cmd run frontend:build`
- `npm.cmd run test:architecture`
- `npm.cmd run test:database` (23 files, 99 tests)
- `npm.cmd run db:migrate`
- `npm.cmd run db:verify`
- `npm.cmd run frontend:typecheck`
- `npm.cmd run docs:validate`
- `npm.cmd run docs:frontend-work-items`
- `npm.cmd run docs:completion-invariants`
- `npx.cmd vitest run tests/unit/frontend-ask-execution.test.ts tests/contract/frontend-ask-execution.contract.test.ts --maxWorkers=1 --fileParallelism=false`
- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-ask-write-postgres.database.test.ts --maxWorkers=1 --fileParallelism=false --testTimeout=20000 --hookTimeout=20000`
- `npx.cmd vitest run tests/unit/frontend-ask-execution.test.ts tests/unit/gemini-provider.test.ts tests/contract/frontend-ask.contract.test.ts tests/contract/frontend-ask-execution.contract.test.ts --maxWorkers=1 --fileParallelism=false` (19 tests)
- `npx.cmd vitest run tests/integration/frontend-ask-product-api.test.ts --maxWorkers=1 --fileParallelism=false`
- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run
  tests/unit/frontend-ask-execution.test.ts
  tests/unit/frontend-ask-write-postgres.test.ts
  tests/unit/postgres-transaction.test.ts
  tests/unit/frontend-command-gateway.test.ts
  tests/contract/frontend-ask.contract.test.ts --maxWorkers=1
  --fileParallelism=false` (5 files, 29 tests)

A previous full database-suite rerun exceeded the 120-second local command
limit after the executed suites reported success. The current focused Ask
PostgreSQL write/execution test passed. This remains validation evidence, not a
completion claim.

## Not yet a completion claim

The Section 2 completion manifest remains `IN_PROGRESS` with its mandatory
criteria `NOT_RUN` until the full frontend, remote CI, exact-head, and review
evidence are available. The current follow-up implementation is still awaiting
the full exact-head regression/attack-recovery evidence, remote CI, and the
separate I03 Verification Record. Completion status is intentionally unchanged.
