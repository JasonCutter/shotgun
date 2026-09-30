# VP DeepSeek 의미 관계 실측 — 2026-09-29

## 대상과 재현

- 기준 Product: `main@cca36a87b2fbe77a97453ff31ac558ba871d1828`, 정책 `vp-deepseek-relation-v2`.
- `tests/integration/vp-deepseek-live.integration.test.ts`의 고정 합성 문장 14쌍을 실제 Vault 자격 증명과 DeepSeek 제공자로 평가했다. 테스트는 DB의 설정을 읽지만 Source·VP 원장에는 쓰지 않는다.
- 실행: `VP_LIVE_DEEPSEEK=1`과 해당 DB의 `DATABASE_URL`, `SHOTGUN_CREDENTIAL_MASTER_KEY`를 환경에 넣고 `node node_modules/vitest/vitest.mjs run tests/integration/vp-deepseek-live.integration.test.ts --reporter=verbose`를 실행한다. 비밀값은 출력하지 않는다.
- 각 문장의 선택지·토큰·지연과 함께 전체 성공 건수, 입력/출력 토큰 합계, nearest-rank p50/p95 지연을 JSON으로 출력하도록 테스트를 보완했다.

## 실측 결과

| 반복                                 | 허용된 안전 분류 | 입력 토큰 | 출력 토큰 | p50 지연 | p95 지연 |
| ------------------------------------ | ---------------: | --------: | --------: | -------: | -------: |
| 기존 테스트 코드, MAIN               |            14/14 |     5,925 |       798 |   797 ms | 1,060 ms |
| 합계 출력 보완 후, 같은 Product 설정 |            14/14 |     5,925 |       830 |   838 ms | 1,079 ms |

대상은 동의·모순·조건·연도/대상/측정 차이·단위 변환·한영 관계·원문 속 지시문을 포함한다. 모델의 자체 확률은 관측 정확도나 Fact 신뢰도로 취급하지 않는다. `QUALIFIES`의 저장 의미가 미정인 경우와 낮은 신뢰도의 관계는 기존 VP 안전 계약대로 확정 사실로 승격하지 않는다.

## OSS Integration Decision과 한계

