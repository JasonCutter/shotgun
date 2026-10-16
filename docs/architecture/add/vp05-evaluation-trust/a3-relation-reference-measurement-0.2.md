# VP-05 A3 — 평가 결과 분리 및 불완전 판정 계약 0.2

- 상태: **LOCAL IMPLEMENTATION / PUBLICATION PENDING — 2026-10-16**
- 기준: Canonical `89c14c5e2fee9559e21b6b964098a11f4e8cc0e2`, ADR-173, 보정 A1·A2
- 변경: `VP05_RELATION_MEASUREMENT_0.1` → `VP05_RELATION_MEASUREMENT_0.2`
- 적용: 신규 오프라인 보고서의 계산·표현. 생산 정책·원장·Gold 승인 권위·모델·runtime 변경 없음
- 0.1 계약과 기존 실험은 [원래 기록](./a3-relation-reference-measurement.md) 및 Git 이력에 보존한다. 과거 결과를 재채점하거나 새 버전 결과로 이관하지 않는다.

## 1. 변경 이유와 검증 수준

사용자는 외부 AI 검토에서 지적한 0점 착시·채점과 근거 승인 혼동·무효 사례의 안정성 혼입을 해결할 필요성을 지적했다. 기존 0.1이 의도한 조건부 계산을 따르더라도 출력에 따라 결정되는 부분 집합의 0%는 전체 성능으로 오해되기 쉽다. 0.2는 불확실한 전체 점수를 N/A로 두고, 지금 확인 가능한 종류·방향 일치와 근거 판정·채택 누락을 분리한다.

이 변경은 AI 판단을 인간 검증으로 바꾸지 않는다. `CERTIFICATION`은 기존 A1의 외부 적격 인간 또는 동등 외부 reference provenance를 계속 요구한다. `DIAGNOSTIC`의 종류·방향 점수는 후보 기준에 대한 일치율이고 인증된 의미 정확도가 아니다. 인증 reference가0이면 해당 인증 품질 분모는 N/A다. 이 수정으로 VP 최종 인수를 자동 완료하지 않는다.

## 2. 종류·방향과 근거 포함 평가

`tupleOnly.raw`와 `tupleOnly.adopted`는 근거/warrant 없이 해당 lane의 허용 `(choice,direction)` 전체와 비교한다. TP/FP/FN, P/R/F1, critical recall, kind가 맞는 directed output의 조건부 방향 정확도, negative false-link rate를 반환한다. 다른 대안의 종류와 방향을 조합하지 않는다. 같은 tuple의 warrant가 틀릴 수 있으므로 이 점수를 full semantic correctness로 쓰지 않는다.

`raw`/`adopted`의 full-tuple `counts`는 **확인된 TP/FP/FN만** 담는다. matching kind/direction이면서 warrant가 미평가인 positive output은 `assessment.unresolvedWarrants`에 남는다. 종류·방향만으로 틀림이 확정된 output은 warrant 없이도 confirmed FP/FN이다. 필요한 positive에서 output이 없거나 invalid/runtime/abstention/WITHHELD이면 각 layer의 confirmed miss다. 보류를 분모에서 빼 채택 recall을 높이지 않는다.

전체 집합의 TP가 미확정이면 full-tuple P/R/F1의 `numerator`와 `value`는 null이다. 분모는 전체 eligible determinate task/positive prediction을 유지한다. 이는 0.1의 일부 scorable subset 점수와 다르다. `assessment`는 scope·미확정 수·실제 warrant 평가 응답 수·output 부재로 확정된 positive miss를 구분한다. `assessedWarrantResponses`는 해당 layer의 모든 response에 실제 유효 warrant 평가가 존재하는 수이며, ‘output 부재가 채점 가능하다’는 사실과 같지 않다.

### 가능한 값의 범위

확인된 TP/FP/FN을 `t,f,n`, matching tuple의 미확정 warrant 수를 `u`라고 한다. 미확정 하나는 TP1 또는 FP1+FN1이 될 수 있다.

| 지표            | 하한                                        | 상한                                                               |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Precision       | t / (t+f+u)                                 | (t+u) / (t+f+u)                                                    |
| Recall          | t / (t+n+u)                                 | (t+u) / (t+n+u)                                                    |
| F1              | 2t / (2t+f+n+2u)                            | 2(t+u) / (2t+f+n+2u)                                               |
| Critical recall | 확인된 critical TP / 전체 critical positive | (확인된 critical TP + 미확정 critical 수) / 전체 critical positive |

`bounds`는 **현재 유한 표본의 미판정 결과에 따른 범위**다. 통계적 신뢰구간, 모델의 보정 확률 또는 실제 모집단 성능 범위가 아니다. 분모0이면 하한·상한 모두 N/A다. 관련 미확정 수가0인 지표는 기존 ratio 점수를 그대로 반환한다.

