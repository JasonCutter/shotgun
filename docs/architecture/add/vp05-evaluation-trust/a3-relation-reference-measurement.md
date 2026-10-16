# VP-05 A3 — Relation Reference 및 측정 계약 0.1

> 2026-10-16 후속: [0.2 로컬 보완](./a3-relation-reference-measurement-0.2.md)은
> 새 보고서의 full-tuple 미판정/N/A·bounds, tuple-only 및 집계 scope를 분리한다.
> 아래0.1은 당시 계약 이력으로 보존한다. 기존 실험을0.2로 재채점하지 않는다.

- Record: `VP05-EVAL-A3-20261012`
- Status: **LOCAL IMPLEMENTATION / CANONICAL PUBLICATION PENDING**
- Subject base: `main@aba6ff27f9620ee1a3f408f8df81e8aad21cc584`
- Contract version: `VP05_RELATION_MEASUREMENT_0.1`
- Authority: 사용자 full-completion 지시 안의 최소 평가 구현. 새 생산 권위·정답 인증·과거 결과 변경이 아님
- Dependencies: [보정 A1](./a1-reference-review-responsibility.md), [A2](./a2-evaluation-input-context.md), [ADR-098](../../adr/ADR-098-stage-12-1-quality-evaluation-contract.md), [ADR-172](../../adr/ADR-172-vp-autonomous-knowledge-authority.md), [ADR-173](../../adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md)
- New certified references: **0**. 기존 72/432/B12 재채점 및 새 provider calls: **0 / 0**

## 1. 결정 및 적용 경계

`packages/vp-relation-evaluation`은 versioned test artifact를 읽는 순수 함수다. DB, provider, 제품 사용자 승인 화면, 새 reviewer registry, 생산 worker 또는 Ledger 연결은 없다. 문서의 Git 게시와 개별 Reference의 외부 의미 검증을 구분한다. 정상 자료 투입·질문에 사용자 review/approval 동작을 추가하지 않는다.

`CERTIFICATION`, `DIAGNOSTIC`, `SYNTHETIC_CONTRACT` lane을 구분한다. certification의 eligible reference는 보정 A1의 exact input/reference digest와 외부 적격 검증 범위·책임·전문성·독립성·기록·이견 처리·taxonomy/input 동등성이 확인된 경우뿐이다. `CANDIDATE/UNVERIFIED`는 diagnostic에서만 비교할 수 있다. 그 결과는 인증 품질이나 객관적 모델 오류율이 아니다. synthetic lane의 결과는 계산 계약의 회귀 검증이며 자연어 정답 승인도 실제 모델 품질도 아니다.

Validator는 기록의 필수 필드·digest 대응을 검사한다. 사람이 존재하고 실제로 원문을 검토했는지, 독립성 주장이 사실인지 또는 외부 문서가 진품인지는 **인증할 수 없다**. 외부 증빙을 실제로 조사·확인한 책임은 A1의 평가 운영자에게 남는다. JSON에 `EXTERNALLY_VERIFIED`라고 쓰는 것만으로 정답을 인증하지 않는다. AI 합의·확률·명성·논리 검사·Git author는 이 증거의 대체물이 아니다.

## 2. target taxonomy와 Reference tuple

현재 application은 `vp-deepseek-relation-v6-evidence-context`이며 아래 6종이다. 보존 v11의 7종은 별도 `V11` target과 exact revision을 요구한다. plan 안에서 target/profile을 섞거나 v6에 NO_RELATION을 요구하면 오류다. 이 패키지는 v11을 활성화하거나 v6/v11 prompt, RELATED 정의, confidence 0.9 또는 SourceVersion 권위를 변경하지 않는다.

