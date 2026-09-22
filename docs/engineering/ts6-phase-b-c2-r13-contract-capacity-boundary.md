# TS-6 PHASE B C2-R13 — Contract Suite Capacity Boundary Discrimination

Status: **TS-6 PHASE B C2-R13 = REVIEW_REQUIRED / STOP**

## 1. Identity and frozen state

Worktree: `C:\dev\shotgun-ts6-phase-b`  
Branch: `codex/ts6-postgres-transaction-phase-b`  
Base/main/HEAD: `1f821ea371b308d8cecede4a98ebe27960873b21`  
Root Vitest: `3.2.7` resolved from declaration `^3.2.2`  
R12 unit script: `vitest run tests/unit --maxWorkers=2`  
Fixture SHA-256: `256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`

R12 ZIP SHA-256 is
`F0E76A3A9E3FDB0C45D1AF60946EB6C635E16F64AF556095CEF1123860EB870E`.
No R13 functional file was changed.

## 2. Exact R12 failure and source structure

R12's first `npm run test:ci` run passed unit but failed contract at
68/69 files and 702/704 tests. The file was
`tests/contract/knowledge-model.contract.test.ts`; both the in-memory and
in-process `traverses approved Typed Edges deterministically and matches
NetworkX` assertions timed out at their existing 5000ms contract.

The test creates the Stage 9 harness, stages Evidence, stages and approves
typed candidates, calculates Shotgun recursive impact, builds relation edges,
then calls `spawnSync` with the platform Python executable and
`adapters/networkx-impact-oracle/oracle.py`. It compares the oracle's
deterministic result with the Shotgun impact. The oracle builds a sorted
NetworkX `DiGraph`, performs bounded BFS (`depth_limit=5`, `max_nodes=100`),
and emits JSON. R13 did not change this structure, the oracle, or the timeout.

## 3. Isolation results

The exact contract file ran five fresh times with default Vitest behavior.
All five were clean: 1/1 file, 12/12 tests, exit 0, and no timeout. Both
transport variants' NetworkX assertions passed in every isolated run. This
classifies the file as `NOT_INTRINSIC_UNDER_FILE_ISOLATION`; it is not an
isolated semantic defect.

## 4. Default full-contract results

The exact current `npm run test:contract` command ran three fresh times.
All three exited 1 with 68/69 files and Stage 9 timeout evidence. The failed
transport varied: one run recorded one in-memory or in-process Stage 9 timeout;
later runs recorded the two transport assertions. No new semantic failure
appeared. This reproduces the R12 contract failure under the unrestricted
contract-suite runner.

## 5. Two-worker full-contract result

R13 then ran the exact diagnostic command
`node node_modules/vitest/vitest.mjs run tests/contract --maxWorkers=2`.
The first run failed at 68/69 files and 703/704 tests: the in-memory Stage 9
NetworkX assertion timed out at 5000ms, while the in-process counterpart passed.
The R13 rule requires an immediate stop on any maxWorkers=2 failure, so runs
2–8 were not executed. The two-worker contract hypothesis is therefore not
proven, and the requested root-cause classification is:

`R13-C4 = MAX_WORKERS_2_INSUFFICIENT`

The evidence supports a non-intrinsic file boundary and a suite-capacity
trigger, but does not justify a permanent `test:contract` worker change. R13
is discrimination only.

## 6. Process and Python observation

The quiet-host rule was honored. No frontend, unit, database, docs, OSS, or
other repository workload was intentionally run concurrently. The contract
file is the only contract file directly importing `node:child_process` and
invoking the NetworkX Python oracle; other search hits are document-format
or historical/reference surfaces. Isolated runs observed one Python process at
peak; default full-contract runs observed up to two Python processes. No
test-owned Node/Python residue or process leak was observed after the stop.

## 7. Rejected workarounds and scope

R13 did not raise the 5000ms timeout, change the oracle, remove the comparison,
mock Python, replace `spawnSync`, change Product traversal, change the Stage 9
harness, modify assertions, switch pools, disable file parallelism, alter
`maxWorkers=2`, change `test:contract`, change CI, change dependencies, run
Vitest 4/5, or rerun `test:ci`. Validator, database, docs, OSS, SBOM, rollback,
and final gates were not run because R13 is narrow and stopped after the first
max2 contract failure.

## 8. Final disposition

`TS-6 PHASE B C2-R13 = REVIEW_REQUIRED / STOP`  
`STAGE9_CONTRACT = NOT_INTRINSIC_UNDER_FILE_ISOLATION`  
`DEFAULT_CONTRACT = CAPACITY-SENSITIVE FAILURE REPRODUCED`  
`CONTRACT_MAX_WORKERS_2 = INSUFFICIENT / NOT_PROVEN`

No permanent contract runner correction is authorized by R13. No commit, push,
pull request, Ready transition, merge, R14, or TS-7 transition was performed.
