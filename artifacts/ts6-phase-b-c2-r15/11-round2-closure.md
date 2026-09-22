# C2-R15 round 2 — final closure report

Round status: `CHANGES_REQUIRED / CONTINUE C2-R15 / NO COMMIT / NO PR`.

**`golden.v5.derived.json` validates clean: 0 issues.** All four acceptance
conditions hold, and the additional condition the reviewer added — no unresolved
or stale relation may remain silently in the snapshot — also holds.

```
v2 (unmodified)   119   (was 121; see §5)
v3 (round 1)       66
v4 (round 2)       54
v5 (final)          0
```

**C2-R15 regression-evidence correction: PASS.**
**TS-6 C2 FINAL: HOLD** — the `PROVEN` authority is defective (§6). That is a
separate, now-measured finding, not a qualification of the evidence work.

---

## 1. What was delivered

### 1.1 The seven §4 dispositions — all closed, all proven on real PostgreSQL

| boundary | disposition | applied as | PostgreSQL |
|---|---|---|---|
| `PostgresOrderingStore.commit` | MINIMAL_PROOF_ADDED | new direct proof block | 2/2 |
| `<module>.commitProjectProjection` | conditional REBIND | **REBIND** (condition resolved) | 16/16 |
| `PostgresExternalActionStore.transactionWithHandle` | MINIMAL_PROOF_ADDED | new direct proof block | 18/18 |
| `PostgresSourcesProductService.retry` | RELABEL/REWRITE_PATH first | no qualified path → MINIMAL_PROOF | 3/3 |
| `PostgresChangeSetReviewRepository.recordDecision` | MINIMAL_PROOF first | no existing qualified call → MINIMAL_PROOF | 3/3 |
| `PostgresOrderingStore.acquireNext` | REBIND_EXISTING or MINIMAL_PROOF | **REWRITE_PATH** (declaration was wrong) | 2/2 |
| `…markStage3ItemsSucceeded` | REBIND_EXISTING first | **REBIND** to the real title | 3/3 |

`COVERAGE_GAP` remains zero. No Product or transaction-inventory change.

### 1.2 The 27 §5 declared relations — all adjudicated and applied

```
Group A  7  genuinely shared evidence → relation-scoped record + covers[]
Group B 20  wrong historical edge, replacement proof found → rebind
Group C  —
```

Group C started at 6 and closed without a single `COVERAGE_GAP`:

```
PostgresAskAnswerExecutionRepository.transaction        MINIMAL_PROOF (direct, public method)
PostgresFrontendReviewRepository.transactionWithHandle  MINIMAL_PROOF
PostgresActionExecutionRepository.transaction           MINIMAL_PROOF
PostgresStandingAIProcessingPolicyRepository.saveRevision MINIMAL_PROOF
PostgresSourcesIntakeLifecycle.transaction              REBIND (PUBLIC_PATH)
PostgresProjectAdministrationRepository.updateStatus    REBIND (PUBLIC_PATH)
```

### 1.3 Four resolver soundness defects

These blocked correct application and were fixed first, each re-verified against
the frozen v2 and the v3 baseline.

**D1 — `PUBLIC_PATH` accepted on `entryInvoked` OR `reach.reached`.** Two
independent false-positive channels. `reach.reached` alone let a *global*
same-named chain vouch for a block that never runs it — exactly how
`PostgresOrderingStore.commit` was "resolved" by the `commitCausalClaim` helper
reaching the canonical-knowledge module's own `commit`. `entryInvoked` alone let
a block invoke the entry and never reach the target. **Both are now required.**
All six genuine `PUBLIC_PATH` relations were checked individually and all six
satisfy both halves.

**D2 — module-level boundaries could never bind a receiver.** `commitProjectProjection`
is an object-literal property of the closure returned by
`createPostgresActivityReadModelStore`, so its symbol is `<module>` and no
receiver can ever bind to it. The class-binding tier is now recognised as
inapplicable for such boundaries, while the requirement that the call appear
**inside the declared block** is preserved; a receiver binding to a *different*
registered class is still `TARGET_MISMATCH`.

