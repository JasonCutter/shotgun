# Developer Workflow Contract — Bootstrap and Test Suite Separation

## Status

Accepted.

- Approval date: 2026-07-28
- Approver: User
- Implementation status: not started
- Classification: developer experience and engineering workflow contract

## Context

The current root `bootstrap` script always runs:

```text
npm ci
-> docker compose up -d db
-> npm run db:reset
```

This is slow for repeated local setup, performs a destructive database reset by default, and does not explicitly wait for PostgreSQL health before database work starts.

The current root `test` script serially runs unit, contract, integration, architecture, and Stage 12 package tests. Fast local feedback and the CI baseline are therefore not named separately.

## Decision 1 — Replace the bootstrap shell chain with a typed script

Implement `scripts/bootstrap.ts` and expose:

```json
{
  "bootstrap": "tsx scripts/bootstrap.ts",
  "bootstrap:reset": "npm run bootstrap -- --reset-db",
  "bootstrap:quick": "npm run bootstrap -- --skip-db"
}
```

The default execution order is:

```text
npm ci
-> docker compose up -d --wait db
-> npm run db:migrate
-> npm run db:verify
```

The default bootstrap must not delete local data.

Supported options:

```text
--skip-db
--skip-install
--reset-db
--help
```

Rules:

- `--skip-db` skips Docker database startup, migration/reset, and verification.
- `--skip-install` skips only `npm ci`.
- `--reset-db` is the only path that may execute destructive `db:reset`.
- `--skip-db` and `--reset-db` together fail immediately.
- Unknown options fail instead of being ignored.
- Child-process failures preserve their exit status and stop the workflow.
- Database work starts only after the Compose health gate passes.
- Command execution is injectable so unit tests do not require Docker or PostgreSQL.

## Decision 2 — Separate quick local tests from the CI baseline

Add:

```text
test:quick
= test:unit
-> test:contract
-> test:architecture
```

Add:

```text
test:ci
= test:unit
-> test:contract
-> test:integration
-> test:architecture
-> test:stage12-package
```

Transition rules:

1. Until GitHub Actions explicitly invokes `npm run test:ci`, `test` remains an alias of `test:ci`.
2. Only after the CI workflow is updated and verified may `test` become an alias of `test:quick`.
3. Database tests, frontend build/E2E, `quality:gate`, and `stage12:reuse-operations-gate` are handled by the subsequent CI gate decision.
4. Live AI tests are excluded from ordinary `test:ci` because credentials, cost, and external-provider availability are involved.

## Required verification

### Bootstrap

- Default order is install, database health wait, migrate, verify.
- `--skip-db` executes no database command.
- `--skip-install` skips only dependency installation.
- `--reset-db` is the only mode that executes reset.
- Unsupported or conflicting options fail fast.
- Child-process exit status is preserved.

### Test scripts

- `test:quick` excludes integration, database, and Stage 12 package tests.
- `test:ci` preserves the full scope of the previous root `test` script.
- Before the CI workflow changes, `test` points to `test:ci`.

## Impact

- `package.json`
- `scripts/bootstrap.ts`
- bootstrap unit tests
- Stage 0 development documentation and repository onboarding guidance
- subsequent GitHub Actions workflow changes

## Excluded

- Required-check and branch-protection configuration
- CI integration of quality and Stage 12 operations gates
- database/frontend job parallelization
- automatic live AI test execution

## Approval boundary

This document accepts the developer workflow contract. It does not authorize implementation, CI changes, PR-ready transition, or merge without the normal implementation and verification process.
