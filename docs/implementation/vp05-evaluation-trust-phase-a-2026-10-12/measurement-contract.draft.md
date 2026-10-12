# VP-05 정답 및 측정 계약 — 검토 초안

> **DRAFT / USER_APPROVAL_REQUIRED / NOT_CANONICAL_EVALUATION_AUTHORITY**
>
> 현행 종류·v6/v11·0.9·Ledger 의미와 frozen 결과를 변경하지 않는다. 모델 출력 schema나 runtime validator 구현 제안이 아니라 미래 평가의 정답·측정 계약 후보다.

## 1. 평가 단위와 reference packet

단위는 하나의 순서 있는 claim 쌍과 **정확히 제공할 입력 bundle**이다. claim-only와 같은 EvidenceSpan 문맥 포함 task는 다른 입력 revision이다. 같은 쌍의 반복 run은 독립 case가 아니다. 모델에는 정답 tuple/검토 rationale/이전 결과를 전달하지 않는다.

각 reference packet에 다음을 고정한다.

- case/version, source content SHA, Source/SourceVersion/Evidence identity 또는 synthetic identity임을 명시.
- 정확한 claim·인가된 context·Unicode 범위·truncation·순서·보안 scope, input/projection digest.
- 평가자가 알고 있는 전체 원문과 모델에게 제공한 부분의 차이, 허용하는 단위/논리/분야 전제와 그 출처.
- 승인 상태/작성자/독립 검토자/승인자/시점/승인 대상 digest, 미해결 쟁점과 판정 가능 범위.
- 서로 결합된 허용 `kind, direction, evidence obligations, warrant, assumptions` tuple들. 각 tuple이 왜 성립하는지 설명하고 반대 해석도 보존.
- critical 지정 이유와 제품 질문·유해 오류·필요한 답변/인용 obligations. Critical을 모델 결과 관측 후 유리하게 선택하지 않음.

검토 상태와 채점 적격성은 별도다. `VERIFIED`라는 문자열을 쓰는 것만으로 승인 증거가 되지 않는다. 문맥 부족, 분쟁, 구조 불능은 개수/원인을 보고하며 certified kind/direction의 분모에서 제외한다. 제외 비율을 숨기지 않는다. 명확한 insufficient-input case를 검토자가 승인한 경우에는 abstention 진단 subset으로 사용할 수 있다.

## 2. 현행 7종 의미를 평가할 때의 후보 검토 계약

| 종류        | 검토해야 하는 의미                                                       | 방향/전제                                                                                  | 결정적 확인과 의미 검토의 경계                                                  |
| ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| EQUIVALENT  | 동일 대상·속성·시점·조건·범위에서 같은 명제                              | NONE; approved unit/notation equivalence를 명시                                            | 단위/명시 값 검사 가능. co-reference·누락 조건 동일성은 의미 검토               |
| SUPPORTS    | premise/cause/prerequisite/example가 conclusion/general claim을 지지     | premise/instance → conclusion/general. cause와 normative justification warrant를 각각 기록 | 역할 선언으로 방향 산출 가능; 역할의 의미적 정당성은 별도 승인                  |
| QUALIFIES   | narrower condition/exception/eligibility/scope가 다른 명제의 적용을 제한 | qualifier → qualified broader assertion                                                    | 텍스트에 조건이 있는지는 검사 가능; subset mention이 restriction인지 사람 검토  |
| CONTRADICTS | 동일 대상·속성 및 겹치는 시점/조건에서 양립 불가능                       | NONE                                                                                       | exact 수치/명시 부정 비교 가능; 대상/조건 동일성 및 암묵 전제는 별도 검토       |
| RELATED     | 다른 네 positive가 성립하지 않으면서 직접 연결되는 명제/메커니즘/결과    | NONE; shared domain/document만으로 승인하지 않음                                           | bridge 존재/offset은 확인 가능; 그 bridge의 타당성은 의미 판단                  |
| NO_RELATION | 주어진 충분한 입력·허용 전제에서 supported direct connection 부재를 판정 | NONE; 현실 전체의 무관함을 선언하는 것이 아님                                              | 검색 실패/권한 거부/형식 실패를 이 label로 대체하지 않음                        |
| UNRESOLVED  | 입력 부족/해석 미결로 final relation 선택 불가                           | NONE                                                                                       | 자발적 semantic abstention과 시스템의 parse/gate/runtime unresolved를 별도 기록 |

기존 `NONE` negative alias, `UNDIRECTED/BIDIRECTIONAL` annotation alias의 이력은 유지한다. 새 reference의 명확한 tuple 표현은 prospective approval 이후에만 적용한다. 기존 실험 alias를 지금 정규화·재채점하지 않는다.

