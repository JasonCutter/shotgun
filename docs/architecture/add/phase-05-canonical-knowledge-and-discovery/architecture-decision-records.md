<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81d29c1ae9dc5c537e1c -->

## 문서 관리
- 범위: ADR-049\~ADR-060
- 상태: **Accepted**
- 기준일: 2026-07-16
- 관련 ADD: [Phase 5 — 공식 지식·확장 ADD (완료)](https://app.notion.com/p/39f5181d71ad81cb97aade975f01c71e)
## ADR-049 — 승인 Manifest 기반 원자적 Canonical Commit과 Transactional Outbox
**상태:** Accepted
**맥락:** 공식 지식, History와 후속 이벤트 중 일부만 반영되면 원장과 Projection이 불일치한다.
**결정:** `ApprovedChangeSetManifest` 검증, Canonical mutation, revision, HistoryEvent와 outbox 기록을 하나의 DB transaction으로 처리한다. 검색·그래프·AI 호출은 transaction 밖에서 실행한다.
**제외 대안:** Canonical 저장 후 별도 프로세스가 History·이벤트를 best-effort 기록.
**영향:** commit ledger, optimistic concurrency, outbox consumer idempotency가 필요하다.
## ADR-050 — Claim과 Fact의 공식 기록 분리 및 자동 승격 금지
**상태:** Accepted
**맥락:** 사용자가 승인한 Claim이 곧 외부 세계의 사실이라는 뜻은 아니다.
**결정:** Claim은 attribution·양태·시간·Evidence를 가진 공식 주장으로 기록한다. Fact는 `PROMOTE_TO_FACT` 등 별도 작업이 명시적으로 승인된 경우에만 생성·수정한다. 모델 confidence로 자동 승격하지 않는다.
**제외 대안:** 승인된 모든 Claim을 Fact로 저장.
**영향:** Canonical schema와 Review UX가 Claim·Fact를 명확히 구분한다.
## ADR-051 — 불변 Revision·경쟁 Claim·충돌의 보존
**상태:** Accepted
**결정:** Canonical 변경은 현재값 덮어쓰기가 아니라 새 revision·유효기간·상태 변경으로 기록한다. 이전 Fact·Claim·미해결 Conflict와 해결 전 근거를 삭제하지 않는다.
**제외 대안:** 최신값 하나만 유지하거나 해결된 충돌을 삭제.
**영향:** 시간 여행 조회·감사·rollback 제안이 가능해진다.
## ADR-052 — HistoryEvent를 Append-only 변경 원장으로 사용
**상태:** Accepted
**결정:** 모든 commit은 actor·approver·before/after·근거·정책·승인 이유·correlation ID를 가진 append-only `HistoryEvent`를 만든다. AI 설명은 보조이며 구조화된 mutation이 기준이다.
**제외 대안:** 일반 애플리케이션 로그만으로 변경 이력 관리.
**영향:** Phase 6의 History·Audit 조회가 공식 계약을 가진다.
## ADR-053 — Rollback을 역변경 ChangeSet으로 처리
**상태:** Accepted
**결정:** 과거 revision을 직접 복원하거나 현재 기록을 삭제하지 않는다. 현재 상태를 기준으로 inverse Draft ChangeSet을 만들고 Phase 4 비교·Impact·사용자 승인을 다시 통과한다.
**제외 대안:** DB snapshot 되돌리기 또는 과거 row 재활성화 자동 실행.
**영향:** rollback도 근거·영향·승인 이력을 보존한다.
## ADR-054 — Compiled Truth는 Canonical에서 재생성되는 버전화 Projection
**상태:** Accepted
**결정:** Compiled Truth는 활성·과거·예정 Fact·Claim·Directive·Priority·Conflict를 현재 읽기 관점으로 조직한 파생 투영이다. Canonical이 아니며 원장에 없는 사실을 만들지 않는다.
**제외 대안:** Compiled Truth를 직접 편집 가능한 공식 지식 저장소로 사용.
**영향:** input snapshot·projector·schema·policy version과 watermark를 기록한다.
## ADR-055 — Projection Watermark·Readiness와 Canonical Commit 분리
**상태:** Accepted
**결정:** 검색·Graph·Compiled Truth·cache Projection 실패는 성공한 Canonical commit을 되돌리지 않는다. 각 투영은 watermark와 readiness를 가지며 최신이 아니면 사용자에게 지연·저하 상태를 표시한다.
**제외 대안:** 모든 Projection 완료까지 Canonical transaction을 열어두거나 오래된 결과를 최신처럼 제공.
**영향:** `READY`, `READY_WITH_LAG`, `DEGRADED`, `FAILED`, `STALE` 상태와 Phase 6 readiness gate가 필요하다.
## ADR-056 — 검색·Semantic Graph는 Canonical Projection이며 AI edge는 후보로 격리
**상태:** Accepted
**결정:** 검색 인덱스와 Semantic Graph는 승인된 Canonical·Compiled Truth만 투영한다. AI가 발견한 동의어·검색어 확장은 recall 필드로 쓸 수 있으나 Citation은 원문 Evidence를 가리킨다. 새 AI relation edge는 Discovery 후보로만 저장한다.
**제외 대안:** 추론 edge와 미승인 후보를 기본 검색·Graph에 혼합.
**영향:** 검색 문서·Graph node/edge contract가 Canonical ID·revision·접근 범위를 보존한다.
## ADR-057 — 증분 Projection 기본과 검증 가능한 전체 Rebuild
**상태:** Accepted
**결정:** 일반 commit은 변경 ID·인접 typed edge 범위만 증분 갱신한다. schema·embedding·접근 정책 변경, 손상과 watermark 불일치 시 새 Projection version을 전체 재생성한 뒤 검증 후 active pointer를 전환한다.
**제외 대안:** 매 commit마다 전체 rebuild 또는 손상 상태에서 계속 증분 갱신.
**영향:** projector 결정성·shadow build·atomic alias swap이 필요하다.
## ADR-058 — Knowledge Discovery의 자동·증분·요청 실행과 후보 전용 경계
**상태:** Accepted
**맥락:** 사용자는 AI가 분류·발견을 자동 수행하고 불필요한 개입을 요구하지 않기를 원한다.
**결정:** 승인 직후 증분 Discovery, 일요일 밤 주간 자동 Discovery, 사용자 요청 Discovery를 지원한다. 모든 발견은 `DERIVED_INFERENCE` 후보이며 자동 Fact·Canonical write·외부 Action 실행을 금지한다.
**제외 대안:** 사용자 요청 때만 탐색하거나 발견 결과를 자동 공식화.
**영향:** trigger·범위·비용·idempotency와 Activity 표시가 필요하다.
## ADR-059 — AI 자동 분류는 넓게 시작하고 축적 후 재분류
**상태:** Accepted
**결정:** GPT·Gemini·Claude가 Gap·관계·패턴 후보를 자동 분류한다. 맞는 범주가 없으면 넓은 candidate type·tag를 제안하되 초기부터 지나치게 세분화하지 않고 자료 축적 뒤 재분류한다. 사용자에게 매 건 분류 승인을 요구하지 않는다.
**제외 대안:** 고정 폴더 체계, 모든 새 분류의 사전 사용자 승인, 처음부터 과도한 taxonomy.
**영향:** taxonomy revision·alias·reclassification History를 지원한다.
## ADR-060 — Discovery 결과의 Phase 3 재진입과 순환 억제
**상태:** Accepted
**결정:** Discovery 결과는 `DiscoveryReentryManifest`로 Phase 3에 들어가 schema·Evidence·dependency validation을 받고 Phase 4 비교·승인을 다시 거친다. 동일 snapshot·profile·semantic signature의 반복 제안은 억제하고 새 Evidence·정책 변경 때만 재활성화한다.
**제외 대안:** Step 17에서 직접 Canonical 반영 또는 무제한 자동 재귀 탐색.
**영향:** loop detection, suppression signature, depth·cost budget이 필요하다.
