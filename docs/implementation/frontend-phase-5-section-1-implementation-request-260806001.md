---
id: FRONTEND-PHASE-5-SECTION-1-IMPLEMENTATION-REQUEST-260806001
classification: CANDIDATE
status: implementation_request_candidate_not_authorized
revision: 0
created_at: 2026-08-06
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
tracking_issue: https://github.com/JasonCutter/shotgun/issues/68
proposed_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
---

# FE-P5-S1 — Agent and Job Activity Workspace Implementation Request r0

## 1. Authority

**CANDIDATE / NOT AUTHORIZED**

이 문서는 구현 요청 후보다. 다음 조건 전에는 Product 코드, DB Migration, Dependency 또는 Work Item 상태를 변경하지 않는다.

1. Gap Audit 사용자 승인
2. ADR-130 ACCEPTED
3. AC-01~AC-26 승인 및 Freeze
4. Contract Snapshot revision 승인
5. Migration 범위 승인
6. Implementation Request 명시적 승인

## 2. Objective

Project-scoped Agent·Job Activity Workspace를 구현하여 사용자가 현재 작업의 Job→Run→Attempt→Stage 상태, 실패·재시도·취소, partial failure, projection lag와 attention을 안전하게 관찰하고 정확한 Domain Resource로 이동하게 한다.

## 3. Frozen input candidate

승인 시 다음 문서를 입력으로 사용한다.

- `docs/architecture/frontend/phase-5-operations-audit.md`
- `docs/engineering/frontend-phase-5-section-1-agent-job-activity-gap-audit-260806001.md`
- `docs/architecture/adr/ADR-130-frontend-agent-job-activity-authority-and-retry-boundary.md`
- `docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md`
- ADR-124
- ADR-129

## 4. Proposed work packages

한 번에 하나의 Work Package만 구현·검증·승인한다.

### WP1 — Activity Domain Contract and Persistence Foundation

범위:

- typed Job/Run/Attempt/Stage/Event/Attention/Projection contracts
- Project binding, identity hierarchy, status/ordering invariants
- additive Migration candidate 029
- persistence repository and restart recovery
- existing execution resource adapter ports

필수 경계:

- existing source/ask/action records remain authoritative
- no FE-P5-S2 history schema
- no browser-authored identity or status

### WP2 — Activity Projection Builder and Read Product API

범위:

- adapters for bounded existing execution flows
- projection revision/freshness/partial state
- project-scoped list/detail APIs
- cursor pagination and stable ordering
- decoder/error/security boundary

필수 경계:

- telemetry is reference, not authority
- inaccessible resource non-disclosure
- stale lower revision cannot win

### WP3 — Activity Workspace Read Experience

범위:

- `/activity` list/filters/attention indicators
- `/activity/jobs/:jobId` detail
- Run/Attempt/Stage views
- timeline semantic alternative
- lag/partial/outcome unknown/recovery states
- exact resource deep links

필수 경계:

- no retry/cancel writes in this WP
- no History/Audit/Rollback UI

### WP4 — Bounded Cancel, Domain Retry and Attention Commands

범위:

- cancel request
- domain retry request
- attention acknowledgement
- command gateway accepted→outcome resolution
- confirmation, idempotency and recovery UI

필수 경계:

- Transport Retry does not create Attempt
- Domain Retry creates new command/run or attempt with causation
- outcome unknown never auto retries
- cancel is not rollback/reversal/compensation
- acknowledgement is not domain resolution

### WP5 — Security, Accessibility, Recovery and Browser E2E

범위:

- project isolation and deep-link denial
- sensitivity/redaction
- keyboard/focus/semantic status/live announcement
- reconnect/refresh/cursor/stale recovery
- full FE-P5-S1 browser scenarios

### WP6 — Performance and Completion Evidence

범위:

- list initial response median gate
- list→detail median gate
- refresh median gate
- bounded pagination/polling checks
- AC-01~AC-26 evidence matrix
- Product completion candidate recording

Ready, Merge, Deployment and Production Verification remain separate authority decisions.

## 5. Migration candidate

Migration: **REQUIRED / NOT AUTHORIZED**

Expected next sequence: `029`, subject to exact repository verification immediately before authorization.

Allowed:

- new activity projection tables/indexes/FKs
- additive adapter cursor or revision metadata
- deterministic test fixtures

Forbidden:

- destructive rewrite of existing execution tables
- migration of FE-P5-S2 retention/history/rollback state
- implicit deployment

## 6. Dependency decision

New Runtime Dependency: **NOT REQUIRED / NOT AUTHORIZED**

Use existing stack and internal packages. Any dependency proposal discovered during implementation invalidates the request and requires separate review before change.

## 7. Verification strategy candidate

No prior PASS exact head is rerun.

For each new implementation head:

- focused tests for changed contract/module
- repository automatic CI only
- exact-head evidence
- no manual duplicate workflow dispatch

Required final evidence:

- contract tests
- persistence/restart tests
- security negative tests
- accessibility tests
- browser E2E
- performance measurement
- migration verification
- no cross-project existence leak
- no outcome unknown auto retry

## 8. Scope exclusions

- FE-P5-S2 History, Audit and Rollback
- long-term retention, tombstone, legal hold
- Reversal DraftChangeSet and Compensating Action implementation
- Cross-Phase Product Verification
- Deployment
- Production Verification
- FE-P4 changes
- real external provider mutation beyond existing bounded test adapters

## 9. Candidate acceptance binding

Implementation must satisfy exactly **FE-P5-S1-AC-01 through FE-P5-S1-AC-26** after user Freeze.

Before Freeze these ACs remain candidates. Implementation may not add AC-27 or silently alter the set.

## 10. Current decision state

- Gap Audit: CANDIDATE
- ADR-130: PROPOSED / NOT_ACCEPTED
- Contract Snapshot r0: CANDIDATE / NOT_FROZEN
- Implementation Request r0: CANDIDATE / NOT_AUTHORIZED
- Migration: REQUIRED_CANDIDATE / NOT_AUTHORIZED
- Runtime Dependency: NOT_REQUIRED
- Product Implementation: NOT_AUTHORIZED
- FE-P5-S2 / Cross-Phase / Deployment / Production Verification: NOT_AUTHORIZED
