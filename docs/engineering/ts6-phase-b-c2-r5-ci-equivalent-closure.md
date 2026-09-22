# TS-6 Phase B C2-R5 CI-equivalent closure

Date: 2026-09-20  
Worktree: `C:\dev\shotgun-ts6-phase-b`  
Branch: `codex/ts6-postgres-transaction-phase-b`  
Base/main/HEAD: `1f821ea371b308d8cecede4a98ebe27960873b21`

## Controller disposition

`C2-R5 = CHANGES_REQUIRED / STOP`.

C2-R4 source, evidence, validator, fixture, and command-gateway review passed. R5
opened only the repository-owned `db-test` target at `localhost:5433/shotgun_test`
through the existing guard, and `db:test:reset` plus `db:test:verify` passed.

The exact selected sixteen-target database evidence run then failed three tests.
Per the R5 controller request, no Product fix, broad database suite, `test:ci`,
unit rerun, or further focused rerun is authorized in this cycle.

## Database target and lifecycle

- Existing healthy container: Compose service `db-test`, canonical pgvector/pg16 image,
  host port `5433`, database namespace `shotgun_test`.
- `DATABASE_URL`: unset.
- `TEST_DATABASE_URL`: process-local only; credentials are intentionally omitted here.
- Target guard: PASS; `current_database()` resolved to `shotgun_test`.
- `npm run db:test:reset`: PASS.
- `npm run db:test:verify`: PASS before focused execution.
- Owner database/service: not touched.
- R5 started service: NO; the canonical container was already healthy.
- Poststate: leave the pre-existing `db-test` container running; do not stop a
  service not started by R5.

## Focused execution

CG-RB-01 through CG-RB-08: PASS (8/8).  
The three new minimal proofs (`saveFailureContext`, `updateProject`, and
`updatePrincipalPreferences`): PASS (3/3).

The sixteen-target manifest was selected by exact boundary IDs and active test
titles. The test files were launched together against the shared canonical test
database, which exposed shared-table cleanup/seed interference:

1. `akp-5-wp2-discovery-reentry.database.test.ts` —
   `durably defers retryable failures, advances the retry boundary, and transitions to processed`
   failed while `seedApprovedAuthority` attempted to insert a `source_versions`
   row whose `original_asset_id` had been removed by concurrent shared-table
   cleanup (`23503`, `source_versions_original_asset_id_fkey`).
2. `frontend-ask-write-postgres.database.test.ts` —
   `commits aggregate and outcome atomically, recovers after restart, and serializes follow-ups`
   failed with `NOT_FOUND` while resolving the question submission after the
   shared database was concurrently reset/cleaned.
3. `frontend-sources-stage3-recovery.test.ts` —
   `Stage3 first attempt throws → retry → same SourceId/SourceVersionId → Stage3 completes → Evidence exists → no duplicate SourceVersion`
   failed in its shared-table `TRUNCATE` setup with PostgreSQL `40P01 deadlock`.

The other selected evidence titles executed successfully, including the three
new minimal proofs and the paths covering connector recovery, activity locking,
re-entry intake, Stage 5 persistence/re-entry, source mixed submission,
provider privacy proposal/approval, and Section 2 project/preferences updates.

## Failure classification and boundary

This is classified as `TEST_ISOLATION_DEFECT / CHANGES_REQUIRED`, not as a silent
Product correction. The common mechanism is concurrent database-file execution
against a shared database where existing suites perform broad `TRUNCATE`/seed
operations. The R5 request requires stopping on any focused DB failure, so no
serial rerun was used to erase the failed evidence and no claim of DB closure is
made.

The `frontend-ask-write` `NOT_FOUND` symptom must remain open for the next
controller decision until it is reproduced under an isolated, serial execution
plan; it is not reclassified as a Product defect from this concurrent run alone.

## Frozen artifacts

- C1 ZIP SHA-256: `D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04`.
- C2-R3 ZIP SHA-256: `6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0`.
- C2-R4 ZIP SHA-256: `0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E`.
- v2 fixture SHA-256 remains `256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.
- No frozen artifact was regenerated or modified.

## Final stop

`SOURCE_AUTHORITY = PASS`  
`REGRESSION_EVIDENCE = NOT CLOSED — 3 focused DB failures`  
`DATABASE_EXECUTION = CHANGES_REQUIRED / STOP`  
`OVERALL = REVIEW_REQUIRED / STOP`

No commit, push, PR, Ready status, or TS-7 transition was performed.
