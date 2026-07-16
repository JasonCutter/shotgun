<!-- Canonical source: https://app.notion.com/p/39f5181d71ad8163b741f77df194b7ac -->

## 문서 관리
- 상태: **완료**
- 범위: Phase 4 — 비교·변경안·승인, Step 10\~14
- Section: 39개
- 기준일: 2026-07-16
- 기준 입력: Phase 3의 `Phase4CandidateManifest`
- 다음 Phase 인계: `ApprovedChangeSetManifest`
- Canonical 저장소: Notion
- 사용자 결정 대기: **없음**
## Phase 4 완료 선언
Step 10\~14의 비교, 중복·충돌·시간·근거 분석, Conflict Projection, Recursive Impact, Draft ChangeSet, Burst Diff, 사용자 승인·수정·보류·거절·Directive 제안 계약을 모두 확정한다.
모든 Canonical 변경은 명시적 사용자 승인 후에만 Phase 5로 전달한다. AI는 폭넓게 활용하지만 승인자나 Canonical 작성자가 아니다. 남은 항목은 모델별 품질·비용, 임계값, 그래프 성능과 Review UX의 구현 검증이며 Phase 4 정책 완료를 막지 않는다.
## 1. 전 Phase 공통 AI 활용 대원칙
GPT, Gemini, Claude를 `AIProviderPool`의 주요 공급자로 폭넓게 활용한다.
### 활용 범위
- 자료 이해와 멀티모달 해석
- 후보 추출과 근거 검증
- 의미 동일성·중복·충돌·시간 범위 분석
- 근거 강도 설명과 반대 해석 탐색
- 영향 경로 우선순위화와 누락 가능성 점검
- ChangeSet·Burst Diff·검토 질문·설명 초안 생성
- 고위험·모호한 판단의 독립 교차 검토
### 공급자 독립성
- 특정 회사나 모델명을 Canonical 스키마와 정책 의미에 고정하지 않는다.
- 모든 호출은 `AIProviderAdapter`와 capability 기반 라우팅을 통한다.
- 모델·버전·프롬프트·도구·정책·비용·시각·Attempt를 기록한다.
- 모델 변경은 과거 판단을 덮어쓰지 않고 새 AnalysisRevision을 만든다.
### 역할 기반 다중 모델 사용
- 일반 항목: capability·비용·지연에 맞는 주 분석 모델 1개를 사용한다.
- 의미 충돌, 높은 영향, 낮은 근거 정렬, 모델 불확실성: 다른 공급자의 독립 challenger 검토를 추가한다.
- 두 분석이 중요한 결론에서 다르면 제3 공급자의 adjudication analysis를 추가할 수 있다.
- 다수결이나 제3 모델의 결론을 자동 정답으로 취급하지 않는다. 각 의견·근거·불일치를 보존하고 사용자에게 보여준다.
### AI와 결정적 시스템의 경계
AI가 담당하는 것은 의미 분석, 설명, 초안, 검토 보조다.
다음은 결정적 시스템이 담당한다.
- 접근 권한과 민감도 필터
- User Directive·Fact Priority의 적용 가능 범위 계산
- 버전·잠금·멱등성·상태 전이
- 실제 그래프 edge를 기반으로 한 영향 탐색
- ChangeSet 스키마 검증
- 승인 권한 검증
- Phase 5 인계
AI는 존재하지 않는 Canonical 자원·근거·영향 edge를 만들어서는 안 된다.
## 2. Phase 경계
### 입력
- `Phase4CandidateManifest`
- `KnowledgeCandidate`, `CandidateRevision`, `CandidateSet`
- `CandidateProvenanceGraph`, `CandidateQualitySignals`
- Canonical Fact·Claim·Entity·Relation·Event·Decision
- 활성 User Directive와 Fact Priority
- HistoryEvent와 현재 투영 버전
- 접근 범위·민감도·승인 권한
### 출력
- `ComparisonResult`
- `ConflictAnalysis`
- `ConflictProjection`
- `ImpactProjection`
- `DraftChangeSet`과 불변 revision
- `BurstDiff`
- `ReviewDecision`
- 승인된 항목의 `ApprovedChangeSetManifest`
- 별도 승인 대기 `UserDirectiveProposal`
### 하지 않는 일
- Phase 4는 Canonical 데이터를 직접 변경하지 않는다.
- 미승인 변경으로 Compiled Truth·검색·그래프를 갱신하지 않는다.
- 외부 Action을 실행하지 않는다.
- 모델 합의만으로 사용자의 승인을 대체하지 않는다.
- 충돌을 조용히 삭제하거나 하나의 주장으로 강제 병합하지 않는다.
## 3. 공통 불변 조건
- 비교는 버전화된 Canonical snapshot을 기준으로 재현 가능해야 한다.
- 접근 권한이 없는 지식은 검색·프롬프트·비교·설명에 포함하지 않는다.
- Fact Priority와 출처 근거 강도는 서로 다른 축이다.
- User Directive는 적용 범위와 유효 기간 안에서만 작동한다.
- Directive는 외부 사실을 참으로 만들거나 근거를 대체하지 않는다.
- 모델 confidence·모델 간 일치율은 사실성 점수가 아니다.
- 미해결 충돌과 모호성은 보존한다.
- Impact는 확인된 dependency와 graph edge를 기반으로 계산한다.
- Draft ChangeSet과 미리보기는 Canonical 변경이 아니다.
- 모든 Canonical 변경은 명시적 사용자 승인을 필요로 한다.
- 사용자 판단과 AI 분석은 불변 revision과 Audit으로 보존한다.
## 4. 처리 흐름
`Phase4CandidateManifest`
→ 접근·정책 범위 계산
→ Canonical snapshot 검색
→ GPT·Gemini·Claude pool 기반 의미 비교
→ 중복·충돌·시간·근거 분석
→ 다중 모델 challenger 검토가 필요한 항목 선별
→ `ConflictProjection`
→ 결정적 graph traversal + AI 설명을 통한 `ImpactProjection`
→ `DraftChangeSet`
→ machine diff + `BurstDiff`
→ 사용자 항목별 검토
→ 수정 시 필요한 단계로 재검증 라우팅
→ 승인 항목 잠금
→ `ApprovedChangeSetManifest`
# Step 10. 기존 Canonical 지식·User Directive·Fact Priority와 비교
## 10.1 비교 대상 Canonical 범위
비교 대상은 Fact·Claim뿐 아니라 Entity·Alias·Relation·Event·Decision·활성 User Directive·Fact Priority·미해결 Conflict·HistoryEvent다.
Action 실행 결과와 파생 문서·검색·캐시는 Canonical 비교 대상이 아니라 Step 12 영향 대상이다.
비교는 후보의 프로젝트·주제·시간·Entity mention을 이용해 제한된 canonical snapshot을 만든 뒤 수행한다. 전체 지식 저장소를 무조건 한 프롬프트에 넣지 않는다.
## 10.2 동일 개체·동일 주장 판정
먼저 안정 ID·명시 외부 ID·기존 승인된 alias를 사용한다. 그다음 시간·역할·조직·범위·문맥을 포함한 의미 비교를 수행한다.
AI는 `SAME`, `POSSIBLY_SAME`, `DIFFERENT`, `INSUFFICIENT_CONTEXT` 후보 판정을 만들 수 있지만 `POSSIBLY_SAME`을 자동 병합하지 않는다.
Claim 동일성은 표면 문장 유사도가 아니라 주체·술어·대상·양태·부정·수량·시간·범위를 비교한다.
## 10.3 시간 범위·현재성 비교
`valid_from`, `valid_to`, `observed_at`, `event_time`, `recorded_at`을 구분한다.
서로 다른 시점에 참인 주장은 충돌이 아니라 `TEMPORALLY_COEXISTS`로 분류할 수 있다. 새 자료가 더 최근이라는 이유만으로 과거 사실을 삭제하지 않는다.
시간대·상대 날짜·불명확 시점은 별도 warning과 unresolved temporal state로 보존한다.
## 10.4 User Directive 적용
적용 순서는 다음과 같다.
1. 접근·민감도·보안 정책
2. 적용 가능한 활성 User Directive
3. 도메인·프로젝트에 적용 가능한 Fact Priority
4. 근거 강도 차원
5. AI 분석 결과
Directive에는 scope, owner, effective period, exception, provenance가 있어야 한다. 적용 범위를 넘어 확장하지 않는다.
Directive가 사실을 수정하는 문장처럼 보여도 자동으로 Fact가 되지 않으며, 반복 정책인지 특정 사실 주장인지 분리한다.
## 10.5 Fact Priority·출처 우선순위
Fact Priority는 “어떤 출처를 어떤 상황에서 우선 검토할지”를 정의하는 정책이며 근거 자체가 아니다.
우선순위가 높은 출처라도 근거가 후보와 맞지 않으면 채택하지 않는다. 낮은 우선순위 출처도 독립적이고 직접적인 강한 근거를 제공할 수 있다.
Priority 적용 결과와 적용하지 않은 예외 이유를 기록한다.
## 10.6 프로젝트·접근 범위 경계
비교 검색은 후보가 상속한 접근 범위보다 넓어질 수 없다.
다른 프로젝트의 Canonical은 사용자가 명시적으로 공유했거나 공통 범위로 승인한 경우에만 비교한다. 개인 비공개 자료는 모델 provider 요청에도 최소 필요 범위로만 포함한다.
권한 변경 후 기존 미리보기는 stale 처리하고 재생성한다.
## 10.7 비교 결과 분류
주요 결과 유형은 다음과 같다.
- `NEW`
- `EXACT_DUPLICATE`
- `SEMANTIC_DUPLICATE`
- `SUPPORTS`
- `REFINES`
- `NARROWS`
- `BROADENS`
- `UPDATES`
- `SUPERSEDES`
- `CONTRADICTS`
- `TEMPORALLY_COEXISTS`
- `AMBIGUOUS`
- `UNRELATED`
- `POLICY_BLOCKED`
한 후보가 여러 기존 자원과 서로 다른 관계를 가질 수 있으므로 단일 label로 강제하지 않는다.
## 10.8 비교 설명·추적
`ComparisonResult`는 후보 revision, canonical snapshot ID, 비교 자원, 적용 Directive·Priority, 모델 분석 revision, 결정적 규칙 결과와 설명을 포함한다.
사용자에게는 “무엇과 비교됐는가”, “어떤 차이가 있는가”, “어떤 정책이 영향을 주었는가”, “모델들이 어디서 의견이 달랐는가”를 보여준다.
# Step 11. 중복·충돌·시간 유효성·근거 강도 분석
## 11.1 중복 유형
정확 중복, 의미 중복, 부분 중복, 상위·하위 주장, 반복 근거, 동일 사건의 다른 관측을 구분한다.
의미 중복은 자동 삭제하지 않는다. 표현·범위·근거·시간의 차이가 유용하면 별도 Claim 또는 supporting evidence로 보존한다.
## 11.2 충돌 유형
- 직접 부정 충돌
- 수량·값 차이
- 범위 차이
- 시점·유효 기간 차이
- Entity identity 차이
- 정의·용어 차이
- 출처 간 관측 불일치
- Directive·정책 충돌
AI는 충돌 유형과 가능한 조정 설명을 제안하지만 충돌 해소를 자동 확정하지 않는다.
## 11.3 시간 유효성
상태는 `CURRENT`, `HISTORICAL`, `SCHEDULED`, `EXPIRED`, `TIME_UNCLEAR`, `NOT_TIME_BOUND`로 분리한다.
현재성은 최신 timestamp 하나로 결정하지 않고 적용 대상·효력 시점·관측 시점과 SourceVersion을 함께 본다.
## 11.4 근거 강도 차원
하나의 trust score를 만들지 않는다.
- directness
- source authority
- independence
- recency
- specificity
- reproducibility
- evidence alignment
- attribution clarity
- temporal fit
- visual grounding
각 차원은 값, 근거, 평가 방법과 불확실성을 가진다.
## 11.5 출처·Priority 결합
근거 강도 평가가 끝난 뒤 별도 policy layer에서 Priority를 적용한다.
Priority 때문에 후보가 선택됐는지, 근거 자체가 더 강한지 구분해 설명한다. AI 모델은 Priority 정책을 재해석하거나 무시할 수 없다.
## 11.6 불확실성·모호성
해결할 수 없는 경우 `UNRESOLVED`, `NEEDS_MORE_EVIDENCE`, `NEEDS_IDENTITY_CONFIRMATION`, `NEEDS_TEMPORAL_CLARIFICATION`, `MODEL_DISAGREEMENT`를 유지한다.
세 모델의 의견이 다르면 숨기지 않고 주요 차이와 각 근거를 검토 화면에 표시한다.
## 11.7 판단 결과 계약
`ConflictAnalysis`는 후보·기존 자원, 비교 유형, 충돌 유형, temporal state, 근거 강도 벡터, 적용 정책, 모델별 분석, unresolved reason과 추천 가능한 ChangeSet operation을 포함한다.
# Step 12. Conflict Projection·Recursive Impact 생성
## 12.1 Conflict Projection 모델
`ConflictProjection`은 경쟁하는 주장·Fact·Claim, 각 Evidence, 시간, Priority, Directive, 분석 상태와 미해결 이유를 한 묶음으로 표현하는 읽기 모델이다.
Projection은 Canonical 원장을 바꾸지 않으며 언제든 입력 snapshot에서 재생성할 수 있다.
## 12.2 직접 영향 계산
후보가 직접 참조하거나 변경하려는 Fact·Claim·Entity·Relation·Event·Decision과 이를 입력으로 사용하는 현재 projection을 찾는다.
직접 영향은 typed edge와 dependency registry를 기준으로 결정적으로 계산한다.
## 12.3 재귀 영향 전파
다음 경로로 확장한다.
- Canonical dependency
- Compiled Truth input
- 검색·그래프 projection
- 저장된 답변·요약·문서·체크리스트
- 일정·Action 후보·자동화 제안
- 캐시·인덱스·materialized view
Cycle detection, visited set, depth·node·time·cost budget을 사용한다. AI는 경로를 발명하지 않고 실제 경로의 의미와 중요도를 설명한다.
## 12.4 영향 대상 자원
영향 대상은 `CANONICAL_RECORD`, `PROJECTION`, `SEARCH_INDEX`, `GRAPH_VIEW`, `DERIVED_CONTENT`, `SAVED_ANSWER`, `CHECKLIST`, `ACTION_CANDIDATE`, `CACHE`, `EXTERNAL_ACTION_REFERENCE`로 분류한다.
Phase 4에서는 외부 상태를 변경하지 않고 영향 가능성만 표시한다.
## 12.5 전파 깊이·성능 한계
정확한 깊이·node cap은 운영 설정이다. 한도를 넘으면 결과를 완전한 것으로 표시하지 않고 `TRUNCATED_BY_BUDGET`과 frontier를 남긴다.
대규모 영향은 비동기 gbrain Job으로 분할하고 중간 projection revision을 제공한다.
## 12.6 오탐·누락 통제
확정 edge와 추론 edge를 구분한다. 약한·추론 관계는 `POSSIBLE_IMPACT`로 표시하고 Canonical 변경이나 자동 재생성의 근거로 단독 사용하지 않는다.
서로 다른 AI 공급자가 중요한 영향 누락 가능성을 제기하면 실제 graph에서 재검색하고 검증된 edge만 추가한다.
## 12.7 영향 설명·시각화
기본 UI는 요약, 영향 트리와 경로 목록을 제공한다. 복잡한 경우 2D graph를 제공하되 목록·키보드 탐색 대안을 함께 제공한다.
각 경로는 시작 변경, edge type, 영향 자원, 예상 상태 변화와 재계산 필요 이유를 보여준다.
## 12.8 재계산 트리거
다음이 바뀌면 stale 처리한다.
- 후보 revision
- Canonical snapshot
- Directive·Priority
- access policy
- dependency graph
- 영향 계산 정책·모델
승인 직전에 snapshot·lock을 다시 확인한다.
# Step 13. Draft ChangeSet·Burst Diff·영향 미리보기
## 13.1 Draft ChangeSet 구조
`DraftChangeSet`은 change_set_id, revision, input candidate set, canonical snapshot, item, dependency, evidence, rationale, conflict·impact projection, status, lock과 생성 Provenance를 가진다.
Draft는 불변 revision이며 변경 시 새 revision을 만든다.
## 13.2 항목 묶음·의존성
기본 검토 단위는 item이다. 서로 분리하면 일관성이 깨지는 항목만 `atomic_group`으로 묶는다.
dependency는 `REQUIRES`, `MUST_COMMIT_WITH`, `BLOCKS`, `OPTIONAL_WITH`, `SUPERSEDES`로 표현한다. AI가 제안한 dependency는 결정적 검증을 통과해야 한다.
## 13.3 제안 작업 유형
- `CREATE`
- `AMEND`
- `CLOSE`
- `SUPERSEDE`
- `MERGE`
- `LINK`
- `UNLINK`
- `RETAIN_CONFLICT`
- `RESOLVE_CONFLICT`
- `CREATE_DIRECTIVE_PROPOSAL`
- `REGENERATE_PROJECTION`
Phase 4의 operation은 실행 계획이며 실제 적용은 Phase 5가 담당한다.
## 13.4 Burst Diff 생성
기계 판독 diff와 사용자용 Burst Diff를 함께 만든다.
Burst Diff는 변경 전·후, 의미 변화, 근거, 시간 범위, 충돌 상태, 영향과 불확실성을 짧게 보여준다. AI가 요약하되 구조화 diff와 Evidence에 의해 검증한다.
표현만 바뀐 것과 사실·범위·시간이 바뀐 것을 명확히 구분한다.
## 13.5 영향·부작용 미리보기
직접·재귀 영향, stale 예상 자원, 재생성 Job, 캐시 무효화, 충돌 유지 여부, 외부 Action 참조를 표시한다.
영향을 모두 계산하지 못하면 누락 가능성과 truncation을 숨기지 않는다.
## 13.6 비용·모델·Job 미리보기
승인 후 Phase 5\~6에서 필요한 Job, 예상 처리량·비용 범위·사용 provider·병렬성·외부 API 가능성을 표시한다.
비용은 보장값이 아니라 입력 크기·모델·재시도 가정이 포함된 범위로 표시한다.
## 13.7 검증 상태·잠금·버전
상태는 `DRAFT`, `VALIDATING`, `READY_FOR_REVIEW`, `IN_REVIEW`, `STALE`, `LOCKED_FOR_APPROVAL`, `PARTIALLY_DECIDED`, `DECIDED`, `CANCELLED`로 관리한다.
검토 중 입력 후보·Canonical·Directive·Priority가 변하면 stale 처리한다. 승인 시 optimistic version check와 short-lived approval lock을 사용한다.
## 13.8 검토 화면·접근성
검토 화면은 다음을 제공한다.
- 항목별 변경 전·후
- 원문 Evidence와 원문 복귀
- 적용 Directive·Priority
- 모델별 분석과 불일치
- Conflict·Impact
- 비용·후속 Job
- 승인·수정·보류·거절
- 댓글과 판단 이유
긴 ChangeSet은 위험·충돌·영향 순으로 정렬할 수 있지만 AI의 중요도 순서가 승인 순서를 강제하지 않는다.
# Step 14. 승인·수정·보류·거절·지침 추가
## 14.1 판단 유형·상태 전이
항목 판단은 `APPROVE`, `APPROVE_WITH_EDIT`, `REQUEST_CHANGES`, `HOLD`, `REJECT`, `CANCEL`이다.
ChangeSet은 `READY_FOR_REVIEW`, `IN_REVIEW`, `PARTIALLY_APPROVED`, `APPROVED_PENDING_COMMIT`, `CHANGES_REQUESTED`, `HELD`, `REJECTED`, `CANCELLED`, `STALE` 상태를 가진다.
## 14.2 항목별·묶음 승인
기본은 항목별 승인이다. `atomic_group`은 전체가 함께 승인돼야 하며 일부만 승인하려면 dependency를 다시 계산한 새 ChangeSet revision을 만든다.
승인되지 않은 항목은 Phase 5 인계에 포함하지 않는다.
## 14.3 사용자 수정 유형 분류
- 표현 수정: 의미·Evidence를 바꾸지 않는 표시 문구
- 사실 수정: 값·주체·관계·상태 변경
- 근거 변경: Evidence 추가·제거·대체
- 범위 수정: 시간·프로젝트·대상·조건 변경
- Identity 수정: Entity 연결 변경
- 새 Claim: 기존 후보에 없던 주장 추가
- Directive 제안: 반복 적용 정책
## 14.4 재검증 라우팅
- 표현 수정: Phase 4 스키마·semantic equivalence 검증
- 사실·새 Claim: Phase 3 후보 생성·Evidence 검증으로 반환
- 근거 변경: Phase 2 Evidence 유효성 및 Phase 3 grounding으로 반환
- 범위·Identity 변경: Step 10\~12 재비교·영향 재계산
- Directive 제안: 별도 `UserDirectiveProposal` 검토
AI는 라우팅을 제안할 수 있지만 시스템 규칙이 최종 경로를 결정한다.
## 14.5 User Directive 후보 생성
반복될 가능성이 있는 사용자 판단은 Directive 후보로 제안할 수 있다. 단일 항목의 승인·거절을 자동으로 장기 지침으로 일반화하지 않는다.
Directive 후보는 목적, scope, 조건, 예외, 유효 기간, 근거가 된 판단과 예상 영향이 있어야 하며 별도 명시적 승인을 받는다.
## 14.6 역할·권한·고위험 승인
초기 개인용 Shotgun의 최종 승인자는 사용자 본인이다.
향후 다중 사용자에서는 item·project·risk별 approver policy를 적용한다. 시스템 관리자나 AI provider는 지식 승인 권한을 갖지 않는다.
Canonical 변경은 위험도와 무관하게 명시적 사용자 승인을 필요로 한다. 고위험 항목은 추가 설명·독립 모델 검토·재인증을 요구할 수 있다.
## 14.7 판단 이유·댓글·Audit
판단에는 actor, decision, reason code, 자유 댓글, timestamp, ChangeSet·item revision, viewed snapshot, 승인 당시 정책·권한과 client context를 기록한다.
이유 입력은 일반 승인에서 선택 사항이지만 충돌 해결, Fact Priority 예외, 고위험 변경, Directive 생성과 기존 Fact 종료에는 필수다.
## 14.8 보류·거절 자료 보존
보류·거절된 후보·Evidence·비교·AI 분석·사용자 이유는 삭제하지 않는다. Canonical 읽기 모델에는 포함하지 않지만 향후 중복 제안 억제, 재검토, 모델 평가와 Audit에 사용한다.
민감도·보존 기간·삭제 요청은 원본 정책을 상속한다. 동일 제안의 반복 생성은 과거 rejection fingerprint를 참고해 억제하되 새 근거·시간 변화가 있으면 재제안할 수 있다.
## 5. Phase 5 인계 계약
`ApprovedChangeSetManifest` 최소 필드:
- approved change_set revision과 item 목록
- 승인 actor·시각·권한·판단 이유
- canonical snapshot·expected version
- operation·dependency·atomic group
- Evidence·Provenance·Comparison·Conflict·Impact 참조
- 적용 Directive·Priority
- commit precondition
- post-commit Job 계획
- 접근 범위·민감도
- schema version·idempotency key
인계 조건:
- 모든 포함 item이 승인됨
- stale 아님
- Evidence·Provenance 유효
- 권한 검증 통과
- atomic dependency 완전
- expected canonical version 확인
- 미해결 충돌을 유지하는 경우 `RETAIN_CONFLICT`가 명시됨
## 6. 오픈소스·기존 구현 연계
### gbrain
- Job·Attempt·Audit·History 기반
- Canonical read와 dependency graph 조회
- Recursive Impact 비동기 작업·재시도·잠금
- Phase 5 commit 호환 idempotency 계약
Phase 4가 gbrain Canonical 저장소를 직접 수정하지 않는다.
### lucasastorian/llmwiki
- Highlight·Annotation의 원문 검토 패턴
- deterministic lint·reconcile 패턴
- 변경 항목에서 원문 위치로 복귀하는 viewer
Markdown diff나 filename citation을 Canonical 변경 모델로 사용하지 않는다.
### ddsyasas/llm-wiki
- 모델·비용·처리 상태·승인 UX 참고
- 긴 검토 작업의 상태·재시도·필터 패턴
기존 ingest가 지식을 직접 수정하는 구조는 사용하지 않는다.
### Inkeep OpenKnowledge
- Burst Diff, Agent Activity, changed-item grouping
- 2D Graph 영향 시각화
- Human Cockpit의 근거·변경·활동 동시 검토 패턴
공개 코드·라이선스·계약이 확인되지 않은 부분은 개념 참고로 제한한다.
### Shotgun 고유 구현
- `CanonicalComparisonEngine`
- `PolicyApplicationEngine`
- `MultiModelReviewOrchestrator`
- `ConflictProjection`
- `RecursiveImpactEngine`
- `DraftChangeSetStore`
- `BurstDiffValidator`
- `ReviewDecisionStore`
- `ApprovedChangeSetManifest`
## 7. 제외한 대안
- 높은 confidence 또는 모델 다수결로 자동 Canonical 승인
- GPT·Gemini·Claude 중 하나에 모든 판단을 영구 고정
- 모든 항목을 항상 3개 모델로 처리
- Fact Priority와 근거 강도를 단일 점수로 혼합
- 충돌을 최신 자료 하나로 자동 대체
- 전체 ChangeSet만 일괄 승인
- 사용자 수정으로 기존 revision을 덮어쓰기
- 거절 후보와 분석 이력 삭제
- AI가 그래프에 없는 영향 관계를 생성
## 8. 사용자 결정
정책 수준의 사용자 결정 대기 항목은 없다.
기존 대원칙인 “AI 결과는 승인 전 후보”, “공식 지식 변경은 승인 경계를 통과”, “Claim과 Fact 구분”과 이번 사용자 지시인 “GPT·Gemini·Claude를 전 Phase에 폭넓게 활용”을 결합해 보수적으로 확정했다.
## 관련 Canonical 문서
- [Phase 4 — Architecture Decision Records](https://app.notion.com/p/39f5181d71ad81209185ed8dc8a1ac49)
- [Phase 4 — 미결사항·구현 검증 대기](https://app.notion.com/p/39f5181d71ad818f8b85dc6395eaa781)
- [Phase 4 — 변경 이력](https://app.notion.com/p/39f5181d71ad8123bf4ede12323f82b7)
