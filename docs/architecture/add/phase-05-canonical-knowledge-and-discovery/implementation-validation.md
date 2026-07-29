<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81f0bb08c3030b0fbe36 -->

## 문서 관리
- 범위: Phase 5 구현 기술·벤치마크·운영 설정
- 상태: **추적 중**
- 관련 ADD: [Phase 5 — 공식 지식·확장 ADD (완료)](https://app.notion.com/p/39f5181d71ad81cb97aade975f01c71e)
## 확정 정책이며 재논의하지 않는 항목
- 미승인 후보의 Canonical 반영 금지
- Claim의 자동 Fact 승격 금지
- Canonical commit·HistoryEvent·outbox의 원자적 경계
- 이전 revision·경쟁 Claim·미해결 Conflict 보존
- Rollback은 역변경 ChangeSet과 재승인
- Compiled Truth·검색·Graph·cache는 파생 Projection
- Projection 지연과 Canonical commit 성공 분리
- Discovery의 승인 직후·주간 자동·사용자 요청 실행
- AI 자동 분류와 넓은 초기 taxonomy
- Discovery 결과의 Phase 3\~4 재진입
- 외부 Action 자동 실행 금지
## Canonical 저장·트랜잭션 검증
- PostgreSQL 등 저장 엔진 선택과 transaction isolation
- optimistic concurrency·atomic group·referential integrity
- transaction outbox·event ordering·at-least-once consumer
- commit ledger와 응답 유실 복구
- schema migration 중 read/write 호환성
## Canonical 모델 검증
- Fact·Claim·Entity·Relation·Event·Conflict·Directive revision schema
- valid time와 transaction time 모델
- n-ary relation·identity merge·retire·supersede 표현
- HistoryEvent 저장량·압축·감사 조회 성능
- 민감정보 마스킹과 접근정책 상속
## Projection 검증
- Compiled Truth projector 결정성 테스트 corpus
- 증분 Projection과 full rebuild 결과 동등성
- watermark·readiness·shadow rebuild·active pointer 전환
- 대규모 정책 변경·Graph corruption의 복구 시간
- Projector version upgrade·rollback 전략
## 검색 구현 검증
- exact·filter·hybrid·semantic 검색 엔진 선택
- 한국어·혼합언어 검색 품질
- embedding provider·model·차원·비용 benchmark
- 원문 Evidence Citation lookup latency
- 접근 범위·민감도 필터의 pre-filter/post-filter 안전성
- index alias swap·reindex 중 무중단 조회
## Semantic Graph 검증
- relational graph·dedicated graph DB·hybrid 방식 비교
- typed edge traversal·시간 조건·Conflict 조회 성능
- 접근 권한에 따른 subgraph filtering
- 대형 connected component와 cycle 처리
- Graph Projection 재생성과 Canonical referential validation
## 캐시·파생 결과 검증
- dependency tag와 canonical watermark schema
- stale propagation 정확도와 과잉 무효화율
- background refresh 우선순위·비용 한도
- 외부 게시 결과의 오래됨 감지와 정정 후보 생성
## Discovery 검증
- GPT·Gemini·Claude별 Gap·관계·패턴·추세 발견 품질
- 독립 challenger가 실제 오류·누락을 줄이는 정도
- 모델 불일치·가정·도출 요약의 사용자 이해도
- automatic taxonomy의 과분류·저분류·재분류 품질
- suppression signature의 반복 제안 억제율과 오억제율
- 승인 직후 증분·주간 전체 Discovery의 비용·지연
- Phase 3 재진입 loop·폭주·후보 중복 방지
## 운영 설정
- 주간 Discovery의 정확한 실행 시각과 catch-up
- 주간·월간 AI 비용 한도와 모델별 quota
- 증분 Discovery의 최대 영향 범위·depth·time budget
- full rebuild의 maintenance window와 사용자 알림
- Projection lag 경고 임계값
## Phase 6로 연기
- 검색·답변·요약·콘텐츠 생성 모드와 Citation UX
- 위험도에 따른 자동 제공·검토
- 화면·문서·파일·읽기 API
- 외부 Action 승인·실행·보상
- 결과 피드백과 재진입
