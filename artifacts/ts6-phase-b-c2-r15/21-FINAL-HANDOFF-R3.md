# C2-R15 — FINAL HANDOFF (qualified reachability authority adopted)

Supersedes `18-ROUND3-HANDOFF.md` (mid-round) and the RESUME block of
`13-FINAL-HANDOFF.md`. Evidence: `19-authority-correction-adopted.json`;
owner verdict and release gate: `22-RELEASE-VERIFICATION-HOLD.json`.

Round status: `CONTINUE C2-R15 / NO COMMIT / NO PR`.

```
C2-R15 regression evidence authority     PASS
production reachability authority        PASS
golden.v6 derived lineage                PASS
TS-6 C2 FINAL                            HOLD  — exact-head release verification only
```

> ## RESUME HERE (fresh session, no prior context needed)
>
> Read in this order: `22-RELEASE-VERIFICATION-HOLD.json` (owner verdict, the
> release gate, and the checklist) → `19-authority-correction-adopted.json` (what
> was adopted, with per-boundary proof) → `golden.v6.derived.json` (the new
> derived lineage, `valid=true, issues=0`).
>
> **Do NOT modify v6 or re-open the reachability authority.** The design and audit
> correction are finished. What remains is release-level verification at exact
> head — normal process exit and canonical CI.
>
> **The authority replacement is DONE and the v6 lineage validates clean.**
>
> ```
> legacy authority (callersFor, method-name-only)   TX_BOUNDARY 100  TEST_ONLY_OR_DEAD  13
> current authority (boundaryMatchKind, qualified)  TX_BOUNDARY  96  TEST_ONLY_OR_DEAD  17
> REVIEW_REQUIRED                                    0  (both eras)
> inventory   120 candidates / 113 boundaries / 11 raw sites / 87 historical  — UNCHANGED
>
> frozen v2        256E5906…86CD   PRESERVED, still rejected (166 issues under the current authority)
> frozen crosswalk E4861D67…21D2   PRESERVED
> golden.v5        D5CB331B…BE60   PRESERVED, byte-identical
> golden.v6        NEW, derived from v5, valid=true issues=0
> production source                UNCHANGED
> ```
>
> **What changed structurally:** `callersFor()` is RETIRED FROM AUTHORITY. It
> survives only as `legacyRecordedCallers` metadata and as the historical
> reconstruction path. Every value that used to be derived from it — status, the
> caller set, `candidateReconciliation[].c2r2Classification`, `summary` — now
> comes from the single `boundaryMatchKind()` result, so status and scoreboard
> cannot diverge into two doctrines again.
>
> **Pinned assertions were SPLIT, not substituted.** The legacy era's `100 / 13`
> is still asserted through `buildAuditShape(ROOT, { legacyAuthority: true })` and
> through the frozen fixture's own summary; the current era's `96 / 17 / 0` is
> asserted separately. Nothing was deleted and no number was replaced.

---

## 1. The four status moves (each source-verified)

```
PostgresDiscoveryFindingRepository.save        PROVEN -> TEST_ONLY_OR_DEAD
PostgresDiscoveryRuntimeRepository.saveJob     PROVEN -> TEST_ONLY_OR_DEAD
PostgresDiscoveryRuntimeRepository.transitionJob PROVEN -> TEST_ONLY_OR_DEAD
PostgresAuthRepository.bootstrapOwner          PROVEN -> TEST_ONLY_OR_DEAD
```

The first three are genuine method-name collisions (evidence in `19-…json`
§statusMoves). The fourth applies the owner's doctrine ruling: its only call path
is gated by `VITEST && !options.authRepository && !production`
(`server.ts:2549-2550`), and under a Postgres configuration
`authRepository = new PostgresAuthRepository(pool)` is injected, so
`!options.authRepository` is mutually exclusive with it. **No supported production
execution path exists.**

### REQUIRED wording for `bootstrapOwner` — a scope limitation, not "dead"

The audit doctrine targets **application production runtime** reachability, and
`scripts/` is explicitly outside the resolver corpus
(`SCOPES = adapters, modules, packages, assemblies, apps`). The same boundary IS
reachable from a separate operator-invoked operational CLI. Record it as:

```
PostgresAuthRepository.bootstrapOwner
  application runtime                          UNREACHABLE  -> TEST_ONLY_OR_DEAD
  operator-invoked CLI (scripts/auth-bootstrap-owner.ts,
    npm script `auth:bootstrap-owner`, real Postgres pool)   REACHABLE
```

Do **not** describe this boundary as merely "dead" without that limitation: it
would misrepresent a live production operator capability. The classification
stands within the audited corpus; the limitation is recorded in
`19-…json` §statusMoves[3].notedCounterEvidence and here.

### How the non-production gate is implemented

As a **general rule**, not a per-boundary exception: a call written in the THEN
branch of an `if` whose condition references `VITEST` or `NODE_ENV === 'test'` —
inline or through a flag variable initialised from such an expression — is test
evidence, not a production execution path. It fires for exactly one boundary in
the corpus.

