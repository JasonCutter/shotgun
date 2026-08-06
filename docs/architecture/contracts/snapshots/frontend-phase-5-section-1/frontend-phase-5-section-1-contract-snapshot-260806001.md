---
id: FRONTEND-PHASE-5-SECTION-1-CONTRACT-SNAPSHOT-260806001
classification: CANDIDATE
status: contract_candidate_not_frozen
revision: 0
created_at: 2026-08-06
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
tracking_issue: https://github.com/JasonCutter/shotgun/issues/68
proposed_adr: ADR-130
---

# FE-P5-S1 — Agent and Job Activity Workspace Contract Snapshot r0

## 1. Contract authority

이 Snapshot은 검토 후보이며 아직 Frozen Contract가 아니다.

- Product 구현: NOT_AUTHORIZED
- Migration 구현: NOT_AUTHORIZED
- Dependency 추가: NOT_AUTHORIZED
- AC status: CANDIDATE / NOT_FROZEN

## 2. Product boundary

FE-P5-S1은 현재 실행 중이거나 최근 완료된 Domain 작업을 Project 범위에서 관찰하고, 실패·재시도·취소·Attention·Projection Lag를 이해하며 정확한 Resource로 이동하는 Workspace를 제공한다.

포함:

- Activity queue/list
- Job detail
- Run/Attempt/Stage hierarchy
- operational timeline/current transition evidence
- progress and partial failure
- attention
- correlation/causation/trace references
- explicit refresh and recovery
- exact resource deep link

제외:

- FE-P5-S2 History·Audit·Rollback·Retention·Tombstone
- Reversal DraftChangeSet와 Compensating Action 실행
- Cross-Phase Product Verification
- Deployment·Production Verification

## 3. Typed resource contract

### 3.1 ActivityJobV1

필수 필드 후보:

- `jobId`
- `projectId`
- `kind`
- `title`
- `status`
- `createdAt`, `updatedAt`
- `activeRunId?`
- `latestAttemptId?`
- `progress`
- `partialFailure`
- `attentionSummary`
- `resourceReference`
- `correlationReference`
- `projection`

### 3.2 ActivityRunV1

- `runId`
- `jobId`
- `runNumber`
- `commandId?`
- `startedAt`, `finishedAt?`
- `status`
- `attemptIds`
- `causedByRunId?`
- `policyContextReference?`

### 3.3 ActivityAttemptV1

- `attemptId`
- `runId`
- `attemptNumber`
- `startedAt`, `finishedAt?`
- `status`
- `errorClassification?`
- `retryKind`: `NONE | TRANSPORT | DOMAIN`
- `retryable`
- `stageIds`
- `traceId?`

Transport Retry는 새 ActivityAttempt resource를 만들지 않는다. `retryKind: TRANSPORT`는 전달 evidence에만 나타날 수 있다.

### 3.4 ActivityStageV1

- `stageId`
- `attemptId`
- `stageKey`
- `label`
- `sequence`
- `status`
- `progress?`
- `startedAt?`, `finishedAt?`
- `failure?`

### 3.5 ActivityEventV1

- `eventId`
- `projectId`
- `jobId`
- `runId?`, `attemptId?`, `stageId?`
- `category`
- `occurredAt`
- `sequence`
- `safeSummary`
- `resourceReference?`

이 Event는 FE-P5-S1 operational evidence이며 FE-P5-S2 장기 AuditEvent를 대체하지 않는다.

### 3.6 UserAttentionV1

- `attentionId`
- `projectId`
- `jobId`
- `reason`
- `severity`
- `requiredAction`
- `status`
- `resourceReference`
- `createdAt`, `updatedAt`, `resolvedAt?`

Notification 상태와 동일시하지 않는다.

### 3.7 ActivityProjectionMetadataV1

- `revision`
- `generatedAt`
- `sourceUpdatedAt`
- `freshness`: `CURRENT | LAGGING | STALE | UNKNOWN`
- `lagMilliseconds?`
- `partial`: boolean
- `nextCursor?`

## 4. Status contract

Job/Run/Attempt/Stage 상태는 typed enum으로 분리한다. 최소 공통 의미:

- `QUEUED`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `CANCEL_REQUESTED`
- `CANCELLED`
- `OUTCOME_UNKNOWN`

상위 상태는 browser가 하위 상태를 임의 집계하지 않고 서버 Projection이 결정한다.

