<!-- Canonical source: https://app.notion.com/p/39f5181d71ad818f8b85dc6395eaa781 -->

## 문서 관리
- 범위: Phase 4 구현 검증·운영 설정
- 상태: **추적 중**
- 정책 수준 사용자 결정 대기: **없음**
- 관련 ADD: [Phase 4 — 비교·변경안·승인 ADD (완료)](https://app.notion.com/p/39f5181d71ad8163b741f77df194b7ac)
## 확정된 정책이며 재논의하지 않는 항목
- GPT·Gemini·Claude를 전 Phase에 폭넓게 활용
- 특정 공급자에 Canonical 계약을 고정하지 않음
- 고영향·모호 항목은 독립 공급자 교차 검토
- 모델 불일치 보존, 다수결 자동 승인 금지
- 모든 Canonical 변경은 명시적 사용자 승인 필수
- Fact Priority와 근거 강도 분리
- 실제 graph edge만 영향 경로로 인정
- 항목별 승인과 필요한 atomic group
- 거절·보류 이력 보존
## 다중 AI Provider 검증
- 작업 유형별 GPT·Gemini·Claude 품질 corpus
- 의미 동일성, 시간 범위, 충돌 유형과 Directive 적용 설명 정확도
- challenger 실행 조건과 제3 분석 조건
- 모델별 비용·지연·rate limit·데이터 처리 정책
- 모델 교체와 prompt migration 시 결과 drift
- provider 장애 시 새 Attempt와 폴백 표시
## Canonical 비교 검증
- Entity·Claim 동일성 false merge·false split 평가
- snapshot 검색 recall·precision
- 프로젝트·접근 범위 누출 테스트
- temporal coexistence와 supersede 분류 corpus
- Directive scope·exception·effective period 적용
- Fact Priority와 evidence vector 분리 확인
## Conflict Analysis 검증
- 직접 모순, 값·범위·시점·정의·identity 충돌 분류
- 다중 모델 불일치 표시 품질
- 단일 trust score가 생성되지 않는지 검사
- unresolved 상태 보존과 Phase 5 인계 차단 조건
## Recursive Impact 검증
- typed dependency registry와 graph edge coverage
- cycle detection, depth·node·time·cost budget
- `TRUNCATED_BY_BUDGET`와 frontier 표시
- weak edge·possible impact의 오탐 통제
- 대규모 graph에서 gbrain Job 분할·재시도
- stale trigger와 재계산 성능
## Draft ChangeSet·Burst Diff 검증
- operation별 schema와 dependency 검증
- atomic group 최소화
- machine diff와 Burst Diff 의미 일치
- 사실·범위·시간 변경과 표현 변경 구분
- 예상 비용 범위 정확도
- stale·lock·optimistic version conflict UX
## Review·Approval UX 검증
- 긴 ChangeSet의 필터·정렬·부분 승인
- 원문 Evidence와 원문 복귀
- 모델별 의견과 차이를 과도한 복잡성 없이 표시
- Conflict·Impact tree와 2D graph의 목록 대안
- 키보드·스크린리더 접근성
- 고위험 승인 재인증 방식
- 모바일·데스크톱 검토 흐름
## Phase 5 연기 항목
- 실제 Canonical commit 트랜잭션
- Fact·Claim·Entity·Relation·Event 반영 규칙
- HistoryEvent 생성
- post-commit projection·검색·graph 갱신
- rollback 역변경 ChangeSet
