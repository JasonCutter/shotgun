---
id: FRONTEND-PHASE-1-5-IMPLEMENTATION-PLAN-V1
classification: CANONICAL
status: confirmed_plan_frontend_work_item_registry_governed
approved_by: user
approved_at: 2026-07-30
migrated_at: 2026-07-29
legacy_source_id: 3a75181d-71ad-817a-9675-c984455b2c3b
---

# Project Shotgun Frontend Phase 1–5 구현계획 v1.0

## 문서 상태

- Canonical Implementation Plan v1.0: 확정
- 원 확정일: 2026-07-24
- 현재 상태 갱신일: 2026-08-01
- 목적: Frontend 설계 순서, 구현 순서, PR 경계와 완료 판정을 하나의 Phase 체계로 통일
- 현재 상태는 이후 승인·구현·병합·완료 기록을 반영한다.

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

<!-- FRONTEND-WORK-ITEM-STATUS:START -->

> 이 블록은 `docs/project/frontend-work-items.json`과 Section Completion Manifest에서 생성됩니다. 블록 내부를 직접 수정하지 않습니다.

| Work Item                                   | Status        |
| ------------------------------------------- | ------------- |
| FE-P3 — Knowledge Understanding and Editing | `IN_PROGRESS` |
| FE-P3-S1 — Knowledge Workspace              | `IN_PROGRESS` |

- 미충족 필수 기준: `manifest unavailable`
- Next valid Product Section: `FE-P3-S2 — Knowledge Editor and DraftChangeSet Authoring`

<!-- FRONTEND-WORK-ITEM-STATUS:END -->

원 Notion v1.0의 초기 상태와 각 Section의 과거 `미착수`, `Draft`, `Pending`, `BLOCKED` 문구는 당시 상태다. 이후 병합된 검증 및 완료 기록이 현재 상태를 결정하며 과거 기록 자체는 삭제하지 않는다.

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

- 상태: 완료
- PR #42
- Merge Commit: `3f1aa93c7b5ce6a795b796f44124ed67112716c0`
- ADR-115·116 Accepted
- AC-01~AC-27 PASS
- ADR-116 Migration 019, Product Session·Command V2, Principal Bootstrap, Global Shell, Home Action Center, Search, Route Guard, Recovery, Accessibility, E2E와 Performance Gate를 포함한다.
- Verification: `docs/engineering/frontend-phase-1-section-3-verification-260729001.md`
- Completion Review: `docs/engineering/frontend-phase-1-completion-review-260730001.md`

Phase 1 완료 흐름:

```text
Local Owner Session 수립
→ Project 생성·선택·관리
→ Settings 관리
→ Home에서 상태·필요 조치 확인
→ 각 Workspace로 안전하게 이동
```

Frontend Phase 1은 2026-07-30 별도 Completion Review와 사용자 승인으로 완료됐다.

## Phase 2 — Knowledge Input·Question

### Section 1 — Sources Workspace

- 상태: **COMPLETE / USER APPROVED AFTER PR #46 MERGE**
- PR #46
- ADR-122 Accepted
- AC-01~AC-32 PASS
- Migration 020 승인·구현·검증 완료
- 신규 Runtime Dependency 필요 없음 / 추가 없음
- Tested Product Head: `496af3d5a5b5903dbd1dcc6a19af157a6b836214`
- Exact-head GitHub Actions: `30536214153` PASS
- Gap Audit: `docs/engineering/frontend-phase-2-section-1-gap-audit-260730001.md`
- Contract Snapshot: `docs/architecture/contracts/snapshots/frontend-phase-2-section-1/frontend-phase-2-section-1-contract-snapshot-260730001.md`
- Implementation Request: `docs/implementation/frontend-phase-2-section-1-implementation-request-260730001.md`
- Final Verification: `docs/engineering/frontend-phase-2-section-1-verification-260730001.md`
- Completion Record: `docs/engineering/frontend-phase-2-section-1-completion-record-260730001.md`
- File·URL·Text 입력
- Intake Draft·검증·정확 중복
- Production Raw-input Staging과 Server URL Acquisition
- Source Library·Metadata·Preview
- SourceVersion·EvidenceSpan·Citation
- 처리 상태·부분 성공·취소·재시도·복구

Section 완료 효력은 승인만으로 발생하지 않고 PR #46이 `main`에 병합될 때 발생한다.

### Section 2 — Ask·Conversations Workspace

- Read Foundation과 Command·Persistence Increment 구현·검증 완료
- Answer Execution 및 나머지 원 Section Contract는 미착수
- Section 완료 판정은 `docs/project/completions/FE-P2-S2.json`이 지배
- Conversation·Branch·Turn
- QueryPlan·Source Exploration·Answer Run
- Citation·Model·Cost
- Streaming·Partial Result·Outcome Resolution
- Export·Feedback·Knowledge Transition
- DraftChangeSetSeed·IntakeDraftSeed·UserDirectiveProposal 진입

완료된 Increment는 Section 완료를 자동 승인하지 않는다. 남은 범위를 제거·연기·분할하려면 ADR-124에 따른 승인된 Scope Amendment가 필요하다.

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

현재 활성 Section 내부의 미착수 Increment는 `FE-P2-S2-I03`이다. 해당 범위를 그대로 구현할지, 분할·연기할지는 별도 승인된 Scope Amendment 또는 구현 요청 전에는 결정되지 않는다.

Section 2가 모든 완료 조건을 충족한 뒤의 다음 유효 Product Section은 `FE-P3-S1 — Knowledge Workspace`다. 이 계획 갱신은 남은 Section 2 구현, Scope Amendment, Section 완료 또는 Phase 3 착수를 승인하지 않는다.

Route-level Lazy Loading·Code Splitting은 Section 3 성능 증거에서 권장된 비차단 횡단 후속 작업이다. 별도 범위와 검증으로 관리한다.
