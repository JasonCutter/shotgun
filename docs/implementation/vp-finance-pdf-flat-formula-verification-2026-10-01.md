# VP-04 / Stage 8 — PDFium equation geometry verification (2026-10-01)

**Status: narrow extraction augmentation implemented; VP-04 remains open.** This
record covers one supplied finance PDF and does not establish general PDF
formula quality.

## Target and source

- Target: Stage 8 `PythonDocumentFormatAdapter`, `DocumentIR`, and `SourceMap`.
- Source: `재무제표재무관리__2026-09-27.pdf`, 10 pages, 797,599 bytes.
- Source SHA-256: `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`.
- Output transformer identity: `shotgun.document-formats@1.4.0`.
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
a NUL glyph or an equals sign. The optional path fails closed when a page has
more than 100,000 PDFium characters or produces more than 20,000 text rows.

A flat formula candidate is limited to a short, single-row ASCII/math
expression. Script markers are placed only from relative glyph size and
position. A stacked fraction is reconstructed only when numerator and
denominator glyph rows sit above and below the same equation baseline, overlap
horizontally around an uppercase equation prefix, and every extracted
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

- Page 5: `FV = PV(1 + r)^n`.
- Page 5: `FV = 100 × (1.1)^2 = 121만원`.
- Page 5: `PV = FV/(1 + r)^n`.
- Page 5: `PV = 110/1.1 = 100만원`.
- Page 6: `NPV = ∑ CF_t/(1 + r)^t − I_0`.
- Page 6: `NPV = 1,150 − 1,000 = 150만원`.

Each segment retained a page-specific `BoundingBoxSelector` in points. The
separate `NPV = 0` line also retained its page/BBox selector. The existing
strict comparison-glyph path still recovered exactly two signs (`NPV > 0` and
`NPV < 0`); 23 other undecodable glyphs remained replacement markers.

Each reconstructed formula uses its original glyph Page/BBox and the existing
selector contract. Docling `v2.130.0` remains `DEFER` under the separate
[reevaluation record](./vp-docling-finance-formula-reevaluation-2026-10-01.md).

## Verification

- Python unit tests: 13/13 passed, including exponent/subscript markers,
  numerator/denominator alignment, exact/contained text agreement, mismatch
  fallback, and the PDFium character budget.
- Supplied-PDF worker run: completed using the exact pypdfium2 5.11.0 package;
  formula text and Page/BBox selectors were inspected against rendered pages 5
  and 6.
- Live DeepSeek ingestion, claim extraction, cited Ask, and replay using adapter
  identity 1.4.0: **passed once** through the browser product flow. Extraction
  returned 111 assertions and 120 candidates; all 20 curated markers were
  covered. The four finance Ask corpus questions matched their expected
  answers and cited pages, including the recovered `PV = FV/(1 + r)^n`
  expression. The NPV sign Ask returned one citation. Replay matched, 12
  relations were current, and 0 relation jobs remained. The run made 35
  successful DeepSeek provider responses totaling 51,502 reported tokens;
  provider billing was not independently reconciled. The earlier two 1.3.0
  live runs are documented in the [query-scoped Ask freshness
  report](./vp-ask-stale-snapshot-recovery-2026-10-01.md).
- Broad multi-document extraction precision/recall and independently reviewed
  Golden labels: **NOT RUN**; VP-04 remains open.

## Contract, rollback, and replacement

- `PythonDocumentFormatAdapter` output shape and `DocumentIR`/`SourceMap`
  contracts are unchanged. Reconstructed text uses the candidate's original
  PDFium coordinates for its BBox selector.
- Adapter identity advances from `1.3.0` to `1.4.0`, so old immutable
  transformation revisions are not silently rewritten or reused as if they
  came from the new transformation.
- No database migration or lockfile update is required. Existing revisions
  remain readable.
- Rollback reverts stacked-fraction recovery and adapter identity to `1.3.0`.
  Stored revisions remain immutable. A PDF parser replacement must
  pass Stage 8 Page/BBox, formula Golden, corrupt/encrypted, upper-contract, and
  adapter replacement tests.
- The relevant record was added to the
  [OSS source registry](./oss-source-registry.json),
  [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md),
  and [ADR-088 amendment history](../architecture/adr/ADR-088-stage-8-format-adapter-and-structural-selectors.md).