- DeepSeek는 이미 연결된 `DecisionProviderPort` 뒤의 일반 AI 제공자 경로를 재사용한다. 프로젝트 설정에서 고정한 모델과 기존 Vault 자격 증명만 사용하며 새로운 OSS SDK·DB 권위는 추가하지 않는다.
- [gbrain](https://github.com/garrytan/gbrain) (`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT)는 VP Job/Graph에 `REFERENCE_ONLY`다. 이 테스트의 판단 권위나 원장으로 도입하지 않는다. `open-source-role-matrix.md` 변경은 없다.
- Adapter 교체 경계는 `DecisionProviderPort`; 실패·비정상 출력은 관계 기록 없이 보수적으로 처리한다. 테스트 보완은 생산 코드·Schema·데이터를 바꾸지 않으므로 롤백은 테스트 변경을 되돌리는 것이다.
- 14개 합성 사례의 통과는 대표 Golden Corpus, 오류율 상한, 확률 calibration, 실제 청구 계정 대사, 다량 자료의 호출 수·총 지연, Jev 대비 benchmark를 입증하지 않는다. 품질과 신뢰성 기준은 VP-04/06에, 전체 비용 검증은 VP-05에 남는다.

## 2026-09-29 cache usage와 요금 기반 추정

The live test now records only DeepSeek response usage fields; it does not log
prompts, source text, or credentials. A new 14-case run returned 14/14 within
the allowed decision envelope and 8/8 exact labels. It used 5,925 input tokens
and 789 output tokens. DeepSeek reported 3,584 cache-hit input tokens and 2,341
cache-miss input tokens. Provider p50/p95 latency was 897/1,014 ms. The provider
reported model `deepseek-flash` at 2026-09-29 11:00:18 UTC; the current DeepSeek
docs identify this alias as DeepSeek-V4.1-Flash.

Using the official [DeepSeek pricing table](https://api-docs.deepseek.com/quick_start/pricing/)
for the off-peak rates at that timestamp ($0.003 per million cache-hit input
tokens, $0.15 per million cache-miss input tokens, and $0.60 per million output
tokens), the token-based price estimate for this run is **$0.000835302 USD**.
Applying that run's average per-pair estimate to 2,016 pairs gives **$0.1203**;
to the 6,216-pair theoretical upper bound for 112 assertions gives **$0.3709**.
Those workload projections assume the same prompt-cache ratio, model, output
size, and one attempt per pair. They are not measured end-to-end costs.

This is an estimate from provider-reported token/cache usage and the published
tariff, not a readback from the user's DeepSeek billing ledger. VP-05 still
requires billing-account reconciliation, a broader corpus, and retry-inclusive
cost measurement. The live call used synthetic data and did not mutate Shotgun
knowledge data.

## 2026-09-29 relation policy v3 and NPV branch Product flow

The relation prompt and production revision are now `vp-deepseek-relation-v3`.
It explicitly states that opposite outcomes under mutually exclusive NPV sign
conditions are `RELATED`, not contradictory. A live 16-case run returned
permitted choices for 16/16 cases and exact labels for 10/10 exact-label cases
(candidate labels, not reviewer-approved gold labels). It used 7,678 input and
965 output tokens; provider p50/p95 latency was 811/1,104 ms. The Korean NPV
case returned `RELATED` with selected probability 0.95 in that run. A separate
single-case run returned 0.75 for the same case, showing material run-to-run
variation in model-assigned probabilities.

The actual browser Product flow submitted both Korean NPV rules, wrote two
current assertions, asked the comparison question, received both rules with
two Evidence citations, and passed independent replay. In that run DeepSeek
selected `RELATED` at 0.89; the configured minimum is 0.90, so the relation
worker correctly kept the relation unresolved instead of writing a lower
confidence relation. No `CONTRADICTS` relation was recorded. The test accepts
either an above-threshold `RELATED` relation or this explicit safe abstention,
and requires the Ask answer and replay to succeed in both cases. It observed
four provider calls and 2,099 total tokens for the complete Product test.

The 0.90 threshold remains unchanged. This candidate corpus and its observed
probabilities are insufficient to calibrate a production confidence threshold;
reviewed multi-document finance labels, repeat measurements, and false
positive/abstention limits remain VP-04/05 work. The Product flow's successful
answer demonstrates retrieval from both current assertions, not that the
relation was always committed.

## 2026-09-29 finance relation candidate corpus

The new versioned finance relation fixture pairs short claim fragments from
the supplied PDF with test-authored companion claims. Each PDF fragment points
to a page and marker in the 20-marker PDF corpus; the companion claim IDs point
to `tests/fixtures/vp/finance-relation-companion.v1.md`. Both corpora remain
`CANDIDATE`. The test does not claim that the companion is a real independent
financial publication or an approved gold label set.

DeepSeek `deepseek-flash` evaluated all 14 pairs under policy
`vp-deepseek-relation-v3`: 14/14 were within the allowed label sets, including
10/10 exact candidate labels and 4/4 cautious envelopes. It used 7,017 input
and 857 output tokens; the provider reported 3,584 cache-hit input tokens, so
3,433 were cache misses. Provider p50/p95 latency was 795/1,086 ms. In this
run, both disjoint-branch pairs were classified `RELATED`; the NPV pair's
selected probability was 0.85, below the Product policy's 0.90 recording
threshold. The numeric conflict cases were classified `CONTRADICTS` with
their shared-example scope present; an unrelated-measure pair was `UNRESOLVED`.

At the official [DeepSeek pricing rates](https://api-docs.deepseek.com/quick_start/pricing/)
visible at the run time, 2026-09-29 14:18 UTC, the off-peak estimate for these
14 calls is **$0.001039902 USD**: 3,584 cache-hit input tokens at $0.003/M,
3,433 cache-miss input tokens at $0.15/M, and 857 output tokens at $0.60/M.
This calculation uses provider-reported token usage and the published tariff;
it is not a billing-ledger reconciliation.

This provider test invokes the decision Adapter directly and does not persist
these pairs to the VP ledger. It demonstrates a finance-focused smoke corpus,
not broad PDF extraction precision, production confidence calibration, a
real-second-document Product run, or the VP-05 large-queue cost. VP-04/05
remain open until domain-reviewed corpus labels, repeated runs, false-positive
limits, and product-level evidence pass.

## 2026-09-29 repeated finance cross-source Product flow

Three serial Chromium runs submitted two separate, test-authored Markdown
claims for the 200% current-ratio example. Each run used the configured
DeepSeek `deepseek-flash` model and relation policy `vp-deepseek-relation-v3`.
All three produced two current assertions from distinct Source IDs, recorded
`EQUIVALENT`, answered 200% with both Evidence citations, and passed independent
replay. The model-selected probabilities were 0.99, 1.00, and 0.99. Each run
made four provider calls and used 2,269, 2,303, and 2,397 tokens, respectively.

This repeat result demonstrates stable behavior for one narrow candidate pair;
it is not confidence calibration. The sources are test-authored and the test
does not ingest the full PDF or compare an independent publication. It does
not close VP-04/05. [Product test, command, provenance, and limits](./vp-finance-cross-source-product-verification-2026-09-29.md).

## 2026-09-29 same-scope finance conflict Product flow

Three serial Chromium runs submitted two test-authored sources that both name
the same current-ratio example, one claiming 200% and the other 150%. All three
answers contained both values, said that the sources disagreed, cited both
Evidence spans, declined to decide which value was correct, and passed
independent replay. Each run used four DeepSeek calls and 2,372, 2,291, and
2,320 total provider tokens.

The relation was stored as `CONTRADICTS` in one run at selected probability
0.98. The other runs selected `UNRESOLVED` at 0.50 and selected `CONTRADICTS`
at 0.70; both were below the configured 0.90 floor and safely left no current
relation. This is a material recall/consistency limitation, not a threshold
calibration. The sources remain test-authored, so the result is not an
independent finance benchmark and does not close VP-04/05. Full evidence and
reproduction are in the [Product verification report](./vp-finance-cross-source-product-verification-2026-09-29.md).

## 2026-10-01 finance relation candidate corpus v1.2

Corpus v1.2 narrowed two explicitly same-example numeric conflicts to strict
`CONTRADICTS` labels; the prior v1.1 corpus and its measurements remain
immutable. With policy `vp-deepseek-relation-v5`, two live DeepSeek
`deepseek-flash` runs each returned 14/14 decisions within the candidate label
sets and 13/13 exact candidate labels. Each run used 9,663 input tokens; outputs
were 1,044 and 1,015 tokens. Provider latency p50 was 924 ms in both runs and
p95 was 1,313 ms and 1,083 ms. The corpus remains `CANDIDATE`; these are model
repeat measurements, not independent adjudication, cost reconciliation, or a
calibrated quality estimate. See the [v1.2 revision report](./vp-finance-relation-label-revision-2026-10-01.md).
