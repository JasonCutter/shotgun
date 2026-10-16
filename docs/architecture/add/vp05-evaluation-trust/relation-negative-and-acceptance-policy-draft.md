# 관계 부재 및 제품 인수 증거 — 정책 보완 검토안

**APPROVED FOR ISOLATED IMPLEMENTATION AND ACCEPTANCE-SCOPE CORRECTION / NOT DEPLOYED — 2026-10-16**

이 문서의 최초 초안은 로컬 commit `789a70518`에 보존된다. 이후 사용자가
“두 변경안의 격리 구현·계약 정비 승인”으로 §2 제안 A의 격리 구현과 §5의
인증/제품 인수 보장 범위 정비를 명시 승인했다. 따라서 해당 범위는 현재 승인된
로컬 결정이며 파일명의 draft는 최초 작성 이력이다. 운영/실AI 승인이나
제안 B 채택을 뜻하지 않는다. Git main 게시 여부는 별도다.

사용자가 평가 문제의 해결과 `NO_RELATION` 필요성을 제기하여 구체화한 변경안이다. AGENTS §0 및 전체 실행 지시 §6에 따른 후속 사용자 승인의 정확한 범위만 적용한다. 운영 변경 또는 새 Gold를 발행하지 않는다.

## 1. 필요한 구분

| 상태                      | 제안 의미                                                                                                                      | 원장/실행 처리 제안                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| NO_RELATION               | 공급된 입력이 충분하며, 적용한 관계 규약에서 긍정 관계가 없다는 명시적 판단. 세상에서 가능한 모든 연결의 절대 부재 증명이 아님 | negative semantic outcome을 저장. positive relation edge를 만들지 않음 |
| UNRESOLVED                | 대상/조건/문맥의 부족·해소되지 않은 모호함 때문에 관계 판단이 불가능                                                           | 부족 원인과 원래 입력을 보존. 관계 부재 정답으로 세지 않음             |
| WITHHELD                  | 모델 raw 판단은 있으나 채택 정책의 확률/토큰 등 조건을 충족하지 못함                                                           | raw와 gate 사유를 분리. NO_RELATION/모델 기권으로 변환하지 않음        |
| INVALID / OUTCOME_UNKNOWN | 형식 오류 또는 실제 실행 결과 불확실                                                                                           | 의미 판단과 분리하고 기존 예산/복구/자동 재호출 금지 경계 유지         |

NO_RELATION은 현행 v6의 output enum에 없다. 오프라인 평가 패키지는 보존 V11 target의 negative를 이미 표현하지만 이를 운영 v6의 출력으로 요구할 수는 없다. 기존 v6 결과에 negative를 소급 부여하거나 미채택을 NO_RELATION으로 재분류하지 않는다.

## 2. RELATED와 겹치지 않게 하는 최소안

**제안 A — v6의 RELATED 의미 유지 + 명시적 negative 추가**를 우선 검토한다. RELATED는 현행 의미 있는 주제 중첩을 유지하고, 입력이 충분하면서 강한 관계도 의미 있는 주제 중첩도 없는 경우 NO_RELATION을 허용한다. 따라서 같은 명시 대상의 서로 다른 속성인 heliograph 사례를 NO_RELATION으로 바꾸는 것을 전제하지 않는다. 의미 있는 주제 중첩의 판단이 애매하면 그 애매함 자체를 드러낸다.

**제외 대안 B — 같은 주제라도 직접 명제/메커니즘 연결이 없으면 NO_RELATION**은 RELATED를 좁히는 더 큰 의미 변경이다. 보존 v11과의 유사성이 있어도 해당 정책 전체를 자동 채택하지 않는다. 이 안을 선택하려면 별도의 taxonomy 결정과 경계 사례 검증이 필요하다.

입력에 없는 경험적 사실을 찾아 NO_RELATION을 뒤집지 않는다. null context만으로 UNRESOLVED를 강제하지 않으며, 충분한 두 claim 자체로 판단 가능한 경우를 허용한다. negative도 모델의 판단이고 객관적 Fact가 아니다.

## 3. 승인된 격리 구현 범위

기존 v6를 덮어쓰지 않는 새로운 versioned policy/schema identity를 만들고 enum/probabilities/validator/router/결과 저장·노출 계약을 일치시켜야 한다. negative의 NONE 방향, 실제 선택 확률 게이트, stored negative와 withheld reason 구분 및 replay/UNKNOWN/claim idempotency를 검증한다. 기존0.9는 임의로 낮추지 않는다. 0.9의 실제 calibration이 인증됐다는 뜻도 아니다.

처음에는 unit/contract와 격리 PostgreSQL + Fake만 사용한다. 새 policy의 실제 AI egress, app 운영 활성화, 기존 backlog 실행, 새 대량 평가·과거 재채점은 포함하지 않는다. 기존 provider credential/global authority를 우회하지 않고 모델·SSC·v11 전체를 전환하지 않는다.

