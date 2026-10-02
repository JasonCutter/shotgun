# Finance relation corpus source-fidelity audit — 2026-09-30

**Status: source cross-check only; corpus labels remain `CANDIDATE`.** This
review confirms whether the versioned relation fixture points to the supplied
PDF and whether its written rationales agree with the cited source. It is not a
blind adjudication, independent subject-matter review, or Golden Corpus
approval. The candidate labels and measured results were not changed.

## Inputs and method

- Source: the user-provided 10-page PDF
  `재무제표재무관리__2026-09-27.pdf`.
- The PDF SHA-256 is
  `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`, matching
  the `source.sha256` recorded in finance relation candidate corpus 1.1.0.
- Test-authored companion: `tests/fixtures/vp/finance-relation-companion.v1.md`.
  It is a test input, not another independent financial source.
- Cross-checked the fixture's case text and rationale against extracted PDF
  text and rendered pages 1–3, 5–6, and 9. No fixture label was changed during
  this pass.

## Case-by-case source check

| Case                                        | Candidate label               | Source check                                                                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance-balance-sheet-identity`            | `EQUIVALENT`                  | Page 1 states `자산 = 부채 + 자본`; the companion sentence restates the same accounting identity.                                                                                                                                |
| `finance-current-ratio-calculation`         | `EQUIVALENT`                  | Page 2 computes 4,000 / 2,000 × 100 = 200%; the companion uses the same amounts and result.                                                                                                                                      |
| `finance-operating-profit-calculation`      | `EQUIVALENT`                  | Pages 2–3 define operating profit as gross profit minus selling and administrative expenses and calculate 900 − 500 = 400만원.                                                                                                   |
| `finance-profit-cash-distinction`           | `EQUIVALENT`                  | Page 3 explicitly says increased profit does not mean cash increased by the same amount; the companion paraphrases it.                                                                                                           |
| `finance-positive-npv-rule`                 | `EQUIVALENT`                  | Page 6 says positive NPV points toward increased firm value; the companion restates that rule.                                                                                                                                   |
| `finance-complementary-npv-branches`        | `RELATED`                     | Page 6 gives both the positive and negative NPV branches. Their differing conditions do not contradict each other.                                                                                                               |
| `finance-irr-definition`                    | `EQUIVALENT`                  | The page 6 IRR heading supplies the subject for the source phrase “discount rate that makes NPV zero”; the companion makes the subject explicit.                                                                                 |
| `finance-discount-rate-present-value`       | `EQUIVALENT`                  | Pages 5–6 give the present-value formula and state the inverse relationship. The companion makes the unchanged cash flow and period explicit; equivalence relies on the formula context being retained with the extracted claim. |
| `finance-beta-complementary-branches`       | `RELATED`                     | Page 9 separately describes β > 1 and β < 1. They apply under different beta conditions and can both be true.                                                                                                                    |
| `finance-beta-1-5-example`                  | `EQUIVALENT`                  | Page 9 defines β > 1 as more market-sensitive and explains β = 1.5 as moving about 1.5 times the market; the companion restates the general β > 1 rule.                                                                          |
| `finance-npv-numeric-conflict`              | `CONTRADICTS` or `UNRESOLVED` | Page 6's example computes 150만원. If the companion's “same investment example” refers to that example, 140만원 conflicts; the candidate envelope retains `UNRESOLVED` if that identity is not preserved.                        |
| `finance-profit-cash-coexistence`           | `SUPPORTS`, `RIGHT_TO_LEFT`   | Page 3 gives the general non-implication. The companion's right-side example (profit rose, cash did not) is a counterexample supporting that left-side rule.                                                                     |
| `finance-unrelated-measures`                | `RELATED` or `UNRESOLVED`     | The current ratio on page 2 and operating profit on page 3 concern separate measures. The candidate envelope avoids merging their values.                                                                                        |
| `finance-current-ratio-same-scope-conflict` | `CONTRADICTS` or `UNRESOLVED` | Page 2 computes 200%. The companion says “same example” but gives 150%; contradiction is appropriate when that reference is preserved, otherwise unresolved is safe.                                                             |

## Findings and limits

The fixture's source digest matches the supplied PDF, and the cited page
content supports the written relation rationales. The direction for the
profit/cash example is `RIGHT_TO_LEFT`; two v5 live trials returned that
direction for both individual and batched calls.

The `finance-discount-rate-present-value` case depends on preserving the source
formula and its fixed cash-flow/period assumptions with the extracted claim.
The matching PDF source version is present in the local Shotgun database with
39 current assertions. Its discount-rate assertion is READY, but the stored
claim text has compressed spacing and its Evidence quote contains the sentence
and adjacent text, not the full formula section. Ask can still cite that
sentence; relation classification currently receives the claim text without
the formula context. This remains a claim-extraction and evidence-span check
under VP-04.
The three multi-choice cases intentionally preserve uncertainty about matching
scenario scope; this text review does not remove those alternatives.

Because the review was not blind and used one implementation reviewer, it does
not meet the independent Golden Corpus review gate. Keep the fixture at
`CANDIDATE`, keep prior metrics as candidate-label measurements, and require a
separate reviewer before promoting these labels to a quality acceptance
baseline.

## OSS decision

`NO_RELEVANT_OSS` for this source-fidelity check: no new package, runtime, or
semantic label generator is needed. It reads the user-provided source and the
existing Shotgun-owned candidate fixture. The existing PostgreSQL/pgvector and
`pg_trgm` ranking decisions documented in the scale characterization remain
unchanged; this audit does not select or enable a candidate-pair filter.
