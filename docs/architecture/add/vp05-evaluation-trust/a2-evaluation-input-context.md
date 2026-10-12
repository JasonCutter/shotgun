# VP-05 A2 — 평가 입력 문맥 및 provenance

- Section decision: **A2_CONDITIONALLY_ACCEPTED / A1_DEPENDENCY_CORRECTED / PUBLICATION_HOLD — 2026-10-12**
- Record identity: `VP05-EVAL-A2-20261012`
- Dependency: [A1 검증 책임 계약](./a1-reference-review-responsibility.md)의 후속 사용자 정정 적용. 사용자의 개별 Reference 검토·승인·reviewer 지정 의무 없음
- Subject: Canonical `main@cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`
- Publication: **LOCAL / PUBLICATION_HOLD**. reviewed merge 전 Canonical 아님
- New evaluations / provider calls / individual Reference approvals: **0 / 0 / 0**

## 1. 확정 결정 — 제품 문맥을 primary로, claim-only를 별도로

미래 제품 관계 품질 검토의 primary 입력 profile은 **`EC_RUNTIME_2000_V1`**로 결정한다. 현행 `DecisionProviderPort@1.2.0`과 실제 application relation worker의 인가된 claim 및 동일 EvidenceSpan context projection을 평가 범위로 삼는다. 자료 전체를 임의로 붙이거나 제품보다 더 많은 정보로 정답을 채점하지 않는다.

**`CLAIM_ONLY_V1`**는 claim만으로 비교 가능한 성능과 문맥 의존을 진단하는 secondary profile이다. 이를 primary 제품 성적으로 대신 보고하거나 두 profile의 분모/점수를 합치지 않는다. 같은 pair라도 profile/input digest가 다르면 별도 검토 task이며 정답 승인 역시 그 정확한 입력에 묶인다. 이번 결정은 실행 authorization, prompt/schema 변경 또는 A/B 실험 재개가 아니다.

| Profile            | 허용 모델 입력                                                                                                                         | 용도 / 제한                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| EC_RUNTIME_2000_V1 | 원래 좌우 claim + 실제 production projection의 동일 EvidenceSpan context(있으면 최대 2,000 Unicode code points) + 실제 truncation flag | 제품과 일치하는 입력 범위의 독립 reference 검토. context가 claim과 같아도 실제 projection대로 보존 |
| CLAIM_ONLY_V1      | 원래 좌우 claim, context null, truncation false                                                                                        | 별도 claim-only 진단. false는 전체 source 문맥이 완전하다는 뜻이 아님                              |

context 부재는 `null/undefined`의 실제 상태로 기록하며, primary profile에서 claim이 충분하면 그것만으로 판단할 수 있다. context를 확보하지 못했다는 이유로 제목·별도 span·외부 문서를 대신 끼우지 않는다. 접근 권위 실패와 의미상 문맥 부족은 별도 분류한다.

## 2. 실제 구현과 동일한 context 범위

근거는 [ADR-172 §11](../../adr/ADR-172-vp-autonomous-knowledge-authority.md), `modules/vp-decision/src/index.ts`, `adapters/vp-knowledge-postgres/src/relation-jobs.ts`, `adapters/vp-decision-general-ai/src/index.ts`다. packet은 다음을 보존한다.

1. Assertion에 이미 연결된 **동일 EvidenceSpan**만 사용한다. project, Source, SourceVersion, Evidence ID, access scope, sensitivity의 대응을 확인한다. 다른 프로젝트/버전/민감도의 원문을 context로 공급하지 않는다.
2. raw `quote.exact`와 provider에 실제 전달되는 context를 구분한다. 현행 SQL은 긴 quote에 대해 `strpos(claim)` 주변부터 최대 1,998 code points를 선택하고 앞뒤 `…`를 붙여 최대 2,000으로 만든다. 짧은 quote는 그대로 전달한다.
3. 앞뒤 생략표시는 **projection metadata 문자**이며 source 원문의 증거가 아니다. 선택한 source 구간, marker, 원래 quote 길이, truncation flag와 projector code identity를 별도로 기록한다. ellipsis까지 literal source substring이라고 주장하지 않는다.
4. claim 원문은 context crop과 별개로 보존한다. crop이 긴 claim이나 핵심 qualifier를 모두 담는다고 가정하지 않는다. 필요 요소가 crop 밖이면 입력 부족 판단에 반영한다. qualifier/괄호/부정/조건/단위를 삭제해 "복구"하지 않는다.
5. evaluator가 claim 위치가 더 좋게 보이도록 crop을 다시 고르거나 추가 문장을 전달하지 않는다. runtime projection defect를 발견하면 해당 input을 승인하지 않고 명시적 issue로 남긴다. 이번 문서에서 구현을 고치거나 외부 호출을 해보지 않는다.

