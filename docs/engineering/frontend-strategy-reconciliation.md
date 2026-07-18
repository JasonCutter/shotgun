# Shotgun Frontend Strategy Reconciliation

> 상태: **검토 후보 / ADD 반영 전**  
> 작성 목적: 기존에 확정된 프론트엔드 참조 전략을 복원하고, 현재 Knowledge Flow·Implementation Roadmap·OSS Integration Roadmap·구현 상태와 정합시킨다.  
> 범위: 문서 정합화만 수행한다. P0-1·P0-2 구현 브랜치와 제품 코드는 변경하지 않는다.

## 1. 결론

Shotgun의 프론트엔드 전략은 새로 설계할 대상이 아니다. 다음 결정은 기존 기준 문서에서 이미 확정되어 있었다.

1. 독립 제품 표면은 `shotgun-web`이다.
2. `ddsyasas/llm-wiki`는 Source Intake, Ask·Chat, Cost·Model·Settings, Action-oriented Home의 **Interaction·Presentation 참조**다.
3. Inkeep OpenKnowledge는 Visual/Source 편집, 2D Graph, Agent Activity, Burst Diff, Entity Vault의 **Human Cockpit 참조**다.
4. 두 프로젝트의 기존 Backend·Runtime·저장 모델은 Shotgun에 포함하지 않는다.
5. UI와 Shotgun Engine 사이의 유일한 제품 경계는 Server-authorized Typed API와 Event Stream이다.
6. UI state, editor state, graph state, activity state는 Canonical·Approval·Security 권한을 소유하지 않는다.
7. 현재 `server.ts` 안의 Ask·Knowledge·Review HTML은 최종 프론트엔드가 아니라 Backend 수직 검증용 임시 UI다.

현재 문제는 프론트엔드 전략 부재가 아니라 **확정 전략이 ADD와 구현 구조로 전달되지 않은 추적성 단절**이다.

## 2. 근거 문서

### 2.1 확정 전략 근거

- `docs/shotgun_reference_architecture_strategy_ko.html`
  - ddsyasas 전체 Next.js 앱을 유지하지 않고 제한된 Interaction·Presentation만 재구현
  - OpenKnowledge 전체 Runtime을 제외하고 Human Cockpit 패턴만 활용
  - `shotgun-web`, `shotgun-api-client`, `editor-core`, `graph-ui`, `activity-ui` 구조
  - Frontend MVP → Review & Activity → Semantic Graph → Visual Editor → Draft Collaboration 순서
- `docs/implementation/oss-integration-roadmap.md`
  - ddsyasas: `Product Workflow UX`, Backend 제외
  - OpenKnowledge: `Human Cockpit`, 전체 Runtime 제외
  - Stage 2, 5, 7, 9에서 각각 Source, Review, Ask, Graph UX 결정을 요구
- `docs/implementation/implementation-roadmap.md`
  - Stage 2: ddsyasas Source Intake UX
  - Stage 5: 최소 Review UI, OpenKnowledge Activity·Burst Diff
  - Stage 7: ddsyasas Ask·Chat UX
  - Stage 9: OpenKnowledge 2D Graph
  - Stage 12: ddsyasas·OpenKnowledge 기반 UX Mock Contract
- `Shotgun Knowledge Flow Detailed Map v0.2`
  - 1.9 입력 화면
  - 6.5 인용 표시·원문 복귀
  - 12.7 영향 설명·시각화
  - 13.8 검토 화면·접근성
  - 17.8 Activity·사용자 가시성
  - 18.6 인용·충돌·Gap 표시
  - Step 20 화면·문서·내보내기·읽기 API
  - 22.8 피드백 상태·결과 표시

### 2.2 현재 구현 근거

현재 제품 표면은 독립 Frontend Application이 아니다.

- `assemblies/shotgun-app/src/server.ts` 안에 Ask, Knowledge Graph, Review HTML·JavaScript가 직접 포함된다.
- Browser Session·CSRF·Project Context도 같은 서버 파일에서 처리된다.
- `apps/shotgun-web`, `packages/shotgun-api-client`, `packages/editor-core`, `packages/graph-ui`, `packages/activity-ui`는 아직 존재하지 않는다.
- Stage 5·7·9의 UI 완료 주장은 최소 수직 슬라이스의 존재를 의미하며, 확정된 Frontend Architecture 전체 구현을 의미하지 않는다.

