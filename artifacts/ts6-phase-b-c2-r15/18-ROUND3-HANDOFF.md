# C2-R15 — ROUND 3 HANDOFF (P-ACCESSOR + REVIEW_REQUIRED closure)

> **SUPERSEDED by `21-FINAL-HANDOFF-R3.md`.** This document records the state
> mid-round, before the owner's rulings were received. The `97 / 16` figure and
> the two "remaining owner decisions" below are historical: both decisions were
> made (bootstrapOwner → `TEST_ONLY_OR_DEAD`; authority replacement approved), the
> scoreboard is now `96 / 17 / 0`, and the v6 lineage is derived and validates
> clean. Read `21-FINAL-HANDOFF-R3.md` for the current state.

Supersedes the RESUME block of `13-FINAL-HANDOFF.md` for the items it covers.
Round status: `CHANGES_REQUIRED / CONTINUE C2-R15 / NO COMMIT / NO PR`.

> ## RESUME HERE (fresh session, no prior context needed)
>
> Read in this order: `17-round3-paccessor-and-review-required-closure.json`
> (what round 3 did, with proof) → `production-reachability-qualified.json`
> (the current qualified classification of all 113 boundaries) →
> `14-review-response-and-adoption-plan.json` (§ the A′ adoption plan).
>
> **The P-ACCESSOR work order is DONE.** `REVIEW_REQUIRED` — a boundary the
> recorded authority calls `PROVEN` but the qualified authority cannot prove —
> went from **17 to 0**. 14 boundaries were recovered by general resolver rules;
> the last 3 were **source-verified as genuine method-name collisions** and belong
> to `TEST_ONLY_OR_DEAD`.
>
> ```
> recorded authority     PROVEN 100   TEST_ONLY_OR_DEAD  13   (callersFor, name-only)
> qualified authority    PROVEN  97   TEST_ONLY_OR_DEAD  16   (REVIEW_REQUIRED 0)
> inventory              120 candidates / 113 boundaries / 11 raw sites / 87 historical  — UNCHANGED
> frozen v2 / crosswalk  UNCHANGED (sha 256E5906… / E4861D67…)
> validator gate         UNCHANGED, still rejects the frozen v2 with 119 issues
> production source      UNCHANGED
> ```
>
> **Two owner decisions are the only things left before adoption:**
>
> 1. **The `PostgresAuthRepository.bootstrapOwner` doctrine ruling.** The resolver
>    says `PROVEN` (the receiver really is the boundary's Port and the boundary
>    really is its only implementation). The single call site sits behind
>    `if (testDevelopmentAuth)`, and `testDevelopmentAuth` is
>    `VITEST && !options.authRepository && !production` (`server.ts:2549-2550`).
>    That is the same *shape* of question as `recoverExpiredLeases`, which the
>    owner already ruled production reachable. **Recommendation: PROVEN** — static
>    wiring is the authority and a configuration guard is recorded as evidence,
>    not as unreachability. **This round did not apply it.**
> 2. **Authorisation to apply the correction to `buildAuditShape`.** Replacing
>    `callersFor()` at `ts6-phase-b-transaction-authority-validator.ts:511-512`
>    with the resolver's `boundaryMatchKind()` is a 2-line change, but it moves
>    the derived scoreboard to `97 / 16` and therefore invalidates the baseline
>    pinned by four frozen snapshots
>    (`c2r15-authority-correction.test.ts:48-54`,
>    `regression-evidence-authority.test.ts:33-39`). The work order reserves that
>    step for an explicit owner decision. **Not applied.**
>
> **Do NOT:** relax the `PRODUCTION_REVIEW_REQUIRED` gate, hardcode hand-traced
> results as per-boundary exceptions, or tune the resolver to a target number.
> The old `94 / 19 / 0` figure remains **discarded** and was never used.

---

## 1. What round 3 changed

One file: `scripts/ts6-phase-b-production-reachability.ts` (untracked, new).

| # | Defect | Impact |
| - | ------ | ------ |
| R-6 | **Function parameters were never indexed** — the body walk started at the `Block`, and a parameter list is a sibling of that Block, not a child | general and large: no injected dependency declared as a parameter was ever visible |
| R-7 | A nested call site was attributed to every enclosing body, and dedup let traversal **order** decide | general (introduced by R-6, caught by the mandated regression check) |
| R-8 | Type-alias constituents were extracted by text scan: missed `Pick<Port,…>`, admitted **method names** as type names, ignored nesting | general, both directions |
| R-9 | The implementation index was one-directional — a class implementing a broad Port was not an implementation of a **narrowing** alias of it | general |
| R-10 | **Qualification was expressed twice and the two copies disagreed** — verdict used the alias rule, classification used literal class equality | general |
| R-11 | Object-literal **factories** were not implementations of the Port they satisfy | general |

