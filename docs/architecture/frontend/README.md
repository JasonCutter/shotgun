---
id: FRONTEND-AND-HUMAN-INTERACTION-ARCHITECTURE
classification: CANONICAL
status: architecture_confirmed_frontend_work_item_registry_governed
approved_by: user
approved_at: 2026-07-30
migrated_at: 2026-07-29
legacy_source_provider: notion
legacy_source_id: 3a15181d-71ad-81e4-bfa4-ee2578e692a0
---

# Frontend and Human Interaction Architecture

## 상태

- Frontend Architecture 방향: **확정**
- Phase 1~5 Section 설계: **완료**
- Cross-Phase Contract 정규화: **완료**
- Frontend Phase 3~5: **설계·Contract 확정 / Product 구현 검증 대기**
- Cross-Phase Product Verification: **미착수**
- 전체 Frontend 완료: **미완료**

<!-- FRONTEND-WORK-ITEM-STATUS:START -->

> 이 블록은 `docs/project/frontend-work-items.json`과 Section Completion Manifest에서 생성됩니다. 블록 내부를 직접 수정하지 않습니다.

| Work Item                                                      | Status                |
| -------------------------------------------------------------- | --------------------- |
| FE-P2 — Knowledge Input and Question                           | `IN_PROGRESS`         |
| FE-P2-S2 — Ask and Conversations Workspace                     | `IN_PROGRESS`         |
| FE-P2-S2-I01 — Read Foundation                                 | `COMPLETE` / VERIFIED |
| FE-P2-S2-I02 — Command and Persistence                         | `COMPLETE` / VERIFIED |
| FE-P2-S2-I03 — Answer Execution and Remaining Section Contract | `NOT_STARTED`         |

- 미충족 필수 기준: `answerExecution, failureAndRetry, finalSectionVerification`
- Next valid Product Section: `FE-P3-S1 — Knowledge Workspace`

<!-- FRONTEND-WORK-ITEM-STATUS:END -->

Phase 1 완료 권위는
[`Frontend Phase 1 Completion Review`](../../engineering/frontend-phase-1-completion-review-260730001.md)에 있다.
Phase 2 Section 1 완료 권위는
[`Frontend Phase 2 Section 1 Completion Record`](../../engineering/frontend-phase-2-section-1-completion-record-260730001.md)에 있다.

이 문서는 Knowledge Flow의 6개 지식 생명주기 Phase를 대체하지 않는다. Frontend Phase 0~5는 Knowledge Flow 전반의 입력, 인용, 검토, 진행 상태, 그래프, 출력과 접근성 정책을 연결하는 횡단 Product 구현 축이다.

## 정식 구현 순서

```text
Shared Contract Foundation (Phase 0)
→ Frontend Phase 1 — Platform Boundary
→ Frontend Phase 2 — Knowledge Input·Question
→ Frontend Phase 3 — Knowledge Understanding·Editing
→ Frontend Phase 4 — Governance·Execution
→ Frontend Phase 5 — Operations·Audit
→ Cross-Phase Product Verification
```

기존 `Frontend MVP`, `Review & Activity`, `Semantic Graph`, `Visual Editor` 명칭은 독립 구현 단계나 완료 판정 단위로 사용하지 않는다. 필요한 경우 Release Milestone 설명으로만 사용한다.

## Phase와 Section

| Phase                                     | Section                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| Phase 1 — Platform Boundary               | 1. Local Owner Session·Authentication·Project Boundary |
|                                           | 2. Settings·Project Administration                     |
|                                           | 3. Home·Action Center·Global Shell                     |
| Phase 2 — Knowledge Input·Question        | 1. Sources Workspace                                   |
|                                           | 2. Ask·Conversations Workspace                         |
| Phase 3 — Knowledge Understanding·Editing | 1. Knowledge Workspace                                 |
|                                           | 2. Knowledge Editor·DraftChangeSet Authoring           |
|                                           | 3. Semantic Graph·Relationship Exploration             |
| Phase 4 — Governance·Execution            | 1. Review Center                                       |
|                                           | 2. External Action Governance·Execution                |
| Phase 5 — Operations·Audit                | 1. Agent·Job Activity Workspace                        |
|                                           | 2. History·Audit·Rollback                              |

Section 완료는 구현, mandatory completion criteria, exact-head 검증, Evidence Registry, 사용자 승인과 `main` 병합을 모두 요구한다. Increment 완료만으로 parent Section을 완료 처리하지 않는다.

