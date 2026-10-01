# VP Stage 8 Multi-Format Live Verification — 2026-10-02

## Result

The actual DeepSeek product flow passed once for the five active Stage 8 fixture formats: HTML, CSV, DOCX, XLSX, and PPTX. VP-08 remains open because this run does not cover URL/connected-source freshness behavior, the 1 MiB intake limit, or image/audio/video intake and answer paths.

## Scope and method

- Ran the browser product flow against a disposable isolated PostgreSQL database and the actual application runtime.
- Uploaded each fixture through Source Intake, waited for replay and relation processing to settle, asked a question through Ask, and checked the returned answer and citation against the uploaded SourceVersion and its Evidence.
- Used `PythonDocumentFormatAdapter@1.11.0`, Candidate prompt `direct-claim-v8`, and the configured DeepSeek `deepseek-flash` provider.
- Verified the format-specific Evidence selector in the citation:

| Format | Selector verified                        | Ask answer and citation |
| ------ | ---------------------------------------- | ----------------------- |
| HTML   | `CssSelector`                            | Passed                  |
| CSV    | `CellSelector`                           | Passed                  |
| DOCX   | `CssSelector` for the paragraph Evidence | Passed                  |
| XLSX   | `CellSelector`                           | Passed                  |
| PPTX   | `ShapeSelector`                          | Passed                  |

All five fixture questions returned the expected fixture answer and cited Evidence from that fixture's exact uploaded SourceVersion. The run ended with 6 current assertions, 3 current relations, 0 pending relation jobs, and a matching projection replay. DeepSeek reported 22 responses and 16,252 tokens. Provider-reported tokens are not an invoice or reconciled cost.

## Limits

This is one successful live run, not a reproducibility or extraction-quality study. Earlier attempts showed variable candidate activation, including one combined run where no expected PPTX assertion became active; a PPTX-only diagnostic and the later complete five-format run passed. The result therefore does not establish precision/recall, error bounds, or stable behavior across repeated runs. The fixtures are candidate Golden examples and have not been independently adjudicated.

The wider VP-08 gate also requires URL/connected-source last-checked time, expiry, and refresh-failure behavior in answers, plus a decision and verification for the 1 MiB limit and currently unsupported image/audio/video paths. Those checks remain open.

## OSS and change boundary

No new OSS dependency, runtime, schema, or migration was introduced. This verification exercises the existing Stage 8 format-adapter boundary and its pinned `PythonDocumentFormatAdapter` integration. The Stage 8 OSS review remains the governing adoption and replacement record; the [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md) and [Stage 8 OSS Integration Review](./stage-validations/stage-8-oss-integration-review.md) document the existing decisions and exclusions.

The test uses a disposable database and disposes it after the run. Rollback is limited to reverting this test and its evidence document; no persistent user data or migration is involved.

## Reproduction

The live test is `VP live Stage 8 format Golden actual DeepSeek answers` in `tests/browser/vp-deepseek-full-flow.live.spec.ts`. It requires `VP_LIVE_DEEPSEEK=1`, `VP_LIVE_DEEPSEEK_FORMATS=1`, a working DeepSeek API key, and the configured test database/runtime prerequisites. An optional `VP_LIVE_DEEPSEEK_FORMAT_FILTER` accepts comma-separated fixture filenames for diagnosis; omit it to run all five formats.
