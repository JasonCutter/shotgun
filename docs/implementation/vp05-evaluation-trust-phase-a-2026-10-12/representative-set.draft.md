# VP-05 대표 평가 집합 및 승인 절차 후보

> **DRAFT / NOT_APPROVED_GOLD / NO_EXECUTION_AUTHORIZATION**
>
> 기존 exposed 72쌍에서 18개를 검토 대상으로 지정한다. 기존 원본·membership·label·432/12 결과는 변경하지 않는다. 아래는 정답이 아니라 검토할 역할/제품 질문이다.

## 1. 선정 범위

12개 core와 6개 쟁점을 나누어 형식·안전 경계·기본 의미와 어려운 taxonomy 선택을 혼동하지 않도록 한다. 이 편의 표본은 모집단 오류율, calibration 또는 blind acceptance를 인증하지 않는다. 중복 claim ID가 있는 서로 다른 case도 task identity로 구분한다. 실제 모델 비교 집합은 승인 후 별도 reference revision으로 정의해야 하며 기존 outcome을 옮기지 않는다.

| 그룹    | 기존 pair ID                            | 독립 검토 목적 / 대표 제품 질문                                                             |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Core 1  | english-equivalent                      | paraphrase, 같은 archive count; A와 B가 같은 내용을 말하는가?                               |
| Core 2  | korean-equivalent                       | 한국어 entity/year/value 동일; 서울 지점의 해당 연도 매출은?                                |
| Core 3  | cross-language-equivalent               | 번역, 시간 표현; 창고 마감 시간의 두 자료는 같은가?                                         |
| Core 4  | unit-conversion                         | 1km/1000m의 허용 단위 전제; 길이가 다른가?                                                  |
| Core 5  | english-contradiction                   | 동일 archive exact 42/43, nondirected; 자료 간 수치 차이를 어떻게 인용하는가?               |
| Core 6  | explicit-negation                       | 같은 backup의 암호화/비암호화; 양쪽 근거와 충돌 표시                                        |
| Core 7  | complementary-npv-condition-branches-ko | 조건 분리; 서로 다른 부호 조건을 모순으로 합치지 않는가?                                    |
| Core 8  | finance-profit-cash-coexistence         | instance→rule support 방향; 사례는 어떤 주장을 뒷받침하는가?                                |
| Core 9  | rel-d1-joint-qualifies                  | 적격 조건과 보호 한도; 누구에게 한도가 적용되는가?                                          |
| Core 10 | rel-d3-quantity-quality-availability    | 공통 outcome에 대한 다른 determinant; 가용성을 결정하는 두 요인은?                          |
| Core 11 | unrelated-topics                        | 단순 domain/주제 비연결과 부족 구별; 이 둘의 직접 연결 근거가 있는가? 기존 정답도 검토 필요 |
| Core 12 | prompt-injection-in-source              | untrusted 지시와 주장 분리; limit 값을 비교할 때 지시를 따르지 않는가?                      |
| 쟁점 1  | condition-sensitive                     | weekdays subset vs exception, 방향/서로 다른 warrant                                        |
| 쟁점 2  | numeric-scope-qualifier                 | exactly/at least, 함의·적용 제한·topic 관련 구별                                            |
| 쟁점 3  | rel-d2-timewait-duplicate-derivation    | causal consequence vs normative justification의 허용 방향                                   |
| 쟁점 4  | finance-irr-definition                  | 실제 제공 제목/주어 없음, claim-only의 UNRESOLVED 가능성                                    |
| 쟁점 5  | finance-discount-rate-present-value     | 고정 현금흐름·기간/공식 전달 범위, 입력 조건에 따른 판정 가능성                             |
| 쟁점 6  | rel-d1-fixed-rate-variable-amount       | rate/amount 구별, RELATED/QUALIFIES/모순 규약                                               |

Core라는 이름이 현재 정답 승인 완료를 뜻하지 않는다. 특히 Core 9/11도 label 해석 검토가 필요하다. 나머지 54개는 다음 검토 대상에서 버리거나 인증하지 않으며 72행 감사표에서 미검증 상태를 유지한다.