`boundaryMatchKind()` is now the single expression of the doctrine, and
`resolveReachability` delegates to it, so a verdict and its classification cannot
disagree.

### P-ACCESSOR (the delivered work order)

`const runtime = getSourcesWriteRuntime()` carries no annotation; the helper's
return type is written on the **arrow signature**, which the index holds in the
initialiser text (`(): SourcesWriteRuntime | undefined => activeRuntime`) and
never in the annotation field. Following it recovers
`PostgresSourcesProductService.submit` / `resolveDuplicate` / `retry`, and — by
the same rule — `PostgresDiscoveryRuntimeRepository.reserveProviderCall` /
`finalizeProviderCall` and `PostgresFrontendCommandGateway.accept`.

---

## 2. The three remaining collisions (source-verified)

```
PostgresDiscoveryRuntimeRepository.saveJob / transitionJob
  every same-named call site has receiver type DiscoveryTriggerRuntimeRepositoryPort.
  The ONLY class implementing that Port is InMemoryDiscoveryRuntimeRepository
  (adapters/discovery-trigger-coordinator/src/index.ts:631). The boundary implements
  DiscoveryRuntimeExecutionRepositoryPort and DiscoveryActivityReadPort instead, and
  the Port is offered only as an optional injection point (server.ts:817) with no
  durable binder. -> the call reaches a DIFFERENT contract.

PostgresDiscoveryFindingRepository.save
  8 same-named call sites, each on an unrelated Port (TransformationRepositoryPort x2,
  ProjectAIConfigurationPort, StandingAIProcessingPolicyWriterPort,
  ChangeSetReviewRepositoryPort x2, DiscoveryReviewResourceWriterPort,
  IntakeRepositoryPort) + 1 unresolved. The composite the boundary IS wired through is
  `type ProductFindingRepository = DiscoveryFindingRepositoryPort &
  DiscoveryFindingLifecycleRepositoryPort` (adapters/discovery-runtime-product/src/index.ts),
  and enumerating every member access on that composite shows listByProject,
  findLifecycle, saveFenced, findRevision, listByProjectPage — `save` is never called.
```

These three are exactly the over-claims the handoff predicted, so adopting the
qualified authority moves `TX_BOUNDARY 100 → 97` and
`TEST_ONLY_OR_DEAD 13 → 16`.

---

## 3. Verification (all run in this round)

```
audit suites     32/32 passed
unit lane        155 files / 1232 tests passed
database lane    112 files / 562 tests passed (1 file, 2 tests skipped — pre-existing)
validator        frozen v2 still FAILS, issueCount 119 (unchanged)
resolver tsc     clean (no error reported for the resolver)
frozen v2 sha    256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD
crosswalk sha    E4861D67B1EBC4885FA9034245C0B2734E25E3865DE278A4FF660C0B4B0621D2
```

Both lanes report `exit code 1` from a vitest `[vitest-worker]: Timeout calling
"onTaskUpdate"` unhandled error at teardown with **zero test failures** — the
pre-existing audit-suite timeout budget noted in `13-FINAL-HANDOFF.md` §5.3.

---

## 4. Reproduce

```powershell
cd C:\dev\shotgun-ts6-phase-b
docker start shotgun-ts6-r15-pg
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5432/shotgun_test'

node node_modules/tsx/dist/cli.mjs scripts/rebuild-ts6-phase-b-c2-r15-qualified-reachability.mjs
# -> boundaries 113 / recorded 100-13 / qualified 97-16 / REVIEW_REQUIRED 3
#    (the 3 are the source-verified collisions above; the validator never sees them
#     because the recorded authority still classifies them PROVEN)
```

---

## 5. Hard constraints (unchanged)

Do not modify `test:contract`, Stage 9, NetworkX, Stage 9 timeout, contract worker
policy, Vitest major version, general CI worker policy, database worker policy, or
unrelated unit-test timeouts. Do not change the transaction inventory to make
validation pass. Do not commit, push, create or update a PR, change CI, merge, or
start TS-7. Stop and report if a correction would require Product transaction
changes or an inventory change.
