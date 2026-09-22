# C2-R15 — RESUME HANDOFF

> **SUPERSEDED (round 2).** Every §4 disposition below is now closed and proven
> against real PostgreSQL. Current state lives in `12-RESUME-HANDOFF-R2.md` and
> the evidence in `11-round2-closure.md`. This file is retained as the round-1
> record and as the origin of the §4 disposition decisions.

Purpose: allow a fresh agent with **no prior conversation context** to continue
C2-R15. Everything needed is in this file or in the referenced artifacts.

Round status: `CHANGES_REQUIRED / CONTINUE C2-R15 / NO COMMIT / NO PR`.

---

## 1. Repository and environment

```
repository  JasonCutter/shotgun
worktree    C:\dev\shotgun-ts6-phase-b
branch      codex/ts6-postgres-transaction-phase-b
base       1f821ea371b308d8cecede4a98ebe27960873b21   (provenance only)
node       v24.15.0
vitest     3.2.7 (declared ^3.2.2) — unchanged in this round
```

Frozen and verified unchanged:

```
tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json
  256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD
ts6-c2-r3-boundary-count-crosswalk.json
  E4861D67B1EBC4885FA9034245C0B2734E25E3865DE278A4FF660C0B4B0621D2
package.json  test:contract and test:database scripts unchanged
              (test:unit carries a pre-existing R12 --maxWorkers=2)
```

### Test database

A PostgreSQL container was provisioned and is required for any further DB proof:

```
docker start shotgun-ts6-r15-pg     # if it is stopped
# created with:
#   -e POSTGRES_USER=shotgun -e POSTGRES_PASSWORD=shotgun -e POSTGRES_DB=shotgun_test
#   -p 5432:5432
#   pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b
#   (digest equals the CI image digest)

$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'
npm run db:test:reset     # migrations + schema recreate
npm run db:test:verify    # bootstrap verified
```

Two measured facts that contradict earlier assumptions:

- Without `TEST_DATABASE_URL` the database suite does **not skip**; it fails at
  collection (`TEST_DATABASE_URL is required for database-backed tests`).
  `requireTestDatabaseTarget()` throws from a top-level await. A skipped run was
  never an acceptable proof anyway.
- `tests/database/auth-postgres.test.ts` fails on the Vitest default 5000 ms budget
  and passes under the repository's declared database policy
  (`--maxWorkers=1 --fileParallelism=false --testTimeout=60000 --hookTimeout=60000`).
  Use that policy for DB runs.

---

## 2. Files created or changed by C2-R15 (all uncommitted)

```
A scripts/ts6-phase-b-regression-evidence-resolver.ts        independent resolver
A scripts/ts6-phase-b-regression-evidence-authority.ts       invariants A-D
M scripts/ts6-phase-b-transaction-authority-validator.ts     import + authority wiring + v3 schema
A scripts/ts6-audit/regression-evidence-authority.test.ts    moved from tests/unit (24 tests, green)
A scripts/ts6-audit/c2r15-authority-correction.test.ts       acceptance + negative (8 tests, green)
M tests/unit/ts6-phase-b-transaction-authority-validator.test.ts  -> MOVED (no longer exists here)
A artifacts/ts6-phase-b-c2-r15/**                            evidence, manifests, derived v3
```

Artifacts of record:

```
artifacts/ts6-phase-b-c2-r15/
  pre-correction/manifest.json + tracked-worktree.patch + bytes/
  correction-manifest.json          per-record decision (69 entries)
  relation-edge-ledger.json         112-edge adjudication
  step0-resolution.json             independent resolution of all 69
  step0-rebind-candidates.json      smallest existing qualified block per unresolved relation
  golden.v3.derived.json            DERIVED corrected snapshot (v2 untouched)
  correction-applied-report.json    what was applied
  07-implementation-assessment.md   assessment of the external review
  08-postgres-verification-and-application.md
  09-nine-case-closure-progress.md
  sha256-manifest.txt, review-bundle.json
```

Review ZIP: `shotgun-ts6-phase-b-c2-r15-review-20260921.zip` in the worktree root.

---

## 3. What is already done and proven

- Pre-correction evidence frozen (actual bytes, not hashes only), with separate
  `productionCorpusDigest` / `testCorpusDigest` / `scannerImplementationDigest` /
  `observedInventoryDigest`, and scanner determinism confirmed by repeat.
- Independent resolver implemented: qualified target `(file, symbol, method)`,
  coverageKind-specific semantics, licensed-hop path verification, AST
  `CallExpression` only, receiver-to-class binding (block scope + import alias),
  test-local helper expansion (including bare-identifier calls and
  extracted-method `.call` invocation).
- Invariants A-D wired into `validateCorpus`. **C and D operate on
  `(boundaryId, testEvidenceId)` relations, not on evidence records.** The fixture
  has 69 evidence records but 112 boundary->evidence edges; record-level
  bookkeeping allowed one resolving target to vouch for another.
- Relation-level back-reference reconciliation: of 43 stale edges, 16 resolve and
  had `covers[]` completed; 27 do not resolve and remain declared and reported.
  No edge was deleted.
- 12 rebinds applied, all proven PASS against real PostgreSQL:
  `saveRevision, appendSuppression, save, accept, complete, submit,
  bootstrapOwner, saveInferences, synchronize, claim, saveBatch,
  commitFrontendDraft`.
- Evidence-id remap propagated into 20 boundary back-references (without this the
  rebinds produced dangling references).
- 2 disposition relabels applied and **verified resolved**:
  `releaseLease -> PUBLIC_PATH`, `recoverExpiredLeases -> OWNER_ATOMICITY`.
