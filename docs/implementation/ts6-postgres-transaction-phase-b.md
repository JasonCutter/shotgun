# TS-6 Phase B — PostgreSQL Transaction Correction

Status: `READY_FOR_INDEPENDENT_PATCH_REVIEW` only after the final verification and review bundle are complete.

Baseline: `1f821ea371b308d8cecede4a98ebe27960873b21`  
Worktree: `C:\dev\shotgun-ts6-phase-b`  
Branch: `codex/ts6-postgres-transaction-phase-b`

## Scope

Phase B corrects evidence-backed PostgreSQL commit-acknowledgement ambiguity while preserving existing Canonical, Evidence, Approval, Candidate, Review, Credential, and derived-projection ownership. The five primary corrections are Stage 4 provider-call `ensure`, Candidate `saveBatch`, Review V2 `resolveOperation`, Credential Vault `advanceRevision`, and Semantic Embedding `saveRevision`. C2 then closes the 51 safe-helper set and the 38 remaining raw caller rows with explicit caller, Port, and assembly evidence.

Excluded: new authority, ledger, schema, migration, Port signature, dependency, PostgreSQL runtime, generic retry, automatic COMMIT retry, Docker changes, desktop acceptance, commit, push, PR, merge, and TS-7.

## Governing evidence and decisions

- Phase A C3 ZIP: `shotgun-ts6-phase-a-c3-review-20260920.zip`, ZIP SHA-256 `277F0D7608D11906FD98DAFA268D2EC909EE11BAA978AC9D4078CDF12578BB08`, actual manifest SHA-256 `DC142FA0BB2921AA117319CB79C7784AB979841509FF77EE9D0933A11D5CC6E3`.
- ADR-169 remains the sole transaction-outcome authority. The dated amendment records the Phase B extension without rewriting the historical scope.
- `withSafePostgresTransaction` remains unchanged and is the only shared helper.
- `TEST_DATABASE_URL` is the only database authority for focused proofs; destructive proofs use isolated `shotgun_test_iso_*` databases.
- C1 accepted evidence is frozen in `shotgun-ts6-phase-b-c1-review-20260920.zip` with SHA-256 `D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04`.
- C2 caller corrections are limited to accepted-command ambiguity propagation, exact command identity readback, and Discovery/Connector recovery preservation. No new authority is introduced.

## OSS Integration Decision

`pg` 8.22.0 at commit `b617619f9fb6fbd231731823e2732a2927ded4be` (MIT) remains the runtime. `pg` 8.23.0, Slonik 49.10.9, pg-promise 12.7.0, and Postgres.js 3.4.9 are `REFERENCE_ONLY / DO_NOT_ADOPT` for this work. No dependency or lockfile change is made. Their transaction lifecycle patterns were reviewed for comparison only; Shotgun-owned business outcome authority is not delegated to them.

## Required invariants

After COMMIT is attempted there is no semantic ROLLBACK. A lost acknowledgement is `OUTCOME_UNKNOWN` unless an existing clean-pool, operation-specific readback proves exact intended durable material. Different or newer material fails closed with existing conflict/stale semantics. No ambiguous mutation is automatically retried.

The Candidate invariant is explicit: a hidden successful `saveBatch` must not invoke `failMaterialization` or publish `CandidateMaterializationFailed`. The Review V2 invariant is explicit: hidden successful operation resolution must not become `RESOLUTION_CONFLICT` solely because the acknowledgement was lost. Credential recovery never stores or emits secret material.

## Verification

Focused tests include the unchanged helper unit control, the TS-6 transaction contract, the Golden Corpus count, and an isolated PostgreSQL acknowledgement-loss proof guarded by `TEST_DATABASE_URL`. Required final gates are the Phase B request's focused domain regressions, full database suite, unit/contract/integration/architecture/stage12 package suites, docs gates, secret scan, and OSS gates. Any failed gate or need for new authority stops the handoff.

## Migration and rollback

`MIGRATION_REQUIRED = NO`. No schema or data migration is included. Before publication rollback is a working-tree revert/discard; after publication rollback is a source commit revert. No destructive database rollback is used.

## Handoff

The final handoff is `READY_FOR_INDEPENDENT_PATCH_REVIEW`, never `TS-6 COMPLETE`. The review ZIP contains the 112-row Golden Corpus, 38 raw caller decisions, 51 safe-helper decisions, 87 final caller rows, exact patches and untracked files, verification outputs, OSS decision, and integrity manifest. Final current-patch PostgreSQL verification passed 111 files / 543 tests with one file / two tests skipped; the earlier transient issue-247/RUS-2-C5 failures passed on clean baseline/current rerun and did not persist. `commit = none`, `push = none`, `PR = none`, and `TS-7 = not started`.
