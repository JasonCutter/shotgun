# ADR-173 — 제품 우선 개발 전략과 평가 신뢰성 경계

## 2026-10-16 사용자 승인 후속

사용자가 [NO_RELATION 격리 구현과 인증/제품 인수 범위 정비](../add/vp05-evaluation-trust/relation-negative-and-acceptance-policy-draft.md)를
승인했다. 실제 제품 질문의 원문·인용·최신성·충돌/조건·권한·복구 증거를
인수 기준으로 사용하고 인증 Gold·의미 정확도 수치는 별도 증거 수준으로 유지한다.
모든 관계를 인간에게 개별 승인받는 일반 제품 흐름은 만들지 않는다. 인증
분모0은 N/A이고 미해결 필수 제품/안전/적용 품질 기준은 계속 blocker다.
신규7종 정책은 명시적 Fake-only 격리 경로에 한정하며 현재 앱의 v6/0.9,
동결 결과·예산/실행 권위·운영 적용 및 게시 승인 경계를 유지한다.

- Status: **ACCEPTED — USER decision, 2026-10-10**
- Decision owner: USER (Project owner)
- Acceptance authority: 사용자의 “개발 전략 ADR 승격 및 기존 결정 정합성 재정비” 요청
- Publication: **USER-AUTHORIZED GITHUB REVIEW BRANCH / PR; reviewed `main` merge 전에는 Git Canonical 게시 완료가 아님**
- Subject base: local VP worktree `6be130125d211ac4da6d45a29fd1db101387a296`
- Scope: Project Shotgun 개발·평가·작업 운영 전략. 즉시 적용 대상은 VP-05의 우선순위와 증거 해석
- Supersedes whole ADRs: **NONE**
- Amends: ADR-098의 향후 평가 보고 조건, ADR-172의 평가 증거 해석 및 선택적 최적화 착수 조건. 아래 Frontier 절 번호는 미게시 로컬 기준선의 번호다.
- Related: ADR-079–098, ADR-117/120/121, ADR-133/143, ADR-160/161/164, ADR-169/172
- Runtime / production data implementation: **NOT AUTHORIZED by this documentation task**

## 1. Context와 승인 근거

### GitHub 검토 게시 범위

원본 `1a36c7b55`의 전략 변경만 `origin/main@e08449982cbf2247b9b1e7a7ef39281eab09166a` 기준으로 옮겼다. 원래 VP 브랜치의 앞선 runtime·평가·실험 commit 68개는 이 PR에 포함하지 않는다. 로컬 v11·global authority·Frontier·동결 결과에 대한 문구는 해당 미게시 로컬 기준선의 보존 요구다. 현재 main에 이미 구현됐다는 주장이 아니다. 실제 main worker는 v6이고 이 문서 PR은 이를 v11로 변경하지 않는다. [게시 범위·출처](../../implementation/development-strategy-reset-2026-10-10/publication-notes.md)를 따른다.

Shotgun의 성공은 관계 분류기의 개별 점수가 아니라, 자료 투입과 질문만으로 최신의 권한 있는 근거를 사용하는 지식 제품 인수 결과다. 관계 실험은 이 제품 목표의 문제를 설명하고 해결할 때 필요하다.

2026-10-10 [기준 감사](../../implementation/development-strategy-reset-2026-10-10/publication-notes.md)는 기존 72쌍 중 30쌍의 CANDIDATE 상태와 나머지 42쌍의 조사된 annotation에서 독립 승인 기록 미확인을 보고했다. 세 mixed 사례는 QUALIFIES를 허용하면서 유효한 방향이 없었다. 합성 채점 입력에서는 관계 채택 0건에도 방향 지표 100%가 나왔다. 이는 72쌍 전부가 틀렸거나 모델의 실제 의미 오류율이 확정되었다는 뜻이 아니다.

사용자는 [개발 전략 재정립 제안 v0.1](../../implementation/development-strategy-reset-2026-10-10/source-proposal.md)을 공식 ADR로 승격하고 관련 문서·원칙을 정비하도록 명시적으로 요청했다. 제안의 “사용자 확정 전” 표시는 원본 이력으로 보존한다. 본 ADR의 결정 승인 근거는 이번 사용자 요청이며 원본 문서가 스스로 부여한 권한이 아니다.