| 선택지      | v6        | 보존 v11 | 방향 / reference 검토 범위                                                                                       |
| ----------- | --------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| EQUIVALENT  | 허용      | 허용     | NONE. 대상·측정 속성·시간·범위·조건과 의미 동등성                                                                |
| SUPPORTS    | 허용      | 허용     | LTR/RTL. 해당 target 규약의 근거/사례에서 지지받는 주장으로. 선언 역할의 의미 정확성은 enum으로 증명되지 않음    |
| QUALIFIES   | 허용      | 허용     | LTR/RTL. 제한·예외·좁은 적용 범위에서 제한받는 주장으로. 단순 더 약한 문장과 실제 제한의 구별은 의미 검토        |
| CONTRADICTS | 허용      | 허용     | NONE. 동일 대상·속성 및 겹치는 시간/범위/조건에서 함께 성립 불가능한 내용                                        |
| RELATED     | 허용      | 허용     | NONE. **각 exact policy의 정의 유지**. v6의 meaningful topic overlap과 v11의 더 제한된 관계를 하나로 합치지 않음 |
| NO_RELATION | 출력 불가 | 허용     | NONE. 관계 부재 선언과 미채택/모델 abstention을 분리                                                             |
| UNRESOLVED  | 허용      | 허용     | NONE. 전달 입력의 불충분/불확실성. schema failure/UNKNOWN을 모델의 자발적 선언으로 변환하지 않음                 |

Ledger의 SUPERSEDES는 SourceVersion chronology 권위로 결정되는 별도 구조이며 이 모델 선택지에 추가하지 않는다. source-to-source 관계 검토는 원문 주장이 세계에서 사실이라는 인증이 아니다.

Reference의 허용 대안은 `alternativeId + choice + direction + warrant + assumptionRules` 전체 tuple이다. 대안 하나와 완전히 일치하면 TP 1이다. 여러 tuple의 종류·방향·근거를 각각 뽑아 새 조합을 만들지 않는다. 모델에게 모든 허용 대안을 출력하도록 요구하지 않는다. 서로 다른 warrant가 있는 양방향 SUPPORTS 등은 개별 대안으로 기록하며 임의 우선순위를 새로 강제하지 않는다.

`DETERMINATE`는 positive-only 또는 NO_RELATION-only 허용 tuple이다. positive와 negative를 섞은 정답은 받아들이지 않는다. `CONTEXT_INSUFFICIENT`는 UNRESOLVED-only 별도 diagnostic이다. 분쟁·provenance invalid·access failure는 제외 이유와 제출 모집단에 남긴다. critical 여부는 reference digest에 포함되며 실제 외부 검증 범위의 일부여야 한다. AI가 이를 선언했다고 critical Gold가 되는 것은 아니다.

## 3. A2 입력과 provenance

`EC_RUNTIME_2000_V1` primary와 `CLAIM_ONLY_V1` secondary를 별도 plan으로 측정한다. 동일 EvidenceSpan context·crop code-point 위치·원문 quote digest·생략 표시와 truncation·project/SourceVersion/Evidence/assertion/scope/sensitivity·projector/adapter/schema/prompt/model identity·semantic/structured/wire digest를 기록한다. claim-only의 context/crop은 null, truncation은 false다.

제품-input 인증 lane은 실제 captured structured request 또는 wire capture와 외부 검증을 요구한다. `FROZEN_RECONSTRUCTION_MATCHES_DIGEST`만 있으면 제품 경로 전달 인증으로 승격하지 않는다. claim/context를 다시 crop하거나 괄호·조건·단위를 제거하지 않는다. 입력 bundle digest와 transport/request digest는 별개의 표현이다. 이 순수 함수는 SQL 권한이나 원문 DB를 조회하지 않으며 source/접근 대응 검사 증거를 대체하지 않는다.

언어 의미, 명시 값의 유한 논리·산술 및 정확 단위 표기만 A2의 명시 규칙으로 사용할 수 있다. 모델에 전달하지 않은 공식·제목·분야 사실은 reference warrant에 보충하지 않는다. 이미 노출된 역사 결과를 새로운 primary input의 결과로 이관하지 않는다.

## 4. raw·warrant·adoption 계약

task는 사전에 `(caseId, run, taskId)`로 예정한다. 누락 observation은 MISSING이며 duplicate, unscheduled, input mismatch는 측정 오류다. raw는 구조-valid 원본의 choice/direction이고, INVALID·NOT_EVALUATED·RUNTIME_FAILURE·OUTCOME_UNKNOWN은 raw null이다. invalid JSON에 choice 문자열이 보였다는 이유로 그것을 모델의 유효 선언으로 세지 않는다.

