# Frontend and Human Interaction Architecture

> 상태: **Canonical ADD 반영 전 검토 후보**  
> 결정 범위: 기존 Phase 1~6 사용자 흐름과 4-Reference Frontend 전략의 횡단 아키텍처 정합화  
> 변경하지 않는 범위: Phase별 Domain 정책, Canonical·Approval·Evidence·Security 경계  
> 관련 ADR: ADR-093, ADR-094, ADR-095(Proposed)

## 1. Section 목적

이 Section은 Phase 1~6에 분산돼 이미 확정된 화면·사용자 흐름·접근성·진행 상태 정책을 하나의 Product Frontend Architecture로 연결한다.

새로운 지식 처리 Phase를 추가하지 않는다. 기존 Phase의 책임을 변경하지 않으며 다음 횡단 경계를 정의한다.

- 사용자가 조작하는 Product Surface
- Frontend와 Shotgun Assembly 사이의 Typed Product Boundary
- Client State와 Server-authoritative State의 구분
- Authentication·Project Context·CSRF의 Browser 소비 방식
- Source·Evidence·Review·Activity·Graph Workspace의 공통 구조
- 현재 Inline Vertical Slice UI에서 독립 Frontend로의 전환
- Browser·Accessibility·Security·Release Gate

## 2. 기준 입력

이 Section은 다음 확정 문서를 기준으로 한다.

- Shotgun Knowledge Flow 기준본 v1.0
- Phase 1~6 Notion Canonical ADD
- Shotgun Module Architecture ADD
- Shotgun 4-Reference Integrated Architecture Strategy
- Implementation Roadmap
- OSS Integration Roadmap
- ADR-093 HTTP Identity and Authorization Boundary
- ADR-094 Server-bound Action Preview, Approval and Execution

참조 OSS의 역할:

- `ddsyasas/llm-wiki`: Product Workflow Interaction·Presentation
- Inkeep OpenKnowledge: Human Cockpit Interaction·Preservation Pattern

두 프로젝트의 Backend·Runtime·Canonical Storage는 Shotgun에 포함하지 않는다.

## 3. 핵심 불변 조건

1. Frontend는 Canonical 지식의 System of Record가 아니다.
2. Frontend는 Approval의 권위 원본이 아니다.
3. Frontend는 Actor·Project·Scope·Sensitivity를 권위 있게 결정하지 않는다.
4. Browser Local State는 Server State를 대체하지 않는다.
5. 미승인 Candidate는 화면 표시 상태와 무관하게 Canonical이 아니다.
6. Editor Mutation은 Draft이며 Canonical Write가 아니다.
7. Compiled Truth는 Server의 Canonical 기록에서 재생성되는 Projection이다.
8. Citation은 원문 Evidence로 돌아갈 수 있어야 한다.
9. Graph·Chart·Diff는 접근 가능한 텍스트·목록 대안을 가진다.
10. 외부 상태 변경은 화면 동작만으로 실행되지 않고 Preview·Approval·Preflight·Execute 경계를 통과한다.

## 4. Product Surface와 Container Boundary

### 4.1 확정 결정

Shotgun Personal Knowledge OS의 최종 사용자 Product Surface는 독립 Frontend Application `shotgun-web`이다.

```text
Browser / future approved desktop wrapper
        ↓
shotgun-web
        ↓
shotgun-api-client
        ↓
Shotgun HTTP Command·Query API + SSE Activity Stream
        ↓
Shotgun Personal Knowledge OS Assembly
        ↓
Reusable Modules / Kernel / Adapters
```

Frontend는 Shotgun-owned Product다. `ddsyasas/llm-wiki`나 OpenKnowledge 전체 App의 Fork를 최종 Product Surface로 운영하지 않는다.

### 4.2 Frontend 소유 책임

- App Shell과 Navigation
- Workspace Composition
- User Input과 Presentation State
- Server Query Cache
- Draft-only Editor State
- Loading·Empty·Error·Retry·Cancellation 표시
- Progressive Rendering과 Streaming 표시
- Keyboard Navigation·Screen Reader Structure
- Responsive Layout
- Browser Telemetry의 안전한 최소 수집

### 4.3 Server 소유 책임