- Audit test moved out of the normal unit lane. Unit lane collects 0 entries for
  it; `tests/unit` = 155 files / 1232 tests, green.

Issue progression: **v2 121 -> v3 68**.

---

## 4. The 7 remaining boundaries — approved dispositions

Use the reviewer-approved disposition per row. Current resolver verdict is quoted
so the next agent can confirm the starting point.

| boundary | current verdict | disposition |
|---|---|---|
| `PostgresOrderingStore.commit` (connector-runtime-postgres) | `CALL_OUTSIDE_TARGET_BLOCK` | **MINIMAL_PROOF_ADDED** — the linked test reaches the canonical-knowledge module's own `commit`; relabel is impossible, so add the smallest test that exercises this registered boundary directly or through a correct path |
| `<module>.commitProjectProjection` (frontend-activity-postgres) | `CALL_OUTSIDE_TARGET_BLOCK` | **conditional REBIND, else MINIMAL_PROOF** — prove the 683-line block's port is bound to `PostgresActivityIndexStore`, then rebind; otherwise add a minimal proof |
| `PostgresExternalActionStore.transactionWithHandle` | `TARGET_MISMATCH` | **MINIMAL_PROOF_ADDED** — the calls occur on the draft repository, wrong target |
| `PostgresSourcesProductService.retry` | `UNQUALIFIED_RECEIVER` | **RELABEL / REWRITE_PATH first** — if a file/symbol-qualified path from the test entry to the registered `retry` can be proven, correct the declaration/path; otherwise MINIMAL_PROOF |
| `PostgresChangeSetReviewRepository.recordDecision` | `TARGET_MISMATCH` | **MINIMAL_PROOF first** — only a module-level/other-class `recordDecision` is reached; rebind only if exact repository-boundary coverage is found |
| `PostgresOrderingStore.acquireNext` | `PATH_NOT_RESOLVED` | **REBIND_EXISTING or MINIMAL_PROOF** — the declared `kernel.connector.publishEvent` entry is not executed by the block, so relabel alone is not enough |
| `PostgresSourcesProductService.markStage3ItemsSucceeded` | `MISSING_TEST_BLOCK` | **REBIND_EXISTING first** — the production caller path exists; find the correct existing block, else MINIMAL_PROOF |

`COVERAGE_GAP` is currently **zero**. Do not assign it unless closing the case
would require Product or transaction-structure change.

---

## 5. Final v3 acceptance conditions

Do not target `68 -> 0` numerically. v3 may be promoted only when all four hold:

1. every retained `(boundaryId, evidenceId)` relation is bidirectionally consistent
2. every retained relation independently resolves under its `coverageKind` rules
3. every coverage-required `PROVEN` boundary has at least one resolved relation
4. `120 candidates / 113 boundaries / 11 raw sites / 87 historical` unchanged

Condition 4 already holds.

Additionally: the 27 unresolved declared relations must be reconciled **after** the
7 cases close — complete `covers[]`/back-reference when the relation is genuinely
shared, remove it when it is a wrong historical edge, rebind when a better proof
exists. Preserving a stale edge merely because it is a boundary's only evidence is
not a final solution: supply the replacement proof first, then remove it.

---

## 6. How to run things

```powershell
cd C:\dev\shotgun-ts6-phase-b
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'

# corrected validator against the frozen v2 (must FAIL, 121 issues)
node node_modules/tsx/dist/cli.mjs scripts/ts6-phase-b-transaction-authority-validator.ts verify

# audit verification suite (24 tests, must stay green)
node node_modules/vitest/vitest.mjs run scripts/ts6-audit/regression-evidence-authority.test.ts

# C2-R15 acceptance + negative regression (8 tests)
node node_modules/vitest/vitest.mjs run scripts/ts6-audit/c2r15-authority-correction.test.ts

# normal unit lane (audit test must NOT be collected); 155 files / 1232 tests
node node_modules/vitest/vitest.mjs run tests/unit --maxWorkers=2
```

Helpers used in this round live in `%TEMP%` and are regenerable:
`c2r15-apply.mts` (derive v3), `c2r15-v3check.mts` (validate v3),
`c2r15-edge-ledger.mts` (edge adjudication), `c2r15-zip2.mts` (bundle).
They are throwaway drivers, not repo files.

---

## 7. Open questions carried forward

1. Evidence authoring lineage is known (R3 closure: 16 missing at start,
   `closedByExistingDirect` 1, `closedByExistingPath` 12, `closedByNewMinimalTest` 3,
   remaining 0; `53 pre-existing + 16 = 69` at ID level, 16/16 present in v2), but
   **why 43 edges carry a stale back-reference is still unexplained** — the three
   newly authored R3 tests are a partial explanation only.
2. Whether the 27 unresolved declared relations include any genuinely shared
   evidence (needing `covers[]` completion) versus wrong historical edges
   (needing removal) is not yet decided.
3. `PostgresConnectionRuntimeState.recoverExpiredLeases` is `private`; its proof
   depends on a test-only cast. Whether that is acceptable as regression authority
   for a private boundary is a policy question for the owner.

---

## 8. Hard constraints (from the C2-R15 work order)

Do not modify `test:contract`, Stage 9, NetworkX, Stage 9 timeout, contract worker
policy, Vitest major version, general CI worker policy, database worker policy, or
unrelated unit-test timeouts. Do not change the transaction inventory to make
validation pass. Do not commit, push, create or update a PR, change CI, merge, or
start TS-7. Stop and report if a correction would require Product transaction
changes or an inventory change.
