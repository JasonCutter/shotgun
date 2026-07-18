# Frontend ADD Alignment Findings

> 상태: **검토 후보 / Canonical ADD 미반영**  
> 기준일: 2026-07-18  
> 기준 브랜치: `docs/frontend-strategy-reconciliation`  
> 관련 문서: `frontend-strategy-reconciliation.md`, ADR-095

## 1. Canonical ADD 위치 확인

현행 Phase 1~6 ADD의 Canonical 저장소는 Google Docs가 아니라 **Notion**이다.

Canonical 허브:

- `Project Shotgun — Architecture Design Documents`
- Page ID: `39f5181d-71ad-81a6-a51f-f7f2a3a88ee6`

허브의 운영 원칙은 다음을 명시한다.

- 정확한 설계 문서 작성과 검토는 Notion에서 수행한다.
- Phase 1~6 ADD는 모두 Notion Canonical 기록 완료 상태다.
- Google Drive는 ADD 작성·보관 경로에서 제외한다.
- 완료된 ADD는 Codex가 저장소 `docs/architecture/add/completed`로 내려받아 정리한다.

따라서 Frontend 정합화의 최종 반영 대상은 다음 두 곳이다.

1. Notion Canonical ADD 허브와 관련 Phase 페이지
2. GitHub Module Architecture ADD와 구현 Roadmap

Google Drive의 과거 ADD Markdown Snapshot은 보조 자료로만 취급한다.

## 2. Phase ADD에 이미 존재하는 Frontend 결정

Frontend 요구가 빠진 것이 아니라 Phase별 정책 안에 분산돼 있다.

### 2.1 Phase 1 / Section 1.9 — Intake Workspace

이미 확정된 주요 UX 계약:

- File·URL·Direct Text를 한 화면에서 추가
- 순서가 유지되는 카드 목록
- 제출 전 명백한 오류 검증
- 부분 성공 허용
- 미제출 내용 자동 저장 금지
- `submitted`, `intake completed`, `automatic processing completed` 구분
- 제출 이후 화면 이탈 허용
- 재접속 시 IntakeSubmission 기준 상태 복원
- 측정 가능한 Upload에만 숫자 진행률 사용
- 단계형 자동 처리 상태
- 진행 중 전체 취소와 실패 항목 재시도
- 실제 시각 디자인과 반응형 구현은 별도 Product UI 설계에서 확정

Frontend Architecture는 이 정책을 변경하지 않고 `Sources` Workspace의 제품 구조로 투영해야 한다.

### 2.2 Phase 4 — Review Workspace

이미 확정된 주요 UX 계약:

- Candidate와 Canonical Snapshot 비교
- Evidence, Conflict, 시간 범위, 영향과 불확실성 표시
- Burst Diff
- 모델 간 의견 불일치 표시
- 사용자 항목별 승인·수정·보류·거절
- UI State는 Approval을 대체하지 않음
- Canonical Write는 서버의 승인 경계 뒤에서만 수행

Frontend Architecture는 이를 `Review` Workspace와 `Activity` Workspace로 묶되, Phase 4의 판단·승인 계약을 바꾸지 않는다.

### 2.3 Phase 6 / Step 20 — Delivery Surface

이미 확정된 주요 UX·출력 계약:

- 대화·검색 화면
- 상세 검토 화면과 원문 Viewer
- 문서·보고서·슬라이드·표·이미지
- 다운로드·내보내기
- 알림·개인 피드
- 읽기 전용 API
- Citation·Conflict·Gap·Readiness의 채널 간 의미 보존
- 원문 복귀 가능한 Citation
- Snapshot·Watermark·Version 고정
- Streaming과 점진적 결과 제공
- 대형 Graph의 Pagination·Virtualization·Summary·Drill-down
- 키보드 탐색
- 색상 외 상태 표현
- Graph·Chart의 목록·텍스트 대안
- 한국어 기본 표시와 원문·번역 전환
- 읽기 결과와 외부 쓰기 Action의 분리

Frontend Architecture는 Step 20을 대체하는 것이 아니라 모든 Product Surface에 적용할 공통 Container·Client·State·Accessibility 경계를 제공한다.

## 3. Module Architecture ADD에서 빠진 부분

`Shotgun Module Architecture ADD`는 다음을 충분히 정의한다.

