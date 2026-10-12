# ADR-173 후속 작업 실행 기준

> 우선순위: 제품 인수 결과 → 평가 신뢰성 → 병목 → 최소 보완 → 기존 Gate. 이 문서는 함수/라이브러리/구현 순서를 지시하는 상세 요청서가 아니다.

## 게시 기준선 구분

[publication-notes](./publication-notes.md)의 v11/Frontier/global authority는 로컬 VP 보존 기준선이다. 이 PR의 main parent worker는 v6이며 실행 code는 변경하지 않는다. 후속 작업은 실제 checkout/runtime identity를 먼저 확인하고 별도 승인 없는 통합·활성화를 하지 않는다.

## 현재 지시와 중지 상태

[ADR-173](../../architecture/adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md)의 사용자 승인 전략과 ADR-172 제품 계약을 함께 적용한다. 이번 작업은 ADR 승격과 정합성 정비까지다. 아래 기술 작업, 중지된 평가 draft, B v1 잔여 24회, 새 모델 호출을 자동 시작하지 않는다.

**다음 과제의 목표:** VP-05 전략 재정립 및 평가 신뢰성 회복. 기존 좁은 검증 결과와 아직 판정할 수 없는 내용을 구분하고, 신뢰 가능한 품질 측정 방식과 제품 영향에 따라 현행 구현의 유지/보완/전환 및 남은 Gate 종료 가능성의 근거를 확보한다.

## 전략 우선순위별 종료 기준

| 단계          | 목표·필수 결과                                                                      | 종료 판정에 필요한 증거                                                                                      | 이번 상태                                                     |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| A 평가 신뢰성 | 후보·검증·분쟁·문맥 부족과 실제 제공 입력, 복수 종류/방향/근거, 지표 정의/분모 분리 | 승인·검증 책임과 범위, 실제 입력 digest, 미평가/표본 한계. 구조 검사나 AI 합의로 의미 승인을 대체하지 않음   | 기준 문제의 감사만 있음. trusted corpus/metric 계약 완료 아님 |
| B 제품 진단   | 자료 A→질문→B/A 수정→재질문·인용/활성 버전/조건/충돌/대기·실패를 관측               | 실제 application/worker/Ask 경로의 좁은 성공과 실패 원인. source·model·epoch·permission·지연/비용 provenance | 기존 부분 E2E 증거 재사용. 이번에 새 제품 실행 없음           |
| C 필요성 판단 | 사전 축적/질문 시 평가/혼합형의 제품 가치와 비용·권위 영향 비교                     | 재계산/replay·데이터 owner·Freshness·보안·지연·비용·회귀 및 유지/보완/전환 이유                              | 세 방식 비교·채택 안 됨. 질문 시 방식은 가설                  |
| D 최소 수정   | 실제 제품 병목에 필요한 변경만 선택                                                 | 신뢰 가능한 baseline 대비 개선·회귀·call/token/청구·복구 증거, revision/identity                             | 구현 안 됨. SSC/모델 변경 전제 없음                           |
| E 잔여 Gate   | 기존 tracker/DoD의 VP-04/05 및 후속 Gate 판정                                       | 승인된 의존성·필수 조건·제한부 완료 적격성·release 증거                                                      | VP-05 미완료, VP-06 STOP 유지                                 |

검토자는 A–E를 새로운 VP 추적 ID 또는 새로운 생산 상태 enum으로 만들지 않는다. A/B 진단의 좁은 완료는 VP-03/04/05의 전체 완료가 아니다. Phase C의 권고는 운영 변경 승인과 별개다.

## 품질 보고 계약

1. “입증된 사실”, “정답 후보/AI 해석”, “자료 부족/미검증”을 구분한다. 원문의 주장을 현실 Fact로 올리지 않는다.
2. 모델 입력에 없는 문맥을 평가자만 이용하지 않는다. normalization/단위 변환/논리 proof는 의미 해석 가정과 승인 범위를 함께 기록한다.
3. 의미 판정, JSON/native schema, confidence gate, 원장 발행, 인용·버전, 원본 tuple 안정성, 발행 상태 안정성을 별도 보고한다.
4. 조건부 방향은 종류·근거 조건이 정답 기준과 맞고 실제 채택된 SUPPORTS/QUALIFIES 예측을 분모로 하며 분모 0은 N/A다. 방향의 정답 여부를 분모 조건으로 넣지 않는다. 세부 정의를 새 계약에서 고정하기 전 구형 숫자를 새 이름으로 해석하지 않는다.
5. 정답 승인 수준, 분자/분모, 미평가·abstention/runtime/OUTCOME_UNKNOWN, 표본 한계 또는 신뢰 구간과 실제 청구/사용량을 보고한다.
6. 원래 72/432/B12의 결과는 보존한다. 새 기준/metric의 진단은 다른 revision·artifact에 기록하고 기존 outcome이나 denominator를 교체하지 않는다.

## 보호·승인 경계

- 보호: 두 동작·VP Ledger·SourceVersion/Evidence·권한/민감도·Claim/Fact·재생·불확실성·egress·글로벌 예산·중복 호출 방지·기존 실험/원본.
- 현행: v11, 0.9 gate, DeepSeek-only identity와 현재 CandidateFrontier 계약.
- 보류: 필요성이 입증되지 않은 prompt/schema 반복, SSC 연속 버전, Qwen/NLI/Jev 비교, 대량 실험 및 draft의 자동 채택.
- 별도 승인: 운영 정책/생산 데이터·권위 변경, 새 architecture 전환, Gold-B-7, VP-06, push/PR/merge.
- 방법 자율성: 위 목표와 경계 안에서는 에이전트가 수단을 결정하고 개선/절충 근거를 보고한다. 기존 필수 Contract·보안·OSS Gate를 줄이지 않는다.

## 미결사항

정답 승인 책임자/범위, 독립 검증·의미 정규화 승인 방식, 대표 제품 질문 집합, 추출/검색/관계/답변 실패 분해, v11/SSC/새 모델의 실제 병목 여부, 0.9 보정성, 청구 대사·관계 후보 축소 품질, VP-05 COMPLETE_WITH_LIMITS 적격성은 아직 결정되지 않았다.

Canonical 게시 상태는 ADR-173의 Publication을 따른다. 이 문서와 전략의 로컬 승인은 운영 배포나 `main` merge를 증명하지 않는다.

## 2026-10-12 후속 결정 — A1·A2 위임 구체화

위 미결사항은 2026-10-10 기록으로 보존한다. 사용자의 후속 위임에 따라 [A1·A2](../../architecture/add/vp05-evaluation-trust/README.md)를 로컬 결정했다. A1의 인간 승인 owner/독립 reviewer·증빙 절차와 A2의 product context primary/claim-only 별도·외부 전제·provenance·부족 처리 기준은 구체화 완료다. 실제 사람 지정/Reference 검토·승인은 미수행이며 taxonomy/metric/대표 집합과 실험·게시 승인은 남는다. 기존 Phase A 초안은 역사 기록으로 보존하고 새 Gold나 평가 권위로 자동 채택하지 않는다. 두 Section 완료 후 STOP하며 다른 A–E 작업을 시작하지 않는다.
