# TS-6 Phase B C2-R7 timeout closure

Date: 2026-09-21  
Worktree: `C:\dev\shotgun-ts6-phase-b`  
Branch: `codex/ts6-postgres-transaction-phase-b`  
Base/main/HEAD: `1f821ea371b308d8cecede4a98ebe27960873b21`

## Final disposition

`TS-6 PHASE B C2-R7 = REVIEW_REQUIRED / STOP`  
`SURROUNDING_BOUNDARY_AUDIT_REQUIRED = YES`  
`PRODUCT_CHANGE = NO`

R6 established that the original TS-1 failure was a default 5-second test
budget failure under the full unit runner, while the exact test passed in
isolation and the complete unit suite passed when file execution was forced
serial. R7 measured the boundary before changing it and applied the smallest
authorized test-only correction: the combined 1600-cell-valid plus 8193-cell-
invalid assertion now has the same 15-second per-test timeout already used by
the neighboring high-cardinality acceptance table.

The correction is stable in five targeted runs and three full TS-1 file runs.
The serialized full-unit diagnostic passes 156/156 files and 1256/1256 tests.
However, both unmodified official `npm run test:unit` runs after the correction
still report a Vitest worker `onTaskUpdate` unhandled error. Although all
156/156 files and 1256/1256 tests pass in each run, the unhandled error makes
both official gates non-clean. R7 therefore does not raise the timeout again,
does not modify Vitest/config/CI, and stops for a broader runner/environment
decision.

## Source identity and scope

Compared with base `1f821ea...` before the R7 correction:

- `tests/unit/ts1-document-format-boundary.test.ts` was unchanged before R7;
  R7 changes only the per-test timeout from the default 5 seconds to 15,000 ms.
- `adapters/document-format-python/src/index.ts` is unchanged from base.
- `adapters/document-format-python/worker.py` is unchanged from base.
- `MAX_CSV_BLOCKS` remains 8192. The first invalid fixture remains exactly 8193
  non-empty CSV cells.
- No Product, worker budget, global test timeout, Vitest configuration,
  package, lockfile, CI, or dependency change was made.

## Test structure and duplicate coverage

The failing test performs two transformations in one assertion:

1. transform the generated 40 x 40 CSV (1600 cells), require exactly 1600
   document blocks;
2. transform a one-row 8193-cell CSV, require non-retryable
   `VALIDATION_ERROR`.

The same file's table independently accepts high-cardinality DOCX, XLSX, CSV,
and PPTX inputs and already specifies a 15,000 ms timeout. The R7 correction
keeps the exact 1600-block assertion and the first-invalid 8193-cell rejection;
it does not weaken or replace either contract.

## Environment and child-process hygiene

- OS: Microsoft Windows 10 Home, build 19045.
- CPU: Intel Core i7-7700HQ, 8 logical processors.
- Visible memory: 16,658,020 KB; free memory at capture: 5,723,724 KB.
- Node: v24.15.0.
- npm: 11.12.1.
- Vitest: 3.2.7 win32-x64.
- Python: 3.14.4.
- Sensitive machine data: not included in the ZIP.

The timing probe captured Python process state before and after the timing
group; independent PowerShell process checks before and after every targeted,
TS-1-file, serialized-unit, and validator group reported zero Python processes
after completion. No orphaned Python process was observed:
`NO_CHILD_PROCESS_LEAK`.

## Timing evidence

Five repetitions per case, with correctness checked on every repetition:

| Case | Result | Min / median / max |
| --- | --- | --- |
| Small valid CSV, 4 cells | 5/5 PASS | 810.9 / 866.6 / 871.6 ms |
| Valid 1600-cell CSV | 5/5 PASS | 2139.3 / 2161.4 / 2186.0 ms |
| Valid 8192-cell near-limit CSV | 5/5 PASS | 46202.2 / 48247.8 / 51944.3 ms |
| First invalid 8193-cell CSV | 5/5 `VALIDATION_ERROR` | 923.2 / 951.9 / 1035.3 ms |
| Combined 1600 then 8193 sequence | 5/5 correct | 3019.2 / 3258.9 / 3305.8 ms |

