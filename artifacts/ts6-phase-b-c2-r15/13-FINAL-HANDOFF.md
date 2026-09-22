# C2-R15 — FINAL RESUME HANDOFF

> **SUPERSEDED — read `21-FINAL-HANDOFF-R3.md` instead.**
>
> The RESUME block below is round 2 and its two blocking items are both RESOLVED:
> the `P-ACCESSOR` work order was implemented, `REVIEW_REQUIRED` reached 0, the
> owner ruled `PostgresAuthRepository.bootstrapOwner` to be `TEST_ONLY_OR_DEAD`,
> and the qualified reachability authority was ADOPTED (`callersFor()` retired
> from every decision) producing the `96 / 17 / 0` v6 lineage.
>
> ```
> C2-R15 regression evidence authority     PASS
> production reachability authority        PASS
> golden.v6 derived lineage                PASS
> TS-6 C2 FINAL                            HOLD — exact-head release verification only
> ```
>
> Current entry points: `22-RELEASE-VERIFICATION-HOLD.json` (verdict + release
> checklist) → `21-FINAL-HANDOFF-R3.md` → `19-authority-correction-adopted.json` →
> `golden.v6.derived.json`. Do NOT modify v6 or re-open the reachability authority.
>
> The sections below are retained as the round-2 historical record.

Supersedes `10-RESUME-HANDOFF.md` (round 1) and `12-RESUME-HANDOFF-R2.md`
(round 2, written mid-round). Evidence and reasoning: `11-round2-closure.md`.

Round status: `CHANGES_REQUIRED / CONTINUE C2-R15 / NO COMMIT / NO PR`.

> ## RESUME HERE (fresh session, no prior context needed)
>
> Work is mid-stream on the reachability-authority adoption (A′). Read in this
> order: `16-review-required-ledger.json` → `15-reachability-adoption-progress.json`
> → `14-review-response-and-adoption-plan.json`.
>
> **State:** `PROVEN 86 / TEST_ONLY_OR_DEAD 13 / REVIEW_REQUIRED 14`.
> The old `94 / 19 / 0` figure is **discarded as a hypothesis** — it came from a
> hand-trace later shown to contain misclassifications. The only fixed
> requirement is **`REVIEW_REQUIRED = 0`**; the PROVEN/TEST_ONLY split is
> whatever the evidence says.
>
> **Next action:** implement `P-ACCESSOR` in `scripts/ts6-phase-b-production-reachability.ts`
> (recover `PostgresSourcesProductService.submit` / `resolveDuplicate` / `retry`
> through the process-global write runtime getter), then `P-FACTORY-CAPTURE`,
> then `P-STRUCTURAL`, verifying after **each** pattern that the already-resolved
> set does not regress. Then source-verify the remaining collision-labelled rows
> the same way `PostgresSemanticIndexRepository.activateGeneration` was
> (`PostgresCanonicalKnowledgeRepository.commitFrontendDraft`,
> `PostgresDiscoveryRuntimeRepository.saveJob`/`transitionJob`,
> `<module>.commitProjectProjection` ×2, `PostgresFrontendCommandGateway.accept`).
>
> **Do NOT:** relax the `PRODUCTION_REVIEW_REQUIRED` validator gate (it is the
> final safety net), hardcode hand-traced results as per-boundary exceptions, or
> tune the resolver to reach any target number.
>
> Five general resolver defects were already fixed this round (see the ledger):
> object-literal method bodies, registered-callback reachability, the
> implementations index, type-alias traversal, and module-level boundary
> equivalence.

**`golden.v5.derived.json` validates clean: 0 issues. All acceptance conditions
hold.** The C2-R15 disposition work requested by the §4 table is complete.

**Official standing:**

