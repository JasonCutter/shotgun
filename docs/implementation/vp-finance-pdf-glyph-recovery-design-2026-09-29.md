# VP-04 — Finance PDF undecoded comparison glyph recovery design (2026-09-29)

**Status: the scoped glyph-recovery and Ask-retrieval fixes are implemented and
verified; VP-04 remains open.**

## Finding

The supplied ten-page finance PDF visibly contains `NPV > 0` and `NPV < 0` on
page 6. In the locked extraction environment (`pdfplumber 0.11.10`,
`pdfminer.six 20260107`, and `pypdfium2 5.11.0`), pdfminer emits 25 NUL glyphs
across pages 5, 6, 7, 9, and 10. The worker maps NUL to U+FFFD because NUL is
not storable in PostgreSQL text. On page 6 only, PDFium reports `>` and `<`
glyph boxes that uniquely overlap two of the four NUL glyph boxes on that page.
The center distances are 1.57 pt and the intersection covers the smaller box.
The other 23 NUL glyphs have no geometrically matching PDFium comparison sign.

## Integration decision

| Candidate                                                | Decision                      | Version, license, and role                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [pdfplumber](https://github.com/jsvine/pdfplumber)       | `ADOPT` (existing)            | `0.11.10`, MIT; remains the owner of reading order, word/line grouping, and Page/BBox selectors.                                                                                                                                      |
| [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) | `AUGMENT` (this VP-04 change) | PyPI `5.11.0`, upstream tag commit `0168561b33a3fc32eceb6ae46cc252f6b0e90c19`, embedded PDFium pin `7913`; binding is Apache-2.0 OR BSD-3-Clause. PDFium and wheel-bundled third-party notices must remain with binary distributions. |
| PyMuPDF                                                  | `REJECT` (existing)           | Existing Stage 8 decision remains due to its AGPL/commercial licensing boundary.                                                                                                                                                      |
| Docling, Tika                                            | `DEFER` (existing)            | No wider parser or OCR runtime is introduced for this localized glyph defect.                                                                                                                                                         |

The selected pypdfium2 release is already fixed in
`adapters/document-format-python/requirements.lock`; this change adds no
package or lockfile update. Its official repository had no published security
advisory on the review date. The parser remains behind the isolated Python
worker and existing raw-size/page limits. The exact upstream version and
embedded PDFium build are recorded in `oss-source-registry.json`.

## Scope and safety rule

Keep pdfplumber as the text/layout and SourceMap authority. For a page that has
NUL glyphs, ask the pinned pypdfium2 version only for `<` and `>` character
boxes. Convert PDFium's bottom-origin boxes to the pdfplumber top-origin page
coordinates. Replace a pdfplumber NUL only when a comparison-glyph match is
reciprocal and unique, center distance is at most 2.5 pt, and intersection
area is at least 0.65 of the smaller character box. Preserve the original
pdfplumber character box and all selectors.

If PDFium cannot parse the page, page counts differ, a box is invalid, or a
match is ambiguous/outside the fixed geometry threshold, leave the NUL in
place. The existing `block()` conversion then emits U+FFFD, and Stage 4's
direct-text validation rejects a claim containing that marker. No OCR,
probabilistic substitution, inference from neighboring words, general PDFium
reading order, or claim-level guess is allowed.

## Contract, Golden, security, and replacement gates

- Unit cases must cover unique `<`/`>` repair, distant glyph rejection,
  ambiguous/tied matches, and one-to-one matching.
- Stage 8's existing PDF Golden must retain its page and BBox selectors and
  text layout. Other file formats must be byte-for-byte unaffected at the
  worker output boundary.
- The supplied finance PDF must recover exactly its two NPV signs, leave the
  other 23 NUL glyphs unresolved, and cite the original page-6 selector.
- Stage 4 must accept the recovered exact claim and continue to reject an
  unresolved U+FFFD claim.
- PDFium failure must preserve the old safe behavior. Removing the glyph
  cross-check restores pdfplumber-only extraction; no stored history is
  rewritten. Adapter identity must advance so a deliberate transformation
  creates a distinct immutable revision.
- Re-run existing corrupt/encrypted PDF and worker timeout/size-limit tests;
  PDFium remains isolated in the existing worker process.

## Implementation and verification result

- The isolated Python worker now requests PDFium comparison-sign boxes only
  for pages containing pdfplumber NUL glyphs. The unique reciprocal match,
  distance, overlap, failure, and ambiguity rules above are implemented.
- The adapter identity is `1.2.0`, so a deliberate re-transform has a distinct
  immutable adapter revision. Existing stored SourceVersions are not rewritten
  automatically.
- Five standard-library geometry tests pass. The Stage 8 transformer and
  selector-contract bundle passes 25/25 tests. The downstream Stage 4
  direct-text contract passes 36/36 tests.
- Against the supplied ten-page finance PDF, the pinned worker produced 20
  blocks, restored exactly the two page-6 signs, and left 23 other NUL markers
  unresolved. The page selector is retained. This is a targeted fixture result,
  not a PDF corpus quality score.
- The first live DeepSeek Ask exposed a separate Korean tokenization retrieval
  gap (`NPV가` did not match `NPV`). The existing PostgreSQL FTS/`pg_trgm` Ask
  adapter now adds deduplicated particle-stripped terms. An isolated DB
  regression passes 2/2 and returns both exact NPV Evidence IDs for the Korean
  question.
- The full browser E2E using the supplied PDF and actual DeepSeek passed after
  both fixes: the positive and negative NPV assertions were READY, Ask cited
  two Evidence spans and explained the distinction, the independent replay
  matched, and pending relation jobs were zero.

These results verify the narrow finance-PDF-to-Ask defect only. Existing
corrupt/encrypted PDF handling, the full Stage 8 replacement gate, broad PDF
quality, and VP-04 remain subject to their applicable suite and corpus gates.
The prior direct-text validation guard remains the safe fallback: any
unresolved U+FFFD claim is rejected. No OCR or inferred sign repair is used.

## Ask retrieval follow-up — implementation result

The `query_terms` CTE now retains raw Korean query terms and unions deduplicated
particle-stripped variants for matching. The original question is still used
for FTS/trigram ranking; this change only broadens the exact-term shortlist.
The regression asserts both `NPV > 0` and `NPV < 0` Evidence rows are returned
for the Korean question, while stored claim and Evidence text remain unchanged.
The actual DeepSeek browser Ask cites those two rows. Search access,
sensitivity, current-assertion, relation, epoch, watermark, and citation checks
remain in force. Rollback removes the additional term variants from the query.

## Ask retrieval follow-up — design before implementation

The first live product replay confirmed that DeepSeek materialized both
page-6 rules as `READY` assertions. A subsequent Ask for the meaning of NPV
returned two unrelated systematic-risk Evidence spans and said the NPV rule
was absent. This is a retrieval failure after successful extraction, so VP-04
does not pass yet.

Reuse existing Stage 7 decisions: PostgreSQL full-text search and `pg_trgm` are
`ADOPT` behind the Shotgun search/knowledge ports; gbrain's search and citation
patterns remain `REFERENCE_ONLY`. No new dependency, runtime, schema, or
Role-Matrix role is introduced. Extend the VP Ask adapter's query-term list with
deduplicated Korean particle-stripped variants (for example `NPV가` → `NPV`,
`기업가치에` → `기업가치`) while preserving the original query for PostgreSQL
FTS/trigram ranking. The exact query text, Candidate claim, and Evidence remain
unchanged. Existing access, sensitivity, current-assertion, relation, epoch,
watermark, and citation checks remain authoritative.

Before VP-04 can close, the isolated PostgreSQL regression must show that the
NPV question retrieves both exact page-6 Evidence spans, does not admit
inaccessible assertions, and preserves the current snapshot checks. The live
DeepSeek Ask must answer the increase/decrease distinction with a citation to
that source. Rollback removes only the additional query-term variants.