대안 tuple은 OR다. 하나의 승인된 tuple/warrant를 만족하면 정답 1건이다. `allowedKinds × allowedDirections`의 무조건 Cartesian product는 사용하지 않는다. 모든 대안을 동시 출력해야 하는 새 multi-label 모델 계약으로 전환하지 않는다.

## 3. 기호와 layer 분리

`V`: 승인되고 해당 입력으로 채점 가능한 case-run. `R`: V 중 positive reference가 있는 항목. `T`: 구조-valid 단일 raw semantic declaration. `Q`: T 중 positive declaration. `A`: V 중 실제 채택된 positive. `G`: kind와 승인된 evidence/warrant 조건 일치. `D`: 방향까지 승인 tuple 일치. `C`: 사전에 critical로 승인한 R.

raw 의미 층과 production adoption 층을 별도 집계한다. 예를 들어 raw 정답이 낮은 선택 확률로 withheld될 수 있으며, raw 오답이 gate로 차단될 수 있다. 시스템이 파싱 실패를 UNRESOLVED로 저장해도 model의 자발적 abstention으로 세지 않는다. Raw evidence/warrant가 출력/기록되지 않아 판정할 수 없으면 evidence accuracy는 N/A이며 kind-only 결과와 구분한다.

## 4. 지표의 정확한 분자·분모

| 지표                              | 분자                                                                   | 분모 / N/A 조건                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Reference certification coverage  | 승인+입력 적격 case 수                                                 | 제출 case 수. candidate/분쟁/문맥 부족/불능 각각 병기                                                                   |
| Raw full-tuple positive precision | Q 중 G와 D 충족 수                                                     | Q 수; 0→N/A                                                                                                             |
| Raw full-tuple positive recall    | R 중 raw positive이며 G와 D 충족 수                                    | R 수; 0→N/A. 승인된 R의 abstention/invalid/runtime 미응답은 미검출로 남김                                               |
| Raw positive F1                   | 2TP                                                                    | 2TP+FP+FN; 0→N/A. 잘못된 positive kind/direction은 FP 1과 해당 reference FN 1을 동시에 발생시킴                         |
| Raw kind correctness (선택적)     | T의 종류가 승인 tuple 중 하나의 종류와 일치                            | T 수; 구조-invalid를 정답으로 세지 않으며 T/전체 V coverage 병기                                                        |
| Adoption full-tuple precision     | A 중 G와 D 충족 수                                                     | A 수; 0→N/A                                                                                                             |
| Adoption positive recall / F1     | R 중 채택 positive이며 G와 D 충족 수 / 위 F1 식                        | R / 2TP+FP+FN. raw 정확도와 별도                                                                                        |
| Critical adoption recall          | C 중 채택 positive이며 G와 D 충족 수                                   | C 수; 0→N/A. raw critical recall도 별도                                                                                 |
| 조건부 채택 방향 정확도           | 아래 분모 중 D 충족 수                                                 | A 중 **SUPPORTS/QUALIFIES이며 kind와 evidence/warrant가 정답 조건에 맞는** 수. 방향 맞음은 분모 조건에 넣지 않음. 0→N/A |
| Raw 조건부 방향 정확도 (별도)     | raw directed G 중 D 충족 수                                            | raw directed G 수; 0→N/A. 채택 방향과 혼용하지 않음                                                                     |
| Positive→NO_RELATION 오류         | R에서 raw NO_RELATION 수                                               | R 수; 0→N/A                                                                                                             |
| Negative false-link rate          | NO_RELATION-only 승인 reference에서 raw positive / adopted positive    | 해당 negative reference 수; 두 층 별도, 0→N/A                                                                           |
| Explicit negative correctness     | negative reference에서 구조-valid raw NO_RELATION 수                   | negative reference 수; UNRESOLVED/invalid를 TN으로 대체하지 않음                                                        |
| Model abstention rate             | 구조-valid 원본 선언 UNRESOLVED 수                                     | provider 응답을 받은 scheduled 항목 수; 0→N/A, invalid도 분모 유지. T 기준 비율은 별도 이름                             |
| Abstention appropriateness        | 독립 승인 insufficient-input subset에서 UNRESOLVED 수                  | 해당 subset 수; 0→N/A. 충분한 입력 positive/negative의 불필요한 abstention 별도                                         |
| Structure parse/schema validity   | 각각 성공한 output 수                                                  | 응답 받은 output 수; 0→N/A. downstream predicate evaluated/passed/failed/not-evaluated 각각 보고                        |
| Critical Evidence coverage        | 반환 evidence가 승인 obligation을 실제로 만족한 수                     | evidence 평가 가능 선언 수; 0→N/A. offset 존재와 의미 충족을 구분                                                       |
| Gate retention / rejection        | eligible / probability·usage·structure·extra guard별 거부 수           | 해당 gate 도달 항목 수, 전체 scheduled 대비 비율도 병기. 첫 거부와 중복 predicate 거부 분리                             |
| Raw 3-run tuple stability         | raw kind/direction이 3회 모두 같은 case 수                             | 예정 3회가 모두 terminal이고 raw 구조-valid인 case 수; 0→N/A. raw-complete case/전체 예정 case coverage 병기            |
| Strict all-run stability          | 3회 모두 구조-valid이며 동일 raw tuple인 case 수                       | 3회 반복을 예정한 모든 case 수; 미완료/invalid는 안정 통과로 세지 않음                                                  |
| Adoption-state stability          | 3회 채택 여부와 채택 tuple/거부 reason이 같은 case 수                  | 3회 terminal complete case 수; 0→N/A. Ledger publication을 관측하지 않았으면 publication stability로 부르지 않음        |
| Runtime completion / UNKNOWN      | terminal 정상 결과 / OUTCOME_UNKNOWN 수                                | 예정/egress execution 수를 각각 명시; 의미 지표와 별도                                                                  |
| Product answer success            | 모든 critical answer/citation obligation 및 안전 조건을 만족한 질문 수 | 승인된 평가 질문 수; 0→N/A. 성공 중 각 단계와 접근·version fail도 분리                                                  |

