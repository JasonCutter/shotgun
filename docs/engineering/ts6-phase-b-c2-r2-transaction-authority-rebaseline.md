# TS-6 Phase B C2-R2 Transaction Authority Rebaseline

Status: `REVIEW_REQUIRED / STOP`

## 1. Identity

- Repository: `C:\dev\shotgun`
- Execution worktree: `C:\dev\shotgun-ts6-phase-b`
- Branch: `codex/ts6-postgres-transaction-phase-b`
- Reviewed base: `1f821ea371b308d8cecede4a98ebe27960873b21`
- Date: 2026-09-20 Asia/Seoul

## 2. Authorization

This pass is limited to C2-R2 source authority, corpus rebaseline, validator,
and evidence. Commit, push, PR, Ready, merge, release, and TS-7 remain
unauthorized.

## 3. Frozen C1 identity

C1 remains frozen and was not regenerated or rerun. The accepted C1 ZIP is
`shotgun-ts6-phase-b-c1-review-20260920.zip`, SHA-256
`D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04`, with
internal manifest SHA
`903A64AC...04A8019`. No C1 proof, full database suite, or hygiene sweep was
repeated.

## 4. Retained C2-R1 changes

The exact command-gateway readback and its focused database test remain in the
worktree. They were not replaced by the taxonomy work. The C2-R1 result remains
`REVIEW_REQUIRED / STOP` because the database proof had no guarded test
database and the old caller corpus was not authoritative.

## 5. Historical rule superseded

The historical 87-row inventory is comparison evidence only. C2-R2 does not
require the current source count to equal 87. The old C2-R1 fixture is
superseded by the v2 fixture; its findings remain in the C2-R1 evidence file.

## 6. Source-derived candidate set

The TypeScript compiler API scanner derives exactly 120 C2-R1 candidate
identities from production source: 110 safe-helper sites and 10 literal raw
transaction sites. The separate raw-site scan finds 11 sites because it also
retains one interpolated savepoint statement for raw-drift evidence.

## 7. Taxonomy

Every candidate is classified as exactly one of `TX_BOUNDARY`,
`TX_PARTICIPANT`, `TX_DELEGATE`, `NON_TX`, `TEST_ONLY_OR_DEAD`, or
`REVIEW_REQUIRED`. A boundary owns outcome authority; a participant receives a
transaction from a boundary and has no independent commit; a delegate forwards
to an owner; non-transaction false positives are excluded; test-only/dead is
used only where no production call expression was found.

## 8. Candidate reconciliation

All 120 candidate identities are present exactly once in
`candidateReconciliation`. Current source-derived candidate counts are:

| Classification      | Count |
| ------------------- | ----: |
| `TX_BOUNDARY`       |   100 |
| `TX_PARTICIPANT`    |     0 |
| `TX_DELEGATE`       |     0 |
| `NON_TX`            |     7 |
| `TEST_ONLY_OR_DEAD` |    13 |
| `REVIEW_REQUIRED`   |     0 |

The seven raw lifecycle duplicates are preserved as explicit `NON_TX` duplicate
exclusions rather than silently dropped.

## 9. Canonical inventory

The candidate reconciliation has 100 production-proven boundary rows and 13
test-only/dead boundary rows, for 113 canonical boundary records. It also has
one canonical savepoint participant represented in the raw-site inventory. The
participant is not one of the 120 C2-R1 candidate rows because it is the
interpolated savepoint site retained separately for raw drift.

## 10. Historical mapping

The v2 corpus contains 87 historical mappings. All 87 are explained; zero are
unexplained. A current count of 120 is therefore an intentional source-derived
delta, not a corpus failure.

## 11. Discovery feedback call graph

The production coordinator is
`modules/discovery-feedback/src/index.ts`:
`DiscoveryFeedbackProductCoordinator.submit` calls
`handle.repository.appendSuppression(directive)`. The PostgreSQL repository
owns its outer transaction through `appendSuppression`; its internal executor
is not counted as an independent owner.

## 12. Discovery runtime call graph

`modules/discovery-runtime/src/worker.ts` defines
`PersistentDiscoveryWorker.runOnce`. Each repository transaction method was
checked by exact source call expression. The worker class or directory name is
not used as caller proof.

## 13. Finding and re-entry call graph

Finding persistence and re-entry methods were checked against actual production
call expressions. Where no production caller was found after the full source
scan, the record is `TEST_ONLY_OR_DEAD`; it is not promoted by naming convention.

## 14. Frontend Knowledge Draft path

The direct production path remains:

`frontend-knowledge-draft-routes.ts`
→ `coordinator.commitFrontendDraft(...)`
→ `dependencies.canonical.commitFrontendDraftInTransaction(transaction, write)`
or `commitFrontendDraft(write)`
→ `adapters/postgres-stage6/src/index.ts`.

The event-handler path is separate and is not treated as the sole caller.

## 15. Raw transaction sites