```
C2-R15 evidence authority correction      PASS
golden.v5 derived evidence view           PASS
Product transaction changes               NONE
Regression coverage authority             CLOSED

production reachability (callersFor):
  recorded authority                      DEFECT CONFIRMED
  qualified replacement                   A' ADOPTED (in progress)
  current qualified split                 86 / 13 / 14   (PROVEN / DEAD / REVIEW_REQUIRED)
  94 / 19 / 0                             DISCARDED — was a hypothesis, not a target
  fix target                              REVIEW_REQUIRED = 0 (split follows the evidence)
  caller-list impact                      748 recorded vs 165 qualified (~78% collision)

TS-6 C2 FINAL                             HOLD
commit / push / PR                        STOP
TS-7                                      STOP
```

The one remaining blocker is not an evidence problem. It is the authority that
decides `PROVEN` — see §2b.

---

## 1. Environment

```
repository  JasonCutter/shotgun
worktree    C:\dev\shotgun-ts6-phase-b
branch      codex/ts6-postgres-transaction-phase-b
base       1f821ea371b308d8cecede4a98ebe27960873b21   (provenance only; HEAD unchanged)
container   docker start shotgun-ts6-r15-pg
            pgvector/pgvector:pg16 @ sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b

$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'
npm run db:test:reset
npm run db:test:verify
```

---

## 2. Final state

```
v2 (unmodified)   119   (was 121; see 11-round2-closure.md §5)
v3 (round 1)       66
v4 (round 2)       54
v5 (final)          0
```

```
FINAL v5 ACCEPTANCE: PASS
  relation statements declared            112
  bidirectionally consistent              112
  independently resolving                 112
  declared-but-not-covered                  0
  covered-but-not-declared                  0
  PROVEN without a resolving relation       0
  PROVEN with empty back-references         0
  inventory  120 candidates / 113 boundaries / 11 raw sites / 87 historical
  validator  valid=true, issues=0
```

Closed: the seven `10-RESUME-HANDOFF.md` §4 boundaries, and the 27 §5 declared
relations (7 shared-evidence declarations completed, 20 rebound to verified
proofs). `COVERAGE_GAP` is zero.

---

## 2b. The blocking item: `callersFor()` — PROVEN authority is defective

`buildAuditShape` sets `status = callersFor(...).length > 0 ? 'PROVEN' :
'TEST_ONLY_OR_DEAD'`, and that status decides `TX_BOUNDARY` (100) vs
`TEST_ONLY_OR_DEAD` (13). `callersFor()` matches by **method name only**.

`scripts/ts6-phase-b-production-reachability.ts` is an independent qualified
resolver (class fields, constructor parameter properties, receiver chains,
destructured object-literal parameter annotations, interface/type-literal member
shapes, field aliasing, calls inside lexical/arrow/nested/timer/anonymous
callbacks, Port-implementation closure excluding `*-in-memory` test doubles).

```
indexed        289 classes / 5799 bodies / 407 files
recorded       PROVEN 100   TEST_ONLY_OR_DEAD 13
resolver-only  PROVEN  82   unreachable       31     <-- an UNDER-estimate
agreement      95/113
callers        748 recorded -> 165 qualified  (~78% collision)
```

The resolver's 82 is **not** the answer. Work order C hand-traced every gap from
the production composition root (constructor/factory wiring → concrete instance
→ receiver → target method):

```
recorded PROVEN       = 100
  qualified reachable =  94     (hand-triage recovered 12 the resolver could not follow)
  confirmed overclaim =   5
  still unknown       =   1
  sum                 = 100
```

Confirmed over-claims:

```
PostgresAuthRepository.bootstrapOwner              only call site is behind
                                                   testDevelopmentAuth = VITEST && !authRepository && !production
PostgresCanonicalKnowledgeRepository.commitFrontendDraft   receiver is the knowledge-draft coordinator
PostgresDiscoveryFindingRepository.saveFenced      receiver is ProductFindingRepository
PostgresDiscoveryRuntimeRepository.saveJob         receiver is DiscoveryTriggerRuntimeRepositoryPort
PostgresDiscoveryRuntimeRepository.transitionJob   same
<module>.commitProjectProjection (activity+history)        receivers are the read-model Ports
```

Still unknown (do **not** demote):

```
PostgresConnectorRuntimeState.recoverExpiredLeases
  private; invoked only from a setInterval arrow inside lifecycle.start, so its
  production reachability depends on whether the app assembly enables the durable
  connector runtime — a deployment-configuration fact, not a code-reading fact.
```