The 8192-cell valid boundary is intentionally heavy because the adapter must
materialize and validate 8192 blocks; it is not used as a reason to change the
Product limit. The failing combined test is fast enough in isolation but can
take about 5–8 seconds under the full parallel unit runner. This explains why
the per-test 15-second correction is narrowly scoped and why the separate
Vitest worker error remains an independent blocker.

## Diagnostic execution

- Original failing test, default settings, five consecutive isolated runs:
  5/5 PASS, approximately 3.76–3.88 seconds each.
- Original TS-1 file, default settings, three consecutive runs:
  3/3 PASS, 18/18 each, approximately 21.05–23.24 seconds.
- Serialized full-unit diagnostic with
  `--maxWorkers=1 --fileParallelism=false` and no timeout override:
  PASS, 156/156 files and 1256/1256 tests.
- Post-correction exact heavy boundary test, default settings, five runs:
  5/5 PASS, approximately 3.63–3.71 seconds each.
- Post-correction full TS-1 file, default settings, three runs:
  3/3 PASS, 18/18 each, approximately 21.05–22.03 seconds.
- Post-correction official `npm run test:unit`, two runs:
  both report 156/156 files and 1256/1256 tests passed, but both also report
  one unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` error.
  Therefore neither is a clean official PASS.

## Root-cause decision

There are two distinct findings, each with one primary classification:

1. Original TS-1 assertion timeout: `INTRINSIC_TEST_DEFECT_FIXED`.
   Evidence: isolated default runs passed 5/5, serial full-unit passed, the
   neighboring high-cardinality table already used 15 seconds, and the exact
   boundary/correctness assertions were preserved by the one-line correction.
2. Post-correction official full-unit worker error: `ENVIRONMENT_DEFECT` pending
   broader audit. Evidence: it repeats in two official runs despite all tests
   passing, while the serialized full-unit run is clean. This is promoted to
   `SURROUNDING_BOUNDARY_AUDIT_REQUIRED`; R7 does not alter runner infrastructure
   or raise the timeout further.

## Validator and frozen state

Post-correction validator unit passed 24/24. Audit and strict verify passed:

```text
candidateCount=120
rawSiteCount=11
TX_BOUNDARY=100
TX_PARTICIPANT=0
TX_DELEGATE=0
NON_TX=7
TEST_ONLY_OR_DEAD=13
REVIEW_REQUIRED=0
issueCount=0
missingRegression=0
fixtureMutation=false
```

The V2 fixture remains:
`256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.

## Deferred gates

Per the repeated official worker error stop rule, R7 did not run the remaining
post-unit gates: Knowledge Flow check, docs/governance bundle, format, lint,
typecheck, diff check, secret scan, OSS audit/verify/SBOM, stage12 reuse gate,
`test:ci`, full database suite, or final database verification. R6 had already
passed Knowledge Flow and the database isolation path; no R7 change can affect
those results except the single unit test timeout line. A new controller round
is required before any broader runner or environment investigation.

## OSS and integration boundary

R7 introduced no OSS adoption, dependency, lockfile, or runtime change. The
existing C2 integration decisions remain preserved: reference review and
version/license/security/maintenance evidence is unchanged, and Shotgun still
owns Canonical, Evidence, Approval, Action, and Module Contract semantics.

## Final stop

`SOURCE_AUTHORITY = PASS (inherited frozen C2 evidence)`  
`DB_ISOLATION = PASS (inherited R6 serial proof)`  
`KNOWLEDGE_FLOW = PASS (inherited R6 EOL-only proof)`  
`TS1_TEST_TIMEOUT = INTRINSIC_TEST_DEFECT_FIXED`  
`OFFICIAL_UNIT = REVIEW_REQUIRED / STOP (repeated worker onTaskUpdate error)`  
`SURROUNDING_BOUNDARY_AUDIT_REQUIRED = YES`  
`OVERALL = REVIEW_REQUIRED / STOP`

No commit, push, PR, Ready status, or TS-7 transition was performed.
