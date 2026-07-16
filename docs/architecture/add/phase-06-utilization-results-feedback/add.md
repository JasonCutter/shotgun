<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81948c94cbf0a894ea01 -->

## 문서 관리
- 상태: **완료**
- 범위: Phase 6 — 활용·결과·피드백, Step 18\~22
- Section: 43개
- 기준일: 2026-07-16
- 기준 입력: Phase 5의 `Phase6ReadinessManifest`
- 생명주기 출력: `ResultArtifact`, `RiskDecision`, `DeliveryPackage`, `ActionExecutionRecord`, `FeedbackEvent`
- Canonical 저장소: Notion
## 1. 목적
Phase 6는 승인된 Canonical 지식과 준비된 Projection을 사용해 검색·답변·요약·콘텐츠·행동 후보를 만들고, 위험도에 따라 읽기 결과와 외부 쓰기 행동을 분기한다. 제공된 결과와 실제 Action의 수정·피드백은 새로운 입력, User Directive 후보, Draft ChangeSet 또는 결과 평가로 정확히 되돌린다.
## 2. Phase 경계
### 입력
- `Phase6ReadinessManifest`
- Canonical Fact·Claim·Entity·Relation·Event·Decision·Directive·Conflict
- `CompiledTruthProjection`, 검색·Semantic Graph·Citation lookup readiness
- SourceVersion·EvidenceSpan·VisualAnalysisRevision·TranslationRevision
- 접근 범위·민감도·마스킹 정책
- 사용자 요청·출력 채널·위험 정책·Connector capability
### 출력
- 근거와 사용 모드가 기록된 `ResultArtifact`
- 실행되지 않은 `ActionCandidate`
- `RiskDecision`과 사용자 검토 요구사항
- 화면·문서·내보내기·읽기 API용 `DeliveryPackage`
- 승인된 외부 실행의 `ActionExecutionRecord`
- 피드백과 재진입 경로를 가진 `FeedbackEvent`
### 이 Phase에서 하지 않는 일
- 답변이나 대화 내용을 자동으로 Canonical에 저장하지 않는다.
- Source 탐색·외부 조사 결과를 승인 지식처럼 표시하지 않는다.
- ActionCandidate를 승인 없이 실행하지 않는다.
- 모델 합의·confidence·사용자 만족도를 Fact로 승격하지 않는다.
- 외부 게시·전송·파일 변경을 단순한 읽기 출력으로 위장하지 않는다.
## 3. 공통 불변 조건
- 모든 결과는 사용 모드·Canonical snapshot·Projection watermark·모델·정책·Citation 상태를 가진다.
- 사실적 진술은 Canonical 자원 또는 원문 Evidence에 결속하거나 추론·불확실성으로 명확히 표시한다.
- GPT·Gemini·Claude를 폭넓게 활용하되 특정 공급자에 계약을 고정하지 않는다.
- 시각 자료를 이해하거나 시각 결과를 만들 때 실제 렌더링을 멀티모달 AI가 확인한다.
- 읽기와 쓰기 API·권한·상태 전이를 분리한다.
- 고위험·외부 영향 행동은 명시적 승인 또는 유효한 제한 위임 없이는 실행하지 않는다.
- Connector 비밀정보는 AI 입력·출력·일반 로그에 포함하지 않는다.
- 사용자 피드백은 장기 기억·Fact·Directive로 조용히 승격하지 않는다.
- 실패·모호한 외부 실행 결과를 성공으로 추정하지 않는다.
## 4. 처리 흐름
사용자 요청
→ 사용 모드·의도·범위 해석
→ 접근·Projection readiness 확인
→ 검색·Graph·Source·외부 조사 계획
→ GPT·Gemini·Claude 기반 결과·Action 후보 생성
→ Citation·충돌·Gap·시각 결과 검증
→ 위험도 판단
→ 읽기 결과는 Step 20으로 제공
→ 쓰기·공개 Action은 검토·승인 후 Step 21 실행
→ 결과·실행 피드백을 Step 22에서 분류
→ Step 1·9·10·13·14 또는 단순 평가 경로로 재진입
## 5. AI와 결정적 시스템의 책임 경계
### AI 활용
- 질문 해석·검색 계획·답변·요약·콘텐츠·행동 후보 생성
- 근거 간 의미 차이·충돌·Gap 설명
- 다국어 표현·검색어 확장·서식·문체 변환
- 고위험 결과의 독립 challenger 검토
- 시각 자료 이해와 생성된 문서·슬라이드·도표 렌더링 검증
- 피드백 유형 제안과 안전한 재진입 경로 설명
### 결정적 시스템
- 접근 권한·민감도·마스킹·Projection readiness
- Citation 대상 ID·원문 locator 유효성
- 위험도 정책의 필수 승인 경계
- ActionAuthorizationToken·Connector 권한·멱등성
- 외부 실행 상태·Audit·외부 ID·보상 가능성
- Feedback 상태 전이·중복·루프 억제
## Phase 6 완료 선언
Step 18\~22의 43개 Section, 사용 모드·근거 기반 결과·다중 AI 라우팅·멀티모달 결과 검증·위험도 관문·읽기 API·외부 Action 실행·피드백 재진입 계약을 모두 확정했다. 사용자에게 추가로 물어야 할 정책 결정은 없다. 구현 제품·Connector·임계값·비용·성능 수치는 별도 구현 검증 대기 항목으로 관리한다.
## 6. 완료 조건
- Step 18\~22의 43개 Section이 구현 가능한 계약으로 정의된다.
- Canonical·Source 탐색·외부 조사 모드가 혼합되지 않고 표시된다.
- 답변·문서·내보내기에서도 원문 Citation과 Provenance가 유지된다.
- 위험도별 자동 제공·검토·차단·위임 경계가 정의된다.
- 읽기 API와 쓰기 Action 실행이 분리된다.
- 외부 Action의 승인·Preflight·멱등성·결과·Audit·복구가 연결된다.
- 피드백이 정확한 이전 Phase로 재진입하고 자동 기억·자동 Fact화를 막는다.
## 7. 기준 문서
Phase 6은 Detailed Map의 Step 18\~22, 총 43개 Section 후보를 기준으로 작성한다. Section은 구현 태스크가 아니라 데이터·정책·사용자 흐름·시스템 책임의 설계 결정 단위다.
- [Step 18 — 검색·답변·요약·콘텐츠·행동 후보 생성](https://app.notion.com/p/39f5181d71ad81fc99e6d38b85a6e010)
- [Step 19 — 위험도에 따른 자동 제공 또는 사용자 검토](https://app.notion.com/p/39f5181d71ad81c6b64be03a9cf957d6)
- [Step 20 — 화면·문서·내보내기·읽기 API 제공](https://app.notion.com/p/39f5181d71ad8160b1bad342d25f7ac0)
- [Step 21 — 승인된 외부 Action 실행·결과 및 Audit 기록](https://app.notion.com/p/39f5181d71ad816fa85dcd062a2fc0ca)
- [Step 22 — 수정·피드백을 입력·지침·변경안으로 반환](https://app.notion.com/p/39f5181d71ad8176abd7efa4671706fe)
- [Phase 6 — Architecture Decision Records](https://app.notion.com/p/39f5181d71ad8167ba22c49184c8f74a)
- [Phase 6 — 미결사항·구현 검증 대기](https://app.notion.com/p/39f5181d71ad814da2eceb5d12394f43)
- [Phase 6 — 변경 이력](https://app.notion.com/p/39f5181d71ad8138ad46f1f62c36b38a)
## 관련 Canonical 문서
- [Step 18 — 검색·답변·요약·콘텐츠·행동 후보 생성](https://app.notion.com/p/39f5181d71ad81fc99e6d38b85a6e010)
- [Step 19 — 위험도에 따른 자동 제공 또는 사용자 검토](https://app.notion.com/p/39f5181d71ad81c6b64be03a9cf957d6)
- [Step 20 — 화면·문서·내보내기·읽기 API 제공](https://app.notion.com/p/39f5181d71ad8160b1bad342d25f7ac0)
- [Step 21 — 승인된 외부 Action 실행·결과 및 Audit 기록](https://app.notion.com/p/39f5181d71ad816fa85dcd062a2fc0ca)
- [Step 22 — 수정·피드백을 입력·지침·변경안으로 반환](https://app.notion.com/p/39f5181d71ad8176abd7efa4671706fe)
- [Phase 6 — Architecture Decision Records](https://app.notion.com/p/39f5181d71ad8167ba22c49184c8f74a)
- [Phase 6 — 미결사항·구현 검증 대기](https://app.notion.com/p/39f5181d71ad814da2eceb5d12394f43)
- [Phase 6 — 변경 이력](https://app.notion.com/p/39f5181d71ad8138ad46f1f62c36b38a)
