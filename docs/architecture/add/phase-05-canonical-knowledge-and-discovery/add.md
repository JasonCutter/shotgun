<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81cb97aade975f01c71e -->

## 문서 관리
- 상태: **완료**
- 범위: Phase 5 — 공식 지식·확장, Step 15\~17
- Section: 24개
- 기준일: 2026-07-16
- 기준 입력: Phase 4의 `ApprovedChangeSetManifest`
- 다음 Phase 인계: `Phase6ReadinessManifest`
- Canonical 저장소: Notion
- 사용자 결정 대기: **없음**
## Phase 5 완료 선언
Step 15\~17의 Canonical 반영, HistoryEvent, Compiled Truth, 검색·Semantic Graph·캐시 갱신, Knowledge Gap·새 관계·행동 후보 탐색과 Phase 3 재진입 계약을 모두 확정한다.
Canonical 변경은 Phase 4에서 사용자가 승인한 `ApprovedChangeSetManifest`만 반영한다. GPT·Gemini·Claude는 의미 검증·설명·Discovery에 폭넓게 활용하지만 Canonical write, 트랜잭션, 권한, 상태 전이와 Projection 일관성은 결정적 시스템이 담당한다.
## 1. 목적
Phase 5는 승인된 변경안을 공식 지식 원장에 원자적으로 반영하고, 그 결과로 현재 읽기 모델인 Compiled Truth와 검색·그래프·연결 파생 결과를 재생성한다. 공식 지식에서 발견되는 누락·약한 근거·새 관계·패턴·질문·행동 가능성은 다시 AI 후보로 생성해 Phase 3으로 되돌린다.
## 2. Phase 경계
### 입력
- `ApprovedChangeSetManifest`
- 승인 당시의 `DraftChangeSetRevision`, `BurstDiff`, `ReviewDecision`
- 고정된 Canonical snapshot과 예상 version
- 승인자·권한·접근 범위·민감도
- Evidence·Candidate·Comparison·Impact Provenance
### 출력
- 새 Canonical revision과 append-only `HistoryEvent`
- `CanonicalCommitted` outbox event
- 버전화된 `CompiledTruthProjection`
- 검색 인덱스·Semantic Graph·캐시 readiness
- `DiscoveryCandidateSet`
- Phase 3 재진입용 `DiscoveryReentryManifest`
- Phase 6 진입 상태인 `Phase6ReadinessManifest`
### 이 Phase에서 하지 않는 일
- 미승인 후보를 공식 지식으로 반영하지 않는다.
- 승인된 Claim을 자동으로 Fact로 승격하지 않는다.
- 과거 상태나 해결되지 않은 충돌을 삭제하지 않는다.
- Projection·검색 인덱스·그래프를 Canonical 원장으로 취급하지 않는다.
- Discovery 결과를 자동 Fact로 만들거나 외부 Action을 실행하지 않는다.
## 3. 공통 불변 조건
- Canonical 원장은 승인된 변경과 이력의 유일한 기준이다.
- Claim과 Fact는 별도 유형·상태·승격 경계를 유지한다.
- 이전 revision·경쟁 Claim·미해결 Conflict를 조용히 삭제하지 않는다.
- 모든 Canonical commit은 멱등하고 원자적이어야 한다.
- Compiled Truth·검색·그래프·캐시는 Canonical에서 재생성되는 파생 투영이다.
- Projection 실패는 Canonical commit을 되돌리지 않지만 readiness를 낮추고 사용자에게 지연 상태를 표시한다.
- GPT·Gemini·Claude의 분석은 Provenance와 revision을 가지며 Canonical write 권한을 갖지 않는다.
- Discovery 결과는 전부 `DERIVED_INFERENCE` 후보이며 Phase 3\~4를 다시 통과한다.
- 접근 범위와 민감도는 Canonical·Projection·Discovery·로그에 상속한다.
## 4. 처리 흐름
`ApprovedChangeSetManifest`
→ 승인·권한·snapshot precondition 재검증
→ Canonical transaction 계획
→ Fact·Claim·Entity·Relation·Event·Directive·Conflict 원자적 반영
→ `HistoryEvent`와 outbox 기록
→ commit 완료
→ Compiled Truth 증분 투영
→ 검색·Semantic Graph·캐시 갱신
→ readiness 계산
→ 승인 직후 증분 Knowledge Discovery
→ 주간 전체 Discovery Batch
→ Discovery 결과의 Phase 3 재진입
→ `Phase6ReadinessManifest`
## 5. AI 활용과 책임 경계
### 폭넓은 활용
- 승인 변경안과 실제 commit 결과의 의미 일치 검토
- HistoryEvent 사용자 설명 초안
- Compiled Truth의 충돌·시간 상태 설명
- 검색어 확장·동의어·다국어 표현 생성
- 새 관계·패턴·Knowledge Gap 탐색
- 확인 질문·조사 과제·Action 후보 생성
- Discovery 결과의 challenger·교차 검토
### 결정적 시스템 책임
- 승인권한과 manifest digest 검증
- optimistic concurrency·잠금·트랜잭션·outbox
- Canonical ID·revision·referential integrity
- projection watermark·재생성·readiness
- 실제 graph edge와 dependency 계산
- 후보 상태 전이와 Phase 3 재진입
### 모델 운영
- GPT·Gemini·Claude는 capability·비용·지연·데이터 정책에 따라 라우팅한다.
- 중요한 Discovery나 모델 불일치는 독립 공급자 challenger를 사용할 수 있다.
- 다수결은 사실성 판정이 아니다. 모델별 근거·도출·불일치를 보존한다.
- 특정 공급자 출력 형식을 Canonical 스키마에 고정하지 않는다.
## 6. 오픈소스·기존 구현 연계
### gbrain
**재사용 우선**
- Minion Queue·Job·Attempt·idempotency·retry·recovery
- Fact·Relation·Timeline 저장 계약과 Audit 패턴
- 후속 Projection Job orchestration
**경계**
- Shotgun의 Claim·Fact 분리, 승인 manifest, HistoryEvent, Conflict, Compiled Truth와 Discovery 재진입 정책이 우선한다.
- gbrain 저장소에 직접 미승인 후보를 쓰지 않는다.
### lucasastorian/llmwiki
- 원문·Evidence 복귀 viewer와 검색 결과 highlight 패턴을 Phase 6 읽기 UX 후보로 참고한다.
- Markdown·SQLite 중심 저장소와 filename Citation은 사용하지 않는다.
### ddsyasas/llm-wiki
- 모델·비용·Job 진행상태와 재시도 UX만 참고한다.
### Inkeep OpenKnowledge
- Agent Activity, Graph, changed-item grouping, Discovery 진행·결과 표시 개념을 참고한다.
- 공개 코드와 라이선스가 확인되지 않은 런타임에는 의존하지 않는다.
### Shotgun 고유 구현
- Canonical commit transaction·HistoryEvent·outbox
- Claim·Fact 승격·Conflict·revision 정책
- Compiled Truth projector·readiness
- 검색·Graph projection 계약
- DiscoveryCandidateSet·suppression·Phase 3 재진입
# Step 15. Canonical Fact·Claim 반영·HistoryEvent 기록
## 15.1 Canonical 반영 트랜잭션
`ApprovedChangeSetManifest`의 digest, 승인자, 승인 시각, 권한, 기준 snapshot version과 atomic group을 commit 직전에 다시 검증한다.
Canonical mutation, revision 생성, Conflict 상태 변경, HistoryEvent와 outbox 기록은 하나의 데이터베이스 트랜잭션 경계에 둔다. 외부 검색·그래프·AI 호출은 이 트랜잭션 안에서 실행하지 않는다.
상태는 `PREPARING → COMMITTING → COMMITTED` 또는 `REJECTED_PRECONDITION`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`로 구분한다.
## 15.2 Fact·Claim 반영 규칙
승인된 `ClaimCandidate`는 기본적으로 Canonical Claim으로 반영한다. Claim은 주장자·출처·양태·부정·시간·Evidence를 유지한다.
Fact 생성·수정은 ChangeSet에 명시된 `PROMOTE_TO_FACT`, `CREATE_FACT`, `UPDATE_FACT`, `RETIRE_FACT` 작업이 별도로 승인된 경우에만 수행한다.
Fact는 하나 이상의 승인된 Evidence·Claim 또는 승인 이유에 결속하며, 단일 모델 confidence만으로 생성하지 않는다. Fact가 바뀌어도 기존 Claim은 삭제하지 않는다.
## 15.3 Entity·Relation·Event 동시 갱신
Fact·Claim이 참조하는 Entity·Alias·Relation·Event는 같은 atomic group에서 referential integrity를 검증한다.
Entity 병합은 승인된 identity mapping에 의해서만 수행한다. Relation은 방향·역할·시간 범위를 보존하며 n-ary 관계를 임의 이항화하지 않는다.
Event와 상태 변화는 `event_time`, `valid_from`, `valid_to`, `recorded_at`을 구분한다. 부분 승인으로 dangling reference가 생기면 commit을 차단하고 Phase 4로 되돌린다.
## 15.4 충돌·이전 상태 보존
기존 Fact·Claim은 업데이트 시 덮어쓰지 않고 새 revision과 유효 기간을 만든다.
상태는 `ACTIVE`, `SUPERSEDED`, `RETIRED`, `HISTORICAL`, `SCHEDULED`, `DISPUTED`를 구분한다.
경쟁 Claim과 미해결 Conflict는 resolution 없이 삭제하지 않는다. 승인된 변경이 충돌을 해결하더라도 해결 전 주장·근거·결정 이유를 History에서 유지한다.
## 15.5 HistoryEvent·Revision
모든 Canonical commit은 append-only `HistoryEvent`를 생성한다.
필수 항목:
- `history_event_id`, `commit_id`, `changeset_revision_id`
- actor·approver·권한·승인 시각
- 변경 유형과 대상 Canonical ID
- before·after revision 참조
- 승인 근거·Evidence·Decision·댓글
- 적용 Directive·Priority·정책 버전
- transaction 시각·schema version·correlation ID
사용자용 설명은 AI가 만들 수 있지만 구조화된 before/after와 실제 mutation이 기준이다.
## 15.6 멱등성·실패·복구
`commit_id`는 승인 manifest digest와 atomic group에서 결정적으로 생성한다. 동일 commit의 재요청은 같은 결과를 반환하고 중복 revision을 만들지 않는다.
optimistic concurrency로 승인 이후 Canonical snapshot이 바뀌었는지 확인한다. 불일치하면 자동 재해석하지 않고 `STALE_APPROVAL`로 Phase 4 재검토를 요구한다.
트랜잭션 전 실패는 안전 재시도하고, commit 성공 후 응답 유실은 commit ledger와 idempotency key로 복구한다.
## 15.7 Rollback 제안
Rollback은 과거 row나 revision을 직접 복원·삭제하는 기능이 아니다. 현재 Canonical 상태를 기준으로 역방향 `DraftChangeSet`을 생성해 Phase 4의 비교·Impact·사용자 승인을 다시 통과한다.
AI는 역변경 설명과 예상 부작용을 제안할 수 있지만, 자동 승인·자동 실행하지 않는다. 이후 생긴 의존 변경 때문에 완전한 역전이 불가능하면 부분 rollback·보상 변경으로 표시한다.
## 15.8 Post-commit 이벤트
트랜잭션 내부 outbox에 `CanonicalCommitted` 이벤트를 기록한다.
필드에는 commit·canonical revision·변경 자원·영향 태그·접근 범위·Projection 요구사항·Discovery trigger를 포함한다.
전달은 at-least-once를 허용하되 소비자는 event ID와 target projection version으로 멱등해야 한다. Projection Job 실패는 commit을 취소하지 않는다.
# Step 16. Compiled Truth·검색·그래프·연결 지식 갱신
## 16.1 Compiled Truth 정의·입력
Compiled Truth는 Canonical 원장이 아니라 현재 시점·범위에서 읽기 쉬운 버전화된 Projection이다.
입력은 활성·과거·예정 Fact와 Claim, Entity·Relation·Event, User Directive, Fact Priority, Conflict, 접근 범위와 시간 기준이다.
Directive·Priority는 사실값이 아니라 해석·선택 정책으로 별도 표시한다. Compiled Truth는 원장에 없는 결론을 새 Fact처럼 생성하지 않는다.
## 16.2 시간·충돌 표현
각 투영 항목은 `CURRENT`, `HISTORICAL`, `SCHEDULED`, `EXPIRED`, `DISPUTED`, `TIME_UNCLEAR` 상태를 가질 수 있다.
같은 대상의 시기별 상태를 하나의 현재값으로 덮어쓰지 않는다. 미해결 Conflict는 competing views, 근거, Priority·Directive 영향과 unresolved reason을 포함한다.
사용자 화면의 간결한 현재 요약 뒤에도 과거·충돌·원문 근거로 이동할 수 있어야 한다.
## 16.3 투영 생성·버전
`CompiledTruthProjection`은 canonical commit sequence, input snapshot digest, projector·schema·policy version, 생성 시각과 접근 범위를 기록한다.
Projection revision은 불변이며 현재 active pointer만 이동한다. 동일 입력·동일 projector version은 동일한 논리 결과를 생성해야 한다.
과거 Projection은 감사·재현에 필요한 기간 보존하고, 대용량 세부 캐시는 재생성 가능 자산으로 관리한다.
## 16.4 검색 인덱스 갱신
정확 검색, 필터 검색, 의미 검색과 Citation lookup을 분리하되 하나의 search document contract를 사용한다.
색인 대상은 Canonical 자원과 Compiled Truth Projection이며 미승인 후보는 기본 검색 결과에 포함하지 않는다.
한국어 번역·동의어·AI 생성 검색어 확장은 recall용 필드로 사용할 수 있지만 결과 Citation은 원문 Evidence를 가리킨다.
임베딩 provider·모델·차원·chunk contract를 버전화하고 변경 시 새 인덱스를 구축한 뒤 atomic alias swap한다.
## 16.5 Semantic Graph 갱신
Semantic Graph는 Canonical Entity·Claim·Fact·Relation·Event·Directive·Conflict의 읽기 Projection이다.
노드·edge에는 Canonical ID, revision, 시간 상태, 접근 범위, Evidence 수와 Conflict 상태를 포함한다.
AI가 제안한 새 edge는 Discovery 후보로만 저장하며 승인 전 Graph에 넣지 않는다. Graph projection은 Canonical referential integrity를 재검증한다.
## 16.6 연결 결과·캐시 무효화
답변·요약·문서·추천·대시보드·API cache는 dependency tag와 canonical revision watermark를 가진다.
commit 영향 태그와 dependency graph를 이용해 필요한 결과만 `STALE`로 표시한다. 모든 결과를 즉시 재생성하지 않고 요청 시 재생성, 우선순위 background refresh, 명시적 full rebuild를 구분한다.
외부에 이미 게시된 결과는 자동 수정하지 않고 오래됨·재생성·정정 후보를 Phase 6에 전달한다.
## 16.7 증분·전체 재생성
일반 commit은 변경된 Canonical ID와 인접 typed edge 범위의 증분 투영을 기본으로 한다.
다음은 전체 재생성 조건이다.
- Projection schema·projector 의미 변경
- embedding model·차원 변경
- index·graph 손상 또는 watermark 불일치
- 접근 정책의 광범위 변경
- 검증 결과 누락 범위를 안전하게 계산할 수 없음
대규모 rebuild는 새 version을 병렬 생성하고 검증 후 active pointer를 전환한다.
## 16.8 일관성·준비 상태
각 Projection은 `NOT_STARTED`, `BUILDING`, `READY`, `READY_WITH_LAG`, `DEGRADED`, `FAILED`, `STALE` 상태와 canonical watermark를 가진다.
Phase 6 readiness는 필요한 Projection별 최소 watermark·접근 정책·Citation lookup 상태를 검사한다.
Canonical commit 직후 Projection이 지연되면 사용자는 공식 변경은 완료됐지만 검색·그래프가 갱신 중임을 볼 수 있어야 한다. 오래된 Projection을 최신처럼 표시하지 않는다.
# Step 17. Knowledge Gap·새 관계·행동 후보 탐색
## 17.1 Knowledge Gap 유형
`KnowledgeGap`은 다음을 구분한다.
- `MISSING_FACT`
- `MISSING_EVIDENCE`
- `WEAK_EVIDENCE`
- `TEMPORAL_GAP`
- `UNRESOLVED_CONFLICT`
- `AMBIGUOUS_DEFINITION`
- `UNRESOLVED_IDENTITY`
- `MISSING_RELATION`
- `STALE_KNOWLEDGE`
- `ACCESS_BLOCKED`
Gap은 결론이 아니라 무엇을 왜 모르는지, 영향받는 자원과 필요한 다음 근거를 기록한다.
## 17.2 새 관계·패턴 발견
GPT·Gemini·Claude는 Canonical snapshot과 접근 가능한 Graph·History를 사용해 아직 명시되지 않은 관계·클러스터·변화 추세·예외·반복 패턴 후보를 탐색한다.
발견 결과는 `RelationCandidate`, `PatternCandidate`, `TrendCandidate`, `AnomalyCandidate`로 분리하고 실제 Canonical edge와 AI 추론 edge를 혼합하지 않는다.
AI가 자동 분류를 수행하며 기존 분류가 맞지 않으면 넓은 범주의 새 candidate type·tag를 제안할 수 있다. 과도한 세분화는 억제하고 자료 축적 후 재분류한다.
## 17.3 확인 질문·행동 후보
Gap과 Discovery 결과에서 다음 후보를 만들 수 있다.
- 사용자 확인 질문
- 추가 자료 요청
- 외부 조사 과제
- 재검증·재번역·재추출 Job
- 일정·메일·파일·API 등 외부 `ActionCandidate`
질문과 Action에는 이유, 기대 정보, 위험도, 예상 비용, 대상, 실행 전제와 근거를 포함한다. Action은 Phase 6의 위험도 판단과 명시적 실행 승인을 받기 전에는 실행하지 않는다.
## 17.4 실행 시점·트리거
Discovery는 세 경로로 실행한다.
1. **승인 직후 증분 Discovery:** 변경된 Canonical ID와 직접 인접 범위만 빠르게 탐색한다.
2. **주간 자동 Discovery:** 일요일 밤 `WeeklyAIBatch`에서 누적 변경·미해결 Gap·패턴을 탐색한다.
3. **사용자 요청 Discovery:** 특정 프로젝트·주제·기간·질문 범위로 즉시 실행한다.
모든 경로는 Source·Canonical 범위와 비용 한도를 명시하고 독립 Job·Attempt로 실행한다. 동일 snapshot·profile의 중복 실행은 멱등하게 억제한다.
## 17.5 Provenance·후보 상태
Discovery 결과는 `DERIVED_INFERENCE` Provenance를 사용한다.
필수 기록:
- 사용한 Canonical snapshot·History·Evidence·Candidate dependency
- 모델·버전·프롬프트·tool·policy
- 전제·미확인 가정·도출 요약
- challenger 의견·모델 불일치
- 비용·Job·Attempt·생성 시각
상태는 `DISCOVERED → VALIDATING → READY_FOR_PHASE_3`, `SUPPRESSED`, `REJECTED`, `STALE`, `SUPERSEDED`로 관리한다.
## 17.6 우선순위·비용·억제
우선순위는 단일 신뢰도 점수가 아니라 다음 축을 분리한다.
- 예상 가치·영향 범위
- 위험도·긴급도
- 근거 부족 정도
- 새로움·중복 가능성
- 사용자 관심·프로젝트 중요도
- 처리·검토 비용
사용자가 무시·보류·거절한 제안은 suppression signature와 이유를 보존한다. 같은 근거·같은 의미의 제안을 반복하지 않으며 새로운 Evidence나 정책 변화가 있을 때만 재등장할 수 있다.
## 17.7 Phase 3 재진입
Discovery 결과는 Canonical로 직접 쓰지 않고 `DiscoveryReentryManifest`를 통해 Phase 3으로 전달한다.
Manifest에는 discovery candidate, dependency graph, canonical snapshot, Evidence, 모델·정책 Provenance, 접근 범위, 후보 유형과 재검증 요구사항을 포함한다.
Phase 3는 `DISCOVERY_REENTRY`·`DERIVED_INFERENCE`로 후보를 생성하고 schema·Evidence·dependency validation을 수행한다. 이후 Phase 4의 비교·Impact·사용자 승인 절차를 다시 거친다.
## 17.8 Activity·사용자 가시성
사용자는 Discovery Job의 trigger, 범위, 사용 모델, 진행 상태, 비용, 생성된 Gap·관계·질문·Action 후보와 suppression 이유를 확인할 수 있어야 한다.
표시는 `무엇을 발견했는가`, `왜 제안됐는가`, `어떤 근거와 가정이 사용됐는가`, `다음 단계는 무엇인가`를 중심으로 구성한다.
모델 내부의 장황한 사고 과정이 아니라 검증 가능한 근거·전제·도출 요약을 보여준다.
## 7. Phase 6 인계 계약
`Phase6ReadinessManifest`에는 다음을 포함한다.
- 최신 canonical commit·snapshot·schema version
- Compiled Truth·검색·Graph·Citation lookup watermark와 readiness
- 접근 범위·민감도·마스킹 정책
- 미해결 Conflict·Knowledge Gap 요약
- stale·degraded Projection과 사용 제한
- Discovery 진행·대기 상태
- 사용 가능한 읽기 모드와 금지된 출력·Action 경계
Phase 6은 readiness가 충족된 Projection만 사용한다. `READY_WITH_LAG` 또는 `DEGRADED` 사용 시 사용자에게 상태와 제한을 명시한다.
## 8. 구현 검증 대기
- Canonical DB transaction·outbox·optimistic lock 구현
- Claim·Fact·Conflict·HistoryEvent schema와 migration
- projector의 결정성·watermark·증분/전체 rebuild
- exact·hybrid·semantic search engine과 embedding benchmark
- Graph store 선택과 대규모 traversal 성능
- cache dependency tag·stale propagation
- GPT·Gemini·Claude Discovery 품질·비용·모델 불일치 표현
- suppression signature와 반복 제안 억제율
- Phase 3 재진입의 loop·중복·폭주 방지
## 9. 제외·연기
- 자동 Fact 승격
- 자동 Canonical write
- 자동 외부 Action 실행
- Projection을 원장으로 사용
- 모델 다수결 자동 승인
- Entity Vault 별도 제품 기능
- Phase 6의 답변·문서·외부 Action 실행 UX
## 관련 Canonical 문서
- [Phase 5 — Architecture Decision Records](https://app.notion.com/p/39f5181d71ad81d29c1ae9dc5c537e1c)
- [Phase 5 — 미결사항·구현 검증 대기](https://app.notion.com/p/39f5181d71ad81f0bb08c3030b0fbe36)
- [Phase 5 — 변경 이력](https://app.notion.com/p/39f5181d71ad81538bb8c18404237e92)