## 사용자 Route

```text
/
/sources
/ask
/chats
/knowledge
/knowledge/editor
/knowledge/graph
/review
/activity
/history
/settings
```

`/chats`는 Ask·Conversations의 보조 Route이며 별도 책임 Section이 아니다. 미구현 Route는 활성 링크로 제공하지 않고 Server Feature Availability에 따라 숨기거나 `COMING_LATER`로 표시한다.

## 고정된 권위 경계

```text
Canonical Knowledge
→ 승인 후 Git 또는 Shotgun Canonical 원장에 기록되는 권위 상태

Server Domain Resource
→ Source·Run·Draft·Review·Approval·Execution·History의 권위 상태

Projection
→ Compiled Truth·Search·Graph·Timeline·Home·Activity·History View

Browser Draft·Presentation
→ 입력·편집·Layout·Focus·Cache 보조 상태
```

Frontend, DOM, Markdown, Canvas, Query Cache, Browser Draft와 UI Projection은 Principal·Project·Scope·Sensitivity·Approval·Canonical·Execution 권위를 소유하지 않는다.

## 핵심 계약

1. `Active Project`, `Resource Project`, `Draft Project`, `Effective Project`를 구분한다.
2. Deep Link 진입이나 Project 전환으로 기존 Resource·Draft·Review·Action의 Project 귀속을 변경하지 않는다.
3. Connectivity, Authentication, Session, Backend Readiness를 별도 상태 축으로 관리한다.
4. 모든 Write는 Versioned Command, CSRF Transport Security, Idempotency, Typed Preconditions, Project·Policy Binding과 Outcome Resolution 계약을 따른다.
5. `OUTCOME_UNKNOWN` 또는 `OUTCOME_INDETERMINATE`에서는 자동 재제출하지 않고 기존 Command·Resource 결과를 조회한다.
6. Snapshot과 Revision을 권위로 사용하며 SSE·Polling·Timeline은 갱신 또는 관찰 수단이다.
7. AI·사용자 결과는 승인 전 Candidate이며 Claim은 자동으로 Fact가 되지 않는다.
8. Canonical 변경, Directive 적용과 External Action 실행은 목적별 Draft·Approval·Commit/Execute 경계를 분리한다.
9. Activity는 현재 운영 Projection이고 History는 Append-only 장기 기록이다.
10. Cancel, Canonical Reversal DraftChangeSet과 External Compensating Action을 구분한다.

## 공통 완료 Gate

- Typed Product API Contract Test
- Phase별 및 Cross-Phase E2E
- Project·권한·민감도·Session 보안 E2E
- Idempotency·Outcome Unknown·Stale·Retry·Cancel Recovery
- Projection Lag·부분 실패·Offline
- Candidate의 Canonical 비자동반영 Negative Test
- Approval 우회 및 Action Preflight·Verify Negative Test
- Activity·History·Reversal Lineage Test
- Desktop·Tablet·Mobile, Keyboard, Screen Reader, 200% 확대
- 성능·대용량·Virtualization·Cache 격리

설계 또는 Contract 확정만으로 구현 완료를 선언하지 않는다. 현재 상태 권위는 Frontend Work Item Registry와 해당 Completion Manifest에 있다.

## Canonical 하위 문서

- [Phase 1 — Platform Boundary](phase-1-platform-boundary.md)
- [Phase 2 — Knowledge Input·Question](phase-2-knowledge-input-question.md)
- [Phase 3 — Knowledge Understanding·Editing](phase-3-knowledge-understanding-editing.md)
- [Phase 4 — Governance·Execution](phase-4-governance-execution.md)
- [Phase 5 — Operations·Audit](phase-5-operations-audit.md)
- [Cross-Phase Contract and Completion Audit](cross-phase-contract-and-completion-audit.md)
- [Frontend ADR Index](adr-index.md)
- [Frontend Phase 1–5 Implementation Plan v1.0](../../implementation/frontend-phase-1-5-plan-v1.0.md)

## Legacy source boundary

Notion page `3a15181d-71ad-81e4-bfa4-ee2578e692a0`과 그 하위 페이지는 이관 출처와 변경 이력을 보존하는 Legacy Reference다. 이 Git 계층과 기존 Git ADR·Contract Snapshot·Engineering Record가 현재 권위 기록이며, Notion-only 수정은 Git PR로 병합되기 전에는 Candidate다.
