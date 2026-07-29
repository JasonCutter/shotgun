---
id: FRONTEND-PHASE-1-5-IMPLEMENTATION-PLAN-V1
classification: CANONICAL
status: confirmed_plan_current_status_amended_by_later_completion_records
approved_by: user
approved_at: 2026-07-24
migrated_at: 2026-07-29
legacy_source_id: 3a75181d-71ad-817a-9675-c984455b2c3b
---

# Project Shotgun Frontend Phase 1–5 구현계획 v1.0

## 문서 상태

- Canonical Implementation Plan v1.0: 확정
- 원 확정일: 2026-07-24
- 목적: Frontend 설계 순서, 구현 순서, PR 경계와 완료 판정을 하나의 Phase 체계로 통일
- 현재 상태는 이후 승인·구현·병합 기록을 반영한다.

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

Knowledge Flow의 6개 Phase와 Frontend Phase 0~5는 대체 관계가 아니다. Frontend는 Knowledge Flow 전반을 횡단하는 Product 구현 축이다.

## 운영 원칙

1. Frontend는 5개 Phase·12개 Section으로 구현한다.
2. Phase와 Section 번호 순서대로 진행한다.
3. 한 번에 하나의 Section만 구현·검증한다.
4. 현재 Section이 사용자 승인·병합·Canonical 반영되기 전에는 다음 Section을 시작하지 않는다.
5. Section 하나를 기본적으로 Branch 1개·Draft PR 1개·완료 판정 1개로 관리한다.
6. Phase 완료와 전체 Frontend 완료를 구분한다.
7. 구현 완료는 Contract Test, E2E, 보안, 접근성, 복구와 해당 비기능 Gate를 통과해야 한다.
8. AI 결과와 UI Projection은 승인 전 Canonical로 자동 반영하지 않는다.
9. 구현 전 Acceptance Criteria를 번호로 고정하고 검토 중 요구사항을 조용히 확대하지 않는다.
10. 새 요구사항은 차단 결함이 아니면 후속 Section Backlog로 분리한다.
11. 기준 문서를 인용할 때 Repository, Ref와 Repo-relative Path를 함께 기록한다.
12. 모든 보고서와 검증 결과는 Git-tracked 문서로 저장한다.

## 현재 위치

```text
Phase 0 — Shared Contract Foundation: 구현·검증·병합 완료
Phase 1 Section 1: 구현·검증·병합 완료
Phase 1 Section 2: 구현·검증·병합 완료
Phase 1 Section 3: 설계·Contract 승인·동결 / Product 구현 미착수
Frontend Phase 1: 미완료
Phase 2~5: 설계·Contract 확정 / Product 구현 검증 대기
Cross-Phase Product Verification: 미착수
```

원 Notion v1.0의 초기 상태 표에 있던 “Phase 1 Section 2 미착수”는 당시 상태다. 이후 PR #20과 승인된 완료 기록이 이를 대체하며, 과거 기록 자체는 삭제하지 않는다.

## Phase 1 — Platform Boundary

### Section 1 — Local Owner Session·Authentication·Project Boundary

- 상태: 완료
- PR #19
- Merge Commit: `ba8995287a43964774fe4b97eb6a791712f56ad4`
- Verification: `docs/engineering/frontend-phase-1-section-1-verification-260724001.md`

### Section 2 — Settings·Project Administration

- 상태: 완료
- PR #20
- Merge Commit: `4b5c90a1bccad520c1bdfa2fc5114d8852ed59d2`
- Typed Settings, Project Administration, Privacy·Model·Cost, Connector·Directive·Schema, Diagnostics·Recovery 경계를 포함한다.

### Section 3 — Home·Action Center·Global Shell

- 상태: 설계·Contract 승인·동결 / 구현 미착수
- ADR-115·116 Accepted
- AC-01~AC-27 Approved and frozen
- Product 구현, Migration, 새 Runtime Dependency 또는 AC 변경은 별도 승인 없이는 수행하지 않는다.

Phase 1 완료 조건:

