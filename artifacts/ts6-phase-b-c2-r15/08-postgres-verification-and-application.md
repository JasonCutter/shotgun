# C2-R15 — PostgreSQL verification and correction application report

## 1. Test database provisioned

```
container  shotgun-ts6-r15-pg    pgvector/pgvector:pg16 (digest ccc6e83d6e35 = CI digest)
server     PostgreSQL 16.15 (Debian) / vector 0.8.6
database   shotgun_test          (satisfies guard regex ^shotgun_test(?:_[a-z0-9]+)*$)
schema     npm run db:test:reset   -> "Database migrations applied / schema recreated"
verify     npm run db:test:verify  -> "Database bootstrap verified"
```

Two facts worth recording, both measured:

- Without `TEST_DATABASE_URL` the database suite does NOT skip; it FAILS at
  collection with `TEST_DATABASE_URL is required for database-backed tests`.
  The work order assumed "skipped when unavailable"; that assumption is wrong for
  this repository. `requireTestDatabaseTarget()` throws from a top-level await.
- `auth-postgres.test.ts` fails on the Vitest default 5000 ms budget and passes
  under the repository's declared database policy
  (`--maxWorkers=1 --fileParallelism=false --testTimeout=60000`). The failure was
  a budget issue, not a test defect.

## 2. Rebind candidates — real PostgreSQL PASS (12/12)

```
[PASS] post-tf-risk001b-proof-matrix.test.ts               12/12
[PASS] akp-7-wp1-feedback-suppression-ranking.database     4/4
[PASS] akp-5-wp2-discovery-reentry.database               13/13
[PASS] section2-postgres                                  10/10
[PASS] ts6-command-gateway-exact-readback.database         8/8
[PASS] frontend-sources-stage4-isolation                   5/5
[PASS] auth-postgres                                      10/10  (declared DB policy)
[PASS] runtime-data-integrity-wp04-schema                  6/6
[PASS] frontend-canonical-commit-frontend-draft           10/10
[PASS] postgres-stage10-transaction-boundary (no DB needed) 10/10
```

Selection rule applied, per work order section 5: not merely "lowest run cost",
but the smallest block that (a) exists as a declared `it()` block, (b) contains an
AST `CallExpression` for the boundary method, and (c) binds the receiver to the
registered boundary class. Skips were never counted as proof.

## 3. Relation-level reconciliation (reviewer guidance applied)

The first attempt at the 43 back-reference mismatches made exactly the mistake the
reviewer warned about: a blanket filter dropped 55 edges and manufactured 39
`MISSING_REGRESSION` findings. Corrected to per-relation adjudication:

```
112 boundary -> evidence edges
  69  evidence declares the boundary              (bidirectional)
  43  evidence does not declare the boundary      (stale back-reference)
       of which 16 relations DO resolve  -> covers[] completed
       of which 27 relations do NOT      -> left declared, reported unresolved
```

v3 preserves v2's relation graph: 69 evidence records, 112 edges, nothing deleted.
Deleting an edge would have silently removed a boundary's only declared evidence.

## 4. Corrections applied

```
REBIND  12   saveRevision, appendSuppression, save, accept, complete, submit,
             bootstrapOwner, saveInferences, synchronize, claim, saveBatch,
             commitFrontendDraft
RELABEL  2   releaseLease           -> PUBLIC_PATH  (entry PersistentDiscoveryWorker.runOnce)
             recoverExpiredLeases   -> OWNER_ATOMICITY (entry recoverProductionExpiredLeases)
covers[] completed        16
evidence-id remap propagated into boundary back-references  20
inventory                 120 candidates / 113 boundaries / 11 raw sites / 87 historical  (unchanged)
```

Evidence-id remap was needed because a rebind changes the record's
`testEvidenceId`; without propagating it, the boundary back-reference became
dangling (`REGRESSION_EVIDENCE_ID_UNRESOLVED` 20 + `REGRESSION_LINK` 20).

## 5. Issue-count progression

```
v2 (unmodified, corrected validator)   121
v3 (derived, corrections applied)       70
```

v3 remaining, by code:

```
35 REGRESSION_COVERAGE_INCOMPLETE
27 REGRESSION_BACKREF_MISMATCH
 2 REGRESSION_CALL_OUTSIDE_TARGET_BLOCK
 2 REGRESSION_TARGET_MISMATCH
 1 REGRESSION_RECEIVER_UNQUALIFIED
 1 REGRESSION_PATH_UNRESOLVED
 1 REGRESSION_ENTRY_NOT_INVOKED
 1 REGRESSION_TEST_BLOCK_MISSING
```

All 35 `COVERAGE_INCOMPLETE` and all 27 `BACKREF_MISMATCH` trace to the 9
boundaries for which no proof block exists. They are not independent defects.

## 6. The 9 unapplied boundaries (adjudication required)

```
PostgresOrderingStore.commit                        wrong target: the test reaches the
                                                    canonical-knowledge module's own commit
PostgresDiscoveryRuntimeRepository.releaseLease     relabelled to PUBLIC_PATH, but the
                                                    approved path does not resolve to the boundary
<module>.commitProjectProjection (activity)         declared block has no call; the 683-line block
                                                    calls through a port parameter (polymorphic
                                                    binding to the postgres store not proven)
PostgresExternalActionStore.transactionWithHandle   calls occur on the draft repository
PostgresSourcesProductService.retry                 hop file is not the boundary file or a
                                                    recorded caller
PostgresChangeSetReviewRepository.recordDecision    reaches the module-level recordDecision, not
                                                    the repository method
PostgresOrderingStore.acquireNext                   declared entry kernel.connector.publishEvent is
                                                    never invoked in the block
PostgresConnectorRuntimeState.recoverExpiredLeases  relabelled to OWNER_ATOMICITY, but the
                                                    approved path still does not resolve
PostgresSourcesProductService.markStage3ItemsSucceeded  declared block does not exist in the file
```

Each requires one of: an explicit relabel to the execution form that actually
occurs, a minimal focused regression proof, or a recorded `COVERAGE_GAP`. This is
the remaining correctness decision and it was not taken unilaterally.

## 7. Files

```
artifacts/ts6-phase-b-c2-r15/golden.v3.derived.json          754 KB   derived, v2 untouched
artifacts/ts6-phase-b-c2-r15/correction-applied-report.json  12 KB    what was applied
artifacts/ts6-phase-b-c2-r15/relation-edge-ledger.json       74 KB    112-edge adjudication
artifacts/ts6-phase-b-c2-r15/correction-manifest.json       108 KB    per-record decisions
```

Frozen and unchanged:

```
golden.v2  256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD
crosswalk  E4861D67B1EBC4885FA9034245C0B2734E25E3865DE278A4FF660C0B4B0621D2
package.json  test:contract and test:database scripts unchanged
```

## 8. Status

C2-R15 = CHANGES_REQUIRED / CONTINUE / NO COMMIT / NO PR.

Closed this round: test database provisioning, 12/12 rebind PostgreSQL proof,
relation-level back-reference adjudication, the covers[0] relation-granularity
defect, the evidence-id remap defect, R3-V01 conversion to a frozen-lineage test,
audit-test exclusion from the unit lane, and creation of the first derived v3.

Outstanding: adjudication of the 9 boundaries above, then v3 revalidation, then
final acceptance.
