# VP-04 / Stage 8 — Docling finance formula re-evaluation (2026-10-01)

**Status: re-evaluation complete; Docling remains `DEFER`. VP-04 remains open.**
This is a focused parser comparison on the supplied finance PDF, not a whole-PDF
quality acceptance test or independent Golden Corpus adjudication.

## Decision target

- Target: VP-04 extraction fidelity; Stage 8 Python Document Format Adapter,
  `DocumentIR` and `SourceMap` boundary.
- Source: `재무제표재무관리__2026-09-27.pdf`, 10 pages, SHA-256
  `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`.
- Trigger: the existing finance source audit found formulas and assumptions on
  pages 5–6 can be lost or returned out of order by the current `pdfplumber`
  path. This meets the Stage 8 documented Docling re-evaluation trigger.

## OSS review

| Candidate                                             | Decision            | Version, license, security and maintenance                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Docling](https://github.com/docling-project/docling) | `DEFER`             | Tested release tag `v2.130.0`, commit `92fc74c36bbd20db9838d7665d38900e5c958319`; upstream `LICENSE` is MIT. The upstream security policy says only latest versions are supported. No Docling runtime is added to Shotgun; a production security/dependency gate has not been run. |
| [Apache Tika](https://github.com/apache/tika)         | `DEFER`             | Not re-tested; current failure is formula-content extraction, and no new evidence justifies another general-purpose runtime.                                                                                                                                                       |
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF)         | `REJECT`            | Existing Stage 8 decision remains: AGPL license is outside the approved distribution boundary.                                                                                                                                                                                     |
| Existing `pdfplumber` + `pypdfium2` adapter           | `ADOPT` + `AUGMENT` | Keep the pinned current path. PDFium remains limited to unique, strict `<`/`>` glyph geometry recovery; it does not take over reading order or formula extraction.                                                                                                                 |

Docling's upstream model catalog exposes CodeFormulaV2 as a specialized,
optional code/formula stage. Its MIT license and upstream code do not transfer
DocumentIR, Evidence, SourceMap or SourceVersion ownership to Docling.

Pinned source references: [release v2.130.0](https://github.com/docling-project/docling/releases/tag/v2.130.0), [tested commit](https://github.com/docling-project/docling/commit/92fc74c36bbd20db9838d7665d38900e5c958319), [MIT license](https://github.com/docling-project/docling/blob/v2.130.0/LICENSE), [security policy](https://github.com/docling-project/docling/security/policy), and [v2.130.0 model catalog](https://github.com/docling-project/docling/blob/v2.130.0/docs/usage/model_catalog.md).

## Isolated comparison

Docling `2.130.0` was installed only in a temporary Python 3.12 virtual
environment under `tmp/`; no application dependency, lockfile, adapter,
database or product behavior changed. Pip's isolated resolution listed 50
distributions, and the temporary environment occupied 854,390,083 bytes after
installation. The environment and downloaded model cache are evaluation-only.

For pages 5–6, the default PDF pipeline with `do_formula_enrichment=False`
finished conversion in 25.55 seconds with the local model cache warm (the first
conversion, which also downloaded OCR weights, took 69 seconds). It retained
section order and identified formula blocks, but the formula items had empty
text. Markdown output replaced each formula with
`<!-- formula-not-decoded -->`; some Korean text also contained U+FFFD
replacement characters. The default path therefore did not recover formula
content or meet the extraction requirement.

The formula-enriched path loaded CodeFormulaV2 but stayed CPU-bound for over six
minutes at approximately 1.9 GB process memory without returning the two-page
conversion. It was stopped; no quality result was produced. This is a failed
local feasibility run, not a benchmark claim about GPU or production servers.

The current `pdfplumber` output for the same pages has formula fragments in
incorrect reading order and replacement characters. The exact source audit
records examples and the source-to-fixture checks in
[the finance relation source audit](./vp-finance-relation-source-fidelity-audit-2026-09-30.md).

## Integration decision and rollback

Keep Docling `DEFER` for production. The non-enriched path leaves formula
content blank; the enriched path exceeded this host's time and memory budget
without a result. Integrating it now would add a large parser/model dependency
without a passing formula Golden test. Do not add Docling packages to the
Shotgun lockfile or call it as an implicit fallback.

No product migration or rollback is required because the evaluation was
isolated. Removing the temporary virtual environment and model cache returns
the workspace to its prior runtime. Continue using the existing adapter and
preserve undecodable formula regions as unresolved Evidence; do not invent
formula text.

Re-open this decision when a bounded, supported host can run CodeFormulaV2
within the product's ingest limits and it passes a page-image adjudicated
formula corpus for expression, variable, exponent, order and surrounding
assumptions. Then run DocumentIR/SourceMap Contract, Golden, security and
adapter-replacement tests before considering `ADOPT` or `AUGMENT`. The relation
corpus remains `CANDIDATE`; this result does not close VP-04/05.