- Authenticated Principal
- Project Membership
- Scope와 Sensitivity Clearance
- Source·SourceVersion·OriginalAsset
- Evidence·Validation·Candidate
- Canonical Knowledge와 History
- Approval Validity
- Action Risk·Execution Authority
- Projection Watermark와 Readiness
- Audit와 Retry Eligibility

## 5. Workspace Model과 Information Architecture

### 5.1 초기 Workspace

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

### 5.2 Workspace 책임

#### Home

- 진행 중 Intake·Job·Action 요약
- 검토 대기 Candidate·ChangeSet
- 최근 Source와 최근 결과
- 사용자 권한 안의 주요 다음 행동
- 오류·지연·Stale Projection 경고

Home은 Canonical 상태나 승인 결과를 자체 추론하지 않고 Server View Model을 표시한다.

#### Sources

Phase 1 Section 1.9를 제품 화면으로 구현한다.

- File·URL·Direct Text 통합 추가
- 카드 기반 순서 목록
- 제출 전 명백한 오류 표시
- 부분 성공
- 미제출 내용 자동 저장 금지
- 제출 후 화면 이탈
- 재접속 상태 복원
- 취소·실패 항목 재시도
- Upload에만 숫자 진행률
- 자동 처리에는 단계형 상태

Sources Workspace는 프로젝트·민감도·Canonical 편집을 Intake 입력 항목에 임의로 추가하지 않는다.

#### Ask

- 질문 입력
- Statement 단위 결과
- Citation
- Conflict
- Gap
- Uncertainty
- Projection Readiness와 Watermark
- 원문 복귀
- 한국어 표시와 원문 전환

답변 문장은 Canonical 또는 Evidence Citation과 결속돼야 하며 미승인 Candidate는 기본 결과에 포함하지 않는다.

#### Knowledge

- Compiled Truth 목록
- Semantic Graph
- 현재·과거·예정·충돌 상태
- Entity·Relation·Event·Decision 탐색
- Filter·Neighborhood·Drill-down
- 목록·표 Fallback
- Projection Lag·Stale 표시

Graph UI는 Canonical Graph를 직접 변경하지 않는다.

#### Review

Phase 4의 검토 계약을 제품 화면으로 구현한다.

- Candidate
- Validation
- Evidence
- Canonical Snapshot
- Comparison
- Conflict
- Burst Diff
- Recursive Impact
- Model Disagreement
- Approval·Hold·Reject·Edit
- Decision Reason
- Stale 상태와 재생성 요구

UI의 선택 상태는 Approval Record가 아니다. 승인 요청은 Server가 Actor·권한·Snapshot·Digest·Revision을 검증한 뒤 기록한다.

#### Activity

- Job·Attempt Timeline
- Intake·Transformation·AI·Validation·Projection·Action 상태
- Agent Activity
- Changed-item Grouping
- Retry·Cancel 가능 여부
- 실패 단계와 안전한 사용자 메시지
- Background Progress 복원
- OUTCOME_UNKNOWN과 Verify 상태

Activity는 실제 Retry Eligibility를 자체 판단하지 않고 Server Capability를 사용한다.

#### History

- Canonical Revision
- HistoryEvent
- 사용자 판단 이유
- 사용한 Evidence·Directive·Policy
- Diff
- Rollback Proposal
- 과거 Snapshot 조회

Rollback은 즉시 과거 상태로 덮어쓰는 동작이 아니라 새로운 검토·승인 대상 Proposal이다.

#### Settings

- 현재 Principal
- 접근 가능한 Project
- Active Project 변경
- Model·Cost·Privacy Policy 표시
- API Token Lifecycle
- Session·Account Lifecycle
- Product Preferences

Settings UI는 Membership이나 Scope를 Client에서 확장하지 않는다.

## 6. Typed Product Boundary

### 6.1 확정 결정

Frontend는 DB Row, ORM Object 또는 Module 내부 Record를 직접 해석하지 않는다.

`shotgun-api-client`는 Versioned Product View Model을 제공한다.

### 6.2 최소 View Model

- `AuthenticatedPrincipalView`
- `ProjectMembershipView`
- `ActiveProjectView`
- `IntakeSubmissionView`
- `SourceSummaryView`
- `ProcessingStatusView`
- `CitationView`
- `SourceReturnTargetView`
- `AskResultView`
- `ReviewBundleView`
- `ReviewDecisionCapabilityView`
- `ActivityEventView`
- `RetryCapabilityView`
- `SemanticGraphView`
- `ProjectionReadinessView`
- `HistoryRevisionView`
- `ActionPreviewView`
- `ActionApprovalView`
- `ActionExecutionStatusView`