원본 SHA-256: `9fdf257d810cd3e12ee8b1cb60f871c46a7a27729d8971ea0dc65e196d562925`. [출처 기록](../../implementation/development-strategy-reset-2026-10-10/source-provenance.json)을 보존한다. 원본에 언급된 `ssc-rel-0.2/SSC-REL-0.2-design.md`는 검토 worktree에 없으며 승인·채택 근거로 사용하지 않았다.

ADR-117/120의 Git `main` 게시 경계는 유지한다. 사용자가 승인한 결정 내용과 검토·merge를 거친 Canonical 게시 상태를 구분한다. 이번 세션의 실행 우선순위는 사용자의 직접 지시에 따라 적용하고, `main`·운영 배포에 반영됐다고 주장하지 않는다.

## 2. 확정 결정

### D1 — 제품 인수가 최상위 결과다

[VP 구현계획](../../implementation/vp-vampire-implementation-plan.md) §1의 인수 시나리오를 유지한다.

1. 빈 단일 Shotgun에 별도 프로젝트 설정 없이 자료 A를 한 번 투입하고 질문한다.
2. 자료 B와 A의 수정본을 투입하고 동일 질문을 다시 한다.
3. 답변은 활성 SourceVersion과 B를 반영하고 합의·조건 차이·충돌·시점을 원문 인용으로 구분한다.
4. 처리가 끝나기 전 질문은 동일 AnswerRun에서 준비를 기다렸다가 자동으로 완료한다.
5. 실패는 이유를 드러내며 근거 없는 확정 답변을 생성하지 않는다.
6. 후보 선택·원문 선택·지식 Review·승인을 추가 사용자 동작으로 요구하지 않는다.

관계 라벨 성적은 이 결과를 대체하지 않는다. 제품 진단의 좁은 성공을 VP-03 또는 전체 VP 완료로 올리지 않는다.

### D2 — 신뢰 수준과 측정 차원을 분리한다

새 평가와 새 결과 보고는 다음을 명시한다.

- 정답 상태: 후보, 검증·승인 근거가 있는 기준, 분쟁/복수 해석, 문맥 부족, 구조 결함. 동결 또는 모델 간 합의만으로 승인 상태를 부여하지 않는다.
- 실제 provider 입력: 원문·인가된 context·잘림 표시·범위·버전·digest. 평가자만 아는 제목·공식·조건을 정답 판정에 조용히 추가하지 않는다.
- 관계 종류·방향·근거의 정합성. 복수의 타당한 해석은 관계별 튜플과 가정/근거로 구분하며 단일 라벨로 강제하지 않는다.
- 제품 답변, 의미 판정, 출력 형식, 근거, 확률 게이트, 발행 결과, 원본 선언 안정성, 발행 상태 안정성을 각각 측정한다.
- 지표 정의·분자/분모·정답 검증 상태·미평가 비율·표본 한계 또는 신뢰 구간을 함께 보고한다.
- 올바른 관계를 채택한 directed 사례가 0이면 조건부 채택 방향 정확도는 **N/A**다. 빈 분모의 품질 정확도를 100%로 보고하지 않는다.
- 조건부 방향의 분모는 정답의 종류·근거 조건과 채택 여부를 만족한 SUPPORTS/QUALIFIES 예측이다. 방향 자체의 정답 여부를 분모 조건으로 사용하지 않는다. 세부 metric과 복수 warrant 대응은 새 평가 계약에서 version으로 고정한다.
- 높은 confidence, 유효 anchor 위치, 형식 통과는 각각 의미 정당성이나 객관적 사실성을 증명하지 않는다. 0.9의 보정성은 별도 검증 과제다.

ADR-098의 “AI 제안 label은 사람 검토 전 CANDIDATE”, 평가 원장과 생산 지식 원장의 분리, 결정적 metric과 보조 LLM 진단 구분을 유지한다. 평가 책임자·독립 검증 방식·정규화의 의미 승인 절차는 별도 정의해야 한다. 수학적 증명·닫힌 문법 PoC의 성공을 자연어 정답 전체의 승인으로 확대하지 않는다.

