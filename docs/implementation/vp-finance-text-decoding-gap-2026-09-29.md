# VP Finance PDF Text Decoding Gap

## Observed result

The ten rendered pages of the user-provided finance PDF were visually checked.
Page 6 clearly shows the two NPV rules, `NPV > 0` and `NPV < 0`. A read-only
inspection of a separate persistent local route database found 128 Evidence
spans, 75 Candidates, and 72 VP assertions for the file. That database snapshot
is not the isolated 112-assertion v5 run in the main VP-04 report.

The stored text for the two NPV rules contains U+FFFD (`�`) in place of the
comparison sign. Since the original image distinguishes `>` from `<`, accepting
the damaged Candidate as a direct fact could reverse a financial decision.
The same snapshot also contains duplicate equation assertions across batches;
that remains a separate consolidation-quality issue.

## Decision and boundary

Make Stage 4's existing `direct-text` validation fail when the Candidate claim
contains U+FFFD, even if that damaged string is an exact substring of Evidence.
No new validation dimension or stored schema is needed. Valid text, exact
SourceVersion linkage, and the existing direct-only rule remain unchanged.

Target: `modules/validation` and its existing Validation module contract. This
is a deterministic evidence-quality gate owned by Shotgun; the provider does
not get to certify undecodable source text as a fact.

## OSS integration record

- `lucasastorian/llmwiki`, commit
  `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0: retain the existing
  `EXTRACT` boundary for quote/locator patterns behind Shotgun's transformation
  and Evidence ports. Its code is not used to infer or repair a missing PDF
  comparison sign.
- W3C Web Annotation Data Model, Recommendation 2017-02-23 / W3C-20150513:
  retain existing `AUGMENT` position/quote semantics. A selector cannot repair
  a character that the PDF text layer failed to decode.
- The current PDF extraction runtime remains the pinned `pdfplumber 0.11.10`,
  `pdfminer.six 20260107`, and `pypdfium2 5.11.0`; this change adds no package,
  OCR engine, provider egress, migration, or Role Matrix assignment.
- OCR repair is deferred. It would need a separate provider/license/security
  and source-location evaluation against a reviewed PDF corpus.

## Verification and rollback

Contract tests must show that an ordinary exact numerical claim remains READY
and that a claim containing U+FFFD becomes REJECTED with a specific direct-text
failure reason. This prevents the damaged sign from entering current knowledge;
it does not reconstruct the missing sign. Rollback removes this additional
validation predicate without rewriting prior Candidate or validation history.

## Verification result

- Visually reviewed all ten rendered source pages. The NPV comparison signs
  are visible on page 6 even though the stored PDF text contains U+FFFD at
  those positions.
- Added an end-to-end Stage 4 contract case for each configured transport. The
  exact damaged claim is retained with its evidence for audit, but its
  validation status is `REJECTED` and `direct-text` reports the undecodable
  character. The full contract file passed 36/36 tests.
- Existing exact numerical claim coverage still passes within that contract
  file. No OCR repair has been implemented; the damaged NPV rules remain
  unavailable as current facts until a separately evaluated OCR path is added.

## 2026-09-29 follow-up: constrained glyph recovery and Ask retrieval

The earlier statement above describes the pre-recovery state. A narrowly
scoped PDFium cross-check now recovers only the two page-6 comparison signs
whose character boxes uniquely match the pdfplumber NUL boxes. It restored
`NPV > 0` and `NPV < 0`; the other 23 NUL markers in the file remain
undecodable and are still rejected if they enter a direct claim. The exact
geometry rule, OSS decision, rollback, and focused tests are recorded in
[`vp-finance-pdf-glyph-recovery-design-2026-09-29.md`](./vp-finance-pdf-glyph-recovery-design-2026-09-29.md).

The first live DeepSeek Ask after extraction still failed because the query
term `NPV가` did not match the stored claim token `NPV`. The PostgreSQL Ask
adapter now adds deduplicated Korean particle-stripped search variants while
preserving the original query, claims, and Evidence. An isolated PostgreSQL
regression returns both NPV Evidence spans for the Korean question. The full
browser flow was rerun against the supplied PDF with live DeepSeek: both NPV
rules became current READY assertions, the Ask cited two Evidence spans and
explained the positive/negative distinction, replay matched, and pending
relation jobs were zero.

This closes only the observed NPV decode-and-retrieval defect for this file.
It does not measure general PDF extraction precision, missed/duplicated
claims, table/formula quality, multi-document finance relations, or VP-04 as a
whole. Unresolved U+FFFD protection remains active; there is no OCR or
probabilistic repair.