**What this means.** `callersFor()` is confirmed defective, but the damage is
concentrated in the **caller lists** (748 → 165); the `PROVEN` split is right for
94 of 100. No disposition in this round relied on a recorded caller: C1, C3 and
C5 all cited recorded callers that turned out to be collisions and were closed by
`MINIMAL_PROOF`/`REBIND` instead.

Applying the correction would move the inventory to `94 / 19` and fire
`REACHABILITY_DRIFT` / `CLASSIFICATION_DRIFT` / `SUMMARY_COUNT` against all four
frozen snapshots. The work order forbids changing the transaction inventory, so
it is **not applied**.

Remediation: **A′ accepted** — preserve frozen v2/v5, adopt qualified
reachability as the new authority, add a correction manifest and a derived
lineage. B rejected as a final solution. Details and three evidence-based
corrections to the proposal are in `14-review-response-and-adoption-plan.json`.
The two that gate adoption:

```
REVIEW_REQUIRED is rejected by the validator (PRODUCTION_REVIEW_REQUIRED,
  ts6-phase-b-transaction-authority-validator.ts:826) -> it is the right way to
  REPRESENT unresolved reachability and the right way for the gate to fail, but
  it cannot be a shipping state. Drive the class to zero first.

94 / 18 / 1 is hand-derived, not an authority output. The qualified resolver
  emits PROVEN 83 / TEST_ONLY_OR_DEAD 14 / REVIEW_REQUIRED 16. 94 = 82 resolver
  + 12 hand-traced recoveries that are not encoded in the resolver.

recoverExpiredLeases is NOT a configuration unknown. Its call site is a
  registered timer callback (connector-runtime-postgres/src/index.ts:1367) and
  the lifecycle IS started on the canonical production path
  (package.json start -> main.ts -> startShotgunApplication ->
  application.ts:1207 -> server.ts:2968). It is reachable from INSIDE its own
  class, which the current doctrine does not count -> doctrine question.
```

`120/113/11/87` survives a status-only correction (counted independently of
status). What changes is the derived scoreboard (`summary.TX_BOUNDARY` /
`TEST_ONLY_OR_DEAD` / `REVIEW_REQUIRED`, `candidateReconciliation[].c2r2Classification`).

Adoption order: close `REVIEW_REQUIRED` to zero (doctrine case, then encode the
10 hand-traced bindings into the resolver) → confirm the 5 collisions → re-derive
→ update the audit baselines that pin `TX_BOUNDARY: 100` / `TEST_ONLY_OR_DEAD: 13`
(`c2r15-authority-correction.test.ts:48-54`,
`regression-evidence-authority.test.ts:33-39`).

`golden.v5` is unaffected either way — it is the corrected regression-evidence
projection and remains valid as such.

---

## 3. Files changed (all uncommitted)

```
M scripts/ts6-phase-b-regression-evidence-resolver.ts                 D1-D4 soundness fixes
M scripts/ts6-phase-b-regression-evidence-authority.ts                block identity from record fields
M scripts/ts6-phase-b-transaction-authority-validator.ts              boundaryId preserved on Issue
A scripts/ts6-phase-b-production-reachability.ts                      independent qualified reachability (the §2b finding)
M tests/database/akp-8-wp2-cross-section-causal-acceptance.database.test.ts    C1 proof
M tests/database/frontend-external-action-postgres-parity.test.ts              C3 proof
M tests/database/frontend-sources-stage3-recovery.test.ts                      C4 proof
M tests/database/stage-5-postgres.test.ts                                      C5 proof
M tests/database/a9-final-closure-evidence.test.ts                             Group C proof
M tests/database/frontend-review-postgres-parity.test.ts                       Group C proof
M tests/database/stage-11-postgres.test.ts                                     Group C proof
M tests/database/standing-ai-processing-policy-owner.test.ts                   Group C proof
A artifacts/ts6-phase-b-c2-r15/golden.v4.derived.json
A artifacts/ts6-phase-b-c2-r15/golden.v5.derived.json
A artifacts/ts6-phase-b-c2-r15/relation-adjudication-plan.json
A artifacts/ts6-phase-b-c2-r15/correction-round2-report.json
A artifacts/ts6-phase-b-c2-r15/callersfor-impact.json
A artifacts/ts6-phase-b-c2-r15/v2-authority-identity-comparison.json
A artifacts/ts6-phase-b-c2-r15/production-reachability-authority.json
A artifacts/ts6-phase-b-c2-r15/reachability-remediation.json
A artifacts/ts6-phase-b-c2-r15/11-round2-closure.md
A artifacts/ts6-phase-b-c2-r15/13-FINAL-HANDOFF.md
```

