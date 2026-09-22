# C2-R15 scope

Corrects the TS-6 regression-evidence validation authority. Does NOT reopen the
PostgreSQL transaction Product audit and does NOT change the retained inventory
(120 candidates / 113 boundaries / 11 raw sites / 87 historical rows).

## Done

1. Pre-correction evidence frozen as TS6_C2_V2_PRE_CORRECTION_AUDIT_EVIDENCE
   (actual bytes of untracked inputs + tracked patch + separate production/test
   corpus digests + scanner determinism proof).
2. Independent evidence resolver: qualified target = (file, symbol, method);
   coverageKind-specific resolution; licensed-hop path verification; AST
   CallExpression only; no source-text authority.
3. Invariants A-D wired into validateCorpus, removing fixture self-reference.
   C and D operate at RELATION granularity: (boundaryId, testEvidenceId), not at
   evidence-record granularity. The v2 fixture has 69 evidence records but 112
   boundary->evidence edges, so record-level bookkeeping would let one resolving
   target vouch for another target of the same record.
4. Precise failure taxonomy. MISSING_REGRESSION not overloaded.
   productionReachability.status = REVIEW_REQUIRED NOT reused.
5. R3-V01 rewritten to verify the durable R3 closure invariant against the frozen
   R3 artifacts instead of asserting "all of v2 passes the current validator".
6. Audit verification test moved out of tests/unit into scripts/ts6-audit/.

## Not done

- The 12 rebindings and 9 declaration corrections in correction-manifest.json
  were NOT applied.
- No minimal regression proof was added.
- No v3 compiled snapshot was produced.
- DB-gated rebind proof was NOT executed (no TEST_DATABASE_URL).
