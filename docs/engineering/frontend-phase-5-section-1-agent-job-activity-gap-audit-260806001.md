---
id: FRONTEND-PHASE-5-SECTION-1-AGENT-JOB-ACTIVITY-GAP-AUDIT
classification: CANDIDATE
status: gap_audited_contract_candidate_implementation_not_authorized
created_at: 2026-08-06
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
tracking_issue: https://github.com/JasonCutter/shotgun/issues/68
---

# FE-P5-S1 — Agent and Job Activity Workspace Gap Audit

## 1. 권위와 범위

이 문서는 `main@8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd`를 기준으로 FE-P5-S1의 현재 Capability와 구현 Gap을 조사한 Contract 후보다.

Canonical 기준:

- `docs/architecture/frontend/phase-5-operations-audit.md`
- `docs/implementation/frontend-phase-1-5-plan-v1.0.md`
- `docs/project/frontend-work-items.json`
- ADR-124 Frontend Work Item Registry 및 Scope Amendment 정책
- ADR-129 External Action Governance and Execution Boundary

현재 권위:

- FE-P4-S2 및 FE-P4: COMPLETE / FINAL_AFTER_MERGE
- FE-P5, FE-P5-S1: NOT_STARTED
- Product 구현, Migration 실행, Dependency 추가: NOT_AUTHORIZED

## 2. Canonical 요구사항 추출

FE-P5-S1 Activity는 현재 실행 상태를 보여 주는 운영 Projection이다.

1. Domain Resource Snapshot이 권위이며 Polling, SSE, Timeline UI는 관찰·갱신 수단이다.
2. Job, Run, Attempt, Stage, Event Identity를 구분한다.
3. Transport Retry는 동일 Command 전달 재시도이며 새 Domain Attempt를 만들지 않는다.
4. Domain Retry는 새 Command와 새 Attempt를 만들고 이전 Attempt·Failure·Policy Context를 보존한다.
5. `commandId`, 내부 `messageId`, `jobId`, `runId`, `attemptId`, `traceId`를 동일 ID로 강제하지 않는다.
6. Projection Lag, Partial Failure, Outcome Unknown, User Attention을 명시한다.
7. 각 Activity는 권한 검증된 정확한 Domain Resource Deep Link를 제공한다.
8. Notification 읽음·삭제는 Domain 문제 해결, Retry, Cancel, Approval을 의미하지 않는다.
9. Cancel, Reversal, Compensation은 서로 다른 작업이다.
10. FE-P5-S2의 장기 History·Audit·Rollback·Retention·Tombstone은 이 Section에서 구현하지 않는다.

## 3. Existing Capability Inventory

### 3.1 Job Runtime

`packages/job-runtime/src/index.ts`에는 `JobRecord`, `AttemptRecord`, Retry Policy와 `InMemoryJobRuntime`이 있다.

재사용 가능:

- Job/Attempt ID 생성
- Attempt 번호와 시작·종료 시각
- retryable failure 기반 재시도
- `OUTCOME_UNKNOWN` 구분
- idempotency key와 consumer identity

Gap:

- In-memory 전용이며 재시작 후 복구되지 않는다.
- Project Scope가 없다.
- Run과 Stage Identity가 없다.
- Transport Retry와 Domain Retry가 계약상 분리되지 않는다.
- Correlation, Causation, Trace와 Resource Deep Link가 없다.
- Projection freshness, lag, partial failure, attention이 없다.

### 3.2 External Action 실행·감사 경계

`modules/action-execution`과 `modules/frontend-external-action`에는 프로젝트 범위 실행 상태, Preview·Approval·Execute·Verify, Audit Event, Store Port, Product API와 보안 거부 기본값이 있다.

재사용 가능:

- 프로젝트 및 Security Context 검증 패턴
- 서버 권위 상태 전이와 idempotent claim
- `OUTCOME_UNKNOWN` 자동 재실행 금지
- Audit/Event sequence와 상세 조회 패턴
- Product API decoder, Store Port, Error mapping
- Action Resource Deep Link 대상

Gap:

- External Action 전용 상태를 전체 Agent/Job Activity로 일반화하지 않는다.
- Source 처리, Ask Answer Run, Canonical Commit 등 다른 실행 흐름을 통합하는 Activity Projection이 없다.
- Job→Run→Attempt→Stage의 공통 Identity와 Projection contract가 없다.

### 3.3 Observability와 공통 인프라

