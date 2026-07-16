<!-- Canonical source: https://app.notion.com/p/39f5181d71ad8123bf4ede12323f82b7 -->

## 문서 관리
- 범위: Phase 4 설계·결정 이력
- 상태: **누적 기록**
- 관련 ADD: [Phase 4 — 비교·변경안·승인 ADD (완료)](https://app.notion.com/p/39f5181d71ad8163b741f77df194b7ac)
## 2026-07-16
### Phase 4 전체 설계 완료
Detailed Map의 Step 10\~14, 총 39개 Section을 비교, 충돌 분석, 영향 계산, ChangeSet·Diff와 사용자 판단 계약으로 통합 설계했다.
### 전 Phase AI 활용 대원칙 확정
사용자 지시에 따라 GPT·Gemini·Claude를 전 Phase에서 폭넓게 활용하도록 확정했다. 특정 공급자에 종속되지 않는 Adapter와 capability routing을 사용하고, 고영향·모호 항목은 독립 공급자 challenger와 필요 시 제3 분석을 사용한다. 모델 의견 차이는 다수결로 제거하지 않고 검토 정보로 보존한다. ADR-037·038·042에 기록했다.
### Canonical 비교·정책 적용
버전화된 Canonical snapshot을 사용하고 User Directive·Fact Priority·근거 강도·AI 분석을 분리했다. 시간에 따라 함께 참일 수 있는 주장을 충돌로 제거하지 않는다. ADR-039\~041에 기록했다.
### Conflict·Recursive Impact
Conflict Projection을 재생성 가능한 읽기 모델로 정의하고, 실제 typed graph edge 기반으로 영향 경로를 계산한다. AI는 경로 설명과 누락 점검을 담당하며 관계를 발명하지 않는다. ADR-043·044에 기록했다.
### Draft ChangeSet·Burst Diff
불변 ChangeSet revision, machine diff와 Evidence 기반 Burst Diff, dependency·atomic group, stale·lock·비용·후속 Job 미리보기를 확정했다. ADR-045·047에 기록했다.
### 사용자 승인 경계
모든 Canonical 변경은 위험도와 무관하게 사용자 본인의 명시적 승인을 필요로 한다. 사용자 수정은 유형별로 적절한 Phase에 재검증 라우팅하며 보류·거절 이력을 보존한다. ADR-046·048에 기록했다.
### Phase 4 완료
정책 수준 사용자 결정 대기 항목이 없으므로 Phase 4를 완료 처리했다. 구현 제품·모델·임계값·성능·UX는 구현 검증 대기로 분리했다.
