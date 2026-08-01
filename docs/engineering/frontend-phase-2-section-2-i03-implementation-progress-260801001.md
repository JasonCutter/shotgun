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
- transactional command mutation plus ledger completion, commit-outcome
  resolution without blind rejection, idempotent read-only replay resolvers,
  and produced-resource links for AnswerRun/attempt/export/feedback/seed;
- browser polling of durable partial events with AnswerRun-scoped incremental
  ordinals, follow-up restart, stale-response guards, and terminal cleanup;
- contract, service, and PostgreSQL regression coverage.

No Canonical Knowledge write is performed by I03. Transition operations create
explicit `PROPOSED` seeds only.

## Current evidence

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:unit` (34 files, 189 tests)
- `npm.cmd run test:contract` (25 files, 199 tests)
- `npm.cmd run test:integration -- --maxWorkers=1 --fileParallelism=false` (15
  files, 52 tests)
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

## Not yet a completion claim

The Section 2 completion manifest remains `IN_PROGRESS` with its mandatory
criteria `NOT_RUN` until the full frontend, remote CI, exact-head, and review
evidence are available. The current follow-up implementation is still awaiting
the full exact-head regression/attack-recovery evidence, remote CI, and the
separate I03 Verification Record. Completion status is intentionally unchanged.