## 3. 복원할 확정 결정

### F-01. 제품 표면과 책임 경계

`shotgun-web`을 독립 Frontend Application으로 둔다.

```text
shotgun-web
  → typed shotgun client
    → Shotgun Gateway / HTTP API / SSE
      → Application Modules
```

Frontend는 다음을 소유한다.

- 화면 Composition
- Navigation과 Workspace 전환
- 사용자 입력·표시 상태
- Server Query Cache
- Draft-only 편집 상태
- 로딩·오류·재시도·진행 표시
- 접근 가능한 시각화와 목록 대안

Frontend는 다음을 소유하지 않는다.

- Principal·Membership·Scope 결정
- Source·Evidence·Validation의 권위 원본
- Canonical Write
- Approval 유효성
- Action Risk Decision
- Connector 실행 권한
- Compiled Truth 생성 규칙

### F-02. ddsyasas 참조 범위

`ddsyasas/llm-wiki`에서 다음을 참고·재구현한다.

- Action-oriented Home
- Paste·File·URL Source Intake
- 형식 Preview
- 비용 사전 확인과 모델 선택 UX
- Ask·Chat Composer와 결과 Layout
- Settings·Project·Privacy·Cost UX
- Command Palette 패턴

다음은 제외한다.

- 기존 SQLite·Markdown Folder 저장
- 기존 ingest/query/lint Backend
- 기존 LLM Client를 Shotgun Provider 경계 밖에서 직접 사용
- 임의 절대경로 기반 Workspace
- Blocking Request와 비복구 Progress
- 3D Canvas-only Graph

Integration Decision은 `REFERENCE_ONLY` 또는 Shotgun Contract로 재구현하는 `AUGMENT`다.

### F-03. OpenKnowledge 참조 범위

Inkeep OpenKnowledge에서 다음을 참고·재구현한다.

- Visual/Source Mode UX
- Markdown Round-trip 보존 Gate
- 2D Graph Interaction·Neighborhood·Filter
- Agent Activity와 Changed-item Grouping
- Burst Diff
- Entity Vault Template UX
- Draft ChangeSet 전용 CRDT 가능성

다음은 제외한다.

- OpenKnowledge 전체 Runtime
- Local Filesystem API
- OpenKnowledge Markdown/Yjs를 Canonical System of Record로 사용
- Editor Mutation을 Canonical Write로 간주
- OpenKnowledge MCP·Search·Git Sharing을 병렬 엔진으로 유지
- 결합된 TiptapEditor 전체 직접 추출
- Yjs의 초기 활성화

### F-04. Typed API 경계

Frontend는 Domain Resource를 직접 조립하거나 DB 표현을 해석하지 않는다.

Typed Client는 최소 다음 View Model을 제공한다.

- Authenticated Principal
- Accessible Project List와 Active Project
- Intake Submission·Intake Status
- Source·SourceVersion Summary
- Evidence Citation·Source Return Target
- Ask Result: Statement·Citation·Conflict·Gap·Readiness
- Review Bundle: Candidate·Validation·Evidence·Diff·Impact·Approval State
- Job Activity·Attempt·Progress·Failure·Retry Capability
- Semantic Graph Node·Edge·Filter·List Fallback
- History·Rollback Proposal
- Action Preview·Approval·Execution Read Model

UI가 임의 Header로 Actor·Project·Scope·Sensitivity를 구성하지 않는다. Trusted Context는 P0-1의 Server Session·API Token 경계를 그대로 사용한다.

### F-05. 화면 정보구조의 복원 기준

초기 Navigation은 기존 전략의 제품 흐름을 유지한다.

```text
Home
Sources
Ask
Knowledge
Review
Activity
History
Settings
```

각 Workspace의 초기 책임은 다음과 같다.

