# TS-6 Phase B C2-R8 — Vitest Worker RPC and Surrounding Test-Boundary Audit

Date: 2026-09-21

## Final disposition

`TS-6 PHASE B C2-R8 = REVIEW_REQUIRED / STOP`  
`R8-S05 = NEW_TEST_FAILURE_REVIEW_REQUIRED`  
`UPSTREAM_VITEST_RPC_SIGNATURE = CONFIRMED`  
`UPSTREAM_VITEST_3_RPC_DEFECT = NOT_PROVEN`

R8 confirmed that the installed Vitest 3.2.7 forks/threads worker RPC path
uses the bundled birpc default timeout of 60 seconds, independently of
`testTimeout` and `hookTimeout`. Upstream Vitest PR #8297 fixes this class of
timeout with `timeout: -1` and pending-RPC teardown across forks, threads,
vmForks, and vmThreads. No real dependency or Product change was authorized.

The run stopped at the first new non-RPC assertion failure: the first
`--pool=threads` diagnostic produced independent test timeouts in two Stage 8
tests, the TS-1 high-cardinality XLSX test, and the C2 transaction validator.
The second threads run and all Vitest 4 sandbox A/B runs were therefore not
executed, as required by the R8 stop condition.

## Evidence summary

- Exact `npm run test:unit`: 156/156 files and 1256/1256 tests passed, but one
  `onTaskUpdate` unhandled error made the process exit 1.
- Forks `maxWorkers=1` (serial file execution): 2/2 clean runs.
- Forks `maxWorkers=2`: 2/2 clean runs.
- Forks `maxWorkers=4`: 2/2 clean runs.
- Forks default worker count: 2/2 reproduced the RPC error and also showed
  additional diagnostic test-timeout failures under the JSON reporter.
- Threads: first run stopped with new non-RPC test timeouts; no RPC error.

The complete sanitized evidence bundle is:

`shotgun-ts6-phase-b-c2-r8-review-20260921.zip`

ZIP SHA-256:

`DC743DA5F67C21D80227D74DCB5262B819B687C66CA3C84C452A874DD936284F`

The transaction-authority fixture remained unchanged at SHA-256
`256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.

## Upstream references

- [Vitest issue #8164](https://github.com/vitest-dev/vitest/issues/8164)
- [Vitest discussion #6511](https://github.com/vitest-dev/vitest/discussions/6511)
- [Vitest PR #8297](https://github.com/vitest-dev/vitest/pull/8297)
- [Vitest releases/support policy](https://vitest.dev/releases.html)
- [Vitest migration guide](https://vitest.dev/guide/migration/)

No commit, push, PR, Ready status, or TS-7 transition was performed. Further
work requires controller review of the new test-boundary failures.