Frozen and verified unchanged:

```
tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json  256E5906...86CD
ts6-c2-r3-boundary-count-crosswalk.json                          E4861D67...21D2
package.json   only the pre-existing R12 test:unit --maxWorkers=2
```

No production source under `adapters/ modules/ packages/ assemblies/ apps/` was
modified by this round.

---

## 4. Verification commands

```powershell
cd C:\dev\shotgun-ts6-phase-b
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'

# frozen v2 must FAIL (119 issues; 121 with C2R15_BASELINE_OLD_AUTHORITY=1)
node node_modules/tsx/dist/cli.mjs scripts/ts6-phase-b-transaction-authority-validator.ts verify

# audit suites — explicit budget required (they carry no per-test timeout)
node node_modules/vitest/vitest.mjs run scripts/ts6-audit/regression-evidence-authority.test.ts `
  scripts/ts6-audit/c2r15-authority-correction.test.ts `
  --maxWorkers=1 --fileParallelism=false --testTimeout=60000 --hookTimeout=60000

# unit lane (audit test must NOT be collected)
node node_modules/vitest/vitest.mjs run tests/unit --maxWorkers=2

# database lane
node node_modules/vitest/vitest.mjs run tests/database `
  --maxWorkers=1 --fileParallelism=false --testTimeout=120000 --hookTimeout=120000
```

To re-derive the snapshots, the drivers live in `%TEMP%` and are throwaway:
`c2r15-round2-derive.mts` (v4), `c2r15-buildplan2.mts` + `c2r15-derive-v5.mts`
(v5). `relation-adjudication-plan.json` is their input/output and records every
decision.

---

## 5. Open items for the owner

1. **v2 baseline 121 → 119.** The authority now verifies the same test block the
   validator resolves instead of re-parsing it from the id; two false-positive
   statements disappear and none are added. Evidenced statement by statement in
   `v2-authority-identity-comparison.json`. No acceptance assertion depends on
   the exact count. Reproduce the old number with
   `C2R15_BASELINE_OLD_AUTHORITY=1`.

2. **`callersFor()` — the blocking item.** See §2b. Measured defective in one
   direction (18 over-claims, 0 under-claims, 748 recorded caller entries for 165
   qualified ones). Not repaired here because repairing it changes the
   transaction inventory. Remediation C → B → (A if the owner wants the canonical
   snapshot corrected) is scoped in `reachability-remediation.json`.

3. **Audit-suite timeout budget.** Most cases in
   `scripts/ts6-audit/regression-evidence-authority.test.ts` call
   `validateCorpus` on the whole corpus and carry no per-test timeout, so the
   default 5 s budget is load-sensitive. Run with an explicit budget, or add
   per-test budgets. Predates this round.

4. **Round-1 artifacts still carry the old numbers.** `08-…md`, `09-…md` and
   `10-RESUME-HANDOFF.md` state `121` / `68`. They are historical records of that
   round and were deliberately not rewritten; `10-` carries a superseded banner.

---

## 6. Hard constraints (unchanged)

Do not modify `test:contract`, Stage 9, NetworkX, Stage 9 timeout, contract worker
policy, Vitest major version, general CI worker policy, database worker policy, or
unrelated unit-test timeouts. Do not change the transaction inventory to make
validation pass. Do not commit, push, create or update a PR, change CI, merge, or
start TS-7. Stop and report if a correction would require Product transaction
changes or an inventory change.
