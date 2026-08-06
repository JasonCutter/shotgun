---
id: ADR-130
classification: CANDIDATE
status: PROPOSED
created_at: 2026-08-06
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
tracking_issue: https://github.com/JasonCutter/shotgun/issues/68
---

# ADR-130 — Frontend Agent·Job Activity Authority and Retry Boundary

## Status

**PROPOSED — NOT ACCEPTED**

이 ADR은 사용자 승인 전까지 후보이며 Product 구현 권위를 부여하지 않는다.

## Context

FE-P5-S1은 Source 처리, Ask Answer Run, Canonical Commit, External Action 등 서로 다른 실행 흐름을 하나의 운영 Activity Workspace에서 관찰해야 한다.

현재 Repository에는 다음 기반이 있다.

- `packages/job-runtime`: in-memory Job·Attempt와 retry policy
- `packages/observability`: trace/telemetry 기반
- `modules/action-execution`: External Action 상태 전이·Audit·Outcome Unknown
- 각 Frontend Product module의 프로젝트·보안·decoder·recovery 패턴

그러나 현재 기반은 다음을 제공하지 않는다.

- persistent Project-scoped Job→Run→Attempt→Stage Activity Projection
- Transport Retry와 Domain Retry의 명시적 구분
- Domain Activity Identity와 telemetry identity의 분리
- Projection freshness/lag, partial failure, attention, resource deep link
- FE-P5-S1과 FE-P5-S2 History의 명확한 저장·권위 경계

Phase 5 문서가 언급하는 legacy ADR-111·112는 현재 추적 가능한 독립 ADR 파일로 존재하지 않는다. 새로운 결정은 새 ADR로 남겨야 한다.

## Decision

### 1. Activity authority

FE-P5-S1의 권위는 **Project-scoped persisted Domain Activity Snapshot**이다.

Polling, SSE, browser cache, timeline animation, telemetry와 notification은 관찰·전달 수단이며 Domain Activity Authority가 아니다.

Snapshot은 최소한 다음을 포함한다.

- projection revision
- generated/updated timestamp
- freshness 또는 lag 상태
- Job/Run/Attempt/Stage current state
- partial failure와 outcome unknown
- attention summary
- correlation/causation/resource reference

### 2. Identity hierarchy

다음 Identity를 분리한다.

```text
Job
→ 하나의 사용자·시스템 목적

Run
→ Job의 한 번의 orchestration execution

Attempt
→ retry policy에 의해 생성되는 실행 시도

Stage
→ Attempt 내부의 bounded progress unit

Event
→ 현재 Activity Projection을 설명하는 operational transition evidence
```

`commandId`, `messageId`, `jobId`, `runId`, `attemptId`, `stageId`, `eventId`, `traceId`는 서로 다른 타입이며 값의 동일성을 강제하지 않는다.

### 3. Retry semantics

- **Transport Retry**: 동일 Command/Message의 전달 재시도다. 새 Domain Attempt를 만들지 않는다.
- **Domain Retry**: 사용자가 또는 정책이 새 실행을 요청한다. 새 Command, Run 또는 Attempt를 만들고 원 실행을 causation reference로 연결한다.
- 실패한 이전 Attempt, Error classification, Policy Context, timestamps는 보존한다.
- `OUTCOME_UNKNOWN`은 자동 Domain Retry 또는 duplicate submission을 유발하지 않는다.

### 4. Persistence

Activity Projection은 process restart 후 복구되어야 하므로 additive persistence가 필요하다.

기존 Source/Ask/Action 원장을 대체하거나 재작성하지 않는다. Projection builder는 기존 authoritative resource를 참조하고, Activity 전용 identity·current state·attention·freshness를 저장한다.

FE-P5-S2의 장기 History, Audit retention, Tombstone, Legal Hold, Reversal은 이 ADR 범위가 아니다.

### 5. Security and deep link

모든 list/detail/refresh/deep-link access는 현재 Principal, Project, Capability와 sensitivity를 서버에서 재검증한다.

다른 Project 또는 접근 불가 Resource의 존재를 count, error detail, timing, deep-link target으로 노출하지 않는다.

### 6. Attention

User Attention은 Notification과 분리된 Domain Projection이다.

Attention은 이유, severity, required action, related resource와 resolution state를 가진다. Notification 읽음·삭제는 Attention이나 Domain 문제를 해결하지 않는다.

### 7. Refresh transport

Contract baseline은 typed HTTP Snapshot fetch와 explicit refresh/polling이다.

SSE는 optional optimization으로 허용하지만:

- Snapshot 권위를 대체하지 않는다.
- reconnect 후 authoritative refetch를 수행한다.
- 새 Runtime Dependency 도입 근거가 되지 않는다.
- FE-P5-S1 완료 조건에 필수 transport로 고정하지 않는다.

### 8. Activity versus History

```text
Activity
→ 현재 실행 상태와 bounded operational evidence

History
→ 장기 불변 Revision·Decision·Approval·Audit·Canonical/External result
```

FE-P5-S1은 Activity를 구현하고 FE-P5-S2 History를 선구현하지 않는다.

## Consequences

### Positive

- 모든 실행 흐름을 동일한 typed Activity 모델로 관찰할 수 있다.
- retry와 duplicate submission을 구분할 수 있다.
- telemetry 장애나 browser refresh가 Domain 상태를 바꾸지 않는다.
- FE-P5-S2의 장기 감사 범위를 침범하지 않는다.
- 기존 Job Runtime, Observability와 Product API 패턴을 재사용할 수 있다.

### Costs

- additive DB Migration과 projection builder가 필요하다.
- 기존 실행 흐름마다 adapter가 필요하다.
- snapshot ordering, lag, partial failure, attention consistency 검증이 필요하다.

## Rejected alternatives

### A. Observability trace를 Activity authority로 사용

거부. Trace는 sampling, retention, redaction과 availability가 Domain Resource와 다르며 사용자 권위 상태를 보장하지 않는다.

### B. External Action execution table을 모든 Job에 재사용

거부. External Action의 승인·위험·connector lifecycle을 Source/Ask/Canonical 실행에 강제하여 의미를 왜곡한다.

### C. Browser에서 여러 API를 조합하여 Activity 생성

거부. Project·security·ordering·partial failure 권위가 browser로 이동하고 일관된 recovery가 불가능하다.

### D. FE-P5-S2 History schema를 동시에 구현

거부. Section 경계를 확대하고 retention·tombstone·rollback 결정을 조용히 선구현한다.

### E. SSE 전용으로 구현

거부. transport 연결 상태가 Domain authority처럼 취급될 위험이 있고 새 dependency와 recovery 복잡성을 만든다.

## Required follow-up before acceptance

1. AC-01~AC-26 검토 및 Freeze
2. additive Migration schema candidate 검토
3. Product API resource shape 검토
4. implementation work package 분할 검토
5. 사용자 ADR 승인

## Authority

- ADR-130: PROPOSED / NOT_ACCEPTED
- Migration: REQUIRED_CANDIDATE / NOT_AUTHORIZED
- Runtime Dependency: NOT_REQUIRED
- Product Implementation: NOT_AUTHORIZED
