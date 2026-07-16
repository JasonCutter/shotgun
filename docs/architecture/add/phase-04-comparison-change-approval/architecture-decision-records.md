<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81209185ed8dc8a1ac49 -->

## 문서 관리
- 범위: ADR-037\~ADR-048
- 상태: **Accepted**
- 기준일: 2026-07-16
- 관련 ADD: [Phase 4 — 비교·변경안·승인 ADD (완료)](https://app.notion.com/p/39f5181d71ad8163b741f77df194b7ac)
## ADR-037 — 전 Phase 다중 AI 공급자 활용 원칙
**상태:** Accepted
**맥락:** 하나의 AI 모델에 의존하면 능력·비용·장애·편향과 공급자 변경 위험이 커진다.
**결정:** GPT·Gemini·Claude를 주요 `AIProviderPool`로 폭넓게 활용한다. capability 기반 라우팅, 독립 challenger 검토와 필요 시 제3 분석을 사용한다. 특정 공급자의 출력 형식을 Canonical 계약에 고정하지 않는다.
**제외 대안:** 단일 모델 영구 고정, 모든 작업의 무조건 3모델 실행.
**영향:** 모든 AI 호출은 Adapter, 버전, 프롬프트, 비용과 Attempt를 기록한다.
## ADR-038 — AI 의미 분석과 결정적 정책·권한 엔진 분리
**상태:** Accepted
**결정:** AI는 의미 비교·설명·초안·누락 검토를 담당한다. 접근 권한, Directive·Priority 적용 범위, 상태 전이, 그래프 traversal, 잠금과 승인 권한은 결정적 시스템이 담당한다.
**제외 대안:** 모델 프롬프트에 권한·정책 집행을 위임.
**영향:** AI 오류가 권한 상승이나 Canonical write로 직결되지 않는다.
## ADR-039 — 버전화된 Canonical Snapshot 기반 비교
**상태:** Accepted
**결정:** 모든 비교 결과는 특정 Canonical snapshot, 후보 revision, Directive·Priority 버전에 결속한다. snapshot 변경 시 미리보기를 stale 처리한다.
**제외 대안:** 항상 최신 DB를 비고정 조회해 검토 중 결과가 변하는 방식.
**영향:** 비교·Diff·승인 결과를 재현할 수 있다.
## ADR-040 — User Directive·Fact Priority·근거 강도 분리
**상태:** Accepted
**결정:** 접근·보안 정책, 적용 가능한 Directive, Fact Priority, 근거 강도, AI 분석을 별도 계층으로 적용한다. Priority는 근거가 아니며 Directive는 외부 사실을 참으로 만들지 않는다.
**제외 대안:** 모든 요소를 하나의 신뢰도 점수로 합산.
**영향:** 판단 이유를 정책 영향과 근거 영향으로 분리 설명한다.
## ADR-041 — 충돌·시간 차이·모호성 보존
**상태:** Accepted
**결정:** 직접 모순, 값·범위·시점·정의·identity 차이를 분리하고, 시점에 따라 함께 참일 수 있는 주장은 `TEMPORALLY_COEXISTS`로 보존한다. 해결 불가능한 모호성을 단일 결론으로 강제하지 않는다.
**제외 대안:** 최신 자료나 우선순위가 높은 출처로 자동 대체.
**영향:** 미해결 Conflict도 Canonical 검토 대상이 된다.
## ADR-042 — 모델 간 불일치의 검토 정보화
**상태:** Accepted
**결정:** GPT·Gemini·Claude 분석이 중요한 결론에서 다르면 이를 숨기거나 다수결로 제거하지 않고 `MODEL_DISAGREEMENT`로 보존한다. 제3 분석은 추가 관점이며 자동 정답이 아니다.
**제외 대안:** 다수결 자동 판정, 첫 모델 결과만 저장.
**영향:** 사용자는 모델별 핵심 근거와 차이를 볼 수 있다.
## ADR-043 — 실제 Typed Edge 기반 Recursive Impact
**상태:** Accepted
**결정:** 직접·재귀 영향은 실제 dependency·graph edge로 결정적으로 탐색한다. AI는 경로의 의미·중요도와 누락 가능성을 설명하지만 edge를 발명하지 않는다.
**제외 대안:** LLM이 영향 목록을 자유 생성.
**영향:** cycle·depth·node·time budget과 truncation 상태가 필요하다.
## ADR-044 — Conflict·Impact Projection의 재생성 가능성
**상태:** Accepted
**결정:** `ConflictProjection`과 `ImpactProjection`은 Canonical 원장이 아닌 버전화된 파생 읽기 모델이다. 입력 snapshot·정책·모델에서 재생성한다.
**제외 대안:** Projection을 직접 Canonical 상태로 저장.
**영향:** 분석 모델 변경과 재계산이 원장 이력을 훼손하지 않는다.
## ADR-045 — Draft ChangeSet 불변 Revision과 이중 Diff
**상태:** Accepted
**결정:** Draft ChangeSet은 불변 revision으로 누적한다. 구조화된 machine diff와 Evidence로 검증된 사용자용 Burst Diff를 함께 만든다.
**제외 대안:** 현재 초안 덮어쓰기, 자연어 요약만 제공.
**영향:** 변경 전후·근거·영향과 승인 당시 상태를 감사할 수 있다.
## ADR-046 — 모든 Canonical 변경의 명시적 사용자 승인
**상태:** Accepted
**결정:** 위험도와 관계없이 모든 Canonical 변경은 사용자 본인의 명시적 승인을 받아야 한다. AI·자동화·모델 합의는 승인 권한을 갖지 않는다.
**제외 대안:** 저위험·고신뢰 후보 자동 승인.
**영향:** Phase 4는 승인된 Manifest만 Phase 5로 전달한다.
## ADR-047 — 항목별 승인과 Atomic Group
**상태:** Accepted
**결정:** 기본은 ChangeSet item별 승인이다. 분리 시 불일치가 발생하는 항목만 `atomic_group`으로 묶는다. 부분 승인이 dependency를 깨면 새 ChangeSet revision과 영향 재계산을 요구한다.
**제외 대안:** ChangeSet 전체 일괄 승인만 지원.
**영향:** 대규모 변경에서도 안전한 부분 승인과 보류가 가능하다.
## ADR-048 — 사용자 수정의 유형별 재검증과 거절 이력 보존
**상태:** Accepted
**결정:** 표현·사실·근거·범위·identity·새 Claim·Directive 수정을 구분해 Phase 2\~4의 적절한 단계로 라우팅한다. 보류·거절 후보와 이유는 삭제하지 않고 Canonical에서만 제외한다.
**제외 대안:** 모든 수정을 Phase 4에서 직접 적용, 거절 항목 삭제.
**영향:** 근거 없는 사용자 수정의 조용한 Canonical 반영을 방지하고 반복 제안을 억제할 수 있다.
