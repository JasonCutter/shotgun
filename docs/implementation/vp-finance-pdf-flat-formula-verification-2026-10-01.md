# VP-04 / Stage 8 — PDFium equation geometry verification (2026-10-01)

**Status: narrow extraction augmentation implemented; VP-04 remains open.** This
record covers one supplied finance PDF and does not establish general PDF
formula quality.

## Target and source

- Target: Stage 8 `PythonDocumentFormatAdapter`, `DocumentIR`, and `SourceMap`.
- Source: `재무제표재무관리__2026-09-27.pdf`, 10 pages, 797,599 bytes.
- Source SHA-256: `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`.
- Output transformer identity: `shotgun.document-formats@1.7.0`.
- No project database or previously stored revision was changed by this
  verification. New transformations use the new adapter identity.

## OSS decision

`AUGMENT` the already adopted `pdfplumber` PDF adapter with the existing pinned
`pypdfium2` glyph geometry. Do not add another parser or package.

- Official repository: [pypdfium2](https://github.com/pypdfium2-team/pypdfium2).
- Exact package: `pypdfium2==5.11.0`, tag commit
  [`0168561b33a3fc32eceb6ae46cc252f6b0e90c19`](https://github.com/pypdfium2-team/pypdfium2/commit/0168561b33a3fc32eceb6ae46cc252f6b0e90c19).
- Embedded PDFium build: `7913`, from the official [5.11.0 release](https://github.com/pypdfium2-team/pypdfium2/releases/tag/5.11.0).
- Binding license: Apache-2.0 OR BSD-3-Clause. Binary distributions must retain
  PDFium and bundled third-party license notices as described by the upstream
  [license information](https://github.com/pypdfium2-team/pypdfium2#licensing).
- Security review: the official [Security page](https://github.com/pypdfium2-team/pypdfium2/security)
  showed no `SECURITY.md` policy and no published advisory on 2026-10-01.
- Maintenance: retain the exact lock. Re-evaluate on a PDFium update, upstream
  security notice, false repair, or adjudicated Golden corpus change.

`pdfplumber==0.11.10` remains the paragraph-order, reading-layout, and selector
owner. PDFium supplies bounded character text and coordinates only.

## Repair boundary

The isolated worker asks PDFium for page glyph geometry when pdfplumber reports
a NUL glyph or an equals sign. For general NUL repair, it accepts only the
small allowlist `<`, `>`, `=`, parentheses, colon, and digits, with reciprocal
one-to-one glyph matches, center distance at most 2.5 points, and at least 65%
box overlap. A separate numbered-list rule accepts only the contiguous PDFium
digit-period-space-Hangul sequence when the digit, bottom-aligned period,
whitespace position, and pdfplumber source line agree. It retains the original
pdfplumber boxes. The optional path fails closed when a page has more than
100,000 PDFium characters or produces more than 20,000 text rows.

A flat formula candidate is limited to a short, single-row ASCII/math
expression. Script markers are placed only from relative glyph size and
position. A stacked fraction is reconstructed only when numerator and
denominator glyph rows sit above and below the same equation baseline, overlap
horizontally around a short uppercase Latin or Korean equation prefix, and every extracted
pdfplumber character in the formula box occurs in the geometry-backed result.
PDFium supplies the actual glyphs and coordinates; the adapter uses those
positions to express the numerator/denominator relationship. It does not
invent missing characters or infer mathematical meaning or reading order.

For a formula with ambiguous alignment or a text mismatch, the worker retains
the existing pdfplumber output. That output can still contain flattened
fragments; this adapter does not yet carry a structured `formula-unresolved`
signal. The original file and selectors remain available, but downstream AI
must not treat malformed formula fragments as verified facts. This is a
remaining VP-04 product-quality issue.

## Supplied-PDF result

The pinned PDFium 5.11.0 worker produced 21 blocks. It reconstructed these
single-row and stacked equation segments and retained their source geometry:

- Page 2: `유동비율 = 유동자산/유동부채 × 100`.
- Page 2: `유동비율 = 4,000/2,000 × 100 = 200%`.
- Page 5: `FV = PV(1 + r)^n`.
- Page 5: `FV = 100 × (1.1)^2 = 121만원`.
- Page 5: `PV = FV/(1 + r)^n`.
- Page 5: `PV = 110/1.1 = 100만원`.
- Page 6: `NPV = ∑ CF_t/(1 + r)^t − I_0`.
- Page 6: `NPV = 1,150 − 1,000 = 150만원`.

Each segment retained a page-specific `BoundingBoxSelector` in points. The
separate `NPV = 0` line also retained its page/BBox selector. The strict
geometry matcher now recovers 19 of the PDF's 25 replacement markers: the page 6
signs (`NPV > 0` and `NPV < 0`), exact-position digits, equals signs,
parentheses, and a colon. Six other glyphs have no qualifying one-to-one match
and remain replacement markers; direct-text validation still rejects them.

Each reconstructed formula uses its original glyph Page/BBox and the existing
selector contract. Docling `v2.130.0` remains `DEFER` under the separate
[reevaluation record](./vp-docling-finance-formula-reevaluation-2026-10-01.md).

## Verification

- Python unit tests: 16/16 passed, including the safe-glyph allowlist and
  reciprocal matching, exponent/subscript markers,
  numerator/denominator alignment, exact/contained text agreement, mismatch
  fallback, the PDFium character budget, and preserved PDF line offsets.
- Supplied-PDF worker run: completed using the exact pypdfium2 5.11.0 package;
  19/25 replacement markers were restored, the two current-ratio fractions and
  six targeted PV/NPV equations retained Page/BBox selectors, and rendered
  pages 2, 5, 6 and 10 were inspected.
- Live DeepSeek ingestion, claim extraction, cited Ask, and replay using adapter
  identity 1.4.0 passed once before safe-glyph recovery; it returned 111
  assertions and 120 candidates, covered 20/20 curated markers, matched four
  answer-and-citation checks, replayed successfully, and left 0 pending relation
  jobs (35 responses, 51,502 reported tokens).
- The 1.5.0 live browser flow passed once: 112 assertions, 113 candidates,
  20/20 curated markers, four answer-and-citation checks, replay match, 7
  current relations, and 0 pending relation jobs (15 responses, 32,920 reported
  tokens). The NPV sign Ask returned 3 citations. All four topic corpus answers
  matched and cited the expected page. Provider billing was not independently
  reconciled.
- A separate 1.5.0 run returned 119 assertions and 121 candidates but timed out
  after 180 seconds with one relation job pending. That run did not capture the
  pending job's durable failure/provider state, so its cause is undiagnosed. The
  focused test now emits that state if a later run times out again. The earlier
  two 1.3.0 live runs are documented in the [query-scoped Ask freshness
  report](./vp-ask-stale-snapshot-recovery-2026-10-01.md).
- Adapter `1.6.0` added Korean-labeled stacked fractions for the page-2 current
  ratio formula and its numeric example. The live DeepSeek run completed
  extraction but found only 18/20 curated markers (84 assertions, 85
  candidates). The misses were the page-3 profit/cash qualification and the
  page-8 diversification limit; the output combined the page-10 quick-review
  list into one candidate. Because the live test stopped at that assertion,
  Ask and replay were not run for this attempt.
- Adapter `1.7.0` preserves physical PDF line breaks inside each existing
  paragraph and keeps each line's exact SourceMap offsets. The 1:1
  worker-block-to-paragraph contract remains unchanged. This gives structured
  extraction visible list-item boundaries and lets the existing Stage 4
  candidate splitter separate independent line claims.
- Broad multi-document extraction precision/recall and independently reviewed
  Golden labels: **NOT RUN**; VP-04 remains open.

## Contract, rollback, and replacement

- `PythonDocumentFormatAdapter` output shape and `DocumentIR`/`SourceMap`
  contracts are unchanged. Reconstructed text uses the candidate's original
  PDFium coordinates for its BBox selector. Physical lines remain within one
  paragraph while their BBox selectors map to exact line offsets.
- Adapter identity advances from `1.5.0` through `1.8.0`, so old immutable
  transformation revisions are not silently rewritten or reused as if they
  came from the new transformation.
- No database migration or lockfile update is required. Existing revisions
  remain readable.
- Rollback reverts Korean-labeled fraction recovery and PDF line-break
  preservation, then restores adapter identity `1.5.0`.
  Stored revisions remain immutable. A PDF parser replacement must
  pass Stage 8 Page/BBox, formula Golden, corrupt/encrypted, upper-contract, and
  adapter replacement tests.
- The relevant record was added to the
  [OSS source registry](./oss-source-registry.json),
  [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md),
  and [ADR-088 amendment history](../architecture/adr/ADR-088-stage-8-format-adapter-and-structural-selectors.md).

## 2026-10-01 full live flow after PostgreSQL planner-statistics refresh

The previous full Ask attempt could spend about 239 seconds inside search, beyond the browser flow's 120-second question timeout. The exact query took about 244 ms when run directly after statistics were current. The cause was stale PostgreSQL planner statistics after the large new assertion batch. `VPAssertionLedgerWorker` now asks the existing PostgreSQL adapter to refresh the fixed search inputs once after a bounded assertion-ledger drain; the worker does not refresh after each page. Migration 126 provides a zero-argument, fixed-table `SECURITY DEFINER` routine because PostgreSQL 16 denies direct `ANALYZE` to the runtime role. The database integration test checks that `vp.assertions.analyze_count` increases after drain and that the separate erasure executor role cannot call the refresh routine. The product test does not issue SQL or call `ANALYZE` manually.

### Migration 126 rollback rehearsal

On 2026-10-01, an isolated PostgreSQL 16 database was migrated through version 125 and backed up with the repository's `pg_dump` backup flow. Migration 126 was then applied and verified to transfer the 11 fixed search-input tables to `shotgun_schema_owner` and install `vp.refresh_search_statistics()`. The pre-126 backup was restored into a separate `shotgun_restore_*` database. The restored state matched all 11 pre-migration table owners, omitted migration 126 and its function, and completed backup integrity verification. The disposable databases and temporary backup were removed. Rollback for this migration is therefore verified as restore of the pre-126 backup plus the previous application code; no in-place downgrade exists.

The supplied PDF was reprocessed end to end with the pinned `direct-claim-v6` extraction policy and configured DeepSeek `deepseek-flash` provider. One live Chromium run passed in about 1.4 minutes, inside the Ask timeout. It matched all 20/20 curated markers, produced 172 current assertions and 175 candidates, replayed the ledger to the same projection, recorded three relations with zero pending relation jobs, and passed the four topic Ask/citation checks with expected PDF-page evidence. The run reported 8,179 input and 8,928 output tokens (17,107 total). This is provider-reported usage, not an independently reconciled invoice.

This resolved the unattended-search timeout reproduced for that supplied-PDF flow. The run above preceded the page-grounded marker assertion and is historical evidence only for wording coverage.

## 2026-10-01 source-first marker review

I rendered all 10 pages of the exact 797,599-byte user-provided file at 120 dpi and reviewed the source pages before opening the candidate marker fixture. I then compared each marker's wording and printed page number with the source image. All 20 text claims are present on their cited page after correction. The review caught one fixture error: `IRR은 10%다` is on printed page 7, while the prior marker listed page 6. The marker is now corpus `1.2.0`, label revision 3, and its page is 7.

The browser marker gate now requires the current assertion's source Evidence to carry a `PageSelector` matching the marker page; the prior gate checked the wording but ignored the `page` field. The contract test locks the corrected page. This is a source-first second-pass by one automated reviewer, not a second human adjudication or a full annotation of every extracted assertion. The fixture therefore stays `CANDIDATE`.

The updated actual DeepSeek Chromium full-flow test passed on the same 797,599-byte PDF: 20/20 markers had a current assertion with an exact matching printed-page `PageSelector`; the marker on page 7 (IRR) passed. The run recorded 150 current assertions, 153 generated candidates, matching projection replay, four current relations, zero pending relation jobs, and all four topic Ask cases with expected answer and page-grounded citation. Provider-reported usage was 30,260 tokens across 11 responses; this is not invoice-reconciled. The run took 3.7 minutes for the full five-test live suite, including the four independent DeepSeek scenarios.

The curated page-grounded marker gate is verified. VP-04/05 remain open: the 20 labels are still `CANDIDATE`; independent blind adjudication, full-document precision/recall and omission review, multi-document conflict/equivalence quality, production scale, and actual billing reconciliation remain unverified. Formula handling also retains the unresolved marker limitations described above.

## 2026-10-01 second page-grounded live run — claim-quality review

The same 10-page, 797,599-byte PDF (SHA-256 above) was ingested again through the real Chromium Product path using the pinned `direct-claim-v6` policy, `PythonDocumentFormatAdapter@1.7.0`, isolated PostgreSQL 16, and configured DeepSeek `deepseek-flash` provider. This run passed in about 1.6 minutes.

- It produced **173 candidates**: 169 `READY` assertions and four `REJECTED` candidates. I independently checked the saved run output: all 169 current assertions are exact substrings of their attached Evidence text, and the 20/20 curated marker assertions each have the expected printed-page `PageSelector`.
- The six targeted Ask checks returned expected answers with page-grounded citations. Projection replay matched, four current relation rows were present, and no relation job remained pending. The four relation rows include same-document repeated statements and a formula pair; this is not evidence of broad cross-document relation quality.
- DeepSeek reported 30,689 tokens across nine responses for the full run. The extraction response alone reported 8,178 input plus 10,725 output tokens (18,903 total). These provider numbers have not been reconciled against account billing.
- The earlier page-grounded run with the same source and policy produced 150 assertions and 153 candidates. This later run produced 169 and 173. The extraction output therefore varies between runs; the marker gate alone does not prove stable coverage.
- Three rejected candidates are the source's clearly readable investment, financing, and dividend decision bullets, but their extracted text contains replacement glyphs (`��`). The fourth rejected candidate's generated claim substituted Chinese `重要的` for the Korean `중요한` present in Evidence; exact Evidence validation rejected it. Several other `READY` candidates are context-dependent list fragments such as single asset names, and a CAPM equation was split into symbol fragments. Evidence containment proves textual grounding, not that each row is a useful, atomic knowledge claim.

The PDF pages are legible when rendered; these errors arise in the extracted text/claim path. The live run is a useful end-to-end pass and a concrete quality finding, not full-document precision/recall or an independent human adjudication. Keep the corpus `CANDIDATE` and VP-04/05 open until the complete extracted set, omissions, fragments, cross-source labels, scale, and actual costs have bounded acceptance results.

## 2026-10-01 numbered-list glyph repair — local adapter verification

The source-first review exposed three adjacent pdfplumber NUL characters on
each of the page-5 investment, financing, and dividend decision lines. The
locked PDFium character stream contains a consecutive digit, period, whitespace,
and Korean letter, but the period is baseline-aligned near the bottom of the
pdfplumber box and did not pass the generic center-distance matcher. The
adapter now repairs only this exact sequence when the digit box, period's
horizontal overlap and bottom edge, PDFium whitespace position, and following
Korean source character all match. It retains pdfplumber's boxes and paragraph
order. No OCR or new package was introduced; the `AUGMENT` remains behind the
existing Python format adapter with the same pypdfium2 pin, license, and
replacement boundary.

The supplied PDF worker now emits all three lines as `1. 투자결정`, `2.
자본조달결정`, and `3. 배당결정` with their full Korean statements and no
replacement characters. Python geometry tests pass 18/18, including a negative
case that refuses a mismatched period baseline. The adapter identity advances
to `shotgun.document-formats@1.8.0`; prior transformation revisions remain
immutable.

## 2026-10-01 adapter 1.8.0 live AI Product run

The full Chromium Product path was rerun on the same source with the pinned
`direct-claim-v6` policy, `PythonDocumentFormatAdapter@1.8.0`, isolated
PostgreSQL 16, and the configured DeepSeek `deepseek-flash` provider. It passed
in about 1.5 minutes.

- The current projection contained 164 assertions from 164 candidates; each
  assertion was directly grounded in its Evidence text. All 23 candidate
  markers had a matching current assertion and the expected printed-page
  `PageSelector`.
- The three repaired lines each materialized as their own READY assertion with
  page-5 Evidence: investment decision, capital-funding decision, and dividend
  decision. None contains replacement characters.
- Six Ask checks returned expected answers with page-grounded citations. The
  finance and NPV answers each displayed two citations. Projection replay
  matched, three relation rows remained, and no relation job was pending.
- DeepSeek reported 8,224 input plus 8,754 output tokens (16,978 total) for
  extraction. This does not include independently reconciled account billing.

This verifies the repair on one source and one live provider run. The corpus
remains `CANDIDATE`: output counts have varied across runs, and full-PDF
precision/recall, omissions, list-fragment quality, formula quality, cross-source
labels, independent blind adjudication, scale, and actual cost reconciliation
remain open. VP-04/05 therefore remain incomplete.

## 2026-10-01 direct-claim-v7 shape canaries

The supplied 10-page finance PDF (SHA-256 `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`) was reprocessed through the actual Chromium Product path with isolated PostgreSQL 16, `PythonDocumentFormatAdapter@1.8.0`, and DeepSeek `deepseek-flash`. Candidate Generation used `direct-claim-v7`. The run passed in about 1.1 minutes with Ask disabled so this run isolates extraction and candidate quality.

- It produced 143 current assertions from 143 candidates. Every current assertion passed the exact Evidence substring gate.
- All 23 page-grounded positive markers matched. Four pinned negative canaries (`토지`, `건물`, `기계장치`, and `i f m f i`) were absent from current assertions. The NPV positive and negative rules were both present.
- Projection replay matched; two current relations remained and no relation job was pending. DeepSeek reported 8,379 input and 7,864 output tokens (16,243 total) for extraction. This is provider-reported usage, not invoice reconciliation.
- Unit and Candidate/fixture contract checks passed 56/56. The corpus digest is `sha256:552abba6e0c9a7370e2e93be3ff45a70c0a4ec834b553a42cf98033ac698395b`; its labels remain `CANDIDATE`.

This is one stochastic model run and four negative canaries, not a full-document precision/recall score or independent blind adjudication. The earlier v7 run produced a different candidate count and exposed one bare noun; this run followed the whitespace-only exact-span recovery and v7 shape guard. Full-PDF omissions, all-candidate precision, cross-source relation quality, independent review, scale, and actual cost remain open.

## 2026-10-01 direct-claim-v7 full Ask run

The full actual Product flow was run a second time with Ask enabled against a new isolated PostgreSQL 16 database and the same exact PDF. Chromium passed in about 1.5 minutes.

- It produced 142 current assertions from 142 candidates. All 23 page-grounded positive markers matched and all four negative canaries remained absent. The corpus is still labeled `CANDIDATE`.
- All four fixed finance Ask questions returned the expected answer and citations on the printed source pages. The separate NPV sign question explained both `NPV > 0` and `NPV < 0` from the source. The finance and NPV overview checks each returned two citations.
- Projection replay matched with seven current relations and zero pending relation jobs.
- DeepSeek recorded 12 responses and 31,132 provider-reported tokens across extraction, relation processing, and Ask. Actual account billing was not reconciled.

The second run reinforces the bounded marker and Ask result while also showing nondeterministic extraction counts: 143 claims with Ask disabled, 142 with Ask enabled. It still does not establish full-PDF precision/recall, because the 23 positive and four negative labels are a candidate corpus and have not had independent blind adjudication. VP-04/05 remain incomplete.

## 2026-10-01 direct-claim-v7 full Ask rerun after line-boundary repair

The supplied PDF was run again through Chromium Product intake, isolated
PostgreSQL 16, `PythonDocumentFormatAdapter@1.8.0`, Candidate Generation
`direct-claim-v7`, and the configured DeepSeek `deepseek-flash` provider. This
run passed in about 1.4 minutes.

- The current projection contained 150 assertions from 150 candidates. All 23
  curated positive markers had current matching assertions and all six
  negative canaries were absent. The β=1.5 example retained its two-line
  qualifier as one complete source-grounded claim. Every assertion retained
  its exact Evidence substring.
- The two overview questions and four page-specific corpus questions returned
  their expected answers with source-page Evidence citations. The balance
  sheet answer cited two Evidence records; both NPV sign conditions appeared
  in the answer with two citations. Each of the four page-specific answers
  cited the expected printed page.
- Projection replay matched. Three current relations remained and no relation
  job was pending. DeepSeek reported 17,237 tokens for extraction; the complete
  run's usage was not reconciled against provider billing.
- The previous v7 runs produced 142 and 143 candidates. The change to 150 is
  further evidence that extraction is nondeterministic. The marker fixture is
  still `CANDIDATE`; complete precision/recall, omitted-claim review, fragment
  quality, independent blind labels, cross-source relation quality, scale,
  and billed-cost reconciliation remain open.

This is a successful end-to-end sample and a confirmed improvement for the
β example, not a closure of VP-04/05.
