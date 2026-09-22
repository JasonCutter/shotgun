# TS-6 PHASE B C2-R14 — Single-Worker Contract Baseline Discrimination

Status: **TS-6 PHASE B C2-R14 = AUDIT_PASS / SINGLE_WORKER_CONTRACT_REMEDIATION_CANDIDATE / STOP**

## Identity and accepted R13 disposition

Worktree: `C:\dev\shotgun-ts6-phase-b`  
Branch: `codex/ts6-postgres-transaction-phase-b`  
Base/main/HEAD: `1f821ea371b308d8cecede4a98ebe27960873b21`  
Root Vitest: `3.2.7` from declaration `^3.2.2`  
R12 unit policy: `vitest run tests/unit --maxWorkers=2`  
Fixture SHA-256: `256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`

R13 established that the Stage 9 contract file is clean in isolation (5/5),
default full contract is capacity-sensitive (3/3 failures), and full contract
at maxWorkers=2 failed on its first run. R14 tested only whether removing all
cross-file worker concurrency makes the complete contract suite deterministic.

## Authorized experiment

The only test command executed in R14 was:

`node node_modules/vitest/vitest.mjs run tests/contract --maxWorkers=1`

It ran as five fresh consecutive invocations. No `fileParallelism=false`, pool,
timeout, hook timeout, test, Product, oracle, dependency, config, CI, package,
or Vitest change was made. No `test:ci`, database, frontend, docs, OSS, SBOM,
rollback, or migration gate was run.

## Five-run result

All five runs were clean:

- 69/69 contract files passed;
- 704/704 tests passed;
- exit code 0;
- timeout 0;
- unhandled errors 0;
- `onTaskUpdate` 0;
- no semantic failure.

The Stage 9 NetworkX assertion passed for both in-memory and in-process
transports in every run. Observed in-memory durations were approximately
1105–1415ms and in-process durations approximately 1009–1350ms, all below the
existing 5000ms contract. Full-suite durations were approximately 113.65s,
128.72s, 125.60s, 136.29s, and 125.07s. Peak observed Python count was 1 and
no test-owned process residue was observed after completion.

## Classification boundary

R14 supports:

`STAGE9_INTRINSIC = NO`  
`CONTRACT_MAX_WORKERS_2 = INSUFFICIENT`  
`CONTRACT_MAX_WORKERS_1 = 5/5 CLEAN`  
`CROSS_FILE_PARALLEL_CONTENTION = STRONGLY CONFIRMED`

This is a remediation candidate, not authorization to serialize the contract
runner. A successful single-worker diagnostic does not authorize changing
`test:contract`, and it does not authorize Vitest 4 migration. Those decisions
remain with the next controller request.

## Rejected workarounds and final stop

R14 did not change `test:contract`, `test:unit`, the 5000ms timeout, any test or
Product source, the NetworkX oracle, pool, file parallelism, dependencies,
CI, or snapshots. It did not run additional pair/subset experiments or retry
failed runs. No commit, push, pull request, Ready transition, merge, R15, or
TS-7 transition was performed.

The R14 evidence and ZIP are the complete result. Stop for controller review.