`packages/observability`, `packages/contracts`, `packages/authentication`, `packages/postgres-transaction`, `packages/shotgun-api-client`, 기존 Frontend Product 모듈과 CI/E2E harness를 재사용할 수 있다.

Gap:

- Observability Trace는 사용자에게 보여 주는 Domain Activity Authority를 대체하지 않는다.
- Telemetry retention과 Domain Activity persistence가 분리되어 있지 않다.
- FE-P5-S1 전용 Product API client, route, list/detail/timeline UI가 없다.

## 4. Layer별 Gap Matrix

| Layer | Current | Gap | Candidate decision |
|---|---|---|---|
| Domain Contract | Job/Attempt와 개별 실행 상태 존재 | Job/Run/Attempt/Stage/Event 통합 모델 부재 | 새 traceable ADR 및 Contract 필요 |
| Product API | 개별 Workspace API 존재 | Project-scoped Activity list/detail/refresh API 부재 | typed read API와 bounded commands 필요 |
| Persistence | Action·Command 등 개별 persistence 존재, Job runtime은 memory | 통합 Activity Projection 및 Attention persistence 부재 | additive DB Migration 필요 |
| Frontend Client/UI | 개별 Source·Ask·Review·Action UI 존재 | Activity route/list/detail/timeline/filter 부재 | 새 FE-P5-S1 product module 필요 |
| Security | Principal·Project·Capability guard 재사용 가능 | cross-project existence hiding과 deep-link 재검증 필요 | deny-by-default, project-bound query |
| Accessibility | 기존 route/table/dialog 패턴 재사용 가능 | live progress, timeline, filters, status semantics의 a11y 계약 부재 | keyboard/table/list alternative와 restrained live region |
| Recovery | Outcome resolution과 stale handling 패턴 존재 | refresh loss, lag, cursor, restart recovery 계약 부재 | snapshot refetch와 explicit stale/partial state |
| E2E | Browser lifecycle harness 존재 | multi-attempt, lag, attention, deep-link lifecycle 부재 | bounded browser E2E 필요 |
| Performance | 기존 route/command gates 존재 | queue/list/detail/timeline latency gate 부재 | list/detail/refresh median gate 필요 |

## 5. 결정 판정

### 5.1 새 ADR

**REQUIRED — Proposed ADR-130.**

이유:

- ADR-129는 External Action의 승인·실행 경계를 지배하지만, 전체 실행 흐름의 Job/Run/Attempt/Stage Identity와 Activity Snapshot 권위를 지배하지 않는다.
- Phase 5 문서가 언급하는 legacy ADR-111·112는 현재 추적 가능한 독립 ADR 파일로 존재하지 않으므로 새로운 변경을 그 번호에 조용히 귀속할 수 없다.
- Retry 종류, ID 비동일성, Projection freshness, Attention과 Activity/History 경계는 장기적인 아키텍처 결정이다.

### 5.2 DB Migration

**REQUIRED — additive Migration candidate, next available sequence expected 029.**

필요 최소 범위:

- Activity Job
- Activity Run
- Activity Attempt
- Activity Stage
- Operational Activity Event 또는 current-stage transition evidence
- User Attention state
- Correlation/Causation/Resource reference
- Projection revision/freshness cursor

금지:

- 기존 실행 원장을 Activity Projection으로 대체
- FE-P5-S2 장기 History·Audit schema 선구현
- 기존 Action Audit의 삭제·재작성

### 5.3 Runtime Dependency

**NOT REQUIRED.**

기존 TypeScript/React/PostgreSQL, native HTTP refresh, 현재 API client와 test harness로 구현 가능하다. SSE는 선택적 transport optimization이며 Contract 완료 조건이 아니고 새 streaming library 추가 근거가 없다.

### 5.4 재사용

**INTERNAL REUSE REQUIRED / NEW OSS NOT REQUIRED.**

주요 재사용 후보:

- `packages/job-runtime`
- `packages/observability`
- `packages/contracts`
- `packages/authentication`
- `packages/postgres-transaction`
- `packages/shotgun-api-client`
- `modules/action-execution`
- `modules/frontend-external-action`
- 기존 Source·Ask·Review Workspace의 Product API, decoder, recovery, accessibility, E2E 패턴

재사용은 기존 Identity를 합치거나 Observability를 Domain Authority로 승격한다는 뜻이 아니다.

## 6. Acceptance Criteria 후보