정확한 Schema와 API Version은 별도 기술 설계에서 확정한다.

### 6.3 Command·Query 구분

- Query는 읽기 전용이고 상태를 변경하지 않는다.
- Command는 CSRF·권한·Idempotency·Expected Revision을 요구한다.
- Product API는 Module 내부 Message Envelope를 Browser에 그대로 노출하지 않아도 된다.
- Gateway는 Product View Model과 Module Contract 사이를 변환한다.

### 6.4 SSE Activity Stream

SSE는 진행 상태와 Activity를 제공하는 후보 기본 경계다.

필수 의미:

- event ID
- ordering scope
- Job·Attempt ID
- resource reference
- state transition
- retryable 여부가 아닌 Server Capability reference
- reconnect cursor
- snapshot reconciliation

SSE가 끊겨도 Server Job은 계속되며 재접속 시 Query Snapshot과 Event Cursor를 이용해 상태를 복원한다.

## 7. Client State·Server State·Draft State

### 7.1 Server-authoritative State

다음은 Server에서 다시 조회해야 한다.

- 인증 상태
- Active Project
- Membership·Scope·Sensitivity
- Intake·Job·Attempt 상태
- Validation·Evidence·Candidate 상태
- Review·Approval 상태
- Canonical·Projection 상태
- Action Preview·Execution·Verify 상태

### 7.2 Client Presentation State

- 열린 Panel
- 선택된 Tab
- Graph Zoom과 임시 Filter
- Table Sort
- Accordion 상태
- 미제출 검색어
- 비권위 UI Preference

### 7.3 Draft State

- 제출 전 Intake Text·URL·Memo
- Review Edit Draft
- Visual/Source Editor Draft
- 미제출 사용자 설명

Draft는 명시적 저장 계약 없이는 Server Canonical State가 아니다.

Phase 1 Intake Draft는 확정 정책에 따라 Browser Local Storage와 Server에 자동 저장하지 않는다.

### 7.4 Cache 규칙

- Cache Key에 Principal·Project·Access Scope·Snapshot·Policy Version을 포함한다.
- Project 변경 시 이전 Project Cache를 권위 있는 현재 화면으로 재사용하지 않는다.
- Permission 변경 시 보호 Query를 재검증한다.
- Optimistic UI는 Approval·Canonical Write·Action Execution에 사용하지 않는다.

## 8. Authentication·Session·Project Context UX

### 8.1 P0-1 계약 소비

Browser는 다음 경계를 사용한다.

- Server-generated Session Cookie
- Same-origin CSRF Token Rotation
- Authenticated Principal Query
- Accessible Project List Query
- Server-validated Active Project Change
- Logout과 Session Revocation

Browser가 다음 Header를 권위 있게 설정하지 않는다.

- Actor ID
- Access Scope
- Sensitivity
- Legacy Project Header

### 8.2 화면 동작

- 인증 만료 시 보호 화면을 로그인 상태로 유지하지 않는다.
- CSRF Rotation 실패와 인증 만료를 구분한다.
- Project 변경 중 이전 Project 데이터를 숨기거나 명확히 Stale 표시한다.
- 권한 없는 자원의 존재 여부를 오류 메시지로 노출하지 않는다.
- Logout 이후 보호 Cache와 민감 Presentation State를 제거한다.

## 9. Source·Evidence·Citation Viewer

### 9.1 Source Viewer

- SourceVersion 고정
- 페이지·셀·Shape·BBox·CSS Selector 등 형식별 위치
- 원문과 번역 전환
- 변환 Revision
- 접근 범위
- 원본 다운로드 권한

### 9.2 Citation

- Filename만으로 Citation을 표시하지 않는다.
- EvidenceSpan과 SourceVersion을 사용한다.
- Exact Quote와 위치를 표시한다.
- 원문 복귀 대상이 사라졌거나 권한이 없으면 안전한 오류를 표시한다.
- 번역문을 Evidence로 표시하지 않는다.

### 9.3 접근성

- Keyboard로 Citation 이동
- Focus Target과 Highlight
- Screen Reader용 Evidence 설명
- 이미지·표 Evidence의 Text Alternative