**D3 — receiver binding picked an arbitrary class.** Two causes: the file-wide
fallback ignored the call position, and the candidate loop returned the first
known class named *anywhere* in the initialiser — so
`new PostgresSourcesProductService(pool, new SealedSourcesStagingService(...), ...)`
bound to the **inner argument** class. Now the nearest declaration at or above
the call wins, and the outermost constructed class in it is chosen.

**D4 — a local name reused across test blocks.** A consequence of D3.

---

## 2. Verification

```
frozen golden.v2            256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD   unchanged
frozen crosswalk            E4861D67B1EBC4885FA9034245C0B2734E25E3865DE278A4FF660C0B4B0621D2   unchanged
package.json                only the pre-existing R12 test:unit --maxWorkers=2
audit suites                32/32 pass
unit lane                   155 files / 1232 tests pass (audit test not collected)
tests/database              112 files / 562 tests pass, 1 pre-existing skip
v5 validator                0 issues, valid = true
```

The audit suites must be run with an explicit budget
(`--maxWorkers=1 --fileParallelism=false --testTimeout=60000 --hookTimeout=60000`).
Most of their cases call `validateCorpus` on the whole corpus and carry no
per-test timeout, so under the default 5 s budget they are load-sensitive.
Timing measured on this machine: ~12.5 s cold, ~1.0 s warm.

### PostgreSQL proofs added this round

```
tests/database/a9-final-closure-evidence.test.ts           ask-execution transaction boundary  (11/11)
tests/database/frontend-review-postgres-parity.test.ts     review transactionWithHandle        (4/4)
tests/database/stage-11-postgres.test.ts                   action execution transaction        (5/5)
tests/database/standing-ai-processing-policy-owner.test.ts standing policy saveRevision        (2/2)
```

Each asserts that work performed inside the boundary is **durably visible after
commit**, which is what makes it a transaction-boundary proof rather than a
call-site proof. The `a9` boundary needed a locally bound receiver: the fixture
reaches it through `fixture.executionRepository`, which no receiver-binding rule
can resolve to the registered class, so the proof constructs the repository
explicitly.

---

## 3. Final acceptance

```
condition 1  every retained relation bidirectionally consistent      112/112   HOLDS
condition 2  every retained relation independently resolves          112/112   HOLDS
condition 3  every coverage-required PROVEN boundary resolved             0 uncovered  HOLDS
condition 4  120 candidates / 113 boundaries / 11 raw sites / 87 historical    HOLDS
additional   no unresolved or stale relation left silently                         HOLDS
additional   no Product change                                                     HOLDS
```

Explicitly checked: declared-but-not-covered `0`, covered-but-not-declared `0`,
declared relations whose evidence does not cover the boundary `0`, `PROVEN`
boundaries with empty back-references `0`.

---

## 4. Artifacts

```
artifacts/ts6-phase-b-c2-r15/golden.v5.derived.json            FINAL derived snapshot (v2/v3/v4 untouched)
artifacts/ts6-phase-b-c2-r15/relation-adjudication-plan.json   the 27-relation plan and its resolution
artifacts/ts6-phase-b-c2-r15/correction-round2-report.json     applied corrections + adjudication + provenance
artifacts/ts6-phase-b-c2-r15/callersfor-impact.json            the callersFor() gate finding
artifacts/ts6-phase-b-c2-r15/v2-authority-identity-comparison.json  the 121 -> 119 evidence
artifacts/ts6-phase-b-c2-r15/13-FINAL-HANDOFF.md               resume handoff
```

`golden.v5` is a deterministic transform: v5 is derived from v4 by applying the
27-relation plan; v4 is derived from v3 by applying the seven §4 dispositions;
v3 is derived from v2. No step edits the inventory.

Two structural notes that matter for review:

- **Relations are split, never deleted.** A shared evidence record must not be
  mutated for one of its targets: doing so silently destroys the other targets'
  proofs (measured — rebinding the `akp-8-wp2a` record broke
  `PostgresFrontendKnowledgeDraftRepository.transactionWithHandle` and
  `PostgresFrontendReviewRepository.transactionWithHandle`). A moved relation
  gets a relation-scoped record; the original keeps what it proves.
