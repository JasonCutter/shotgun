# Shotgun Frontend Strategy Reconciliation

> 상태: **확정 및 Canonical ADD 반영 완료**  
> 확정일: 2026-07-18  
> 범위: 기존 Frontend 참조 전략 복원과 ADD·Module Architecture·Implementation Roadmap 정합화  
> 비범위: P0-1·P0-2 제품 코드와 보안 구현 브랜치

## 1. 확정 결과

Shotgun의 프론트엔드 전략은 새로 설계하지 않고 기존 기준 문서에서 복원했다.

확정된 결정:

1. 최종 사용자 Product Surface는 독립 `apps/shotgun-web`이다.
2. Frontend는 `packages/shotgun-api-client`를 통해 Shotgun HTTP Command·Query API와 SSE Activity Stream을 사용한다.
3. `ddsyasas/llm-wiki`는 Source Intake, Ask·Chat, Cost·Model·Settings와 Action-oriented Home의 Interaction·Presentation 참조다.
4. Inkeep OpenKnowledge는 Visual/Source UX, 2D Graph, Agent Activity, Burst Diff, Entity Vault와 Preservation Test의 Human Cockpit 참조다.
5. 두 프로젝트의 전체 Backend·Runtime·저장 모델은 Shotgun에 포함하지 않는다.
6. Browser UI는 Principal·Project·Scope·Sensitivity·Approval·Canonical·Action 권위를 소유하지 않는다.
7. `assemblies/shotgun-app/src/server.ts`의 Inline HTML은 `Backend Vertical Slice UI`이며 최종 Product UI가 아니다.

## 2. Canonical 반영

Notion Canonical ADD 허브 아래에 다음 문서를 생성하고 사용자 승인 상태로 저장했다.

- `Frontend and Human Interaction Architecture (확정)`
- Page ID: `3a15181d-71ad-81e4-bfa4-ee2578e692a0`

ADD 허브에도 횡단 Architecture 확정 상태와 페이지 연결을 반영했다.

## 3. 저장소 동기화

다음 문서로 같은 결정을 동기화했다.

- `docs/architecture/add/completed/frontend-and-human-interaction-architecture.md`
- `docs/architecture/module-architecture/frontend-product-surface-amendment.md`
- `docs/architecture/module-architecture/README.md`
- `docs/architecture/adr/ADR-095-frontend-product-surface-and-reference-strategy.md`
- `docs/implementation/frontend-delivery-roadmap.md`
- `docs/implementation/README.md`
- `docs/engineering/frontend-add-alignment-findings.md`

ADR-095의 상태는 `Accepted`다.

## 4. Workspace와 전달 순서

초기 Workspace:

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

전달 순서:

1. F0 Frontend Foundation
2. F1 Frontend MVP
3. F2 Review and Activity
4. F3 Semantic Graph
5. F4 Visual Editor
6. F5 Advanced Draft Collaboration — 별도 ADR 전까지 연기

## 5. 기존 Stage 기록과의 정합성

과거 기록은 삭제하지 않고 다음 의미로 유지한다.

- Stage 5: 최소 Review 수직 슬라이스와 Backend Contract 검증
- Stage 7: 최소 Ask·Cited Answer 수직 슬라이스
- Stage 9: Graph Projection과 최소 UI/List 검증
- Stage 12: UX Mock Contract와 재사용 검증

이 기록들은 최종 Product Frontend 완료를 의미하지 않는다. 최종 Frontend 완료는 F0~F5 Gate로 추적한다.

## 6. 미결사항

이번 확정으로 다음 기술은 선택하지 않았다.

- Frontend Framework와 Exact Version
- SPA·SSR·Desktop Wrapper
- Route와 URL Policy
- Design System·Component Library
- Server State·Form·Validation Library
- Typed Client 생성 방식
- SSE reconnect·replay 구현
- Visual Editor 기술
- Browser E2E·Visual Regression 도구
- 모바일 지원 범위
- Frontend 배포·업데이트 방식

각 항목은 F0 구현 전에 별도 기술 결정 또는 ADR을 요구한다.

## 7. P0-1·P0-2와의 관계

이 문서 작업은 P0-1·P0-2 보안 구현 브랜치와 제품 코드를 변경하지 않았다. Frontend 구현은 ADR-093·094의 Server Authority를 소비하며 약화하지 않는다.