혼합 positive/UNRESOLVED reference는 기본 P/R 모집단에 넣을지 자동 결정하지 않는다. 승인자가 입력 판정 가능성에 따라 적격 positive 또는 ambiguity diagnostic으로 지정한다. 그 결정과 제외율은 실험 전에 고정한다. 방향이나 kind가 없는 historic raw output에 새 witness를 AI로 채워 넣지 않는다.

Confidence는 full-tuple correctness의 자기보고와 selected-label probability를 분리한다. 보정 진단 후보는 사전 정의 bins의 평균 확률 vs 독립 승인 정확도, bin counts, Brier/ECE와 risk/coverage다. 반복 run을 독립 표본으로 취급하지 않으며 불확실성은 case/source 단위 clustering을 고려한다. 18개 diagnostic은 보정 threshold나 높은 모집단 신뢰도 인증에 부족하다. 승인 전 구현·새 실험·0.9 조정은 하지 않는다.

## 5. 제품 실패 귀속

Source → extraction → authorized frontier/relationship → search shortlist → answer generation → publication/read freshness의 증거를 이어 기록한다. AnswerRun/citation은 활성 SourceVersion·Evidence·scope와 연결한다. relation decision이 없어도 정확한 source-grounded 답변이 나올 수 있고, relation 정답이어도 검색/답변이 틀릴 수 있으므로 직접 영향 trace 없이 인과를 단정하지 않는다.

제품 질문마다 A-only, A+B, A수정 후, 과거 AnswerRun, 조건/충돌/부족·WAITING·실패·권한 negative obligations를 승인한다. 관계 macro score로 최신성·보안·인용·답변 정확도를 대체하지 않는다. runtime unknown은 NO_RELATION도 semantic abstention도 아니다.

## 6. 최소 채택 경계와 검증할 반례

실제 향후 구현은 기존 test-artifact/digest/Unicode/ratio 도구를 재사용하는 방향이다. SourceVersion/Evidence 접근 권위, Ledger, global budget, credential/claim/attempt, Ask state를 새 평가 저장소가 대체하지 않는다. 승인 기록은 평가 artifact이며 제품 지식 승인 체계를 새로 넣지 않는다.

다음 합성 contract 반례를 승인 후 metric 구현의 검사 대상으로 제안한다.

- approved directed reference, disallowed undirected prediction → 조건부 방향 분모 0/N/A, full-tuple FP+FN.
- wrong direction인 correct-kind/evidence adopted directed → 방향 분모 1, 분자 0.
- suppressed raw 종류 3회 변동 → raw 안정 FAIL, adoption 안정은 별도 관측.
- positive raw 정답이 gate 거부 → raw TP, adoption FN; 모델 의미 오류로 합산하지 않음.
- approved alternatives에서 유효 tuple 하나 → TP 1, 모든 label을 출력하도록 요구하지 않음.
- invalid, UNKNOWN, missing response, voluntary UNRESOLVED → 서로 다른 disposition/coverage, silent TN 없음.
- 미승인 candidate/문맥 부족 → 인증 점수 제외와 제외 사유/비율을 공개; 0분모는 N/A.

이번에는 이 새 metric 구현이나 기존 결과 적용을 하지 않았다. [감사 보고](./report.md)와 [대표 집합 초안](./representative-set.draft.md)을 함께 검토한다.