기존 frozen evaluator와 결과를 이번 결정에 맞춰 소급 수정하지 않는다. 향후 새 metric/reference 계약을 적용할 때는 새 revision·identity·범위를 고정하며 기존 threshold를 조용히 낮추지 않는다.

### D3 — 병목과 비교 기준을 먼저 증명한다

작업 순서는 다음과 같다.

`제품 인수 결과 → 평가 신뢰성 확인 → 실제 병목·필요성 증명 → 관련 OSS 재사용 판단 → 최소 기술 보완 → 회귀·비용·제품 Gate 검증`

필요성이 확인되지 않은 DeepSeek prompt/schema의 즉흥 변경, SSC 연속 버전 설계, Qwen/NLI 등 새 모델 비교 및 대량 재실험은 **HOLD**다. 필요성이 입증된 구현 범위에서는 기존 OSS-first·version/license/security·Port/Adapter·Contract 원칙을 적용한다. 조사나 PoC의 존재만으로 구조 교체를 채택하지 않는다.

### D4 — 중지·동결·운영 기준을 보존한다

- Architecture B v1의 잔여 24회는 재개하지 않는다. 12/36 중지 결과와 raw/provenance를 보존한다.
- 기존 72쌍은 노출된 개발·역사 비교 자료다. 독립 승인 Gold 또는 blind acceptance 자료로 사용하지 않는다.
- 기존 432회 결과, Gold annotations, corpus membership, scorer/parser, 실험 identity와 소비된 UNRESOLVED 결과는 덮어쓰거나 새 실험으로 이관하지 않는다.
- v11 `vp-deepseek-relation-v11-contractual-protocol-and-physical-generalization`과 0.9 gate는 유지한다. ADR-161/164의 DeepSeek 실행 권위와 model identity도 유지한다.
- 글로벌 예산·동일 credential execution context·claim/job/lease/attempt binding·authorized-egress 경계·중복 호출 fence·OUTCOME_UNKNOWN·복구 이력을 유지한다.
- 중지된 평가 구현과 그 생성물은 미검증 초안이다. “freeze”, “verified”, “ready”라는 초안 필드가 채택/검증 근거가 되지 않는다. [보존 manifest](../../implementation/development-strategy-reset-2026-10-10/paused-drafts.json)의 stash에서 보존하고 자동 재개하지 않는다.
- VP-06/07 이후는 기존 STOP을 유지한다. 새 ADR 작성으로 VP-05의 미완료 Gate가 종료되지 않는다.

### D5 — 목표와 안전 경계 안에서 방법을 위임한다

요청서는 목적·달성 결과·완료 기준·보존 대상·승인 경계를 중심으로 작성한다. 상위 실행 에이전트는 해당 목표 안에서 조사, OSS 선택, 구현 방법, 검증 방식을 결정하고 수정·절충 이유와 증거를 결과에 기록한다.

이 자율성은 사용자의 명시적 금지, 승인된 Contract/Test/안전 조건, publication·운영 정책·생산 데이터·예산·새 Gate의 승인 경계를 무효화하지 않는다. 중요한 전략·권위·범위 변경은 사용자 결정이 필요하다. 결과 검토 역할을 분리하되, ChatGPT나 다른 AI의 검토만으로 독립적인 사람의 의미 승인이 완료됐다고 주장하지 않는다.

작업 실패가 반복되면 작은 prompt/schema 보정을 계속하기 전에 원인·평가 기준·요구사항을 재검토한다. 미검증 후보를 활성 지식 권위로 올리지 않는다.

## 3. 전략 실행 순서와 기존 추적 ID

