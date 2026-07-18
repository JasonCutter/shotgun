# Frontend ADD Alignment Findings

> 상태: **검토 완료 / Canonical ADD 반영 완료**  
> 기준일: 2026-07-18  
> 기준 브랜치: `docs/frontend-strategy-reconciliation`  
> 관련 문서: `frontend-strategy-reconciliation.md`, ADR-095

## 1. Canonical ADD 위치

Phase 1~6 ADD와 횡단 Frontend Architecture의 Canonical 저장소는 **Notion**이다.

Canonical 허브:

- `Project Shotgun — Architecture Design Documents`
- Page ID: `39f5181d-71ad-81a6-a51f-f7f2a3a88ee6`

확정 Frontend 페이지:

- `Frontend and Human Interaction Architecture (확정)`
- Page ID: `3a15181d-71ad-81e4-bfa4-ee2578e692a0`

Google Drive는 ADD 작성·보관 경로에서 제외한다. 저장소 `docs/architecture/add/completed`의 문서는 Canonical ADD의 구현 추적용 사본이다.

## 2. 확인된 기존 UI 결정

Frontend 정책은 누락된 것이 아니라 Phase별 ADD에 분산돼 있었다.

- Phase 1 Section 1.9: 통합 Intake 화면, 부분 성공, 상태 복원, 취소·재시도, Draft 자동 저장 금지
- Phase 4: Candidate·Evidence·Conflict·Impact·Burst Diff·승인 검토 계약
- Phase 6 Step 20: 화면·원문 Viewer·읽기 API·Citation·Streaming·접근성·Graph fallback
- Reference Architecture: `shotgun-web`, Typed Client, ddsyasas·OpenKnowledge 참조 범위
- Implementation/OSS Roadmap: Stage 2·5·7·9·12 UI·UX 검증 요구

## 3. 실제 누락

`Shotgun Module Architecture ADD`의 전체 구조에는 Assembly·Modules·Kernel·Adapters만 존재했고 다음이 명시되지 않았다.

- 사용자 Client Product Container
- 독립 `shotgun-web`
- Typed Product API Client
- Browser Session·CSRF·Project Context 소비 경계
- Client State·Server State·Draft State 구분
- Inline Vertical Slice UI의 임시 지위
- Frontend Build·Browser·Accessibility Release Gate

따라서 문제는 Frontend 전략 부재가 아니라 **확정 전략의 추적성 단절**이었다.

## 4. 정합화 결정

다음 문서들을 같은 결정으로 정합화했다.

1. Notion Canonical Frontend ADD
2. Notion ADD 허브
3. `docs/architecture/add/completed/frontend-and-human-interaction-architecture.md`
4. Module Architecture Frontend Amendment와 README
5. ADR-095 Accepted
6. Frontend Delivery Roadmap와 Implementation README

## 5. Stage 완료 표현 정정

과거 Stage 기록을 삭제하거나 실패로 변경하지 않는다.

- Stage 5 UI: 최소 Review vertical slice
- Stage 7 UI: 최소 Ask·Citation vertical slice
- Stage 9 UI: Graph Projection과 최소 UI/List 검증
- Stage 12 UI: UX Mock Contract와 Module reuse 검증

이들은 최종 Frontend Product 완료가 아니다. F0~F5 Frontend Delivery Gate가 별도로 완료돼야 한다.

## 6. 안전 경계

- Frontend는 Principal·Membership·Scope·Sensitivity를 결정하지 않는다.
- Browser는 Legacy Authority Header를 만들지 않는다.
- UI State는 Approval이나 Canonical Record가 아니다.
- Optimistic Canonical Write와 Action Execute를 금지한다.
- Inline HTML은 `Backend Vertical Slice UI`다.
- P0-1·P0-2 보안 경계를 변경하거나 약화하지 않았다.

## 7. 남은 기술 결정

Framework, SPA/SSR/Desktop, Routing, Design System, State/Form Library, Typed Client Generation, SSE 구현, Visual Editor, Browser Test Tool, 모바일·배포 방식은 이번 Section에서 확정하지 않았다.

다음 Frontend Foundation Section에서 한 번에 하나씩 검토한다.
