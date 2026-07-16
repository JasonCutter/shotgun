# ADR-086: Stage 6 Canonical Commit, History and Outbox

- 상태: Accepted
- 날짜: 2026-07-17

## Context

Stage 5는 사용자가 검토한 Candidate를 `ApprovedChangeSetManifest`로 고정한다. Stage 6은 이
승인 결과만 공식 지식 원장에 반영해야 하며, 중간 실패나 재실행으로 Claim·History·Event가
서로 어긋나면 안 된다.

gbrain의 Page·Fact·Timeline과 migration·recovery 구현, PostgreSQL 기반 Job 도구,
ORM·migration 도구를 비교했다. gbrain은 append·lock·idempotency 패턴은 유용하지만
Shotgun의 Approval, Claim·Fact 분리, Canonical 소유권 계약과 동일하지 않다.

## Decision

1. `stage6.canonical-knowledge`만 `canWriteCanonical: true`를 가진다.
2. Canonical Module은 `ChangeSetApproved` Event를 받으면 저장된 Manifest를 다시 조회한다.
3. Event payload, Manifest digest, Candidate digest, Content digest, Approval Token digest와
   user actor·만료 시각을 모두 검증한다.
4. Commit ID는 Manifest ID와 같게 하여 재실행을 멱등하게 만든다.
5. Snapshot version·digest가 승인 시점과 다르면 `STALE_APPROVAL`로 거부한다.
6. Claim, Commit, Revision, HistoryEvent, Transactional Outbox와 project state 변경을
   PostgreSQL의 한 트랜잭션에서 처리한다.
7. History와 Revision은 append-only이며 update·delete를 DB trigger로 차단한다.
8. Outbox는 `FOR UPDATE SKIP LOCKED`, 처리 lease, attempt 번호로 중복 worker와 중단 복구를
   제어한다.
9. gbrain runtime·database는 포함하지 않고 검증된 패턴만 Shotgun Repository Port 뒤에서
   독립 구현한다.
10. pg-boss, Graphile Worker, node-pg-migrate, Drizzle, Kysely는 현재 최소 범위에 필요하지
    않아 `DEFER`한다.

## Consequences

- 승인되지 않은 Candidate나 UI 상태는 Canonical 쓰기 근거가 될 수 없다.
- Claim은 공식 Claim으로 저장되며 Fact로 자동 승격되지 않는다.
- 동일 Manifest 재전달은 같은 Commit 결과를 반환하고 새 Revision을 만들지 않는다.
- Outbox publish가 늦어져도 Canonical transaction은 보존되고 다시 dispatch할 수 있다.
- 범용 Job·ORM 도구는 필요 시 Adapter 내부에서 도입할 수 있으며 상위 Contract는 바뀌지 않는다.

## Verification

- 두 Transport의 Stage 6 Contract Test
- PostgreSQL restart·replay·row-lock concurrency Test
- transaction failpoint 전체 rollback Test
- append-only History 변경 차단 Test
- Module Manifest의 Canonical writer 단일성 Architecture Test
- Stage 6 OSS Gate와 exact version·license registry 검증
