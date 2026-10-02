# VP-04 — Direct Claim v5 and evidence quality verification (2026-09-29)

**Status: partial evidence; VP-04 remains open.** This report records the current
working-tree result. The implementation and tests are not yet on `main`.

## Scope

- `direct-claim-v5` asks extraction to return every explicit claim and caps
  DeepSeek claim-extraction responses at 16,384 output tokens. The cap is part
  of the durable input snapshot and request digest.
- Candidate Generation splits converter-merged statements while preserving the
  matching statement's qualifiers. Markdown heading-only fragments are not
  promoted to claims, and a product version such as `v1.2` stays attached to
  its following release statement.
- The plain-text transformer now gives an ATX heading its own source range and
  attaches a `MarkdownHeadingContext` selector to the following Evidence. The
  adapter identity is `shotgun.plain-text@1.0.2`; previous transformation
  revisions remain immutable.

## OSS integration record

| Candidate                                                                                  | Version / license                                             | Decision and boundary                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki)                          | Commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0 | Existing `EXTRACT` decision remains. Its quote-normalization and source-location patterns are used behind Shotgun's `PlainTextTransformerPort` / `EvidenceLocatorPort`. No upstream runtime, SQLite, VaultFS, or database schema is introduced. |
| [W3C Web Annotation Data Model](https://www.w3.org/TR/2017/REC-annotation-model-20170223/) | Recommendation 2017-02-23, W3C-20150513                       | Existing `AUGMENT` decision remains for position and quote selectors. `MarkdownHeadingContext` is an additive Shotgun selector; SourceVersion, EvidenceSpan, offsets, and hashes remain Shotgun-owned.                                          |

Target Stage/Modules are VP-04, Stage 3 Transformation/Evidence and Stage 4
Candidate Generation, behind `PlainTextTransformerPort` and
`EvidenceLocatorPort`. The boundary is the existing transformation and Evidence
SourceMap. No package, dependency, database migration, or Role Matrix decision
was added. The pinned lucas assessment records Apache-2.0, ambiguity-safe quote
location, and a separately versioned adapter with no automatic upstream update;
the W3C selector is a stable recommendation, not a runtime dependency. Heading
text remains untrusted source content and is never executed or followed as an
instruction. Existing Contract and Golden tests are the replacement check.
Rollback keeps the additive selector readable and stops producing it; it does
not overwrite older SourceMap revisions. `npm run oss:audit` exited successfully
at the repository's high-severity threshold; npm reported four moderate
advisories in the existing Vitest/@vitest-mocker and jsdom/undici development
dependency chain. This work adds no dependency and does not change those
packages.

## Verification results

### Approved deterministic quality baseline

The existing, user-approved `shotgun-quality-baseline@1.0.0` corpus and its
thresholds were reused unchanged. The current Stage 4 route passed
`npm run quality:gate`:

| Metric                 | Current | Approved floor |
| ---------------------- | ------: | -------------: |
| Precision              |   0.636 |          0.545 |
| Recall                 |   0.875 |          0.750 |
| F1                     |   0.737 |          0.632 |
| Exact claim match      |   0.556 |          0.444 |
| Evidence exact match   |   0.875 |          0.857 |
| Evidence coverage      |   0.875 |          0.750 |
| Unsupported claim rate |       0 |              0 |

The run uses the deterministic Fake provider. It validates the Stage 4
generation, evidence, and validation path; it does not measure live model
accuracy. `noClaimAccuracy=0` remains a known diagnostic that the approved v1
policy explicitly marks non-blocking.

### Real finance PDF and DeepSeek

The local PDF `재무제표재무관리__2026-09-27.pdf` was ingested into an isolated
PostgreSQL database through the Shotgun browser Sources screen. The actual
DeepSeek model was `deepseek-flash`, prompt `direct-claim-v5`.

- File: 797,599 bytes; SHA-256
  `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`.
- Extraction response: HTTP 200, `finish_reason=stop`, complete JSON; requested
  output cap 16,384; 7,895 input + 7,864 output = 15,759 tokens.
- The run materialized 113 candidates, 112 current direct-evidence assertions,
  and matched all 8 preselected numerical examples: balance-sheet equation,
  200% current ratio, 400만원 operating profit, 121만원 future value, 100만원
  present value, 150만원 NPV, 10% IRR, and beta 1.5%.
- The live Ask answer cited two Evidence spans. Independent VP replay matched;
  pending relation jobs were zero.

Reproduction:

```powershell
$env:VP_LIVE_DEEPSEEK='1'
$env:VP_FINANCE_PDF_PATH='C:\Users\lhm24\Downloads\재무제표재무관리__2026-09-27.pdf'
$env:VP_FINANCE_PDF_ASK='1'
npm run frontend:test:e2e -- --grep "VP live finance PDF extraction and cited Ask characterization" --project=chromium
```

### Policy update, incremental history, and clean rebuild

The actual DeepSeek browser test changed the first isolated database from v2 to
v5, modified source A from 42 to 44 while retaining source B=43, and compared it
with a new database built directly from A=44 and B=43. Both projections held two
assertions and one contradiction relation, their logical projections matched,
and each final answer cited both sources. The live test passed in Chromium.

Reproduction:

```powershell
$env:VP_LIVE_DEEPSEEK='1'
npm run frontend:test:e2e -- --grep "VP live incremental history agrees with a clean DeepSeek rebuild" --project=chromium
```

### Versioned relation-decision candidate corpus

The former inline 14-pair DeepSeek sample is now pinned at
`tests/fixtures/vp/relation-decision-corpus.v1.1.json` with its JSON Schema,
stable SHA-256 digest, provenance, rationale, and separate exact-label versus
safe-choice cases. The corpus remains `CANDIDATE`; it is synthetic and is not
an approved VP release threshold. The prompt-injection sample remains source
data and was classified from the conflicting claims, not obeyed as an
instruction.

This is an evaluation fixture behind the existing `VPDecisionProviderPort` and
`GeneralAIVPDecisionAdapter`; it does not introduce a new runtime or provider
boundary. Existing Ajv `8.20.0` validates the fixture schema, and the existing
DeepSeek route remains the `AUGMENT` decision recorded for ADR-172. No package,
lockfile, production schema, or Open-source Role Matrix change was made.

Live DeepSeek verification used `deepseek/deepseek-flash` and policy
`vp-deepseek-relation-v2` on 2026-09-29:

| Full run | Exact labels |                                                     Permitted set |                                                                       Provider tokens |               p50 / p95 latency |
| -------- | -----------: | ----------------------------------------------------------------: | ------------------------------------------------------------------------------------: | ------------------------------: |
| 1        |          8/8 |                                                             14/14 |                                                                   5,925 + 803 = 6,728 |   734 / 967 ms, adapter elapsed |
| 2        |          8/8 | 13/14; one `different-entity` response failed decision validation | 5,505 + 727 = 6,232 for 13 accepted responses; failed response usage was not captured | 831 / 1,107 ms, adapter elapsed |
| 3        |          8/8 |                                                             14/14 |                                                                   5,925 + 812 = 6,737 |   771 / 1,306 ms, provider call |

After run 2, the isolated `different-entity` case returned the permitted
`UNRESOLVED` choice (420 input + 60 output tokens; 1,121 ms). Run 3 then passed
all 14 cases. Thus the current small corpus passed twice, with one transient
structured-decision validation failure in the intervening full run. That
failure was not reproducible in the isolated retry, but it shows a reliability
case that VP-06 must exercise. Runs 1 and 2 measure full adapter elapsed time;
run 3 measures only the provider call, so their latency figures are not a
strict like-for-like comparison. Currency billing is not available here.

Reproduction:

```powershell
$env:VP_LIVE_DEEPSEEK='1'
node --env-file-if-exists=.env --env-file-if-exists=.env.test node_modules/vitest/vitest.mjs run tests/integration/vp-deepseek-live.integration.test.ts --maxWorkers=1 --testTimeout=180000
```

These runs measure short synthetic relation batches. They do not measure billed
currency, complete retry cost, large-source candidate reduction, or relation
quality between the finance PDF and a second real document.

### Contract tests

`tests/contract/issue-237-markdown-evidence-segmentation.contract.test.ts`,
`tests/contract/transformation-evidence.contract.test.ts`,
`tests/contract/ai-candidate-validation.contract.test.ts`, and
`tests/contract/quality-stage4-baseline.contract.test.ts` passed: 53 tests.
The focused PostgreSQL persistence test also passed in a disposable isolated
database and confirmed the body quote, Unicode position, heading selector, and
Evidence identity after a runtime restart.

## Limits and next VP-04 work

The single PDF's 8/8 marker result is coverage of selected examples, not a full
precision/recall score for every extracted claim. Some PDF candidates still
combine neighboring explanations, converter output still distorts some
equations, and the current ratio / present-value examples each have a duplicate
or overlong matching candidate. The PDF produced no relation candidates in this
run, which does not test cross-document relation quality. The test records
tokens, not actual billed currency.

Next work is to add representative multi-document finance cases, label
expected claims and Evidence, measure false positives and omissions, and test
agreement, qualification, contradiction, and supersession across versions.
The 14-pair candidate relation corpus is a small provider smoke set, not that
finance corpus. VP-04 cannot be checked until the wider corpus and its
prespecified error limits pass.

## 2026-09-30 — full-PDF multi-topic Ask verification

The same user-provided 10-page PDF was uploaded through the real Shotgun
Sources screen into a fresh isolated PostgreSQL database and processed by
DeepSeek `deepseek-flash` with `direct-claim-v5`. The current run generated 127
candidates and 116 current direct-evidence assertions. All 20 page-grounded
markers in the versioned PDF marker corpus were found, with no missing marker.
This remains candidate-set coverage: the matcher chooses the shortest matching
assertion when duplicates exist, and the run still contains two matching
current-ratio candidates and two present-value candidates. This does not
estimate extraction precision or recall across all 116 assertions.

A new versioned four-question Ask corpus covers the current-ratio example
(page 2), operating-income example (page 3), present-value example (page 5),
and beta sensitivity example (page 9). Each answer contained its expected
result; every citation resolved to the exact uploaded SourceVersion; and the
cited Evidence included the expected topic term and PDF page selector. The
existing balance-sheet and NPV questions also passed, and the independent
projection replay matched with zero pending relation jobs. The full test made
11 DeepSeek requests and used 28,452 reported input/output tokens in total,
including extraction. Currency billed by DeepSeek was not read back.

The Ask corpus is `CANDIDATE`, tied to this PDF's SHA-256, and has its own
schema and digest. Search still uses the existing PostgreSQL full-text and
`pg_trgm` Ask adapter behind `AskKnowledgeEvidenceSearchPort` (`ADOPT` per the
existing Stage 7 decision); PDF SourceVersion, EvidenceSpan, selectors, and
citation ownership remain Shotgun-owned. No new runtime, provider, database
schema, or OSS dependency was added. This single-source question set tests
retrieval and citation grounding; it does not close multi-source financial
relation quality, broad extraction precision/recall, or VP-04.

### 2026-09-29 follow-up — actual finance PDF glyph recovery and Ask

After the original v5 run, the supplied PDF was reprocessed with the pinned
Stage 8 worker after constrained `<`/`>` glyph recovery was added. The worker
restored the two page-6 NPV signs from unique PDFium geometry matches; 23 other
NUL markers remained unresolved. The downstream direct-text gate continues
to reject unresolved U+FFFD claims.

The first live Ask replay found that Korean particle-bound `NPV가` was omitted
from the stored `NPV` claim shortlist. The existing PostgreSQL Ask search now
adds particle-stripped variants. The repeated actual DeepSeek browser run
passed: extraction produced 106 current assertions and 117 generated
candidates in this run; the exact `NPV > 0` and `NPV < 0` rules were READY;
the Korean Ask explained increase versus decrease and cited both Evidence
spans; independent replay matched; and pending relation jobs were zero. These
counts are run-specific because model extraction output can vary.

The isolated DB retrieval regression passed 2/2, the Stage 8 recovery and
selector bundle passed 25/25, the direct-text validation contract passed
36/36, and the full live browser E2E passed. This closes the observed NPV
path failure only. The broader PDF/finance corpus quality measures listed
above remain outstanding, so VP-04 remains open.

### 2026-09-29 narrow multi-source finance Product follow-up

Two test-authored current-ratio pairs were run through actual browser Sources,
DeepSeek `deepseek-flash`, current VP relation policy, Ask, and independent
replay. Three same-value paraphrase runs recorded `EQUIVALENT` in 3/3 at
selected probabilities 0.99–1.00. Three same-scope 200%/150% conflict runs
recorded `CONTRADICTS` in 1/3 (0.98); the other two fell below the 0.90 policy
floor (0.50 `UNRESOLVED`; 0.70 `CONTRADICTS` choice) and were not committed as
relations. All six answers cited both Evidence spans, preserved both values,
and did not decide which value was correct; all six independent replays
matched. The run evidence and limitations are in
[`vp-finance-cross-source-product-verification-2026-09-29.md`](./vp-finance-cross-source-product-verification-2026-09-29.md).

This is a small candidate characterization, not a user-reviewed or independent
financial source set. In particular, conflict-relation recall is too unstable
to use these results for calibration or to close VP-04/05. The supplied PDF
was not re-ingested for these six Product runs.
