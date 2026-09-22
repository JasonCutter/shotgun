# C2-R15 — 9-case closure progress (round 2)

## Resolver rule corrections (the reviewer's structural warning was correct)

Two coverageKind semantics were being conflated. Both are now fixed, and both
fixes were required for the approved dispositions to resolve at all.

### OWNER_ATOMICITY must not demand a DIRECT_BOUNDARY final hop

The rule now accepts an owner-level proof when:

- (a) the declared entry is executed by the block, **or** the block drives the
  owner operation directly or through a test-local helper, **and**
- (b) the owner operation reaches the registered boundary method on the same
  class, via the production graph or test-local helper expansion, **and**
- (c) the proof file asserts the invariant.

Requiring a licensed final `CallExpression` for OWNER_ATOMICITY was wrong and
produced a false failure.

### Two helper invocation shapes had to be recognised

1. **Bare-identifier calls.** A test-local helper invokes the production entry as
   `await recoverX(state)`, not as a member access. The test-local call index only
   recorded property accesses, so the edge was invisible.

2. **Extracted-method invocation.** The strongest case, and the one that actually
   blocked `recoverExpiredLeases`:

   ```ts
   const recovery = (state as unknown as { recoverExpiredLeases(): Promise<void> })
     .recoverExpiredLeases;
   await recovery.call(state);
   ```

   The invoked callee is `call`, and the boundary method appears only as an
   extracted member access. The index now also records extracted member names
   whose parent is not a call expression.

## Dispositions applied this round

| boundary | disposition | result |
|---|---|---|
| `PostgresDiscoveryRuntimeRepository.releaseLease` | DECLARATION_RELABEL -> `PUBLIC_PATH`, entry `PersistentDiscoveryWorker.runOnce` | **RESOLVED_PUBLIC_PATH** |
| `PostgresConnectorRuntimeState.recoverExpiredLeases` | DECLARATION_RELABEL -> `OWNER_ATOMICITY`, entry `recoverProductionExpiredLeases` | **RESOLVED_OWNER_ATOMICITY** |

Both are proven against the real PostgreSQL instance:
`akp-4-wp4-discovery-execution.contract.test.ts` 3/3 and
`post-tf-risk002-connector-fencing-proof.test.ts` (fencing proof matrix).

## Issue progression

```
v2 (unmodified)                 121
v3 after rebinds + remap         70
v3 after the two relabels        68     <- this round
```

v3 remaining by code:

```
34 REGRESSION_COVERAGE_INCOMPLETE
27 REGRESSION_BACKREF_MISMATCH
 2 REGRESSION_CALL_OUTSIDE_TARGET_BLOCK
 2 REGRESSION_TARGET_MISMATCH
 1 REGRESSION_RECEIVER_UNQUALIFIED
 1 REGRESSION_PATH_UNRESOLVED
 1 REGRESSION_TEST_BLOCK_MISSING
```

`REGRESSION_ENTRY_NOT_INVOKED` is now zero. The 34 coverage-incomplete findings
are narrower than the 9 open boundaries, which indicates the resolver now accepts
some relations it previously rejected.

## Remaining 7 dispositions (approved, not yet applied)

```
PostgresOrderingStore.commit                          MINIMAL_PROOF_ADDED
<module>.commitProjectProjection                      conditional REBIND, else MINIMAL_PROOF
PostgresExternalActionStore.transactionWithHandle     MINIMAL_PROOF_ADDED
PostgresSourcesProductService.retry                   RELABEL/REWRITE_PATH first, else MINIMAL_PROOF
PostgresChangeSetReviewRepository.recordDecision      MINIMAL_PROOF first
PostgresOrderingStore.acquireNext                     REBIND_EXISTING or MINIMAL_PROOF
PostgresSourcesProductService.markStage3ItemsSucceeded REBIND_EXISTING first
```

`COVERAGE_GAP` remains at zero; none of the nine is fixed as a gap.

## Final v3 acceptance conditions (from the review)

1. every retained `(boundaryId, evidenceId)` relation is bidirectionally consistent
2. every retained relation independently resolves under its `coverageKind` rules
3. every coverage-required `PROVEN` boundary has at least one resolved relation
4. `120 / 113 / 11 / 87` inventory unchanged

Condition 4 holds. Conditions 1-3 require the remaining 7 dispositions and the
subsequent reconciliation of the 27 unresolved declared relations, then removal of
any stale edge only after a replacement proof exists.

## Status

C2-R15 = CHANGES_REQUIRED / CONTINUE / NO COMMIT / NO PR.