- **FE-P5-S1-AC-01**: Project-scoped Activity 목록은 권한이 허용된 Job만 반환한다.
- **FE-P5-S1-AC-02**: Job, Run, Attempt, Stage, Event는 서로 다른 typed identity를 가진다.
- **FE-P5-S1-AC-03**: Domain Resource Snapshot이 권위이며 UI transport 상태는 권위가 아니다.
- **FE-P5-S1-AC-04**: Snapshot은 projection revision, generatedAt, freshness/lag 상태를 제공한다.
- **FE-P5-S1-AC-05**: Transport Retry는 동일 Command 전달이며 새 Domain Attempt를 만들지 않는다.
- **FE-P5-S1-AC-06**: Domain Retry는 새 Command·Attempt를 만들고 원 Attempt와 causation으로 연결한다.
- **FE-P5-S1-AC-07**: 이전 Attempt의 Failure, Policy Context와 timestamps가 보존된다.
- **FE-P5-S1-AC-08**: `commandId`, `messageId`, `jobId`, `runId`, `attemptId`, `traceId`는 동일성을 강제하지 않는다.
- **FE-P5-S1-AC-09**: Running, Succeeded, Failed, Cancelled, Outcome Unknown과 Partial Failure를 구분한다.
- **FE-P5-S1-AC-10**: Stage 진행률은 서버가 제공한 bounded evidence만 표시하며 임의 추정하지 않는다.
- **FE-P5-S1-AC-11**: User Attention은 이유, severity, required action, resource reference를 가진다.
- **FE-P5-S1-AC-12**: Notification read/delete는 Attention 해결이나 Domain 상태 변경을 의미하지 않는다.
- **FE-P5-S1-AC-13**: 각 Activity resource link는 이동 시 현재 Principal·Project·Capability를 다시 검증한다.
- **FE-P5-S1-AC-14**: 다른 Project와 민감 Resource의 존재를 오류·count·timing으로 노출하지 않는다.
- **FE-P5-S1-AC-15**: List API는 cursor pagination, stable ordering, bounded filters를 제공한다.
- **FE-P5-S1-AC-16**: Detail API는 Job→Run→Attempt→Stage hierarchy와 관련 resource를 반환한다.
- **FE-P5-S1-AC-17**: API decoder는 unknown field와 browser-authored authority field를 거부한다.
- **FE-P5-S1-AC-18**: Persistent Projection은 process restart 후 동일 identity와 상태를 복구한다.
- **FE-P5-S1-AC-19**: concurrent refresh와 out-of-order update가 더 최신 Snapshot을 되돌리지 않는다.
- **FE-P5-S1-AC-20**: `OUTCOME_UNKNOWN`은 자동 retry 또는 duplicate submission을 유발하지 않는다.
- **FE-P5-S1-AC-21**: Cancel은 Rollback, Reversal 또는 Compensation으로 표시되지 않는다.
- **FE-P5-S1-AC-22**: Workspace는 list, detail, timeline/stage view, filters와 explicit refresh/recovery를 제공한다.
- **FE-P5-S1-AC-23**: Keyboard navigation, focus restoration, semantic status, table/list alternative와 restrained live announcement를 제공한다.
- **FE-P5-S1-AC-24**: Browser E2E는 success, retry, failure, outcome unknown, lag, attention, deep-link denial과 recovery를 검증한다.
- **FE-P5-S1-AC-25**: Activity list→detail과 refresh의 median performance gate는 각각 2000ms 이하를 목표로 한다.
- **FE-P5-S1-AC-26**: FE-P5-S2 History·Audit·Rollback·Retention과 Cross-Phase Verification은 구현하지 않는다.

## 7. 제외 및 미결사항

제외:

- FE-P5-S2 장기 History·Audit·Rollback
- Reversal DraftChangeSet 및 Compensating Action 구현
- Deployment·Production Verification
- Cross-Phase Product Verification
- 기존 PASS CI 재실행

승인 전 미결:

1. Proposed ADR-130 승인 여부
2. additive Migration 범위 및 최종 sequence
3. AC-01~AC-26 Freeze 여부
4. Polling baseline과 optional SSE의 구현 우선순위
5. first implementation work package 분할

## 8. 현재 권위

- Gap Audit: CANDIDATE
- Proposed ADR-130: NOT_ACCEPTED
- Contract Snapshot: CANDIDATE / NOT_FROZEN
- Implementation Request: CANDIDATE / NOT_AUTHORIZED
- Product code / Migration / Dependency: NOT_AUTHORIZED
