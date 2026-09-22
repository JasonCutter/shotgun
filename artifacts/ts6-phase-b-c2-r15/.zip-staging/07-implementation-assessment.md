# C2-R15 ??review assessment (verification of the reviewer's claims)

Each claim was checked against the fixture, the code and the run output.

| # | Reviewer claim | Verdict | Evidence |
|---|---|---|---|
| 1 | 69 records vs 112 boundary->evidence edges; 112-69=43 | **CORRECT** | measured: records 69, edges 112 (PROVEN 100 + non-PROVEN 12), sum covers = 69, matched edges 69, mismatched 43 |
| 2 | authority checker uses covers[0] and evidence-id-level success, so a multi-cover evidence could vouch for a boundary it does not resolve | **CORRECT as a defect, NOT currently reachable** | all 69 records have covers.length === 1 and 0 with length 0; blind spot confirmed by code inspection and now fixed |
| 2b | fixing it before v3 is the right order | **CORRECT** | applied; coverage-incomplete count rose 43 -> 57, exposing 14 relations that record-level counting had wrongly accepted |
| 3a | 43 backref mismatch must stay a hard failure; do not mirror-copy covers[] | **CORRECT** | 19 of the 43 stale edges do resolve at relation level and 24 do not, so a blanket copy would be wrong in both directions |
| 3b | the historical 87-row test should not be failing; report contradicts bundle source | **PARTLY INCORRECT** | it does fail, but by TIMEOUT: budget 5000 ms, observed 13,873 ms, caused by the new checker's ~1,830 ms cold index. No assertion failure. Fixed with an explicit 60_000 ms budget |
| 4 | R3-V01 should become a historical R3 closure invariant test | **CORRECT** | rewritten; it now asserts the frozen closure counters and the 16/16 id lineage |
| 4b | keep the "corrected validator rejects v2" regression proof | **CORRECT** | retained as the first acceptance test |
| 5 | DB-gated rebind needs a real PostgreSQL PASS; skip is not proof | **CORRECT** | 12 candidates all under tests/database/**; NOT RUN in this environment |
| 6 | 107 issues is not the final defect count; root vs derived must be separated | **CORRECT** | 43 coverage-incomplete are derived from the same relation defects; relation-edge-ledger.json now separates BIDIRECTIONAL vs STALE_BACKREF and reports relation resolution per edge |
| 7 | recoverExpiredLeases may be adequate as OWNER_ATOMICITY; do not assume a new test | **CORRECT** | measured: its test-local helper drives the production recovery path and the file asserts OUTCOME_UNKNOWN and fencing invariants |
| 8 | separate modules are acceptable | **CORRECT** | no rollback; three review checks recorded in known limitations |

## Relation-edge ledger (measured)

| class | relation resolved | relation unresolved |
|---|---:|---:|
| BIDIRECTIONAL (evidence declares the boundary) | 43 | 26 |
| STALE_BACKREF (boundary references evidence that covers elsewhere) | 19 | 24 |
| **total 112** | 62 | 50 |

Consequence for the correction: the 43 stale-backref edges are not one class.
19 of them resolve at relation level (the test does exercise the boundary; only
the covers[] declaration is missing) and 24 do not. A blanket covers[] copy would
be wrong for the 24, and deleting the edges would be wrong for the 19.

## Status

C2-R15 = CHANGES_REQUIRED / CONTINUE / NO COMMIT / NO PR.

Outstanding before final acceptance:
1. adjudicate the 43 stale-backref edges with the ledger classes above
2. execute the 12 DB-gated rebinds with a real TEST_DATABASE_URL and PASS logs
3. apply the 9 declaration/block/path corrections
4. produce the corrected compiled snapshot only after 1-3
5. add the invariant/failure-taxonomy proof and the final SHA-256 manifest
