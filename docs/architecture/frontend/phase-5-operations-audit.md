---
id: FRONTEND-PHASE-5-OPERATIONS-AUDIT
classification: CANONICAL
status: design_and_contract_confirmed_implementation_verification_pending
approved_by: user
approved_at: 2026-07-24
legacy_source_id: 3a65181d-71ad-819b-b4f7-f196a3816fe7
---

# Frontend Phase 5 — Operations·Audit

## 상태

- Section 설계·구현 Contract 정규화 완료
- Product 구현·E2E·보안·접근성 완료는 별도 판정
- 관련 ADR: ADR-111, ADR-112

## Section 1 — Agent·Job Activity Workspace

Activity는 현재 Job·Run·Attempt·Stage·Event의 운영 Projection이다.

확정 경계:

- Domain Resource Snapshot이 권위이며 SSE·Polling·Timeline UI는 갱신·관찰 수단이다.
- Job, Run, Attempt와 Stage를 구분한다.
- Retry는 새 Attempt로 기록하고 이전 Attempt, Failure와 Policy Context를 보존한다.
- Transport Retry는 동일 Command 전달 재시도이며 새 Domain Attempt를 만들지 않는다.
- Domain Retry는 새 Command·새 Attempt이며 원래 흐름을 Correlation·Causation으로 연결한다.
- Frontend `commandId`, 내부 `messageId`, Job ID, Attempt ID와 `traceId`를 동일 ID로 강제하지 않는다.
- Projection Lag, Partial Failure, User Attention과 정확한 Resource Deep Link를 표시한다.

## Section 2 — History·Audit·Rollback

History는 Append-only Revision, Decision, Approval, Audit, Canonical Commit과 External Result를 장기 보존한다.

확정 경계:

- HistoryEvent와 AuditEvent의 Identity를 삭제·덮어쓰지 않는다.
- Event Payload Availability는 `AVAILABLE`, `REDACTED`, `PURGED_BY_POLICY`, `UNAVAILABLE` 등 별도 상태로 관리할 수 있다.
- `PURGED_BY_POLICY`는 Event Identity 삭제가 아니라 Payload Redaction·Tombstone을 의미한다.
- 운영 Log Retention과 Approval·Audit·Canonical History Retention을 분리한다.
- Project 삭제 후 Audit 접근은 ProjectTombstone, DeletedProjectAuditScope와 현재 Capability를 다시 검증한다.
- Canonical Rollback은 과거 상태 직접 복원이 아니라 Reversal DraftChangeSet이다.
- External Rollback은 별도 Compensating Action이다.
- Legal Hold 또는 Retention 정책이 권한을 확대하거나 Approval·Canonical 계보를 조용히 삭제하지 않는다.

## 통합 계약

```text
Activity
→ 현재 운영 상태 Projection

History
→ 불변 장기 기록
```

- Aggregate Resource Kind는 Home·Filter·Grouping에 사용하며 Concrete Resource Identity를 대체하지 않는다.
- Background Summary, Notification, Attention Queue, Activity와 History는 동일 Domain Resource를 참조할 수 있지만 역할이 다르다.
- Notification 읽음·삭제는 Domain 문제 해결, Retry, Cancel 또는 Approval을 의미하지 않는다.
- Cancel, Reversal과 Compensation을 서로 다른 작업으로 표시한다.

## Phase 5 완료 조건

```text
현재 작업 관찰
→ 실패·재시도 추적
→ 과거 변경·승인·실행 조회
→ 안전한 Reversal 또는 Compensation 시작
```

현재 판정은 설계·Contract 완료이며 Product 구현 완료가 아니다.
