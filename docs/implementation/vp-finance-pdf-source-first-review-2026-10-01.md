# VP Finance PDF source-first marker review — 2026-10-01

## Scope and method

- Source: user-provided `재무제표재무관리__2026-09-27.pdf`, SHA-256 `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`, 10 printed pages.
- All ten pages were rasterized at 120 dpi and read before opening the candidate marker fixture. The source wording and printed page were then checked against each of its 20 marker rows.
- This is a source-first second pass by one automated reviewer. It is not a second human review, a blind multi-reviewer adjudication, or a review of every generated claim. The corpus remains `CANDIDATE`.

## Marker check

| Printed page | Marker IDs                                                                                                                               | Source check                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1            | `balance-sheet-equation`, `balance-sheet-identity`                                                                                       | Both accounting equation statements are visible.                                                                |
| 2            | `current-ratio-result`                                                                                                                   | The 4,000 / 2,000 example produces 200%.                                                                        |
| 3            | `operating-profit-result`, `cash-vs-profit-distinction`, `cash-flow-operating`                                                           | The 400만원 example and the profit/cash qualification are visible; operating cash flow is defined on this page. |
| 4            | `cash-flow-investing`, `cash-flow-financing`                                                                                             | Both definitions appear under their respective headings.                                                        |
| 5            | `future-value-example`, `present-value-example`                                                                                          | The FV example is 121만원 and the PV example is 100만원.                                                        |
| 6            | `npv-example`, `discount-rate-present-value`, `npv-positive-investment-direction`, `npv-negative-investment-direction`, `irr-definition` | NPV is 150만원; the discount-rate direction, positive/negative NPV meanings, and IRR definition are visible.    |
| 7            | `irr-example`                                                                                                                            | The worked example states the resulting IRR is 10%.                                                             |
| 8            | `systematic-risk-diversification-limit`                                                                                                  | The text says diversification cannot eliminate systematic risk completely.                                      |
| 9            | `beta-example`, `beta-above-one`, `beta-below-one`                                                                                       | The β=1.5 example and the above-/below-one definitions are visible.                                             |

All 20 marker statements match the listed page after correction. The original `irr-example` row incorrectly listed printed page 6; its text is on page 7. The fixture is now corpus `1.2.0`, label set revision 3, digest `sha256:f6d315123e89593025f6336161d2a29a20314698852571abe3ac9ff8eb54e6cc`.

## Gate correction and remaining evidence

The old browser check ignored each marker's `page` field. It now requires a current assertion's Evidence selectors to contain a matching `PageSelector`, and the contract test locks the corrected IRR page. The prior 20/20 run checked text only and must not be read as proof of page accuracy.

- Updated actual DeepSeek Chromium full-flow test: **PASS**. All 20/20 markers matched a current assertion whose Evidence included the marker's exact printed-page `PageSelector`, including `irr-example` on page 7. The run produced 150 current assertions and 153 candidates, replay matched, four finance Ask corpus cases cited the expected page, four current relations remained, and pending relation jobs were 0. Provider-reported usage was 30,260 tokens across 11 responses; billing was not independently reconciled.
- Full-document atomic-claim precision/recall and omission review across the 150 current assertions in the latest run: **not measured**.
- Relation corpus independent adjudication, multi-document error bounds, and provider invoice reconciliation: **not measured**.

This review fixes a known fixture defect and makes the live marker check stricter. It does not close VP-04 or VP-05.
