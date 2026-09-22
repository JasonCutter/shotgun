# Known limitations and unresolved items (rev 2)

1. FIXTURE NOT CORRECTED. The corrected validator rejects the unmodified
   golden.v2 with 121 issues (57 coverage-incomplete, 43 backref-mismatch, plus
   14 attribute-level failures). Resolving them is outstanding work.

2. RELATION-AWARE CORRECTION NOW APPLIED (this revision). Invariants C and D
   operate on (boundaryId, testEvidenceId) relations. Before this change the
   checker validated only covers[0] and recorded success per evidence id, which
   could let one resolving target vouch for another target of the same record.
   Effect of the change on the measured result: RECRESSION_COVERAGE_INCOMPLETE
   went 43 -> 57, i.e. 14 relations had been incorrectly counted as covered.
   The covers[0] shape is NOT currently reachable (all 69 records have exactly
   one covers entry); the fix is preventive, as directed.

3. HISTORICAL 87-ROW TEST: root cause was a TIMEOUT, not an assertion failure.
   Budget 5000 ms (default), observed 13,873 ms. The cold production index built
   by the resolver costs ~1,830 ms per process, which the previously borderline
   test could not absorb. An explicit 60_000 ms budget was added to that test.
   The reviewer's inference that this test had no reason to fail was therefore
   partly incorrect: it did fail, but by budget, not by assertion.

4. R3-V01 REWRITTEN. It used to assert result.valid === true && issues === [],
   which is no longer a true statement about v2. It now verifies the frozen R3
   closure facts (start 16, closedByExistingDirect 1, closedByExistingPath 12,
   closedByNewMinimalTest 3, remaining 0, 16/16 closure ids present in v2,
   53 + 16 = 69).

5. DB-GATED EVIDENCE NOT EXECUTED. All 12 rebind candidates live under
   tests/database/**; a skipped run is not accepted as execution proof (work
   order section 5). No TEST_DATABASE_URL was available in this session.
   Final acceptance is therefore NOT achievable in this environment.

6. NO MINIMAL PROOF ADDED. Of the 9 boundaries with no qualified call anywhere in
   the test corpus, 2 (PostgresOrderingStore.commit,
   PostgresExternalActionStore.transactionWithHandle) may need one; the other 7
   are declaration/block/path mismatches.

7. PRE-CORRECTION ARCHIVE SELECTION. The archive preserves 11 files chosen as the
   TS-6 audit inputs plus R3 lineage. The selection criterion is recorded in
   evidence/pre-correction-manifest.json; it is not a full repository snapshot.

8. NEW MODULES ADDED WITHOUT EXPLICIT INSTRUCTION. The resolver and the authority
   checker were factored into separate modules by judgement; the work order
   directed only that validateCorpus stop using method-name heuristics. Reviewers
   have accepted this factoring subject to three checks at final review:
   no duplicated source scanning, no growth into a general call-graph framework,
   and staying within TS-6 audit tooling scope.

9. SOURCE-SCANNING COST. observeValues: the production definition index builds
   once per process at ~1,830 ms and is cached; a warm single-record resolution is
   ~1 ms. Repeated validateCorpus calls in one process reuse the cache.