모델에 공급하지 않은 전체 원문·제목·formula·다른 EvidenceSpan은 reviewer가 **누락 원인과 source provenance를 확인하는 자료**로만 볼 수 있다. 거기서 가져온 정보를 해당 입력의 정답 근거로 몰래 쓰지 않는다. 같은 span에 포함된 heading이라도 실제 crop에 없는 경우 미전달 정보다.

정규화는 검사·비교를 위한 별도 view로만 한다. Unicode/NFC/공백·표기 해석을 하더라도 실제 wire text와 source quote를 보존하고 원문/digest를 바꾸지 않는다. 새로운 normalizer, full-document retrieval, translator 또는 schema는 도입하지 않는다.

## 3. 외부 전제의 결정

**입력에 없는 경험적·분야 사실은 gold warrant로 사용하지 않는다.** 기본 언어 의미와 제한된 형식적 계산은 문장 해석 규칙이며, 새로운 사실 공급과 구별한다. reviewer는 자신의 전문지식을 누락 전제 탐지에 사용할 수 있지만 모델에게 주지 않은 전제를 채워 정답을 강제할 수 없다.

| 전제           | 허용 범위                                                                                                 | 제외 범위                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 언어·표기      | 통상 문법, 명시 부정/조건/수량사의 의미, 입력 한국어/영어의 동의 표현. 해석에 이견이면 A1 review에서 기록 | 숨은 대상·시간·독점성 추정, "평일"을 "평일에만"으로 바꾸기                                 |
| 산술·유한 논리 | 입력의 명시 값/명제에 대한 사칙연산·단위 일치·조건 포함 관계. 사용한 rule과 유도 과정을 packet에 기록     | 주어지지 않은 변수 고정, 시간/대상 동일성 가정, 경험적 인과 관계 또는 새 법칙              |
| 정확 단위 표기 | 예: km→m의 SI 접두어 1,000 배처럼 정확한 표현 규칙. scalar와 단위 mapping을 명시                          | 환율·물가·금리·시장값·관례적 기간 가정 또는 추정값                                         |
| 분야 전제      | supplied authorized claim/context에 이미 명시된 전제만 사용                                               | IRR 주어/제목, PV 공식과 고정 cash flow/기간, 광전효과 법칙, RFC/법령 조건을 외부에서 추가 |
| 평가 정책      | 명시한 target revision의 관계 종류·방향 규약을 동일하게 적용                                              | evaluator가 더 엄격한 v11/SSC 규약을 v6 입력에 조용히 강제                                 |

이 최소 형식 해석 규칙은 `Use no outside facts`의 경험적 전제 금지를 유지한다. 단위·논리 해석 자체가 논쟁적이면 승인된 assumption/rule의 범위를 명시하거나 해당 case를 분쟁으로 둔다. 도메인 공식을 실제 입력에 넣으려면 기존 동일 EvidenceSpan projection 안에 있어야 한다. 그 밖의 확대는 이번 계약에 포함되지 않는다.

## 4. input provenance의 최소 요건

새 검사 packet은 아래를 버전과 함께 보존해야 한다. 이는 기존 test-artifact fields의 결정이며 새로운 운영 원장이 아니다.