- Home: 진행 중 작업, 검토 대기, 최근 Source, 주요 Action
- Sources: Paste·File·URL Intake, 처리 상태, Source 탐색
- Ask: Citation·Conflict·Gap이 분리된 답변
- Knowledge: Compiled Truth 목록과 2D Graph
- Review: Candidate·Evidence·Diff·Impact·Approval
- Activity: Job·Attempt·Agent·파일 변경·재시도
- History: Canonical Revision, 판단 이유, Rollback Proposal
- Settings: Project, Model, Cost, Privacy, API Token Lifecycle

정확한 Route·화면 구조는 ADD의 Frontend Section에서 확정한다. 위 목록은 새 전략이 아니라 기존 확정 전략의 복원 기준이다.

### F-06. 단계적 구현 순서

기존 로드맵 순서를 유지한다.

1. **Frontend Foundation**
   - `shotgun-web`
   - `shotgun-api-client`
   - App Shell, Auth Session, Project Context, Error Boundary
2. **Frontend MVP**
   - Home, Sources, Ask, Knowledge, Settings
   - ddsyasas UX 반영
3. **Review & Activity**
   - OpenKnowledge Activity, Burst Diff
   - ChangeSet, Conflict, Directive, History
4. **Semantic Graph**
   - 2D Graph Adapter
   - Node·Edge Filter, Neighborhood, Accessible List
5. **Visual Editor**
   - Visual/Source Mode
   - Markdown Preservation Fixture Gate
6. **Advanced Draft Collaboration**
   - 별도 ADR 후 Yjs Draft CRDT

## 4. 현재 구현과의 정합화 규칙

### 4.1 현재 Inline UI의 지위

현재 `server.ts`의 HTML 화면은 다음 상태로 재분류한다.

- `Backend Vertical Slice UI`
- API·Projection·Review 흐름 검증용
- 최종 Product UI 아님
- 삭제 대상이 아니라 독립 Frontend가 대체할 때까지 유지하는 임시 Compatibility Surface

### 4.2 보존해야 할 현재 자산

독립 Frontend 전환 시 다음은 재사용한다.

- P0-1 Browser Session·CSRF·Project Context 계약
- Stage 2 Intake Command·Query
- Stage 5 Review Command·Query
- Stage 7 Ask·Citation Response
- Stage 9 Graph Projection과 List Fallback
- Stage 10 Projection Readiness·Lag
- Stage 11 Action Preview·Approval·Execution Read Model
- Module Contract와 In-process/PostgreSQL Adapter

### 4.3 교체해야 할 결합

다음 결합은 점진적으로 제거한다.

- HTML Template와 Domain Route가 `server.ts`에 함께 존재
- 화면이 Raw Module Response를 직접 해석
- 각 화면마다 CSRF Fetch를 중복 구현
- Navigation·Auth State·Project State의 공통 App Shell 부재
- Browser E2E가 제품 Surface가 아니라 Injection Test 중심
- Frontend Package Boundary와 Build·Deployment Gate 부재

### 4.4 전환 원칙

- 현재 API Contract를 먼저 Typed Client로 감싼다.
- 독립 Frontend가 동일 Contract Test를 통과한 뒤 화면별로 전환한다.
- 전환 기간에는 Inline UI와 `shotgun-web`을 동시에 Canonical 제품 표면으로 선언하지 않는다.
- 새 화면이 검증된 후 Inline UI를 `development-only` 또는 제거 대상으로 변경한다.
- Frontend가 Backend 보안 결정을 복제하지 않는다.

## 5. ADD 정합화 위치

Frontend는 Knowledge Flow의 새 Phase가 아니다. 여러 Step에 걸쳐 있는 **횡단 아키텍처 관심사**로 ADD에 추가한다.

권장 ADD Section:

### Frontend and Human Interaction Architecture

1. Product Surface와 Deployment Boundary
2. User Roles·Core Tasks·Workspace Model
3. Information Architecture와 Navigation
4. Typed Client·Gateway·SSE Boundary
5. Client State·Server State·Draft State
6. Authentication·Session·Project Context UX
7. Source·Evidence·Citation Viewer
8. Review·Diff·Impact·Approval UX
9. Activity·Progress·Failure·Recovery UX
10. Graph·Editor·Accessibility
11. Frontend Packaging·Testing·Release Gate

이 Section은 Detailed Map의 다음 항목을 연결한다.