| 전략 우선순위      | 달성 결과                                                  | 종료 증거                                                       |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------------------- |
| A 평가 신뢰성      | 검증 상태·제공 문맥·복수 해석·metric 분모 구분             | 승인되지 않은 기준의 인증 지표 제외, 구조 검사와 의미 승인 분리 |
| B 제품 진단        | A 투입→질문→B/A 수정→재질문, 대기/재개·인용·버전·실패 관측 | 실증/미검증 기능과 검색·근거·추론·원장·출력 원인의 분해         |
| C 관계 방식 재평가 | 현행 사전 축적·질문 시 평가·혼합형의 필요성 비교           | 품질·재생·지연·비용·보안·권위 영향에 따른 유지/보완/전환 권고   |
| D 최소 수정        | 재현된 제품 병목에 필요한 변경만 구현                      | 신뢰 가능한 개선·회귀·비용·실행 안정성 증거                     |
| E 잔여 Gate 복귀   | VP-04/05와 이후 패키지를 기존 의존성대로 판정              | tracker/DoD의 필수 Gate와 기존 인수 기준 충족                   |

A–E는 우선순위이며 VP-01~~VP-11 tracker ID 또는 VP-0~~VP-4 제품 단계의 번호/계약을 바꾸지 않는다. COMPLETE_WITH_LIMITS는 제한·해제 계획·승인된 적격성 판단을 필요로 하며 필수 안전·제품·평가·OSS Gate를 우회하는 상태가 아니다.

## 4. 기존 결정과의 정확한 관계

| 기준                          | 관계와 적용 범위                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-098                       | **AMENDS_REPORTING_ONLY**: 향후 관계 평가의 검증 상태·분모·조건부 방향·안정성 분리를 명시. 기존 Claim/Search 계약, 승인 이력과 frozen 결과 보존                                                  |
| ADR-172 §13.1                 | **AMENDS_EVIDENCE_INTERPRETATION_ONLY**: frozen Gold recall은 그 기준의 신뢰 수준과 제공 입력 범위 안에서만 증거. 100% critical / ≥99% overall candidate recall 요구와 Frontier 계약은 변경 없음 |
| ADR-172 제품·원장·§13 나머지  | **RETAINS**: 자동 VP Ledger, Source/Evidence, CandidateFrontier, READY/관계 농축 분리, 증분/rebuild·예산·복구 계약                                                                               |
| ADR-161/164                   | **RETAINS**: provider/model identity, no silent fallback. 새 모델은 미검증 대안이며 운영 활성화 승인 아님                                                                                        |
| ADR-117/120/121               | **RETAINS**: Git main publication·원본/변경 이력·단일 ADR 번호 owner. 로컬 승인을 Canonical 게시로 혼동하지 않음                                                                                 |
| ADR-079–092 / OSS Role Matrix | **RETAINS**: 정당화된 구현 범위의 Module·Contract·안전·OSS 검증. 본 결정은 새 OSS/runtime 채택이 아님                                                                                            |
| 기존 승인형 Phase ADD/ADR-160 | **NO_NEW_SUPERSESSION**: VP 적용 제외는 이미 ADR-172가 규정. 기존 승인형 제품 계약은 역사/해당 경로에서 유지                                                                                     |
| 구현 로드맵·agent 작업 순서   | **AMENDS_VP_PROCESS_PRIORITY**: 제품/평가/병목 증명이 기술 실험 착수보다 먼저. 관련 OSS 검토와 필수 Gate는 유지                                                                                  |

대체되는 것은 “동결 후보 점수면 인증 의미 품질이다”, “기술 후보가 제안되면 즉시 반복 실험한다”, “제한 표기만으로 다음 Gate를 자동 진행한다”는 활성 해석/진행 방식이다. 이를 정식 ADR 전체의 폐기라고 기록하지 않는다. [충돌·정합성 정리](../../implementation/development-strategy-reset-2026-10-10/reconciliation.md)에 실제 문서 절과 변경 이유를 남긴다.

## 5. 확정하지 않은 기술적 대안

다음은 이번 전략으로 채택되지 않는다.

- SSC v0.1/v0.2, compact tuple, 별도 role finalizer 또는 새 confidence 계약의 운영 적용.
- 닫힌 문법 parser나 서명 review registry 초안의 평가 권위 채택.
- Qwen/NLI/Jev 또는 다른 model/provider로의 실행 전환.
- 사전 관계 축적을 질문 시 비교로 대체하는 방식. ADR-172의 관계 기록·원장·증분/replay 계약을 변경하려면 별도 ADR·영향/회귀 검증·사용자 승인이 필요하다.
- 관계 benchmark를 최종 답변 품질의 대체 지표로 삼는 방식.
- Gate 축소, VP-05의 제한부 완료, 새 calibration threshold, 대량 A/B/새 blind holdout.