- **Superseded declared relations are retired, not left dangling.** 27 stale
  back-references were removed only after a verified replacement proof existed
  for the same boundary, which is what lets condition 1 hold without losing
  coverage.

Evidence records: `69 → 95` (26 relation-scoped records for the discovered
relations; v5 keeps 95).

---

## 5. The frozen v2 baseline moved 121 → 119

`checkRegressionEvidenceAuthority` resolved the declared test block by
re-parsing it out of `testEvidenceId`, while the validator resolves it from
`evidence.file` / `evidence.testName`. Those disagree whenever a record's id
carries a suffix, so the authority was checking a *different block* than the
validator. It now uses the same block identity, falling back to id-parsing only
when the fields are absent.

Measured effect on the frozen v2, statement by statement:

```
legacy (recorded)  121
corrected          119
dropped              2   REGRESSION_TEST_BLOCK_MISSING + REGRESSION_COVERAGE_INCOMPLETE
                          for product-service.ts:1485, from one suffixed id
added                0
```

A strict improvement — the two dropped statements were false positives caused by
the mis-parse. Reproduce the recorded 121 with
`C2R15_BASELINE_OLD_AUTHORITY=1`. The acceptance test is unchanged and does not
assert an exact count; it asserts `valid === false`, at least one issue, and
that `REGRESSION_COVERAGE_INCOMPLETE` and `REGRESSION_BACKREF_MISMATCH` are
present — all still true.

---

## 6. `callersFor()` — the impact gate, and what it means

**Gate question:** is `callersFor()` the authority for
`productionReachability.status === PROVEN`?

**Answer: yes.** `buildAuditShape` sets
`status = callersFor(...).length > 0 ? 'PROVEN' : 'TEST_ONLY_OR_DEAD'`, and that
status decides `TX_BOUNDARY` (100) vs `TEST_ONLY_OR_DEAD` (13). `callersFor`
matches a production caller by **method name only**, so the recorded caller lists
are polluted (`PostgresDiscoveryFeedbackRepository.transaction` records 56
callers, `PostgresAskAnswerExecutionRepository.transaction` records 47).

**STOP condition checked — not triggered.** Three independent attempts to
quantify qualified reachability were made, and all three were measurement
artifacts, which is itself the finding:

```
pass 1  receiver-text equality                89/100 "zero qualified callers"   artifact
pass 2  call-site-local receiver typing       98/100                            artifact
pass 3  production call graph, named bodies   11/100                            artifact, root-caused
```

Pass 3's cases are all invoked from **anonymous callbacks**, which a named-body
index cannot see: `PostgresOrderingStore.acquireNext` is called as
`state.ordering.acquireNext` inside the async callback passed to
`state.jobs.run` (`packages/connector-runtime/src/runtime.ts:686`), and
`PostgresConnectorRuntimeState.recoverExpiredLeases` from a `setInterval` arrow
(`adapters/connector-runtime-postgres/src/index.ts:1367`). So the `100 / 13 / 7`
split is not disturbed and no production-reachability authority defect was
proven.

**Consequence, applied throughout:** `productionReachability.callers` was never
used to source regression evidence or to license a hop. Groups A/B were selected
by qualified resolution; Group B's `PUBLIC_PATH` rebinds use an entry that the
block provably invokes and whose path provably reaches the boundary.

**Follow-up (separate, not required for C2-R15):** tighten `callersFor()` to a
file/symbol-qualified match with anonymous-callback indexing, then re-derive the
caller lists and re-check the `100 / 13 / 7` split. Scope recorded in
`callersfor-impact.json`.

---

## 6b. `callersFor()` — the independent resolver, and its verdict

The gate above was answered from code inspection. This section is the
independent measurement the reviewer asked for, and it changes the gate from
"unproven" to "confirmed defective".

`scripts/ts6-phase-b-production-reachability.ts` is an independent, qualified
reachability resolver. It qualifies a production call site only when the
receiver **statically resolves** to the boundary class, or to a Port whose only
non-test-double production implementation is the boundary class. It handles the
shapes that defeated three earlier approximations: class fields and constructor
parameter properties, receiver chains (`state.ordering.commit`), object-literal
parameter annotations with destructuring, interface and type-literal member
shapes, aliasing through a field, and calls inside lexical, arrow, nested,
timer and anonymous callbacks.

