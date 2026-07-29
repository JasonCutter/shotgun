<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81538bb8c18404237e92 -->

## 문서 관리
- 범위: Phase 5 설계·결정 이력
- 상태: **누적 기록**
- 관련 ADD: [Phase 5 — 공식 지식·확장 ADD (완료)](https://app.notion.com/p/39f5181d71ad81cb97aade975f01c71e)
## 2026-07-16
### Phase 5 전 구간 설계
Detailed Map의 Step 15\~17, 24개 Section을 검토해 Canonical 반영, Compiled Truth·검색·Graph Projection, Knowledge Discovery와 Phase 3 재진입 계약을 작성했다.
### Canonical 반영 경계
Phase 4의 사용자 승인 결과만 `ApprovedChangeSetManifest`로 반영한다. Canonical mutation, revision, HistoryEvent와 outbox를 하나의 트랜잭션으로 묶고 Claim을 Fact로 자동 승격하지 않는다.
### History·Rollback
이전 revision·경쟁 Claim·미해결 Conflict를 보존한다. Rollback은 과거 상태 덮어쓰기가 아니라 역변경 Draft ChangeSet을 만들어 Phase 4의 비교·Impact·사용자 승인을 다시 통과하도록 했다.
### Compiled Truth와 Projection
Compiled Truth, 검색 인덱스, Semantic Graph와 cache는 Canonical에서 재생성되는 버전화 Projection으로 확정했다. Projection 실패는 성공한 commit을 되돌리지 않으며 watermark·readiness·지연 상태를 사용자에게 표시한다.
### Knowledge Discovery 자동화
기존 사용자의 AI 자동 분류 선호와 Phase 3 direct-only 기본 Batch 결정을 결합했다. 승인 직후 증분, 일요일 밤 주간 자동, 사용자 요청의 세 Discovery 경로를 사용한다. GPT·Gemini·Claude가 Gap·새 관계·패턴·확인 질문·Action 후보를 찾지만 모든 결과는 후보로만 남긴다.
### 자동 분류·재분류
분류는 AI가 자동 수행하고 맞는 범주가 없으면 넓은 새 분류 후보를 만든다. 초기 taxonomy를 과도하게 세분화하지 않고 자료 축적 뒤 재분류하며, 매 건 사용자 승인으로 흐름을 막지 않는다.
### 재진입과 루프 방지
Discovery 결과는 `DiscoveryReentryManifest`로 Phase 3에 재진입하고 Phase 4 승인을 다시 거친다. semantic signature·snapshot·profile 기반 suppression으로 반복 제안과 자동 탐색 순환을 억제한다.
### 완료 처리
사용자에게 추가로 물어야 할 정책 결정은 없었다. 구현 제품·수치·모델 benchmark는 별도 구현 검증 목록으로 분리하고 Phase 5를 완료 처리했다.
