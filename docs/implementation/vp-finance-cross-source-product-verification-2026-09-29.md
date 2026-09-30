# VP-04/05 — Finance Cross-source Product Verification (2026-09-29)

**Status: narrow product evidence; VP-04 and VP-05 remain open.** This verifies
two deliberately small finance pairs through the browser product path. It is
not a representative independent-document benchmark or an approved Golden
Corpus.

## Scope and provenance

- Product path: two Markdown files submitted through Sources, automatic
  extraction and evidence validation, VP current assertion ledger, automatic
  relation job, cited Ask, and independent projection replay.
- Source A: `유동비율 = 4,000 / 2,000 × 100 = 200%.`
- Source B: `유동자산 4,000만원을 유동부채 2,000만원으로 나눈 유동비율은 200%다.`
- Conflict Source A: `같은 예시에서 유동자산 4,000만원, 유동부채 2,000만원의 유동비율은 200%다.`
- Conflict Source B: `같은 예시의 유동비율은 150%다.`
- Both files are test-authored paraphrases based on the short, page-grounded
  marker in `finance-pdf-claim-markers.v1.json`. This test did **not** submit the
  supplied PDF or claim that Source B is an independent publication.
- Data and database were confined to a newly created isolated PostgreSQL test
  database per run; no source or ledger rows were written to the installed
  product database.

## Verification

The live Chromium test ran three times serially with the configured DeepSeek
model `deepseek-flash` and relation policy `vp-deepseek-relation-v3`.

| Check                                     | Result                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Distinct Source IDs / current assertions  | 2 / 2 in every run                                                                                 |
| Direct claim to exact Evidence validation | 2/2 in every run                                                                                   |
| Paraphrase relation                       | `EQUIVALENT` in 3/3 runs                                                                           |
| Paraphrase model-selected probability     | 0.99, 1.00, 0.99; not calibrated confidence                                                        |
| Same-scope conflict relation              | `CONTRADICTS` in 1/3 runs; safe abstention in 2/3 at 0.50 and 0.70                                 |
| Conflict Ask answer                       | 150% and 200%, discrepancy and both Evidence citations in all three answers                        |
| Independent replay                        | 6/6 matched; zero pending relation jobs                                                            |
| DeepSeek calls / provider tokens          | 4 calls/run; paraphrase 2,269 / 2,303 / 2,397; conflict 2,372 / 2,291 / 2,320 total tokens per run |

Reproduction (requires a configured local DeepSeek Vault credential):

```powershell
$env:VP_LIVE_DEEPSEEK='1'
npm run frontend:test:e2e -- --grep "VP live finance paraphrases retain both sources" --project=chromium --repeat-each=3 --workers=1
npm run frontend:test:e2e -- --grep "VP live same-scope finance values" --project=chromium --repeat-each=3 --workers=1
```

The serial worker setting is required by this browser fixture because each
runtime binds the same local frontend port. An initial parallel repeat collided
on that port and was discarded; it is not included in the results above.

## Integration boundary and limits

- The existing Shotgun `DecisionProviderPort` and configured DeepSeek
  `deepseek-flash` provider path were reused. No new runtime, package, database
  schema, or dependency was introduced.
- `garrytan/gbrain` at pinned commit
  `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT remains `REFERENCE_ONLY` for
  Job and Graph patterns; its runtime and DB do not become VP authority.
- The existing Stage 4 structured-output and validation contracts remain the
  guard. Both persisted assertions point to their own Source and Evidence; the
  model relation does not merge or erase either claim.
- The same-scope conflict was written only once in three runs; the other two
  outputs fell below the 0.90 recording threshold and were not stored as a
  relation. The Ask still retained both claims, named 150% and 200%, cited both
  Evidence spans, and stated that the supplied material did not establish
  which value was right. This variability confirms that model-selected
  probabilities are not calibrated confidence and that current high-threshold
  relation recall is incomplete.
- This does not measure extraction omissions across the PDF, supersession
  rates, a real independent second publication, confidence calibration,
  candidate-pair reduction, retry-inclusive cost, or the provider billing
  ledger. Six repeated examples cannot establish production error bounds. Keep
  the corpus classification `CANDIDATE` and VP-04/05 unchecked.
- Rollback is to remove this live test and its report; the test's isolated DB is
  disposed after each run. No production migration or user-data rollback is
  required.
