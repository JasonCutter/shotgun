# C2-R15 round 2 — RESUME HANDOFF

Supersedes `10-RESUME-HANDOFF.md` for current state. The §4 disposition table
there is **closed**; read `11-round2-closure.md` for the evidence.

Round status: `CHANGES_REQUIRED / CONTINUE C2-R15 / NO COMMIT / NO PR`.

---

## 1. Environment

```
repository  JasonCutter/shotgun
worktree    C:\dev\shotgun-ts6-phase-b
branch      codex/ts6-postgres-transaction-phase-b
base       1f821ea371b308d8cecede4a98ebe27960873b21   (provenance only)
container   docker start shotgun-ts6-r15-pg
            pgvector/pgvector:pg16 @ sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b

$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'
npm run db:test:reset
npm run db:test:verify
```

Use the repository's declared database policy for DB runs
(`--maxWorkers=1 --fileParallelism=false --testTimeout=60000 --hookTimeout=60000`).

---

## 2. Status

```
v2 (unmodified, corrected validator)   121
v3 (round 1 derived)                    68
v4 (round 2 derived)                    54
```

`14` issue statements closed, **no new issue of any code introduced**.
Remaining 54 = 27 `REGRESSION_BACKREF_MISMATCH` + 27 `REGRESSION_COVERAGE_INCOMPLETE`,
both views of the same 27 declared relations.

Closed this round — all seven §4 boundaries, each proven on real PostgreSQL:

```
C1 PostgresOrderingStore.commit                       MINIMAL_PROOF_ADDED  akp-8-wp2 (2/2)
C2 <module>.commitProjectProjection                  REBIND_EXISTING      activity parity (16/16)
C3 PostgresExternalActionStore.transactionWithHandle MINIMAL_PROOF_ADDED  external-action parity (18/18)
C4 PostgresSourcesProductService.retry               MINIMAL_PROOF_ADDED  stage3-recovery (3/3)
C5 PostgresChangeSetReviewRepository.recordDecision  MINIMAL_PROOF_ADDED  stage-5-postgres (3/3)
C6 PostgresOrderingStore.acquireNext                 REWRITE_PATH         wp05-connector (2/2)
C7 ...markStage3ItemsSucceeded                       REBIND_EXISTING      stage3-recovery (3/3)
```

`COVERAGE_GAP` is still zero; no Product or transaction-structure change was
needed.

---

## 3. Files changed this round (uncommitted)

```
M scripts/ts6-phase-b-regression-evidence-resolver.ts        D1-D4 soundness fixes
M scripts/ts6-phase-b-transaction-authority-validator.ts     boundaryId on Issue
M tests/database/akp-8-wp2-cross-section-causal-acceptance.database.test.ts   C1 proof
M tests/database/frontend-external-action-postgres-parity.test.ts             C3 proof
M tests/database/frontend-sources-stage3-recovery.test.ts                     C4 proof
M tests/database/stage-5-postgres.test.ts                                     C5 proof
A artifacts/ts6-phase-b-c2-r15/golden.v4.derived.json
A artifacts/ts6-phase-b-c2-r15/correction-round2-report.json
A artifacts/ts6-phase-b-c2-r15/11-round2-closure.md
```

Frozen and verified unchanged:

```
tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json  256E5906...86CD
ts6-c2-r3-boundary-count-crosswalk.json                          E4861D67...21D2
package.json   only the pre-existing R12 test:unit --maxWorkers=2
```

---

## 4. Verification commands

```powershell
cd C:\dev\shotgun-ts6-phase-b
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'

# frozen v2 must FAIL with 121
node node_modules/tsx/dist/cli.mjs scripts/ts6-phase-b-transaction-authority-validator.ts verify

# audit suites (32 tests, must stay green)
node node_modules/vitest/vitest.mjs run scripts/ts6-audit/regression-evidence-authority.test.ts scripts/ts6-audit/c2r15-authority-correction.test.ts

# unit lane (155 files / 1232 tests; audit test must NOT be collected)
node node_modules/vitest/vitest.mjs run tests/unit --maxWorkers=2

# database lane (112 files / 558 tests, 1 pre-existing skip)
node node_modules/vitest/vitest.mjs run tests/database --maxWorkers=1 --fileParallelism=false --testTimeout=120000 --hookTimeout=120000
```

---

## 5. What remains

The 27 declared relations are **adjudicated** (see
`correction-round2-report.json` → `round2Adjudication` and
`11-round2-closure.md` §5) but not applied:

```
Group A  7  genuinely shared; only covers[] is missing -> complete covers[]
Group B 13  wrong historical edge; a different existing block proves it -> rebind
Group C  7  wrong historical edge; no qualified call exists anywhere ->
            minimal proof, or an owner COVERAGE_GAP decision
```

Group C boundaries:

```
PostgresAskAnswerExecutionRepository.transaction
PostgresFrontendReviewRepository.transactionWithHandle
PostgresSourcesIntakeLifecycle.transaction
PostgresActionExecutionRepository.transaction
PostgresProjectAdministrationRepository.updateStatus
PostgresStandingAIProcessingPolicyRepository.saveRevision
PostgresSemanticEmbeddingProfileRepository.saveRevision
```

**Read before starting Group B/C.** `callersFor()` in the validator matches
production callers by **method name only**, so one boundary can record dozens of
unrelated callers (`PostgresAskAnswerExecutionRepository.transaction` records
47). Any `PUBLIC_PATH` declaration derived from `productionReachability.callers`
is unsound. Groups A and B were selected using qualified `DIRECT_BOUNDARY`
resolution only. Tightening `callersFor()` is a separate correction and was not
undertaken.

---

## 6. Acceptance conditions (v3/v4 promotion gate)

1. every retained `(boundaryId, evidenceId)` relation bidirectionally consistent — **27 open**
2. every retained relation independently resolves — **92/112 resolve**
3. every coverage-required `PROVEN` boundary has ≥1 resolved relation — **20 uncovered**
4. `120 candidates / 113 boundaries / 11 raw sites / 87 historical` — **HOLDS**

Do not promote to v3 final until 1–3 hold.

---

## 7. Hard constraints (unchanged)

Do not modify `test:contract`, Stage 9, NetworkX, Stage 9 timeout, contract worker
policy, Vitest major version, general CI worker policy, database worker policy, or
unrelated unit-test timeouts. Do not change the transaction inventory to make
validation pass. Do not commit, push, create or update a PR, change CI, merge, or
start TS-7. Stop and report if a correction would require Product transaction
changes or an inventory change.