첫 구현은 별도의 `explicit-negative-isolated` module/adapter와 evaluator target으로
제한한다. Adapter는 `isolated-fake` identity와 `ISOLATED_FAKE` mode만 허용하고
production job execution identity가 있으면 호출 전에 거부한다. 정상 worker의
provider Port를 구현하지 않아 실수로 교체 주입할 수 없다. 실제 DB job/receipt에
negative를 쓰는 adapter 또는 migration은 만들지 않는다. 반환된 versioned
record는 격리 실험 artifact이며 원장이 아니다. 따라서 이 단계에서 production
DB 호환성·재시작·budget binding이 새 정책에 대해 검증됐다고 주장하지 않는다.
그 경계로 확대하려면 기존 실행 권위·저장 Port를 사용하는 별도 격리 연결과
PostgreSQL 검증이 필요하다. 실제 credential/provider 경로로 우회하지 않는다.

## 4. 과거 72개 평가 기준 오류 처리

기존72개 파일과432/B12 결과는 수정하지 않는다. Phase A가 지적한 방향 없는 QUALIFIES3개는 새 reference validator로 거부하고, 원래 allowed direction을 추측해서 채우지 않는다. IRR 주어 및 고정 cash flow/기간 등 필요한 전제 부족2개는 당시 공급 입력에서 판정 가능했는지를 분류한다. 이를 ‘모든 정답을 절대로 맞힐 수 없다’ 또는 ‘모델 점수가 실제로 얼마나 깎였다’고 새로 단정하지 않는다.

후속 평가에는 별도의 versioned reference 집합을 사용하고, 구조 불능·부족·분쟁·AI 검토 후보·독립 인증을 구분한다. 옛 라벨을 수리해 옛 실험 결과에 적용하지 않는다. 이 초안은 새 reference나 정답을 발행하지 않는다.

## 5. 승인된 인간 인증과 제품 인수 범위 분리

1. **CERTIFICATION 유지**: 객관적인 의미 품질 수치/인증 Gold를 주장할 때는 기존 A1의 적격 인간 또는 동등 외부 reference provenance를 요구한다. AI 합의·산술 검사·confidence로 그 상태를 대신하지 않는다.
2. **DIAGNOSTIC/회귀 검증 활용**: 명시 값·단위·유한 논리의 결정론적 검증, AI 교차 검토와 반대 해석, exact input/provenance·권한·구조 검사를 활용한다. 자연어 paraphrase 전체를 형식적 증명으로 보지 않는다. 결과의 후보/AI 검토 수준과 실제 채점 범위를 공개한다.
3. **제품 인수는 실제 질문 결과와 안전 경계 중심**: A→질문→B→질문→A 수정→재질문에서 인용·최신성·충돌/조건 표시·권한·불확실성·장애 복구를 검증한다. 모든 내부 관계 라벨 또는 기존72개 전체의 인간 인증을 일률적인 선행 조건으로 만들지 않는 방향을 제안한다.
4. **해결되지 않은 필수 품질 Gate는 명시**: 인증 분모가0이면 인증 정확도/critical recall/calibration은 계속 N/A다. 제품 인수와 인증된 AI 의미 정확도의 보장 범위를 분리해 승인해야 한다. 기존 DoD의 필수 기준이 이 제안과 충돌하면 해당 기준의 적용 범위/잔여 위험을 사용자가 정책으로 결정하기 전에는 COMPLETE를 선언하지 않는다.
5. 사용자 개별 reference 검토·정답 승인·reviewer 지정 의무는 없다. 인간 도움은 실제로 필요한 고위험/분쟁의 전문 근거 또는 인증 목적에 한정하여 비용/효익을 판단한다. 유료 외주를 기본 전제로 하지 않는다.

**인증 reference0 또는 인증 점수N/A라는 사실만으로 최종 제품 인수를 자동
차단하지 않는다.** 제품 인수는 위의 실제 제품·안전·적용 품질 검증 결과로
판정하고 인증되지 않은 모집단 관계 정확도/보정성의 한계를 함께 명시한다.
이는 N/A를 PASS로 바꾸거나 실제 제품 의미 오류를 무시한다는 뜻이 아니다.

## 6. 승인 범위와 이력

사용자가 승인한 결정은 (a) RELATED를 유지하면서 NO_RELATION을 추가하는 새 정책의 **격리 설계·구현**, (b) 위 증거 수준을 유지하는 **제품 인수 Gate의 범위 정비**다. Gold 발행·운영 설정/DB/앱/worker 변경·실제 AI 호출·기존 실험 재개·push/PR/merge는 별개다. 기존 A1/A2/A3 원문과 선행 승인 이력은 보존한다.
