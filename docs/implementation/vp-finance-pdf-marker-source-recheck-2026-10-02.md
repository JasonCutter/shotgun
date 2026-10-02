# Finance PDF marker source recheck — 2026-10-02

## Scope and source identity

This is a second-pass source check of the existing VP finance marker fixture.
It verifies the fixture's selected page locations and canary wording against
the supplied PDF. It is not a complete inventory of every claim in the PDF
and is not blind semantic adjudication.

- PDF: `재무제표재무관리__2026-09-27.pdf`
- SHA-256: `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`
- Page count: 10
- Fixture: `finance-pdf-claim-markers.v1.json`, version 1.9.0, 80 positive
  markers, 11 non-claim canaries; label status remains `CANDIDATE`.

## Method and findings

Rendered and visually inspected all ten original pages with PDFium. The
fixture's 80 selected positive snippets are present on their assigned pages.
An independent text extraction and normalized substring check found 72/80
snippets exactly in the expected page text. The eight text-only misses were
`irr-example`, `capm-formula`, `beta-above-one`, `beta-below-one`,
`credit-sale-revenue-before-cash`, `future-value-equation`,
`present-value-equation`, and `beta-equals-market-movement`; visual inspection
confirmed each on the fixture's page. These misses are extraction/typography
differences (equation layout, Greek/subscript glyphs, and line wrapping), so a
plain text substring matcher is not sufficient for these markers.

Ten of eleven non-claim canary strings occur literally in the PDF text. The
`fragmented-capm-symbols` canary (`i f m f i`) does not occur as a literal
source phrase; it represents an incomplete transformed formula fragment. It
can still be checked against generated claims, but it must not be reported as
a verbatim source quote.

The page images also show why marker coverage cannot stand in for a complete
claim gold set: several positive markers are deliberately short location
snippets (for example, a formula result or clause tail), rather than complete
atomic propositions. The source check confirms these selected anchors, not
whether every eligible proposition was extracted, whether each proposition
was split correctly, or whether inter-source relations are correct.

## Gate effect

This recheck strengthens page-location evidence and identifies a limitation in
the text-only marker matcher. It does not change the fixture label status and
does not close VP-04/05. Full-source atomic-claim adjudication, omission and
false-positive bounds, representative relation labels, and billed-cost
reconciliation remain open.