**현행 v6는 semantic warrant를 출력하지 않는다.** full tuple을 평가하려면 해당 output digest/reference digest에 결합한 독립 외부 warrant assessment가 별도로 필요하다. 관측/검증되지 않은 warrant는 `NOT_OBSERVED/UNVERIFIED`다. enum/offset/schema를 통과했다고 warrant를 자동 일치시키지 않는다. fake fixture는 SYNTHETIC_CONTRACT로만 표시한다.

adoption은 실제 관측한 `ADOPTED`, `WITHHELD(reason)`, `NOT_REACHED(reason)`다. raw가 맞아도 0.9 gate에서 거부될 수 있고 raw가 틀려도 거부될 수 있다. 평가기는 gate를 다시 계산하거나 확률을 바꾸지 않는다. production Ledger를 관측하지 않은 adoption 상태를 Ledger publication이라고 부르지 않는다. selected-label probability와 self-reported confidence는 별도 필드와 관측 coverage로 보존하며 full semantic correctness 확률로 해석하지 않는다.

## 5. 정확한 분자·분모·N/A

`R`: 해당 lane에서 적격하고 DETERMINATE인 예정 task. `R+`: positive reference task. `R−`: v11 NO_RELATION-only task. `Q`: 구조-valid raw positive. `A`: 실제 adopted positive. `W`: 외부 검증된 warrant 또는 synthetic lane의 test oracle. `TP`: 같은 허용 tuple의 kind/direction/W 일치. 각 layer에서 잘못된 positive는 FP 1, positive reference의 미검출은 FN 1이다. task 반복 수와 unique case 수를 별도 보고한다.

W가 없더라도 kind/direction 자체로 불일치가 확정되면 full-tuple 오답이 확정된다. **kind/direction이 가능한 tuple와 맞지만 W가 미검증인 positive는 full-tuple 미평가**다. 이를 기본 의미 FN으로 단정하지 않는다. 각 layer의 full-tuple scorable subset과 전체 R 대비 coverage를 공개하고 조건부 점수를 서로 다른 coverage의 모델 간 성적처럼 비교하지 않는다. invalid/runtime/abstention/누락은 유효한 positive 산출이 없으므로 예정 positive의 미검출로 유지한다.

| 지표                                         | 분자                                                                               | 분모 / 해석                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Reference certification/eligibility coverage | 외부 검증 및 captured-input 적격 수 / lane 적격 수                                 | 제출 reference 수; 각 제외 이유 공개                                                     |
| Raw/adopted full-tuple precision             | TP                                                                                 | scorable raw/adopted positive 수                                                         |
| Raw/adopted full-tuple recall                | TP                                                                                 | 해당 layer의 scorable R+ 수; 미검증 W 제외 수/coverage 병기                              |
| Raw/adopted F1                               | 2TP                                                                                | 2TP+FP+FN                                                                                |
| Critical recall                              | critical TP                                                                        | 해당 layer의 scorable critical R+ 수                                                     |
| 조건부 raw/adopted 방향 정확도               | 같은 kind/W와 direction까지 맞는 수                                                | directed Q/A 중 kind/W가 정답과 맞는 수. **방향 정답은 분모 조건이 아님**                |
| Kind correctness                             | raw choice가 허용 choice에 있는 수                                                 | 구조-valid R 수; full tuple/의미 warrant 인증이 아님                                     |
| Confirmed positive yield                     | 원래 전체 R+ 중 확인된 TP                                                          | 전체 R+ 수. UNKNOWN/invalid/missing/W 미평가를 포함한 산출 확인률이며 의미 정확도와 구분 |
| Negative false-link rate                     | R−에서 raw/adopted positive 수                                                     | 전체 R− 수; explicit negative correctness와 별도                                         |
| Explicit negative correctness                | R−에서 구조-valid raw NO_RELATION 수                                               | R− 수. UNRESOLVED·invalid·미채택은 TN이 아님; v6에는 이 모집단 없음                      |
| Model abstention rate                        | RESPONSE 중 valid raw UNRESOLVED 수                                                | RESPONSE 수. schema-invalid도 분모에 유지하며 UNKNOWN은 별도                             |
| Abstention appropriateness                   | independently eligible insufficient subset의 valid UNRESOLVED                      | 해당 insufficient 예정 task 수                                                           |
| Structure validity                           | 구조-valid response 수                                                             | response 수; invalid/not-evaluated 별도                                                  |
| Raw tuple stability                          | 예정 반복이 모두 valid이고 choice/direction 동일한 case 수                         | 모두 valid인 반복 case 수; valid-complete coverage 공개                                  |
| Strict all-run stability                     | 같은 raw 안정 case 수                                                              | 반복을 예정한 모든 case 수. 미완료/invalid는 성공 아님                                   |
| Adoption-state stability                     | 모든 반복 terminal이며 adoption status/reason/adopted tuple/outcome 동일한 case 수 | 모든 반복 terminal case 수; publication 안정성 인증 아님                                 |
| Runtime completion/UNKNOWN                   | 관측 terminal 수 / UNKNOWN 수                                                      | 예정 task 수 / 별도 outcome count; 의미 오판과 혼합하지 않음                             |