## 10. Review·Diff·Impact·Approval UX

### 10.1 Review Bundle

하나의 검토 Context에 다음을 결속한다.

- Candidate Revision
- Validation Revision
- Evidence Set
- Canonical Snapshot
- Comparison Result
- Conflict Projection
- Impact Projection
- Draft ChangeSet
- Burst Diff
- Approval Capability

### 10.2 Stale 처리

다음 변경이 있으면 현재 검토 화면은 Stale다.

- Candidate Revision
- Evidence Digest
- Validation Result
- Canonical Snapshot
- Project Permission
- Source Sensitivity
- Approval Policy

Frontend는 Stale 상태에서 승인 버튼을 숨기는 것만으로 보안을 구현하지 않는다. Server가 요청을 거부해야 한다.

### 10.3 Edit

사용자 Edit는 변경 유형에 따라 올바른 Phase로 재진입한다.

- Wording/Layout
- Factual Correction
- New Knowledge
- Evidence/Reference Change

Editor는 Phase 재진입 요구를 View Model로 표시하며 이를 우회한 Canonical Write를 만들지 않는다.

## 11. Activity·Progress·Failure·Recovery UX

### 11.1 상태 표시

- 측정 가능: byte upload 등 숫자 진행률
- 비측정 작업: 단계형 상태
- Attempt와 Job을 구분
- 자동 Retry와 사용자 Retry를 구분
- Retry 금지 상태를 명확히 표시

### 11.2 오류 표시

사용자 메시지는 다음을 구분한다.

- Validation Error
- Permission Denied
- Stale Resource
- Temporary Infrastructure Failure
- Permanent Unsupported Input
- Outcome Unknown
- Projection Stale

Secret, raw provider response, stack trace, token 또는 민감 Digest를 화면에 노출하지 않는다.

### 11.3 Recovery

- 새로고침 후 현재 Snapshot 복원
- SSE Cursor 재연결
- 누락 Event는 Snapshot Query로 조정
- Background Job은 화면 이탈과 분리
- Cancel은 Server Capability가 허용할 때만 요청

## 12. Graph·Visualization·Accessibility

### 12.1 Graph 전략

- 2D Semantic Graph
- Node·Edge Type 구분
- Neighborhood Mode
- Filter
- Search와 Focus
- Impact Path 표시
- Current·Historical·Scheduled·Conflict 상태

### 12.2 금지

- 3D Canvas-only Product Graph
- Keyboard로 탐색할 수 없는 Graph
- 색상만으로 상태 구분
- Graph를 Canonical 편집 표면으로 사용

### 12.3 Fallback

모든 Graph에는 동일한 권한·Snapshot을 사용하는 목록·표 대안을 제공한다.

## 13. Visual·Source Editor Boundary

### 13.1 적용 범위

OpenKnowledge의 다음 UX를 참고한다.

- Visual Mode
- Source Mode
- Round-trip Preservation
- Typed Semantic Block
- Change Preview

### 13.2 불변 조건

- Editor State는 Draft다.
- Markdown/Yjs는 Canonical Store가 아니다.
- Save는 Draft ChangeSet 또는 적절한 Candidate를 생성한다.
- Byte·Semantic Preservation Fixture Gate를 통과해야 한다.
- Evidence·Citation 위치를 조용히 손상하지 않는다.

### 13.3 Yjs

Yjs는 초기 Frontend에서 비활성이다. 다중 사용자·Agent Draft Collaboration은 별도 ADR을 요구한다.

## 14. Current Inline UI Migration

### 14.1 현재 지위

`assemblies/shotgun-app/src/server.ts`의 HTML·JavaScript는 `Backend Vertical Slice UI`다.

### 14.2 전환 순서

1. Product API와 Typed Client 계약 작성
2. Auth·Project App Shell
3. Sources
4. Ask
5. Knowledge
6. Review
7. Activity
8. History·Settings
9. Inline UI를 development-only로 제한
10. 최종 제거 또는 별도 Diagnostic Surface로 유지 결정

### 14.3 전환 Gate

화면별로 다음을 통과한 뒤 대체한다.

- Contract Test
- Browser E2E
- Accessibility Test
- Authentication·CSRF Test
- Cross-project Negative Test
- Stale State Test
- Error·Recovery Test

