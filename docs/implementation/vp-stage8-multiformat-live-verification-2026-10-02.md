# VP Stage 8 Multi-Format Live Verification — 2026-10-02

## Result

The actual DeepSeek product flow passed twice for the five active Stage 8 fixture formats: HTML, CSV, DOCX, XLSX, and PPTX. VP-08 remains open because these runs do not cover URL/connected-source freshness behavior, the 1 MiB intake limit, or image/audio/video intake and answer paths.

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

All ten fixture questions returned the expected fixture answer and cited Evidence from that fixture's exact uploaded SourceVersion. Both runs ended with 3 current relations, 0 pending relation jobs, and a matching projection replay. The first run had 6 current assertions, 22 DeepSeek responses, and 16,252 provider-reported tokens; the second had 7 current assertions, 28 responses, and 21,204 tokens. Provider-reported tokens are not an invoice or reconciled cost.

## Limits

Two complete live runs now reproduce the five expected answers, citations, and replay result, but they do not reproduce the same extraction workload: current assertions changed from 6 to 7 and provider usage changed from 22 responses / 16,252 tokens to 28 / 21,204. Earlier attempts also showed variable candidate activation, including one combined run where no expected PPTX assertion became active; a PPTX-only diagnostic and both later complete runs passed. These results do not establish precision/recall or error bounds, and the workload variation still needs an explanation. The fixtures are candidate Golden examples and have not been independently adjudicated.

The wider VP-08 gate also requires URL/connected-source last-checked time, expiry, and refresh-failure behavior in answers, plus a decision and verification for the 1 MiB limit and currently unsupported image/audio/video paths. Those checks remain open.

## OSS and change boundary

No new OSS dependency, runtime, schema, or migration was introduced. This verification exercises the existing Stage 8 format-adapter boundary and its pinned `PythonDocumentFormatAdapter` integration. The Stage 8 OSS review remains the governing adoption and replacement record; the [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md) and [Stage 8 OSS Integration Review](./stage-validations/stage-8-oss-integration-review.md) document the existing decisions and exclusions.

The test uses a disposable database and disposes it after the run. Rollback is limited to reverting this test and its evidence document; no persistent user data or migration is involved.

## Reproduction

The live test is `VP live Stage 8 format Golden actual DeepSeek answers` in `tests/browser/vp-deepseek-full-flow.live.spec.ts`. It requires `VP_LIVE_DEEPSEEK=1`, `VP_LIVE_DEEPSEEK_FORMATS=1`, a working DeepSeek API key, and the configured test database/runtime prerequisites. An optional `VP_LIVE_DEEPSEEK_FORMAT_FILTER` accepts comma-separated fixture filenames for diagnosis; omit it to run all five formats.