- source/SourceVersion/Evidence identity와 원문 SHA, synthetic ID인지 실제 인가된 제품 ID인지, assertion/claim 원문과 정렬된 좌우.
- 프로젝트·principal/access scope·sensitivity·egress 판정의 필요한 비밀이 아닌 provenance. 다른 사람의 민감한 source를 리뷰 승인으로 공개하지 않음.
- profile, 실제 context/crop/marker/truncation, raw quote hash와 code-point 범위, projector code SHA 및 applicable adapter/Port version.
- target policy revision, closed taxonomy, prompt/schema/adapter/model identity와 token/transport parameters. main v6와 로컬 v11 baseline을 구분.
- input bundle digest(IDs·범위·scope·text 포함), adapter의 semantic request digest, StructuredGenerationRequest payload digest, 실제 HTTP request body digest/안전한 원문(보존 가능하면). 서로 다른 표현의 digest를 같은 것으로 취급하지 않음.
- human reference/tuple/warrant revision·digest, validator/source-bound 검사 결과, 의미상 부족/구조 오류/접근 실패/UNKNOWN을 구별한 기록.

현재 main 일반 AI의 **wire user payload에는 claim/context/truncation만** 포함된다. ID/권한/실행 identity는 adapter의 semantic digest와 별도 provenance에 들어간다. 모든 provenance 필드를 모델이 읽었다고 주장하지 않는다. request body를 보존할 때 credential/header/secret을 포함하지 않는다.

검증 강도는 `ACTUAL_WIRE_CAPTURED`, `STRUCTURED_REQUEST_CAPTURED`, `FROZEN_RECONSTRUCTION_MATCHES_DIGEST`, `UNVERIFIED`로 구분해서 보고한다. future product-input 인증에는 실제 app 경로의 captured structured request와 보호된 identity 연결이 필요하다. 실제 HTTP wire 증거가 없으면 transport 전달은 별도 미검증으로 남긴다. 테스트에 wire가 없다는 이유로 live call을 실행하거나 부족한 과거 기록을 새 기록으로 치환하지 않는다.

기존 432회는 frozen reconstruction/digest로 input을 대조했고 B 12회는 실제 wire가 있다. 이 차이를 유지한다. annotation hash로 만든 A/B SourceVersion은 실제 제품의 current-version 인가 검증 증거가 아니다. 기존 432/12를 새 EC profile의 결과로 이관하지 않는다.

## 5. 문맥 부족 및 미평가 처리

| 상황                                                                     | 결정                                                                | 점수/승인 경계                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 전달 입력과 허용 형식 규칙으로 충분                                      | 보정 A1의 외부 적격 인간/동등 reference 검증 provenance 확인        | 확인된 범위의 tuple/reference만 인증 측정 후보. 사용자 review/승인 요구 없음                                         |
| 제목/조건/대상/formula/인과 bridge가 없음 또는 crop 밖                   | `CONTEXT_INSUFFICIENT`와 누락 요소·위치를 기록                      | 기존 positive label을 강제하지 않음. 충분 입력의 positive/negative certification 분모에서 제외하고 제외 수/비율 공개 |
| 입력 부족 자체의 외부 독립 인간 검증 또는 동등 reference provenance 확인 | 별도 insufficient-input/abstention diagnostic reference로 기록 가능 | 현재 target API가 지원하는 UNRESOLVED 및 불확실성 표시에 관한 검토. positive miss로 자동 처리하지 않음               |
| 여러 타당한 해석                                                         | 각 warrant와 승인 범위를 기록                                       | 자동 단일 label 또는 AI 다수결 금지. A3 taxonomy/metric 미결정 보존                                                  |
| source/hash/version/context 재구성 불일치                                | `INPUT_PROVENANCE_INVALID`                                          | 의미 채점 중단, 모델 오판으로 합산하지 않음                                                                          |
| 인가/DB 권위 조회 실패, evidence 접근 불가                               | `AUTHORITY_OR_ACCESS_FAILURE`                                       | 다른 근거로 우회하지 않고 실행·보안 문제로 분리. NO_RELATION/semantic abstention 성공으로 위장하지 않음              |
| provider 결과/commit 불명                                                | 기존 OUTCOME_UNKNOWN 증거 유지                                      | 자동 재호출·새 input 재구성으로 결과 교체 금지                                                                       |

