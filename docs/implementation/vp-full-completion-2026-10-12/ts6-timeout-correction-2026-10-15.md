# TS6 standard-timeout correction — 2026-10-15

Status: **TS6_TIMEOUT_CORRECTED_LOCALLY / PUBLICATION_NOT_AUTHORIZED**.

## Scope and cause

The user authorized investigation and correction of the remaining TS6 timeout,
with the existing verification strength preserved. The development base is
`97f783e90369f0bee1a2221f5993fb4ab7de3334`; this is a local correction, not a
Canonical publication or an operating rollout.

The earlier standard run had 48 passes and two five-second timeouts:
`R3-V16 keeps the fixture unchanged during verification` and
`R3-V02 rejects a regression path with a nonexistent symbol`. The unchanged
Canonical control also timed out on V16. Those failure records remain intact.

The reusable AST audit already checked all source bytes on every invocation,
but discarded the bytes after hashing. Its subsequent boundary, caller and
regression checks reopened the same files repeatedly. Regression test titles
were also parsed again for each evidence record sharing a test file. A CPU
profile of the unmodified validator showed repeated synchronous file reads
dominating the cold audit and warm validation. This is measured validator
overhead, not a demonstrated product semantic failure or a reason to waive it.

## Minimal correction and reuse decision

Only the existing validator and its cache tests change:

- Retain the source text read while computing the full path-and-byte SHA-256
  fingerprint. Reuse that text for the same synchronous audit/validation.
- On **every** new audit/validation, enumerate paths and read all source bytes
  again, including cache hits. Do not substitute timestamps, a TTL or a caller
  promise of immutability. Files outside this inventory keep their original
  read behavior. This does not add filesystem transaction isolation.
- Parse active test titles once per file **within one validation**, then check
  every declared evidence record against that set. Keep qualified regression
  resolution and all issue rules unchanged.
- Preserve detached audit results, root separation, qualified/legacy separation,
  additions/removals, timestamp-preserving edits and linked TSX invalidation.
  A fresh source-read failure propagates instead of accepting old source text.

Integration decision: **AUGMENT** the existing TS6 validator; reuse the existing
TypeScript AST and Vitest runner. The installed/locked versions are
TypeScript5.9.3 (Apache-2.0) and Vitest4.1.11 (MIT); manifests and lockfile are
unchanged. The verified gbrain, lucas, ddsyasas and OpenKnowledge references do
not supply this repository-specific audit boundary. No package, runtime,
database or new authority is introduced, and the OSS role matrix needs no new
adoption row. Rollback is reverting this isolated validator/test correction;
there is no migration or stored-data transformation.

## Measurement and verification

The same local profiler measured the following before/after observations:

| Operation                                  |  Before |   After | File reads before → after |
| ------------------------------------------ | ------: | ------: | ------------------------: |
| Cold audit                                 | 37.59 s | 15.14 s |            24,633 → 1,680 |
| Warm audit / full source fingerprint       |  1.31 s |  1.37 s |             1,195 → 1,195 |
| First validation / resolver initialization |  5.88 s |  4.39 s |             2,944 → 1,730 |
| Repeated validation                        |  3.69 s |  1.67 s |             2,410 → 1,196 |
| Nonexistent path-symbol negative           |  3.11 s |  1.72 s |             2,410 → 1,196 |

Each operation's serialized output digest is identical before/after, including
the complete historical-v2 issue list and the mutated path rejection. The warm
audit remains essentially unchanged because full byte revalidation is retained.
These are diagnostic timings, not a universal runtime bound. The profiler's
legacy `bytes` field mixes string lengths and Buffer lengths; use read counts
and timings above rather than treating that field as exact byte throughput.

Three added tests check per-validation reads (not per-relation reads), fresh
title/path rejection after equal-length edits with restored timestamps, and
propagation/recovery of an injected fresh-read failure. They use an explicitly
synthetic valid corpus and create no historical or semantic Gold evidence.

The first standard run used exactly
`vitest run scripts/ts6-audit --pool=forks --maxWorkers=4`:
**4 files / 53 tests PASS / 0 failures / 0 skips**, 110.61 seconds.
V16 passed in 2,730 ms and V02 in 2,667 ms. Existing five-second limits, explicit
cold-audit 60/120-second limits, assertions, negative cases, worker settings and
package scripts are unchanged.

The second fresh-process standard run used the same command and also passed
**4 files / 53 tests / 0 failures / 0 skips**, 115.84 seconds. V16 passed in
2,551 ms and V02 in 2,768 ms. This repeat addresses the previously intermittent
timeout rather than selecting only a favorable focused run.

Final checks:

| Check                                   | Result                                |
| --------------------------------------- | ------------------------------------- |
| Standard TS6 full suite, run 1          | PASS, 53/53                           |
| Standard TS6 full suite, run 2          | PASS, 53/53                           |
| New and existing cache safety tests     | PASS, 7/7; included in both full runs |
| Full repository `tsc --noEmit`          | PASS                                  |
| ESLint on both changed TypeScript files | PASS                                  |
| TS6 C2 release verification             | PASS                                  |
| Formatting on all four changed files    | PASS                                  |
| Document governance (`all`)             | PASS                                  |

The release verification confirms the current v8 lineage validates and
reproduces byte-for-byte, the approved relation graph and reverse references
remain complete, and frozen history is preserved. No derived artifact is
rewritten to accommodate this performance correction. Formatting and document
governance exit results are retained in the final evidence record.

## Preservation and limits

Evidence directory:
`C:\dev\artifacts\vp-full-completion-2026-10-12\ts6-timeout-correction-20261015`.
It contains before/after CPU profiles and full output snapshots, standard test
logs, preservation/equivalence checks and final verification records.

The prior text, failed-image and successful-image evidence index digests are
unchanged; all their 131/132/87 linked entries verify (350 references total).
The original TS6 regression-authority tests and current/frozen artifacts are
not regenerated. Product source, provider policy, dependencies, CI settings,
72/432/B24 and Gold-B-7 are unchanged. No live AI, operating app/worker,
operating database/configuration/authority change or remote publication occurs.

This correction closes the demonstrated TS6 verification defect locally.
It does not certify AI semantic quality, new Gold references,
full VP completion or operating acceptance.
