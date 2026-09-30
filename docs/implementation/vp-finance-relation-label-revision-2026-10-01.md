# Finance relation label revision — 2026-10-01

**Status: source-grounded candidate revision; not independently adjudicated.**
This revision narrows two relation envelopes in finance corpus v1.1 to strict
`CONTRADICTS` labels because each pair explicitly says both numbers describe
the same example. It does not certify that the test-authored companion value is
factually correct, and it does not promote the corpus to `REVIEWED` or
`APPROVED`.

## Version and provenance

- Previous immutable corpus: `finance-relation-candidate.v1.1.json`, contract
  `1.1.0`, label set revision 2, digest
  `sha256:c9fb7c0d514f6bcdf25038030616ea1feaa1ac31eaa4df39b8dedf46c800e9a4`.
- Current immutable corpus: `finance-relation-candidate.v1.2.json`, contract
  `1.2.0`, label set revision 3, digest
  `sha256:7f46918b7570441c9cd13c635d8ef668ee55e1874f06bba14656a8ca93388e45`.
- User PDF SHA-256 remains
  `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`.
- Companion claims remain test-authored data in
  `tests/fixtures/vp/finance-relation-companion.v1.md`, not an independent
  financial source.
- Corpus status remains `CANDIDATE`; all prior v1.1 measurements stay attached
  to that version and are not rewritten.

## Label changes

| Case                                        | v1.1 envelope                 | v1.2 label    | Basis                                                                                                     |
| ------------------------------------------- | ----------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `finance-npv-numeric-conflict`              | `CONTRADICTS` or `UNRESOLVED` | `CONTRADICTS` | Both texts explicitly name the same investment example; 150만원 and 140만원 cannot both describe its NPV. |
| `finance-current-ratio-same-scope-conflict` | `CONTRADICTS` or `UNRESOLVED` | `CONTRADICTS` | Both texts explicitly name the same example; the stated inputs yield 200%, which conflicts with 150%.     |

The `finance-unrelated-measures` envelope remains `RELATED` or `UNRESOLVED`.
No factual winner is inferred from a contradiction relation.

## Contract and live model evidence

The v1.2 contract test checks the schema and digest, preserves the 14 unique
cases, expects 13 strict labels and one cautious envelope, and verifies both
same-example conflict labels.

The configured DeepSeek `deepseek-flash` adapter classified the full v1.2
corpus twice using `vp-deepseek-relation-v5`. Each run returned 14 valid
decisions, passed all 14 allowed label sets, and matched all 13 strict labels.
Both numerical conflict cases returned `CONTRADICTS` in both runs; the
unrelated-measures case returned `RELATED` in both. There were no malformed
responses or failed calls.

| Run | Input tokens | Output tokens | Provider p50 | Provider p95 |
| --- | -----------: | ------------: | -----------: | -----------: |
| 1   |        9,663 |         1,044 |       924 ms |     1,313 ms |
| 2   |        9,663 |         1,015 |       924 ms |     1,083 ms |

These are two live model trials, not an independent human adjudication,
confidence calibration, a billing-ledger reconciliation, or a broad finance
quality estimate. The test uses synthetic relation requests and does not write
VP relation records. VP-04/05 remain open for independent label review,
representative extraction and multi-document quality, candidate-pair recall,
large-queue retry/cost measurement, and actual provider billing reconciliation.

## OSS integration decision

`NO_RELEVANT_OSS`: this change versions Shotgun-owned evaluation data and its
schema; it adds no runtime, package, or provider adapter. The existing OSS
review and `vp-deepseek-relation-v5` adapter boundary are unchanged.

## Verification

- `tests/contract/vp-finance-relation-candidate.contract.test.ts`: 3/3 passed.
- `tests/integration/vp-deepseek-live.integration.test.ts`: 1/1 passed in each
  of two runs, with `VP_LIVE_DEEPSEEK=1` and the finance corpus selector.
- ESLint passed for the corpus helper, contract, and live integration test.
- The stored corpus digest matches the computed stable JSON digest.