```
indexed            289 classes / 5799 method bodies / 407 production files
recorded           PROVEN 100   TEST_ONLY_OR_DEAD 13
qualified          PROVEN  82   unreachable       31
agreement          95/113
over-claims        18      under-claims 0
caller entries     748 recorded  ->  165 qualified   (~78% collision)
```

**Zero under-claims.** Not one boundary recorded `TEST_ONLY_OR_DEAD` is
reachable under qualified resolution. The recorded split never wrongly excludes.

**Eighteen resolver-only over-claims**, in three kinds:

```
11  confirmed method-name collision
 6  UNKNOWN only — receiver type not statically resolvable at that site
 1  no production call site of that method name at all
```

Confirmed collisions include
`this.store.save -> ActivityReadModelStorePort`,
`this.configuration.save -> ProjectAIConfigurationPort`,
`this.runtime.saveJob -> DiscoveryTriggerRuntimeRepositoryPort`, and
`handle.repository.appendSuppression -> DiscoveryFeedbackWriteRepositoryPort`.

### Hand-triage of those eighteen (work order C, complete)

Every `UNKNOWN` and every non-collision call site was then traced by hand from
the production composition root — constructor/factory wiring → concrete instance
→ receiver → target method. Nothing was demoted to unreachable on method-name or
interface-name grounds alone.

```
recorded PROVEN       = 100
  qualified reachable =  94     (resolver proved 82; hand-triage recovered 12)
  confirmed overclaim =   5
  still unknown       =   1
  sum                 = 100
```

**The resolver's 82 was an under-estimate.** Its gaps were path-finding, not
unreachability: an object-literal factory call (`application.ts:989`), a
port-typed dependency member (`modules/comparison/src/index.ts:436`, bound to
`new PostgresComparisonRepository(pool)` at `application.ts:1296`), an
accessor-returned runtime (`runtime.productService`, sole implementor), a
structural inline parameter type (`this.source`), and a port passed through a
dependency object (`input.commandGateway` / `runtime.commandGateway` →
`application.ts:472`).

The **5 confirmed over-claims** are:

```
PostgresAuthRepository.bootstrapOwner            only call site is behind
                                                 `testDevelopmentAuth = VITEST && !authRepository && !production`
PostgresCanonicalKnowledgeRepository.commitFrontendDraft   receiver is the knowledge-draft coordinator
PostgresDiscoveryFindingRepository.saveFenced    receiver is ProductFindingRepository
PostgresDiscoveryRuntimeRepository.saveJob       receiver is DiscoveryTriggerRuntimeRepositoryPort
PostgresDiscoveryRuntimeRepository.transitionJob same
<module>.commitProjectProjection (activity + history)      receivers are the read-model Ports
```

The **1 still-unknown** is `PostgresConnectorRuntimeState.recoverExpiredLeases`:
`private`, invoked only from a `setInterval` arrow inside `lifecycle.start`, so
its production reachability depends on a deployment-configuration fact (whether
the app assembly enables the durable connector runtime) rather than on code
reading. It is deliberately **not** recorded as unreachable.

### Consequence, and why it is not applied here

Applying the corrected authority would move the candidate inventory from
`TX_BOUNDARY 100 / TEST_ONLY_OR_DEAD 13` to `94 / 19`, and would fire
`REACHABILITY_DRIFT`, `CLASSIFICATION_DRIFT` and `SUMMARY_COUNT` against all four
frozen snapshots. The C2-R15 work order forbids changing the transaction
inventory to make validation pass, so the correction is **not applied**;
nothing about the corpus, the fixtures or `callersFor()` was changed.

**The corrected picture is narrower than the resolver alone suggested.**
`callersFor()` is confirmed defective, but its damage is concentrated in the
**caller lists** — 748 recorded entries collapse to 165 qualified ones, so ~78%
of the recorded production-caller evidence is method-name collision — while the
`PROVEN`/`TEST_ONLY_OR_DEAD` split is right for 94 of 100 boundaries and wrong
for 5. No rationalized disposition in this round relied on a recorded caller
instead of a verified proof: C1, C3 and C5 all cited recorded callers that turned
out to be collisions, and each was closed by `MINIMAL_PROOF` or `REBIND` rather
than by trusting that caller.

