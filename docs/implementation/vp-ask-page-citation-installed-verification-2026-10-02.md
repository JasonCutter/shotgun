# VP installed Ask page-citation verification — 2026-10-02

## Scope

Verify the MAIN desktop-launcher runtime can read the saved real-DeepSeek answer
from the supplied finance PDF and show its page-grounded Evidence link after
the SourceMap-to-citation change in PR #378.

## Environment

- Desktop launcher runtime: `main@6325a755fd80b585a3991556609ed3efb5754935`.
- `/health`: HTTP 200, `status=ok`, `readiness=READY`.
- Configured provider shown in Shotgun: DeepSeek / DeepSeek V4.1 Flash.
- Browser-loaded production bundle in a newly opened document:
  `index-BmHTcJua.js`.
- Source: supplied `재무제표재무관리__2026-09-27.pdf`; Source ID
  `c5bd03a9-626a-4c26-82ff-b0b5a6e452e1`, SourceVersion ID
  `4e291023-7c26-4f3f-9df5-3dc1d6b292ba`.

## Procedure and result

Opened the existing completed conversation for:

> 자료의 예에서 유동자산 4천만원과 유동부채 2천만원으로 계산한 유동비율은 얼마인가요?

The saved answer rendered successfully: current assets 40 million KRW divided
by current liabilities 20 million KRW gives a current ratio of 200%, with the
calculation `(4,000 ÷ 2,000) × 100 = 200%`. The answer exposed its pinned Evidence
link with `page 2`, and the target remained the supplied finance PDF's exact
Source and SourceVersion.

An already-open document from before the MAIN relaunch still held the older
`index-C1AoPZhq.js` bundle and displayed a strict-decoder error for the new
optional `pageNumbers` field. The current TypeScript decoder and the newly
served MAIN bundle both accept the field; opening a new document loaded the
current asset and the saved conversation passed. This was a stale-client-tab
observation, not a remaining contract decoder defect. No new provider request
was made during this readback.

## Limits

This verifies one saved answer and one PDF page citation on the installed MAIN
runtime. It does not close VP-09's full product/security gate or VP-11's clean
empty-space upload → actual AI question → revised-source acceptance flow. It
also does not establish the independent extraction/relation quality required
for VP-04/05.