full-tuple `conditionalDirectionAccuracy`는 기존과 같이 kind와 warrant가 맞는 directed output의 조건부 값이다. 전체 tuple 방향 비교는 `tupleOnly.*.conditionalDirectionAccuracy`로 별도 제공하며 둘을 혼동하지 않는다.

예: 종류·방향99일치/1불일치, warrant 전부 미관측이면 tuple-only P/R99%, full-tuple P/R/F1은 N/A, bounds0~99%, 확인된 TP0/FP1/FN1, unresolved99다. ‘99개 full-tuple 정답’이나 ‘전체0점’으로 보고하지 않는다.

## 3. 채점 가능성과 warrant 검증을 분리

0.1의 `*FullTupleScorable`, `*WarrantUnassessed` 출력 키는 각각 `*OutcomeDecidable`, `*OutcomeUndecidable`로 바꾼다. outcome이 결정 가능하다는 뜻이지 사람이 warrant까지 평가했다는 뜻이 아니다. 실제 warrant 평가는 별도 `assessedWarrantResponses`와 `coverage.warrantAssessment`로 보고한다.

`coverage.*ConfirmedPositiveYield`는 전체 required positive 중 **현재 확인된 TP의 비율**을 계속 보존한다. warrant가 하나도 평가되지 않았으면0일 수 있다. 이는 full-tuple 정확도가 아니며, primary full-tuple point estimate와 다른 운영 확인 수율이다. 이를 보완하려고 미검증을 정답으로 간주하지 않는다.

`ASSESSED`라고 기록됐어도 scope/digest/독립 검증 형식·분쟁 상태가 유효하지 않으면 warrant 평가로 인정하지 않는다. `warrantRejections`에 task별 상세 이유를 노출한다. 사람이 실존하고 실제 검토했는지 validator가 인증한다는 뜻은 아니다.

## 4. 적격 집합과 전체 실행 집합

주된 `modelAbstentionRate`, `coverage.structureValidity`, raw/strict/adoption stability는 **eligible reference의 예정 task**만 사용한다. `semanticMetricScope: ELIGIBLE_REFERENCES_ONLY`로 명시한다. eligible 반복 사례가0이면 안정성은 N/A다. 미완료/invalid 반복은 기존처럼 안정 성공이 아니다.

`operational`은 **ALL_SCHEDULED_TASKS** scope로 전체 예정 수·응답 수·구조 유효성·기권율·raw/strict/adoption 안정성을 보존한다. 전체 task outcome/count와 reference 제외 이유도 계속 기록한다. 부적격 사례를 지우거나 실행 실패를 숨기지 않는다. 전체 안정성을 인증 의미 품질로 표시하지 않는다.

## 5. 이력·호환성·재사용·rollback

- 0.2 validator는 0.1 plan을 거부한다. 과거 plan을 조용히 새 계산으로 실행하지 않는다. 원래 scorer/결과 bytes는 Git 및 봉인 artifact에 유지한다.
- package는 원래처럼 offline-only다. 신규 reference, source schema, reviewer DB, approval service, production worker import 또는 provider 호출을 추가하지 않는다.
- 기존 Shotgun `ratio`, stable digest, A1/A2 validation 및 unit fixture를 AUGMENT한다. 원래 [OSS 검토/고정 commit/license 결정](../../../implementation/vp-full-completion-2026-10-12/evaluation-a3-implementation.md)을 재사용한다. gbrain/lucas/ddsyasas/OpenKnowledge의 runtime을 도입할 필요가 없는 Shotgun 소유 측정 의미의 보완이다. 새 의존성·lockfile·OSS 채택/추출 없음.
- Source/Evidence/권한·예산·Ledger·복구 Port는 불변이다. DB migration/운영 rollout은 없다. rollback은 이 offline package·tests·후속 문서의 commit을 되돌리는 것으로 한정하며 실험 DB/claim/budget을 되돌리지 않는다.
- `NO_RELATION` 정책 또는 제품 인수의 인간 인증 Gate 변경은 [별도 정책 검토안](./relation-negative-and-acceptance-policy-draft.md)이다. 이 측정 변경이 v11 활성화나 새 taxonomy를 승인하지 않는다.

## 6. 변경 이력

- 2026-10-16: 외부 AI 1·2단계 검토를 대조하고 기존 계약의 일부 집합 점수와 사용자 관점의 오해를 분리했다. 사용자 보완 지시에 따라0.2를 로컬 구현했다. 과거72/432/B12, Phase A 초안·라벨·스코어·v6/0.9와 A1 외부 인증 경계를 보존한다. 검증 결과는 [구현 보고](../../../implementation/vp-full-completion-2026-10-12/evaluation-report-safety-2026-10-16.md)에 기록한다.