## 6. 미결사항과 후속 작업 기준

미결사항은 평가 범위·독립 의미 승인 책임자와 증빙, 대표적인 제품 질문/답변 집합, 검색/추출/관계/답변 품질의 분리, v11/SSC의 실제품 병목, 0.9 보정성, 실측 청구 비용, 관계 후보 축소·대기 지연, VP-05 종료 적격성이다.

후속 요청의 첫 목표는 **VP-05 전략 재정립 및 평가 신뢰성 회복**이다. 기존 narrow proof와 미검증 내용을 구분하고, 남은 VP-04/05 조건을 제품 영향과 연결하며, 유지/보완/전환 및 Gate 종료 가능성의 근거를 준비한다. 문서 승격 작업 자체는 이 구현 과제를 자동 실행하거나 중지된 draft를 재개하지 않는다.

허용된 목표 안의 방법 선택에는 구현법 사전 승인을 요구하지 않는다. Gold-B-7 개봉, 운영 정책·생산 데이터·데이터 권위 변경, 새 architecture 전환, push/PR/merge, VP-06 진입은 별도 명시적 승인 대상이다. 이 ADR이 이미 부여한 **문서 정비 승인**을 다시 요구하지 않는다.

## 7. 결과·검증·되돌리기

이번 변경은 새 ADR·관계 metadata·ADD/개발계획/평가/agent 안내의 문서 정비다. 생산 code·DB·Semantic policy·frozen evaluator는 변경하지 않는다. 기존 전략의 보안·원문·실행 무결성을 개선 속도나 품질 점수로 완화하지 않는다.

검증은 ADR owner/index·링크·Canonical/생성물 registry·문서 drift, 변경 범위, source/stash bytes, 기존 frozen 결과와 production semantic digest 보존으로 수행한다. [완료 보고](../../implementation/development-strategy-reset-2026-10-10/report.md)가 증거와 남은 publication 조건을 기록한다.

`NO_RELEVANT_OSS` for strategy authority and document reconciliation. 기존 문서 validator와 Git/hash 도구를 재사용하며 OSS dependency·version·license·runtime·Role Matrix 채택 상태를 바꾸지 않는다. 문서 실행 방식의 rollback은 본 commit의 문서 변경을 명시적으로 revert하고 관계 metadata를 갱신하는 것이며, 이전 기록과 중지된 draft 보존 stash는 삭제하지 않는다.

## Change history

- 2026-10-10: 사용자 요청으로 전략 v0.1을 신규 ADR-173의 결정으로 승격. 원본 draft와 Git Canonical 게시 경계 보존. 기존 ADR 전체 폐기 없음.

## 2026-10-12 implementation note — A1·A2 decision delegation

사용자의 A1·A2 위임으로 A1 다음 A2를 구체화한 local head는 `e8d0f7d769722f4482ff26a9828812f37e1270cc`다. 이후 `A1_CHANGES_REQUIRED / A2_CONDITIONALLY_ACCEPTED / PUBLICATION_HOLD` 정정이 사용자 최종 Reference 승인·reviewer 지정 의무를 대체했다. [현재 Section 기록](../add/vp05-evaluation-trust/README.md)은 Project Owner의 아키텍처·정책 승인과 개별 의미 검증을 분리하고, 준비·기계 검증·증거 수집·분류·측정 운영은 상위 에이전트가 담당한다. 인증에는 사용자 외부 적격 인간 검증 또는 동등한 외부 reference provenance가 필요하며, 증거가 없으면 CANDIDATE/UNVERIFIED다. 사용자가 개별 지식·관계·AI 결과를 review/승인하거나 reviewer를 지정할 의무는 없고, 인증 Gold 부재로 제품에 승인 클릭을 추가하지 않는다. A2 문맥·v6/v11 구분, D2/D4/D5 및 ADR-117/120 게시 경계는 유지한다. 선행 승인/위임 기록은 보존하며 뒤의 명시적 정정을 현재 계약으로 적용한다. 새 실행·운영 권위 없이 게시 HOLD를 유지한다.