---

## 2. Relation integrity is untouched

A reachability correction changes **which** boundaries carry a coverage
obligation. It never re-opens whether an approved relation proof holds.

```
declared relations   112 -> 112   identical
evidence records      95 ->  95
back-references       0 missing
PROVEN boundaries    96, all with >=1 qualified caller and >=1 relation
```

---

## 3. Verification (this round)

```
validator on golden.v6.derived.json      valid=true, issues=0
audit suites                            37/37 assertions passed   (process exit code 1)
unit lane                               155 files / 1232 tests passed   (process exit code 1)
database lane (full)                    111 files passed, 2 tests failed in ONE flaky
                                        concurrency file, 2 skipped   (process exit code 1)
database lane (that file, isolated)     3/3 passed
resolver + validator tsc                no NEW errors (one pre-existing, see below)
frozen v2 / crosswalk / golden.v5       byte-identical
```

**These local results are NOT release PASS evidence and the lanes are NOT
"green".** Assertions passed except the two noted below, but every lane process
exited `1`. A passing assertion set and a passing process are different claims,
and nothing here is exempted locally.

```
assertions: PASS
process:    FAIL (exit 1)
cause:      known Vitest teardown / onTaskUpdate timeout
```

**Disposition: require a normal exit 0 from exact-head canonical CI.** If
canonical CI shows the SAME infrastructure teardown error, then check whether an
approved runner-defect / isolation policy already exists and adjudicate it
separately. No pre-emptive exemption.

**The two database failures: not a regression, but also not release evidence.**
`tests/database/frontend-ask-claim-concurrency.test.ts` failed 2 of 3 cases in the
full lane, passed 3/3 in isolation, and passed in the earlier full-lane run this
session. The file imports only `PostgresFrontendCommandGateway`,
`PostgresAskAnswerExecutionRepository`, `createPostgresPool` and the migration
helpers; **nothing under `adapters/ modules/ packages/ assemblies/` imports the
validator or the resolver**, so no production code path is reachable from this
round's change. That makes a causal link weak, but one isolated re-run does not
close it: **let exact-head canonical CI / the DB suite decide.** If canonical CI
passes, close it with no further investigation; if the same concurrency test fails
repeatedly there, re-open the flaky determination.

**Pre-existing TypeScript error — do not call the typecheck clean.**
`ts6-phase-b-transaction-authority-validator.ts:1012` `TS2345` (`Corpus`
`RegressionEvidence[]` vs `EvidenceShape[]`). "No NEW TypeScript error" is
accurate; "typecheck clean" is **not**. Whether it is already part of the accepted
baseline, and whether the exact-head canonical typecheck actually permits it,
must be confirmed in the final CI. A pre-existing error is not an automatic
release exemption.

### Exact-head release verification checklist

```
[ ] canonical CI process exit code is 0 (not merely "all assertions passed")
[ ] if the Vitest teardown / onTaskUpdate error appears in canonical CI, obtain the
    standing runner-defect adjudication or isolation policy first
[ ] full canonical DB suite clean, or the ask-claim concurrency file adjudicated
[ ] canonical typecheck at exact head: no validator:1012 TS2345, or that error is
    confirmed as an already-accepted baseline entry
[ ] frozen v2 / crosswalk / golden.v5 byte-identical at exact head
[ ] nothing under adapters/ modules/ packages/ assemblies/ apps/ changed
[ ] rebuild-ts6-phase-b-c2-r15-qualified-reachability.mjs at exact head -> 96 / 17 / 0
[ ] rebuild-ts6-phase-b-c2-r15-v6-lineage.mjs -> derived lineage valid=true issues=0
```

---

## 4. Reproduce

```powershell
cd C:\dev\shotgun-ts6-phase-b
docker start shotgun-ts6-r15-pg
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'

# qualified classification of all 113 boundaries
node node_modules/tsx/dist/cli.mjs scripts/rebuild-ts6-phase-b-c2-r15-qualified-reachability.mjs

# derive the v6 lineage from the preserved v5 (writes a NEW file, never rewrites v5)
node node_modules/tsx/dist/cli.mjs scripts/rebuild-ts6-phase-b-c2-r15-v6-lineage.mjs

# audit suites (explicit budget required — they carry no per-test timeout)
node node_modules/vitest/vitest.mjs run scripts/ts6-audit/regression-evidence-authority.test.ts `
  scripts/ts6-audit/c2r15-authority-correction.test.ts `
  --maxWorkers=1 --fileParallelism=false --testTimeout=120000 --hookTimeout=120000
```

---

## 5. Hard constraints (unchanged)

Do not modify `test:contract`, Stage 9, NetworkX, Stage 9 timeout, contract worker
policy, Vitest major version, general CI worker policy, database worker policy, or
unrelated unit-test timeouts. Do not commit, push, create or update a PR, change
CI, merge, or start TS-7. Stop and report if a correction would require Product
transaction changes or an inventory change.
