# VP finance PDF independent source audit — 2026-10-02

## Scope and method

This audit checked the supplied `재무제표재무관리__2026-09-27.pdf` (SHA-256
`bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`, 10 pages)
against the VP finance marker and Ask fixtures and one opt-in actual-product
run (`direct-claim-v10`, DeepSeek `deepseek-flash`, temperature 0.2). The source
was checked with `pypdf 6.10.0` using NFKC and whitespace/punctuation
normalization, then visually checked where PDF text extraction did not retain
formula or symbol layout. Numeric Ask answers were also recalculated from the
page examples. This is an AI source audit, not a human sign-off or a blinded
precision/recall study.

## Source and label findings

- The fixture source digest and page count match the supplied PDF.
- Of the 80 positive page markers, 75 and their required context were found by
  normalized text extraction on the expected page. The remaining five were
  visually present in their expected page images: `irr-example` (page 7),
  `beta-above-one`, `beta-below-one`, `beta-equals-market-movement` (page 9),
  and `present-value-equation` (page 5).
- Ten negative canaries occur inside source context as incomplete material:
  isolated asset/cash list labels, list actions/examples, a sentence tail, a
  beta-example continuation, or an orphan formula symbol. The
  `fragmented-capm-symbols` canary is absent from the PDF. Three consecutive
  actual-product runs promoted none of the 11 strings as a standalone claim.
  Their presence is why this is a fragment test rather than a “text absent”
  test.
- The four fixed Ask labels match the PDF and their page examples: current
  ratio `4,000 / 2,000 × 100 = 200%` (page 2), operating income
  `2,000 − 1,100 = 900만원`, then `900 − 500 = 400만원` (page 3), present
  value `110 / 1.1 = 100만원` (page 5), and beta example
  `1.5 × 1% ≈ 1.5%` (page 9).

## One generated-candidate source check

The opt-in audit contained 147 assertions from one live Product run. Every
assertion was an exact substring of its attached Evidence. Independent PDF
text extraction found 131/147 assertion strings on the expected page. The
remaining 16 are formula, symbol, or layout cases on pages 2, 5, 6, 7, and 9;
all were visible in the rendered page images. This supports source location
and direct-text fidelity for that run. It does not label every assertion as a
complete, standalone proposition and it does not measure omitted claims.

Four normalized duplicate groups were found across the detailed pages and the
page-10 summary: gross-profit equation, operating-profit equation, future-value
equation, and present-value equation. These repeated source spans should keep
both provenance links while consolidating the displayed knowledge. That
behavior is not closed by the candidate-count or relation-count measurements.

## Disposition and remaining limits

This audit supports the selected marker pages, negative-fragment examples,
four Ask answer labels, and the source fidelity of the inspected candidate
run. It does not upgrade either fixture from `CANDIDATE`: no complete
document-wide gold claim inventory exists, output omissions are not bounded,
the standalone completeness of all generated assertions is not adjudicated,
and cross-source relation labels lack a reviewed representative corpus.
Candidate and relation counts varied across repeated real runs. Semantic
validation remains `NOT_RUN`; provider billing has not been reconciled. The
earlier intermittent Ask `QUEUED` runs also remain unexplained. VP-04/05 stay
open.
