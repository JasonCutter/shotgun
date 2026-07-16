# Stage 6 — Canonical Claim Commit, History and Outbox

## 완료 상태

**COMPLETE — 2026-07-17**

## 실행 흐름

```text
ChangeSetApproved
→ ApprovedChangeSetManifest 재조회
→ Digest·Actor·만료·Snapshot precondition 검증
→ PostgreSQL project row lock
→ Claim + Commit + Revision + HistoryEvent + Outbox
→ 동일 transaction commit
→ CanonicalCommitted publish
→ Outbox published 표시
```

## 폴더 구조

```text
modules/
  canonical-knowledge/
adapters/
  stage6-in-memory/
  postgres-stage6/
db/migrations/
  006_stage6_canonical_history_outbox.sql
tests/
  contract/canonical-knowledge.contract.test.ts
  database/stage-6-postgres.test.ts
```

## 데이터 구조

- `CanonicalClaim`: 승인된 Claim 본문, SourceVersion, Evidence, 접근 범위
- `CanonicalCommitResult`: Manifest와 Canonical version 변경 결과
- `CanonicalRevision`: Commit 단위의 변경 이유와 Actor
- `CanonicalHistoryEvent`: 조회 가능한 append-only 활동 이력
- `CanonicalOutboxRecord`: `CanonicalCommitted`의 영속 전달 상태
- `canonical.project_state`: project별 현재 version과 snapshot digest

`Fact` 테이블이나 자동 변환은 만들지 않았다. Stage 6의 결과는 Claim이다.

## 핵심 규칙

- 승인 Manifest가 없으면 Canonical 쓰기를 하지 않는다.
- Event와 Manifest 내용이 하나라도 다르면 거부한다.
- 승인 user actor와 Token actor가 같아야 한다.
- 승인 후 Canonical Snapshot이 달라지면 `STALE_APPROVAL`이다.
- Manifest ID 하나는 Canonical Commit 하나만 만든다.
- Revision·History는 수정·삭제할 수 없다.
- Canonical Module 외 다른 Module은 공식 원장을 쓸 수 없다.

## Outbox 복구

Outbox는 DB에서 pending record를 claim할 때 `SKIP LOCKED`를 사용한다. 쉬운 말로,
여러 worker가 동시에 실행되어도 같은 줄을 동시에 가져가지 않게 하는 PostgreSQL 기능이다.

- processing record는 5분 lease 후 다시 가져올 수 있다.
- attempt 번호가 맞는 worker만 published로 완료할 수 있다.
- publish 실패 시 pending으로 돌려 재시도할 수 있다.
- 재시작 뒤에도 Outbox와 publish 결과가 보존된다.

## 실행과 검증

```powershell
$env:DATABASE_URL = 'postgres://shotgun:shotgun@localhost:5432/shotgun'
npm run db:reset
npm run db:verify
npm run check
npm run test:database
npm run oss:audit
npm run oss:sbom
```

## OSS 결정

상세 근거는
[Stage 6 OSS Integration Review](../implementation/stage-validations/stage-6-oss-integration-review.md)와
[ADR-086](../architecture/adr/ADR-086-stage-6-canonical-commit-history-outbox.md)에 기록했다.

- PostgreSQL: `ADOPT`
- gbrain: `REFERENCE_ONLY`
- pg-boss·Graphile Worker: `DEFER`
- node-pg-migrate·Drizzle·Kysely: `DEFER`