이 18개와 별개로 승인된 제품 A→질문→B→질문→A수정→재질문/과거답변 흐름을 최소 질문 packet으로 연결한다. source pairs의 관계 정확도와 answer fidelity를 각각 채점한다. WAITING·실패·다른 프로젝트/민감도·stale 경계는 기존 13개 Fake 인수 증거를 재사용하고, 실제 모델 답변 품질 검증이 필요한 부분만 향후 승인 범위로 제안한다.

## 2. 독립 승인 절차

1. 사용자가 승인 책임자·검토 범위·측정 계약을 결정한다. Phase A 감사 승인과 개별 label 승인은 별개다.
2. 작성자는 기존 claim/source/hash, 모델에게 줄 입력 및 미전달 문맥을 검토 packet으로 제시한다. 이전 모델 출력·candidate label은 독립 첫 판단에서 가리고, 노출 이력 자체는 기록한다. exposed source를 숨긴다고 새 blind holdout이 되지는 않는다.
3. 작성자와 다른 검토자가 원문·인가 context·허용 단위/논리 전제를 대조해 독립적으로 kind/direction/evidence/warrant와 판정 가능성을 기록한다. 분야 전문성이 필요한 source는 자격/검토 한계를 명시한다.
4. 일치해도 근거와 승인 범위를 확인한다. disagreement가 여러 타당한 warrant라면 OR tuple, 실제 모순/정보 부족이면 분쟁/부족으로 유지한다. 표결·AI 합의로 자동 Gold를 만들지 않는다.
5. 지정 승인자가 명시적 case/input/tuple digest와 revision에 승인 기록을 남긴다. 지금 새 registry 서비스/서명 프레임워크를 개발하지 않고 versioned review artifact로 충분한 최소 절차를 제안한다.
6. prospective 비교 전에 평가 적격/critical/제외 사례, metrics/N/A, sample/repeats/cost/budget/STOP과 evaluator identity를 고정한다. 기존 AI 결과를 보고 label이나 기준을 바꾼다면 새 revision/exposed diagnostic이며 이전 기록을 보존한다.

검토자의 실제 책임/독립성, 판단 근거와 승인이 없으면 CANDIDATE다. AI는 예시와 반대 해석 탐색을 도울 수 있지만 독립 사람의 승인권자가 아니다. 이 절차는 일반 제품 사용 시 매번 지식 Review를 요구하지 않는다.

## 3. 다음 Phase의 정확한 미결사항

| 결정할 사항                              | 결정하지 않으면 생기는 문제                                  | 현재 상태                  |
| ---------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| 정답 승인 owner/reviewer 및 분야 범위    | AI 후보의 자기 인증                                          | USER_DECISION_REQUIRED     |
| claim-only/context task와 허용 외부 전제 | 평가자만 아는 사실로 모델 오판 판정                          | USER_DECISION_REQUIRED     |
| tuple별 의미·방향·근거 규약              | 원인·정당화·subset 해석을 조용히 단일 정답 강제              | REVIEW_REQUIRED            |
| metrics/제외/N/A와 critical sample       | no-adoption을 방향 100%로 표현, gate 실패를 의미 오류로 혼합 | CONTRACT_APPROVAL_REQUIRED |
| 18개 대표성과 질문 obligations           | 편의 표본의 점수로 전체 제품 품질 주장                       | SCOPE_APPROVAL_REQUIRED    |
| 미래 실제 실행 비용/표본/STOP            | 무제한 실험이나 24회 자동 재개                               | NOT_AUTHORIZED             |

해결 순서는 책임·범위/계약 확정 → 개별 reference 검토·승인 → 최소 prospective 측정 필요성 판단이다. SSC/v11/모델 전환 또는 새로운 구조 채택은 여기서 자동 승인되지 않는다. Gold-B-7, B 잔여 24, 동결 평가, VP-06 STOP 유지.
