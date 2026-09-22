# TS-6 PHASE B C2-R12 — Deterministic Unit Runner Ceiling Proof and Pre-Migration Baseline Recovery

Status: **TS-6 PHASE B C2-R12 = REVIEW_REQUIRED / STOP**

## 1. Identity and frozen state

Worktree: `C:\dev\shotgun-ts6-phase-b`  
Branch: `codex/ts6-postgres-transaction-phase-b`  
Base/main/HEAD: `1f821ea371b308d8cecede4a98ebe27960873b21`  
Node: `v24.15.0`  
Available parallelism: `8`

The transaction fixture remained frozen at SHA-256
`256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.
R11's Vitest 4 migration was not applied. R10 and R11 review ZIPs were
preserved; R11 ZIP SHA-256 is
`5A2458A4D277DC5B84C7A2007E4D3959806D3452044387AB88992ED42EA4E2F4`.

## 2. R11 disposition and R10 policy amendment

R11 stopped before migration because the existing R10 `maxWorkers=50%`
effective four-worker pre-migration control was not clean. R10's 5/5 evidence
remains valid for the runs it executed, but R11 later reproduced Stage 8
adapter-replacement and C2 validator timeouts plus `onTaskUpdate` at the same
effective worker level. R10's percentage policy is therefore locally proven
but not deterministically stable.

R12 tested the authorized absolute ceiling with fresh Vitest 3.2.7 processes.
The command-line candidate `node node_modules/vitest/vitest.mjs run tests/unit
--maxWorkers=2` passed 8/8 consecutive runs. Each was 156/156 files and
1256/1256 tests with exit 0, no timeout, no unhandled error, and no
`onTaskUpdate`. The diagnostic maxWorkers=4 contrast failed 3/3 with the
known validator timeout and `onTaskUpdate` failure. This supports an absolute
two-worker ceiling without serializing file parallelism.

After that proof, the only authorized functional patch was applied:
`package.json` changed the repository-owned `test:unit` script from
`vitest run tests/unit --maxWorkers=50%` to
`vitest run tests/unit --maxWorkers=2`. `package-lock.json`, the root Vitest
declaration (`^3.2.2`), Product source, tests, timeouts, config, CI, frontend
manifest, and dependencies were not changed by R12.

## 3. Post-patch result and stop reason

The official `npm run test:unit` command passed 5/5 consecutive runs at
156/156 files and 1256/1256 tests, exit 0, timeout 0, and `onTaskUpdate=0`.

R12 then ran the first required `npm run test:ci` block. Unit passed, but the
contract stage failed: `tests/contract/knowledge-model.contract.test.ts`
timed out in both the in-memory and in-process
`traverses approved Typed Edges deterministically and matches NetworkX` tests
at their existing 5000ms contract. The contract result was 68/69 files and
702/704 tests, exit 1. Because R12 requires 3/3 consecutive clean
`test:ci` runs and says to stop on any failure, runs 2 and 3 were not started.

This yields:

`PRE_MIGRATION_BASELINE_RECOVERED = PROVISIONALLY_PROVEN`  
`LONGER_GATE_BASELINE = NOT_CLEAN`  
`TWO_WORKER_POLICY = EVIDENCE-BACKED CANDIDATE, NOT FINAL C2 CLOSURE`

The two-worker candidate is not discarded, but R12 cannot claim the stronger
success disposition because the required component gate did not complete.
No timeout was increased and no test or Product correction was attempted.

## 4. Host and process observation

The quiet-host requirement was honored: no frontend, database, documentation,
OSS, or other repository test/build workload was intentionally run in parallel
with the stability blocks. Codex/CUA service Node processes remained. Candidate
runs observed a peak Node process count of approximately 18 and peak Python
process count 1; maxWorkers=4 contrast observed approximately 20 Node and 2
Python processes. After the failed contract run no test-owned process residue
was observed. The evidence records minimum available memory and per-run
durations; no performance threshold was imposed.

## 5. Scope and rejected alternatives

R12 did not modify Product behavior, test semantics, fixtures, snapshots,
timeouts, Vitest configuration, CI, dependencies, frontend files, or the OSS
registry. It did not run the database suite, full docs/OSS/SBOM campaign,
rollback proof, or Vitest 4 migration because the required `test:ci` gate
failed. R12 explicitly rejects using maxWorkers=1, serialization,
`fileParallelism=false`, pool switching, timeout increases, test workload
reduction, error suppression, retry-until-clean behavior, Node-module patches,
Vitest 4/5 migration, frontend fixes, or CI changes as an unapproved response.

## 6. Final disposition

`TS-6 PHASE B C2-R12 = REVIEW_REQUIRED / STOP`  
`STOP REASON = TEST_CI_NOT_CLEAN / PRE_MIGRATION_BASELINE_NOT_RECOVERED`

R13 is not authorized, Vitest 4 migration is not authorized, and no commit,
push, pull request, Ready transition, merge, or TS-7 transition was performed.
The next controller request must address the exact Stage 9 contract timeout
under the existing 5000ms contract without silently changing the test or
timeout boundary.
