# VP-05 실행·비용 측정 prospective 계약

- Version: `VP05_EXECUTION_ACCOUNTING_0.1`
- Scope: private `packages/vp-relation-evaluation/src/accounting.ts`의 순수 오프라인 reconciliation helper
- New provider/network/DB calls, historical 72/432/B12 output reads, new certified Gold: **0 / 0 / 0 / 0**
- Authority: 기존 global claim/provider-call/attempt provenance의 향후 보고 계약. 새로운 원장·runtime·가격표·생산 Gate가 아님

## 1. 입력과 실행 정합성

`AccountingClaim`은 global claim/store/authority/UTC day에 task/job/semanticAttempt/executionKey/input digest/provider/model identity를 결합한다. `AccountingCall`은 해당 claim에 실제 durable call ID와 response ID, outcome, decision disposition, reported tokens, 필요한 measured adapter duration을 연결한다. duplicate claim, 동일 job/semanticAttempt의 두 claim, 한 claim의 두 call, call/claim identity mismatch, 동일 authority/provider response의 두 attribution은 거부한다. 같은 의미 attempt를 다른 executionKey로 표현해 중복 claim을 숨길 수 없다.

성공·실패·schema-invalid·withheld·OUTCOME_UNKNOWN은 모두 관측한 provider egress population에 남긴다. 실제 successful output이 원장에 채택되지 않았다고 유료 실행을 제외하지 않는다. `RELEASED_UNUSED`와 `RESERVED`, 인가 후 아직 호출 전인 `AUTHORIZED_NOT_STARTED`는 따로 보고한다. reserved/released claim에 provider call을 붙이면 오류다.

global state가 PROVIDER_SUCCEEDED/FAILED지만 call row가 없으면 **known egress + call record missing**이다. EXECUTION_AUTHORIZED만 있고 call record가 없으면 **possible UNKNOWN egress**로 별도 보고하며 호출 0 또는 성공을 추정하지 않는다. 이 경우 추가 provider 실행·자동 retry를 지시하지 않는다. helper는 actual reconciliation을 수행하지 않고 supplied observation의 일관성과 누락을 보여준다.

## 2. 토큰·latency·청구 분모

| 항목                        | 정의                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| known egress                | 관측 SUCCEEDED/FAILED/OUTCOME_UNKNOWN call 및 finalized provider claim에서 call record가 없는 실행                                                                   |
| input/output token coverage | 각 토큰 값이 실제 제공된 call 수 / known egress. null·부분 값·missing call은 coverage 부족으로 남김                                                                  |
| reported token sum          | 확인된 비음수 safe integer만 합산. 값 0은 관측 0이며 null과 다름. 아무 값이 없으면 N/A, 누락을 0 token으로 채우지 않음                                               |
| adapter duration            | **ADAPTER_INVOKE_TO_RESPONSE_OR_THROW** boundary의 계측 revision·observation digest·milliseconds. client adapter 경과 시간이며 서버 내부 추론 시간이라는 주장이 아님 |
| latency coverage / p50·p95  | duration을 가진 completed success/failure call 수 / known egress. quantile은 정렬 후 `ceil(q*n)`번째 NEAREST_RANK. 관측 duration 0건이면 N/A                         |
| invoice coverage            | matching billing provenance를 가진 attributed call 수 / known egress. possible UNKNOWN은 별도 counts이며 숨겨 전체 실행의 100% 청구 대사라고 하지 않음               |

reservation 생성→settle까지의 dwell, worker lease 시간, job 생성→완료 시간 또는 claim timestamp를 provider latency로 대체하지 않는다. 그런 값은 별도 queue/generation 지표다. trace/duration이 없으면 N/A다. 가격표·토큰당 환산·cache/peak/offpeak 추정치를 넣지 않는다.

invoice line은 invoice/line identity·call/claim·provider/model·**동일 provider response ID**·record locator/digest·확인 주체가 대응해야 한다. 중복 line 또는 한 call에 중복 청구 attribution은 거부한다. 여러 line/component 청구를 한 call에 연결하려면 billing 원본의 명시적인 검증된 consolidation artifact가 먼저 필요하며 자동 합치지 않는다.

금액은 비음수 정확 decimal 문자열로 받아 BigInt scale로 합산한다. currency별 subtotal을 별도 유지하고 환율을 적용하지 않는다. `totalPaidCost`는 known egress 전체가 정확히 attribution되고 possible UNKNOWN이 없으며 currency가 하나일 때만 공급된 line 범위의 합계를 반환한다. 그 외에는 null(N/A)이며 partial matched invoice subtotal만 명시한다. refund/negative amount 또는 attributed provider response를 공급할 수 없는 invoice는 이 0.1 계약 밖이며 자동 양수 비용으로 바꾸지 않는다.

## 3. provenance의 검증 수준과 통합

helper가 invoice/latency record의 진위, 실제 결제 또는 실제 clock 관측을 독립적으로 인증하지 않는다. artifact digest와 identity 일치는 **공급된 증거의 구조 정합성**이다. `checkedBy` 문자열·기관 이름·AI 판단만으로 실청구 대사를 완료했다고 주장할 수 없다. 최종 보고는 실제 authority/provider/billing 자료의 확인 범위와 보호된 evidence locator를 함께 제출해야 한다.

운영 global authority를 이 package가 조회하거나 다른 counter로 대체하지 않는다. 향후 승인된 capture 경로가 non-secret immutable observation bundle을 제공하면 helper를 호출할 수 있다. 기존 receipt-only 합계는 withheld/invalid/failed/UNKNOWN 비용을 빠뜨릴 수 있으므로 global execution evidence와 actual call trace를 함께 사용한다. 과거 frozen output을 읽어 새 점수/비용을 만들거나 역사 결과를 다른 experiment로 이관하지 않는다.

기존 `quality-evaluation.ratio`의 분모 0→null과 `relationArtifactDigest`를 재사용했다. 새 dependency·pricing library·billing service·reviewer DB·production authority는 없다. 기존 runtime accounting을 교체하지 않는 작은 offline helper다. rollback은 helper/호출부를 제거하는 것이며 migration이 없다.

## 4. 검증 결과와 한계

synthetic unit **8 PASS**, 기존 A3 synthetic **24 PASS**, 함께 **32 PASS**. Package-only typecheck와 소유 파일 ESLint PASS. duplicate execution, wrong claim/call/response binding, released claim에 대한 egress, UNKNOWN/missing coverage, pre-egress invented usage, adapter boundary, exact decimal 0.10+0.20=0.30, mixed currency·partial invoice N/A를 검증했다.

invoice fixture는 `SYNTHETIC-NOT-A-REAL-INVOICE`로 명시하며 실제 청구 인증이 아니다. 이번 구현으로 실제 provider usage·latency·billing Gate를 통과했다고 주장하지 않는다. 해당 실제 증거가 없는 현재 paid cost와 실제 provider latency는 **N/A**다. no-Gold 품질 인증과 기존 Gate의 미완료 조건을 비용 helper 통과로 완화하지 않는다.