## 5. Product API candidate

### Read

- `GET /product-api/frontend/activity/jobs`
  - project-bound list
  - cursor pagination
  - filters: kind, status, attention, time range
  - stable ordering
- `GET /product-api/frontend/activity/jobs/:jobId`
  - Job + Runs + Attempts + Stages + bounded events + attention
- `GET /product-api/frontend/activity/jobs/:jobId/refresh`
  - authoritative snapshot refresh 또는 일반 detail GET의 cache-bypass variant

### Bounded commands

- `POST /product-api/frontend/activity/jobs/:jobId/cancel-requests`
- `POST /product-api/frontend/activity/jobs/:jobId/retry-requests`
- `POST /product-api/frontend/activity/attentions/:attentionId/acknowledgements`

Retry는 서버가 Transport Retry와 Domain Retry를 결정한다. Browser는 Attempt ID를 생성하지 않는다.

모든 command는 기존 Frontend Command Gateway의 accepted→outcome resolution 패턴을 재사용한다.

## 6. Persistence candidate

Additive migration candidate, expected next sequence 029:

- `frontend_activity_jobs`
- `frontend_activity_runs`
- `frontend_activity_attempts`
- `frontend_activity_stages`
- `frontend_activity_events`
- `frontend_activity_attentions`
- projection revision/cursor indexes

규칙:

- 모든 row는 Project binding을 가진다.
- unique identity와 parent FK를 보존한다.
- transition ordering/sequence가 단조 증가한다.
- 기존 Source/Ask/Action 원장은 유지한다.
- migration rollback은 새 schema 제거 범위이며 Domain rollback과 다르다.

## 7. Security contract

- Principal/Project/Capability missing: deny
- list/detail/deep link는 동일 project guard 사용
- inaccessible resource: non-disclosing not-found response
- sensitivity에 따라 safe summary와 error detail redaction
- browser-supplied project, status, progress, attempt/stage identity 거부
- raw telemetry payload, connector secret, provider payload 직접 노출 금지

## 8. Frontend contract

Route candidate:

- `/activity`
- `/activity/jobs/:jobId`

UI:

- queue/list with filter and attention indicator
- detail summary
- Run/Attempt selector
- Stage timeline with semantic list/table alternative
- partial failure/outcome unknown/lag banners
- exact resource links
- explicit refresh/recovery
- cancel/retry confirmation with authority wording

## 9. Accessibility contract

- keyboard reachable list/filter/detail/actions
- focus restoration after dialog and route error
- status conveyed by text, not color alone
- progress uses native/semantic value where determinate
- indeterminate progress labeled explicitly
- live announcements limited to meaningful state changes
- timeline has ordered list/table alternative
- retry/cancel labels distinguish consequences

## 10. Recovery and ordering

- reconnect/refresh always refetches authoritative Snapshot
- stale response cannot overwrite higher revision
- cursor invalidation returns explicit recovery state
- partial source failure does not fabricate success
- outcome unknown does not auto retry
- denied deep link returns safe route recovery

## 11. E2E candidate

Required browser scenarios:

1. Project-scoped list and detail
2. successful Job with stages
3. failed Attempt followed by Domain Retry with prior evidence preserved
4. Transport Retry without new Domain Attempt
5. partial failure and lag state
6. outcome unknown with no auto retry
7. attention and acknowledgement without false resolution
8. cancel distinct from rollback
9. cross-project deep-link denial
10. refresh/reconnect recovery and stale-response rejection
11. keyboard and semantic timeline path

## 12. Performance candidate

- Activity list initial usable response median ≤ 2000ms
- list→detail median ≤ 2000ms
- explicit refresh median ≤ 2000ms under test fixture
- pagination prevents unbounded event/timeline payload
- frontend avoids unbounded polling and duplicate concurrent refresh

## 13. Acceptance Criteria binding candidate

This Snapshot binds candidate **FE-P5-S1-AC-01 through FE-P5-S1-AC-26** as defined in the Gap Audit.

Status: NOT_FROZEN. Renumbering, addition or removal requires user review before implementation.

## 14. Decision summary

- ADR: ADR-130 REQUIRED / PROPOSED
- Migration: REQUIRED / NOT_AUTHORIZED
- Runtime Dependency: NOT_REQUIRED
- Internal reuse: REQUIRED
- New OSS: NOT_REQUIRED
- Product implementation: NOT_AUTHORIZED