- Reusable Modules
- Kernel
- Contracts
- Connector Runtime
- Security Context
- Port and Adapter
- Data Ownership
- Assembly와 Recipe
- Deployment Evolution

그러나 전체 구조도와 Assembly 정의에 다음이 없다.

- Browser 또는 Desktop Product Client Container
- `shotgun-web`
- Typed API Client
- Gateway·BFF 역할
- HTTP API와 SSE Event Stream
- Client State·Server State·Draft State 경계
- Navigation·Workspace·App Shell
- Browser Security Consumption Boundary
- Browser·Accessibility·Frontend Contract Test Gate

현재 `Shotgun Personal Knowledge OS`는 모든 Knowledge Flow Module을 사용한다고만 정의돼 있으며 사용자가 그 Assembly를 조작하는 Product Surface는 Container로 모델링되지 않았다.

이것이 Phase ADD의 UX 정책과 실제 구현 사이의 핵심 추적성 단절이다.

## 4. 현재 구현과의 차이

현재 구현은 다음 상태다.

```text
assemblies/shotgun-app/src/server.ts
├─ HTTP routes
├─ authentication/session/CSRF handling
├─ Ask HTML and JavaScript
├─ Knowledge Graph HTML and JavaScript
└─ Review HTML and JavaScript
```

이 구조는 Stage별 Backend Vertical Slice 검증에는 유효하지만 다음 이유로 최종 Product Frontend가 될 수 없다.

- Product UI와 Backend Assembly가 한 파일에 결합됨
- Typed Client 경계가 없음
- 공통 App Shell·Navigation·Project Context Store가 없음
- CSRF 획득과 Fetch가 화면별로 중복됨
- Domain response를 화면 JavaScript가 직접 해석함
- Browser Build·Package·Deployment 경계가 없음
- Browser E2E와 Accessibility Gate가 없음
- ddsyasas/OpenKnowledge 참조 전략의 적용·제외 추적이 제품 코드에 없음

현재 Inline UI는 `Backend Vertical Slice UI`로 유지하고, 독립 Frontend가 검증된 뒤 화면별로 대체한다.

## 5. ADD에 추가할 정확한 횡단 Section

Phase 1~6의 기존 Section을 다시 열어 내용을 재설계하지 않는다.

Canonical ADD 허브 아래에 다음 횡단 문서를 추가하는 것이 정합적이다.

### `Frontend and Human Interaction Architecture`

하위 결정 단위:

1. Product Surface와 Deployment Boundary
2. User Roles·Core Tasks·Workspace Model
3. Information Architecture와 Navigation
4. Typed Client·Gateway·HTTP·SSE Boundary
5. Client State·Server State·Draft State
6. Session·CSRF·Active Project UX
7. Source Intake·Processing·Recovery UX
8. Evidence·Citation·Source Viewer
9. Review·Burst Diff·Impact·Approval UX
10. Activity·Progress·Failure·Retry UX
11. Knowledge Graph·List Fallback·Accessibility
12. Visual/Source Editor Preservation Boundary
13. Frontend Packaging·Browser Test·Release Gate

이 문서는 다음 Phase 결정들을 참조한다.

| Frontend 관심사 | Canonical Phase 결정 |
|---|---|
| Sources Workspace | Phase 1, Section 1.9 |
| Evidence Viewer | Phase 2와 Step 20.1·20.4 |
| Review Workspace | Phase 4, Step 10~14 |
| Knowledge·Graph | Phase 5와 Step 20.7·20.8 |
| Ask·Delivery | Phase 6, Step 18·20 |
| External Action UX | Phase 6, Step 19·21 |
| Feedback·Reentry | Phase 6, Step 22 |

## 6. Module Architecture ADD 수정 후보

사용자 승인 후 Module Architecture ADD에 다음을 추가한다.

### 6.1 전체 구조의 Client Container

```text
Client Products
├─ shotgun-web
└─ future local desktop wrapper
        ↓
Typed Product Boundary
├─ shotgun-api-client
├─ HTTP Query/Command API
└─ SSE Job/Activity Stream
        ↓
Shotgun Personal Knowledge OS Assembly
```

### 6.2 책임 경계

Frontend 소유:

- Composition
- Navigation
- Local presentation state
- Server query cache
- Draft-only editor state
- loading/error/retry/accessibility