분모 제외는 사례를 삭제하는 것이 아니다. 원래 제출 수, 적격 수, 제외·분쟁·부족·invalid/runtime 수와 이유를 함께 보존한다. missing context를 정답처럼 채워 넣는 것도, 모든 어려운 사례를 숨겨 점수를 높이는 것도 허용하지 않는다. 구체적인 metric 공식·threshold·실행 표본은 A2로 확정하지 않는다.

### 현재 정책과의 중요한 호환성

Canonical main v6의 `VP_RELATION_CHOICES`는 **EQUIVALENT/SUPPORTS/QUALIFIES/CONTRADICTS/RELATED/UNRESOLVED 6종**이다. 보존 로컬 v11은 NO_RELATION을 포함하는 7종이며 RELATED의 의미도 더 제한적이다. A2는 두 정책을 통합·활성화하거나 v6 출력에 없는 NO_RELATION을 요구하지 않는다. "관계 미채택", "모델의 UNRESOLVED", "NO_RELATION이라는 별도 의미 선언"을 같은 것으로 세지 않는다. 관계 종류·복수 tuple·absence metric의 호환성은 별도 A3 결정 사항으로 남긴다.

## 6. 근거·제외 대안·영향

Phase A에서 IRR/현재가치 2쌍의 evaluator-only 문맥과 432 claim-only vs B wire의 증명 강도 차이를 확인했다. 실제 제품의 context Port를 primary로 정하면 evaluator-only 정보 유입과 구현보다 넓은 입력 비교를 방지하면서 제품 질문과의 연결을 유지할 수 있다. claim-only를 별도 남겨 문맥 의존을 가리는 것도 피한다.

| 제외 대안                                              | 이유                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| claim-only를 유일한 제품 품질 기준으로 고정            | 실제 context 지원 경로와 다르고 알려진 누락 전제를 모델 오류로 혼합 |
| 항상 전체 문서/여러 EvidenceSpan/웹 문맥 추가          | ADR-172의 인가된 동일 EvidenceSpan 범위와 입력 동등성 위반          |
| 좋은 정답을 얻을 때까지 crop/질문을 재작성             | frozen 입력과 승인 대상의 정합성 훼손, tuning/새 실험               |
| reviewer 전문지식으로 부족 조건을 암묵 보완            | 모델과 evaluator의 정보 비대칭                                      |
| A/B annotation hash를 제품 SourceVersion 인증으로 간주 | synthetic identity와 실제 권위/접근 확인은 다른 증거                |
| 6종 v6를 조용히 7종 v11 기준으로 평가                  | policy/profile 불일치, 의미 정책 변경의 우회                        |

영향은 미래 평가 input profile과 human reference의 판정 범위에 한정한다. 실제 source 선택·context SQL·prompt/schema·model·confidence gate·Source/Evidence/권한·Ledger·budget/실행 authority는 변경하지 않는다. A1과 ADR-098/172/173의 인간 검증/제품 경계를 보완하며 상위 정책을 대체하지 않는다.

미결사항은 taxonomy/metric(A3 이후), 대표 집합의 외부 독립 검증 provenance와 critical/question obligations, 미래 실행/게시 허가다. 증거 확보·분류 운영은 상위 에이전트가 담당하고 사용자에게 reviewer 지정/Reference 검토·승인을 요구하지 않는다. 기존 profile 선택·외부 전제·부족 처리 기준을 유지하며 새로운 문맥 권위를 도입하지 않는다.

## 7. 변경 이력

- 2026-10-12: A1 확정 후 A2를 결정. 기존 2,000 code-point 동일 EvidenceSpan Port/projection을 primary 기준으로 재사용, claim-only 분리. runtime ellipsis와 raw quote의 차이, provenance 강도 및 현재 v6 6종/로컬 v11 7종 차이를 명시. 어떤 과거 label/점수도 재작성하지 않음.
- 2026-10-12, 후속 사용자 정정: A2 조건부 수용과 publication HOLD를 기록하고 A1 종속 검증 주체 표현만 정합화. EvidenceSpan primary, claim-only 분리, 외부 전제·실제 input provenance·v6/v11·문맥 부족 처리 계약은 그대로 유지.