```text
Session 수립
→ Project 선택·관리
→ Settings 관리
→ Home에서 상태·필요 조치 확인
→ 각 Workspace로 안전하게 이동
```

## Phase 2 — Knowledge Input·Question

### Section 1 — Sources Workspace

- File·URL·Text 입력
- Intake Draft·검증·정확 중복
- Source Library·Metadata·Preview
- SourceVersion·EvidenceSpan·Citation
- 처리 상태·취소·재시도·복구

### Section 2 — Ask·Conversations Workspace

- Conversation·Branch·Turn
- QueryPlan·Source Exploration·Answer Run
- Citation·Model·Cost
- Streaming·Partial Result·Outcome Resolution
- Export·Feedback·Knowledge Transition
- DraftChangeSetSeed·IntakeDraftSeed·UserDirectiveProposal 진입

## Phase 3 — Knowledge Understanding·Editing

### Section 1 — Knowledge Workspace

Canonical Knowledge, Fact·Claim·Conflict·Gap, Evidence·Version·시간과 Compiled Truth Projection을 탐색한다.

### Section 2 — Knowledge Editor·DraftChangeSet Authoring

DraftChangeSetSeed, Typed Operation, Base Revision, Evidence, Rationale, Impact, Validation, Stale와 Review 제출을 관리한다.

### Section 3 — Semantic Graph·Relationship Exploration

Typed Graph Projection, Path·Neighborhood·Conflict·Gap·Impact Overlay와 List·Table·Path 접근성 대안을 제공한다.

## Phase 4 — Governance·Execution

### Section 1 — Review Center

Candidate·DraftChangeSet·UserDirectiveProposal, Evidence·Impact와 목적별 Approval을 검토한다. Approval과 Commit을 분리한다.

### Section 2 — External Action Governance·Execution

ActionCandidate·Manifest·Risk·Preview·Approval·Preflight·Execute·Verify·Compensation을 관리한다. Timeout 자동 재실행을 금지한다.

## Phase 5 — Operations·Audit

### Section 1 — Agent·Job Activity Workspace

Job·Run·Attempt·Stage, Progress, Failure·Retry·Cancel, Attention, Correlation과 Projection Lag를 제공한다.

### Section 2 — History·Audit·Rollback

Append-only History, Revision·Decision·Approval, Canonical Commit·External Result, Retention·Tombstone, Reversal DraftChangeSet과 Compensating Action을 제공한다.

## Cross-Phase Product Verification

필수 종단 흐름:

```text
Local Owner Bootstrap
→ Project 생성·전환
→ Source 입력·처리·중복
→ Ask·Citation
→ Knowledge 탐색
→ DraftChangeSet
→ Review·Approval
→ Canonical Commit
→ External Action Preflight·Execute·Verify
→ Activity
→ History·Audit
→ Reversal·Compensation
```

필수 Negative Test:

- Frontend의 Principal·Project 권위 생성 금지
- 다른 Project Cache 재사용 금지
- 민감 Resource 존재 노출 금지
- Candidate 자동 Canonical 반영 금지
- Approval 우회 금지
- Approval과 Commit·Execute 혼합 금지
- Outcome Unknown 자동 재제출 금지
- Cancel을 Rollback으로 표시하지 않음
- 삭제 Project Audit 범위 확대 금지
- Retention Purge로 Event Identity 삭제 금지

## Branch·PR 전략

```text
Section 1개
= 구현 Branch 1개
= Draft PR 1개
= 사용자 승인 후 Ready 및 Merge
```

다른 Section을 병렬 구현하지 않는다.

## 다음 구현 경계

현재 다음 Product 구현 대상은 Phase 1 Section 3이다. 다만 ADR-119 Product 구현이 Section 3 착수 전 Engineering Foundation으로 별도 승인되어 진행될 경우, 그것은 새 Product Section이 아니라 승인된 횡단 State/Cache 계약 구현으로 기록한다.

이 문서 이관 자체는 Section 3 Product 구현 승인, Phase 1 완료 또는 Phase 2 착수를 의미하지 않는다.