- 1.9
- 6.5
- 12.7
- 13.8
- 17.8
- 18.6
- 20.1~20.9
- 22.8

각 Flow Section은 Domain 책임과 완료 조건을 유지하고, 화면의 공통 구조와 기술 경계는 Frontend Section을 참조한다.

## 6. 상태별 기록

### 6.1 확정된 결정

- 독립 `shotgun-web`
- ddsyasas Product Workflow UX 참조
- OpenKnowledge Human Cockpit 참조
- 전체 OSS Runtime 재도입 금지
- Typed API가 UI와 Engine 사이의 유일한 제품 경계
- Canonical·Approval·Security는 Server 소유
- 3D Canvas-only Graph 제외
- 2D Graph와 Accessible List 병행
- Yjs는 Draft 전용이며 초기 범위에서 연기
- 현재 Inline UI는 임시 Backend Vertical Slice

### 6.2 아직 확정되지 않은 사항

- Frontend Framework와 정확한 Version
- SSR·SPA·Desktop Wrapper 범위
- Route 구조와 URL 정책
- Design System과 Component Library
- Server State Library
- Form·Validation Library
- Typed Client 생성 방식
- SSE 재연결·Event Replay UX
- Visual Editor의 구체 기술
- Browser E2E 도구
- 모바일 지원 수준
- Frontend 배포·업데이트 방식

이 항목은 기존 전략을 복원하는 문서에서 임의 확정하지 않는다.

### 6.3 제외된 대안

- Backend 완료 후 임의의 UI를 나중에 붙이는 방식
- `server.ts` Inline HTML을 최종 제품 구조로 유지
- ddsyasas 전체 App·Backend 채택
- OpenKnowledge 전체 Runtime 채택
- UI Local State를 Approval 또는 Canonical 상태로 간주
- Browser가 권위 있는 Actor·Project·Scope Header를 구성
- 3D Graph-only UX
- 접근 가능한 목록 대안 없는 Graph
- 초기 Yjs·실시간 공동 편집

### 6.4 영향 범위

문서:

- ADD에 횡단 Frontend Section 추가
- Detailed Map의 공통 관심사에 Frontend·Human Interaction 추가
- Stage 5·7·9·12 완료 기록에서 `최소 UI 수직 슬라이스`와 `최종 Frontend` 구분
- README에 Product Surface 상태 명시
- 새 Frontend ADR 작성

구현:

- `apps/shotgun-web`
- `packages/shotgun-api-client`
- 필요 시 `packages/editor-core`, `packages/graph-ui`, `packages/activity-ui`
- 현재 Inline UI의 단계적 격리
- Browser Contract·Accessibility·Security Test 추가

P0-1·P0-2:

- 현재 보안 보정 범위는 변경하지 않는다.
- `shotgun-web`은 확정된 Trusted Session·CSRF·Project Context를 소비한다.
- Frontend 작업을 이유로 P0 Security Gate를 완화하거나 우회하지 않는다.

## 7. 문서 반영 순서

1. 이 정합화 문서를 검토·확정한다.
2. Frontend Architecture 결정을 ADR로 기록한다.
3. Google Docs ADD에 `Frontend and Human Interaction Architecture` Section을 추가한다.
4. Detailed Map 공통 관심사와 참조 관계를 갱신한다.
5. Implementation Roadmap의 Stage 완료 표현을 정정한다.
6. 별도 구현 계획을 작성한다.
7. P0-1·P0-2 완료 후 다음 Backend Wave와 Frontend Foundation의 우선순위를 다시 결정한다.

## 8. 완료 판정

이 문서의 완료는 Frontend 구현 완료가 아니다.

다음 조건을 만족하면 **전략 복원·문서 정합화 완료**로 판정한다.

- 기존 참조 전략의 확정 결정이 누락 없이 식별됨
- 현재 Inline UI의 지위가 명확해짐
- 확정 결정·미결사항·제외 대안·영향 범위가 분리됨
- ADD 반영 위치와 Detailed Map 참조 관계가 정의됨
- P0-1·P0-2 작업과 충돌하지 않는 병행 경계가 정의됨
- 사용자 승인 후 ADD와 ADR에 반영할 수 있는 상태가 됨