The raw-site corpus contains 11 current raw sites, including the interpolated
savepoint. Raw sites are not auto-adopted as independent authorities. Literal
`COMMIT` and `ROLLBACK` sites sharing a `BEGIN` function are explicitly linked
to the owning raw boundary.

## 16. Regression evidence

The scanner found 53 existing regression-evidence records. Strict verification
reports 16 production-proven boundaries without linked regression evidence:

- connector-runtime-postgres:1199, 1389
- discovery-reentry-postgres:777, 987
- discovery-runtime-postgres:2844
- frontend-activity-postgres:91
- frontend-ask-execution-postgres:2421
- frontend-sources-write-postgres/product-service:467, 508, 1485
- postgres-stage5:418, 1340
- postgres:971, 1500
- provider-privacy-deployment-postgres:90, 160

No fabricated test IDs were added to conceal these gaps.

## 17. Validator audit mode

`npx tsx scripts/ts6-phase-b-transaction-authority-validator.ts audit` is
read-only and reports 120 candidates, 11 raw sites, 113 boundaries, and one
participant. It does not write or rebaseline the fixture.

## 18. Validator verify mode

`npx tsx scripts/ts6-phase-b-transaction-authority-validator.ts verify` is
strict and exits 1 with 16 `MISSING_REGRESSION` issues. This is the required
source-authority failure, not a reason to weaken the validator.

## 19. Validator negative coverage

The unit suite covers source count, duplicate identities, classification drift,
caller binding, fabricated/import-only caller evidence, missing regression
links, raw-site drift, production `REVIEW_REQUIRED`, participant/delegate and
exclusion set checks, and fixture immutability.

## 20. Exact command readback

The retained command-gateway contract requires the same command id,
`COMPLETED`, `SUCCEEDED`, and structural equality of `produced_resources`.
Otherwise the original `OUTCOME_UNKNOWN` is rethrown. The lookup is read-only;
there is no retry, second update, or command execution.

## 21. Database gate

`DATABASE_URL` and `TEST_DATABASE_URL` are absent in this environment. The
guarded C2 command-gateway database test was invoked and exited before running
any test because `TEST_DATABASE_URL` is required and a `DATABASE_URL` fallback
is forbidden. Result: `DB_VERIFICATION=BLOCKED_NO_TEST_DATABASE`.

## 22. Product scope

No Product behavior outside
`adapters/frontend-command-gateway-postgres/src/index.ts` was changed in this
rebaseline. No new Port, schema, ledger, transaction framework, dependency, or
runtime was introduced.

## 23. OSS review

The existing `packages/postgres-transaction` helper remains the approved
transaction adapter. No new OSS candidate is relevant to the source inventory
or exact readback. Decision: `NO_RELEVANT_OSS` for new behavior, with existing
helper reuse. No internal helper schema is promoted to a Shotgun contract.

## 24. Security and approval boundary

The rebaseline does not write Canonical state, bypass Approval, add Action
authority, or expose OSS internal identifiers. The validator is read-only and
the exact readback is a SELECT-only reconciliation path.

## 25. Migration

No database migration or data transformation is required. The v1 fixture is
removed as a competing canonical fixture; its historical evidence is retained
in the C2-R1 evidence document.

## 26. Rollback

Rollback is file-level: restore the prior validator/fixture pair and retain the
C2-R1 evidence. The command-gateway behavior can be reverted independently;
the v2 corpus does not alter runtime data.

## 27. Changed C2-R2 files

- `scripts/ts6-phase-b-transaction-authority-validator.ts`
- `tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json`
- `tests/unit/ts6-phase-b-transaction-authority-validator.test.ts`
- `docs/engineering/ts6-phase-b-c2-r1-transaction-authority-evidence.md`
- `docs/engineering/ts6-phase-b-c2-r2-transaction-authority-rebaseline.md`

The worktree also contains pre-existing owner and C2-R1 changes; they are not
claimed as newly authored by this rebaseline.

## 28. Verification summary

- TypeScript compile: PASS (`npx tsc --noEmit`)
- C2-R2 validator unit tests: PASS (9 tests)
- C2-R1 focused unit tests: PASS where rerun
- Validator audit: PASS as an audit report
- Validator verify: FAIL as intended with 16 missing regression links
- Database verification: BLOCKED by missing `TEST_DATABASE_URL`

## 29. Gate decision

`SOURCE_AUTHORITY=FAIL` because strict regression evidence is incomplete.
`DB_VERIFICATION=BLOCKED_NO_TEST_DATABASE`.
`OVERALL=REVIEW_REQUIRED / STOP`.

The 16 missing regression links and the unavailable guarded database are the
remaining blockers. No claim of `COMPLETE`, `COMPLETE_WITH_LIMITS`, Ready, or
TS-7 authorization is made.

## 30. Handoff

C2-R2 is reported to the controlling GPT with the v2 fixture, validator output,
unit-test result, and artifact manifest. Wait for the next complete request;
do not commit, push, open a PR, or proceed to TS-7 without explicit authority.