Remediation options are scoped in `reachability-remediation.json`. With the
corrected counts, **B (demote the caller lists from evidence authority) is
rejected as a final solution and A′ accepted** — preserve frozen v2/v5, adopt
qualified reachability as the new authority, and add a correction manifest plus a
derived lineage. Three details of A′ were corrected with evidence; see
`14-review-response-and-adoption-plan.json`. The two that matter:

**`REVIEW_REQUIRED` cannot be a shipping state.** The validator raises
`PRODUCTION_REVIEW_REQUIRED` for *any* boundary with that status
(`ts6-phase-b-transaction-authority-validator.ts:826`), so a projection
containing one is rejected by the tool. It is the right way to *represent*
unresolved reachability and the right way for the gate to fail — not a final
state. Driving that class to zero is a precondition of adoption.

**`94 / 18 / 1` is not what an authority emits.** Applying the qualified
resolver mechanically to all 113 boundaries yields

```
PROVEN 83   TEST_ONLY_OR_DEAD 14   REVIEW_REQUIRED 16
```

The 94 came from adding 12 hand-traced recoveries to the resolver's 82, and
those fixes are not encoded in the resolver. Separately,
`PostgresConnectorRuntimeState.recoverExpiredLeases` is not a configuration
unknown: its call site is a registered timer callback
(`.../connector-runtime-postgres/src/index.ts:1367`, `setInterval(() =>
this.recoverExpiredLeases())` in the constructor) and the lifecycle **is**
started on the canonical production path (`package.json` `start` →
`main.ts` → `startShotgunApplication` → `application.ts:1207` →
`server.ts:2968`). It is genuinely reachable but reachable *from inside its own
class*, which the current reachability doctrine does not count — a doctrine
question, not a code-discovery one, and correctly a TS-6 FINAL blocker.

**On the inventory:** 120 candidates / 113 boundaries / 11 raw sites / 87
historical survive a status-only correction, because they are counted
independently of status. What changes is the derived scoreboard —
`summary.TX_BOUNDARY` / `TEST_ONLY_OR_DEAD` / `REVIEW_REQUIRED` and
`candidateReconciliation[].c2r2Classification`. (An earlier line in this report
said the correction "invalidates the 120/113/11/87 invariant"; that was
imprecise and is corrected here.)

Adoption order, so that the derivation produces something the tool accepts:
close the `REVIEW_REQUIRED` class to zero first (resolve the doctrine case, then
encode the hand-traced bindings into the resolver), confirm the 5 collisions,
and only then re-derive and update the audit baselines.

**TS-6 C2 FINAL remains HOLD.** `golden.v5` is unaffected: it is the corrected
regression-evidence projection and remains valid as such.

---

## 7. Review notes for the owner

1. **The 121 → 119 change is the one baseline movement in this round.** It is a
   correction, evidenced statement by statement in
   `v2-authority-identity-comparison.json`, and no acceptance assertion depends
   on the exact number.
2. **The `PROVEN` authority defect is the blocking item for TS-6 C2 FINAL**
   (§6b). It is measured, one-directional, and not repaired here because
   repairing it changes the transaction inventory.
3. **95 evidence records, 112 relations.** The relation/record ratio is a
   consequence of the record model: one `coverageKind` and one `path` per record.
   Making identity relation-scoped is what allowed the graph to become
   consistent without deleting anything; it also means `file`/`testName` are
   authoritative and the id suffix is not parseable. That is now handled
   consistently in both the validator and the authority.
4. **The audit suites need an explicit timeout budget** (see §2). This predates
   this round but is now the difference between a green and a flaky run.

No commit, push, PR, CI change, or merge. Stage 9, NetworkX, contract worker
policy, Vitest major version, general CI worker policy and database worker policy
untouched. No production source under `adapters/ modules/ packages/ assemblies/
apps/` was modified.