## 15. Frontend Packaging·Testing·Release Gate

### 15.1 Package Boundary

최소 목표:

```text
apps/shotgun-web
packages/shotgun-api-client
```

선택적 분리 후보:

```text
packages/editor-core
packages/graph-ui
packages/activity-ui
```

패키지 분리는 실제 재사용성과 결합도 근거에 따라 결정하며 단순 폴더 수 증가를 목표로 하지 않는다.

### 15.2 필수 테스트

- Unit
- Product API Contract
- Browser Integration
- End-to-end
- Accessibility
- Authentication·CSRF
- Project Isolation
- Visual Regression의 제한적 사용
- Editor Preservation Fixture
- Graph List Equivalence
- Offline·Reconnect·Recovery

### 15.3 Release Gate

- 보호 화면 인증 우회 없음
- Legacy Authority Header 사용 없음
- Approval·Canonical Optimistic Mutation 없음
- Cross-project Cache Leak 없음
- Critical Browser Flow 통과
- Keyboard-only 핵심 작업 가능
- Screen Reader Landmark 존재
- Graph·Diff·Chart 대안 존재
- 주요 오류와 Stale 상태 표시
- Reference OSS License·적용 범위 추적

## 16. 확정된 OSS 적용·제외

### 16.1 ddsyasas/llm-wiki

적용:

- Home hierarchy
- Source Intake interaction
- Ask·Chat presentation
- Cost·Model·Settings workflow
- Design tokens와 leaf presentation component 후보

제외:

- Backend
- SQLite·Filesystem authority
- 기존 Provider execution
- blocking progress
- unrestricted path model
- 3D-only graph

### 16.2 Inkeep OpenKnowledge

적용:

- Visual/Source UX
- 2D Graph interaction
- Activity
- Burst Diff
- Entity Vault template
- preservation test pattern

제외:

- complete runtime
- local filesystem authority
- canonical Markdown/Yjs
- direct canonical editor mutation
- initial Yjs

## 17. 제외한 아키텍처 대안

- Backend 완료 후 임의 UI 부착
- Inline HTML을 최종 Product UI로 유지
- ddsyasas 전체 App Fork
- OpenKnowledge 전체 Runtime
- Client-side Authority Header
- UI State 기반 Approval
- Optimistic Canonical Write
- 3D Graph-only UI
- 접근성 Fallback 없는 Visualization
- 초기 Real-time CRDT

## 18. 영향 범위

### 문서

- ADD Canonical 허브
- Module Architecture ADD
- Implementation Roadmap
- OSS Integration Roadmap
- Stage 5·7·9·12 완료 표현
- ADR-095

### 구현

- 독립 Frontend App
- Typed Product Client
- Product API View Models
- SSE Activity
- Inline UI 격리
- Browser·Accessibility·Security Tests

### 운영

- Browser Build와 Release
- Session·CSRF 운영
- Frontend Telemetry
- Client Cache와 Sensitive State 정리
- OSS License·Upstream 추적

## 19. 미결사항

다음은 이 Section 승인만으로 확정하지 않는다.

- Frontend Framework와 Exact Version
- SPA·SSR·Desktop Wrapper
- Route와 URL Policy
- Design System·Component Library
- Server State Library
- Form·Validation Library
- Typed Client 생성 방식
- SSE reconnect·replay 세부 규칙
- Visual Editor 기술
- Browser E2E 도구
- Visual Regression 도구
- 모바일 지원 범위
- Frontend 배포와 자동 업데이트

각 항목은 Frontend Foundation 구현 전 별도 기술 결정 또는 ADR을 요구한다.

## 20. 완료 조건

이 Section은 다음이 충족되면 확정된다.

- 기존 Phase UI 정책과 충돌 없음
- ddsyasas·OpenKnowledge 적용·제외 범위가 보존됨
- `shotgun-web`과 Typed Product Boundary가 Module ADD에 반영됨
- Current Inline UI가 임시 Surface로 기록됨
- Security·Canonical·Approval Server Authority가 명시됨
- Frontend Foundation Gate가 Roadmap에 추가됨
- 미결 기술 선택을 임의로 확정하지 않음
- ADR-095가 Accepted로 전환됨

이 Section의 확정은 Frontend 구현 완료를 의미하지 않는다.
