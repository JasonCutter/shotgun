# TS-6 PHASE B C2-R10 — Bounded Unit Runner Capacity Remediation and Stability Proof

Status: **TS-6 PHASE B C2-R10 = PASS / READY_FOR_CONTROLLER_VITEST4_MIGRATION_AUTHORIZATION**

## Scope and disposition

R10 applied exactly one functional change: `package.json` now declares `test:unit = vitest run tests/unit --maxWorkers=50%`. On this host `os.availableParallelism()=8`, so the bounded policy targets four workers while retaining Vitest's existing forks pool, file parallelism, and isolation. No Product code, dependency version, package-lock, CI workflow, timeout, test workload, or Vitest migration changed. R7's frozen TS-1 timeout remains unchanged.

The pre-change candidate command passed 3/3 consecutive runs. The post-change official command passed 5/5 consecutive runs. Each unit run passed 156/156 files and 1256/1256 tests with exit 0, no unhandled errors, no `onTaskUpdate` timeout, and no test timeout. The full `npm run test:ci` command passed 2/2 consecutive runs: contract 69/69 files and 704/704 tests, integration 65/65 files and 510/510 tests, architecture PASS, and stage12 package PASS.

## Required gates

- Frozen fixture: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD; expected 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD; mutation=false.
- Standalone validator unit: PASS 24/24; audit: PASS; verify: PASS; candidateCount=120; rawSiteCount=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0; issueCount=0.
- R8 four-failure control: all four known failures remained assertion-clean under the bounded official suite; no semantic deviation or timeout was observed.
- Process hygiene: final Python count=0; final Node count=15; no runner-owned residue observed.
- Static verification is recorded in artifact 24; no database suite was run.

## OSS and replacement boundary

This is runner policy remediation only. No new OSS was adopted, extracted, or upgraded in R10. The existing Vitest adapter/runtime remains behind the existing test boundary. Vitest 4 migration is explicitly deferred to R11/controller authorization and must be separately pinned and gated with Contract, Golden Corpus, Security Negative, Adapter Replacement, Migration/Rollback, and OSS Integration evidence.

## Known limits and next handoff

This is not serialization and not a Vitest RPC fix. It is a 50%-of-available-parallelism capacity policy (8→4). R11 is ready only for separately authorized controller-led Vitest 4 migration. R10 stops here with no commit, push, PR, merge, Ready transition, or TS-7 transition.