Server 소유:

- Principal·Membership·Scope·Sensitivity
- Domain state
- Canonical state
- Approval validity
- Action authority
- Projection meaning

### 6.3 배포 진화

- 초기: `shotgun-web` + modular-monolith API, local-first
- 이후: independent static/web deployment 가능
- Desktop wrapper는 별도 결정 전 미확정
- Frontend가 Service 분리 여부를 알아야 하지 않도록 Typed API를 안정 경계로 유지

## 7. Roadmap 정정 후보

기존 Stage 완료 상태를 취소하지 않는다. 대신 UI 완료 표현을 정확히 구분한다.

- Stage 5: `Minimum Review Vertical Slice Complete`
- Stage 7: `Minimum Ask Vertical Slice Complete`
- Stage 9: `Minimum Graph Vertical Slice Complete`
- Stage 12: `UX Mock Contract Reuse Validation Complete`

이 항목들은 다음을 의미하지 않는다.

- dedicated frontend complete
- product navigation complete
- frontend package boundary complete
- accessibility complete
- browser security E2E complete
- ddsyasas/OpenKnowledge product integration complete

별도 Frontend Foundation과 Frontend MVP Gate를 Implementation Roadmap에 추가해야 한다.

## 8. P0-1·P0-2와의 병행 경계

P0-1·P0-2 보정 브랜치는 변경하지 않는다.

Frontend 정합화는 다음 보안 계약을 소비한다.

- server-derived Principal
- Project Membership
- Browser Session
- CSRF rotation
- Active Project server validation
- API Token scope ceiling
- server-bound Preview·Snapshot·Approval·Execution

Frontend는 이 결정을 재설계하거나 우회하지 않는다.

현재 P0 보안 테스트가 실행되는 동안 수행 가능한 작업은 문서 정합화, Proposed ADR, API/View Model inventory와 Frontend implementation planning까지다. 제품 코드 병행 수정은 Security branch가 확정되기 전 시작하지 않는다.

## 9. 상태 구분

### 확정된 기존 결정

- dedicated `shotgun-web`
- ddsyasas Product Workflow UX 참조
- OpenKnowledge Human Cockpit 참조
- reference runtime 전체 채택 금지
- Typed API를 제품 경계로 사용
- server-owned Canonical·Approval·Security
- 2D Graph + accessible list/table
- Yjs 초기 도입 연기

### 이번 정합화에서 확인된 Fact

- Canonical Phase ADD는 Notion에 있다.
- Google Drive는 Canonical ADD 경로에서 제외됐다.
- Phase별 UI 정책은 이미 상세히 확정돼 있다.
- Module Architecture ADD에는 Client Product Container가 없다.
- 현재 UI는 `server.ts` Inline Vertical Slice다.
- 계획된 Frontend Package는 아직 구현되지 않았다.

### 미결사항

- Frontend Framework와 Version
- SPA·SSR·Desktop Wrapper
- Design System
- Typed Client 생성 방식
- Server State Library
- SSE reconnect/replay
- Browser E2E 도구
- Visual Editor 기술
- 모바일 범위
- 배포와 업데이트 방식

### 제외 대안

- Inline HTML을 최종 Product UI로 유지
- ddsyasas 전체 Backend 채택
- OpenKnowledge 전체 Runtime 채택
- UI state를 Approval 또는 Canonical truth로 사용
- Browser authority header
- 3D-only Graph
- 초기 Yjs

## 10. 다음 Canonical 반영 절차

이 문서와 ADR-095는 사용자 검토 전까지 후보 상태다.

사용자 승인 후 한 Section 안에서 다음만 수행한다.

1. ADR-095를 `Accepted`로 변경
2. Notion ADD 허브에 `Frontend and Human Interaction Architecture` 문서 추가
3. 기존 Phase 페이지에는 내용을 복제하지 않고 관련 Frontend Section 링크와 변경 이력만 추가
4. Module Architecture ADD에 Client Product Container와 Typed Product Boundary 추가
5. Implementation Roadmap에 Frontend Foundation·MVP Gate 추가
6. GitHub 완료 ADD 사본 생성 규칙에 따라 Notion 결과를 저장소로 동기화

그 전에는 Frontend Framework를 선택하거나 제품 구현을 시작하지 않는다.