**모든 빈 분모는 null(N/A)**. 전체 외부 Gold가 0이면 certification quality는 N/A다. false-link 0은 높은 explicit-negative accuracy를 뜻하지 않는다. unsupported native v6 NO_RELATION recall을 요구하지 않는다. 반복 run은 독립 지식 표본이 아니며 diagnostic 소표본으로 모집단 정밀도·보정성·비용을 인증하지 않는다. confidence calibration·신뢰 구간·billing·제품 질문 성공은 이 구현의 미실행 후속 측정이며 기존 threshold를 낮추는 근거가 아니다.

## 6. CandidateFrontier와 제품 평가의 연결

Frontier coverage helper는 selection artifact의 revision/digest와 exact reference-set digest를 요구한다. 분모는 해당 input/권한/profile/외부 검증이 적격인 positive membership과 critical obligation이며 이론상 모든 N²가 아니다. verified positive가 없으면 critical/overall recall은 N/A다. helper 성공은 selection artifact의 진위를 인증하거나 생산 후보를 실행하지 않는다. 기존 100% critical/≥99% overall 요구는 변경하지 않는다.

관계 scalar 성적은 제품 질문 성공을 대체하지 않는다. A-only→A+B→A 수정→과거 AnswerRun, 동일 범위 충돌·조건 차이·부족·WAITING·권한/실패에서 실제 검색 Evidence→generation→citation/SourceVersion→publication/read freshness를 연결해야 한다. 관계 미채택과 질문 실패를 같은 것으로 단정하지 않는다. extraction/관계/search/answer/runtime 단계 귀속은 실제 trace로 확인하며 fake success는 live 의미 품질 인증이 아니다.

## 7. 제외 대안·미결사항·변경 이력

- 제외: 기존 scorer 수정/결과 이관, enum/anchor로 warrant 인증, AI 합의 Gold, NO_RELATION을 v6에 추가, 빈 분모 100%, wrong direction을 분모에서 빼기, 모든 이론 쌍 Frontier 분모, reviewer DB/새 운영 권위.
- 직접 구현 이유: 기존 quality-evaluation은 Claim/Search이며 raw/adoption/warrant/tuple reference를 제공하지 않는다. 그 ratio/digest를 재사용하고 Shotgun 소유 test artifact 의미만 추가한다. 자세한 OSS 판단은 [구현 기록](../../../implementation/vp-full-completion-2026-10-12/evaluation-a3-implementation.md) 참조.
- 미결: 실제 외부 적격 검증 증거 확보와 taxonomy/input 동등성, 충분한 product 질문 obligations와 대표성, warrant 평가 가능한 output 범위, confidence calibration/비용·신뢰구간, prospective 실행/게시·운영 Gate. 사용자에게 개별 reference 승인/reviewer 지정 의무를 전가하지 않는다.
- 2026-10-12: full-completion 지시 범위에서 A3 최소 오프라인 구현. A1 사용자 정정·A2 context 계약과 Phase A 원본을 보존. 새 Gold 0, frozen 재채점 0, provider calls 0. Canonical 게시와 제품·의미 품질 Gate는 별도 증거를 요구한다.
