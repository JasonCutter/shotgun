# ADR-097: Stage 12.1 Canonical Outbox, Projection Recovery and Clean Restore

- 상태: **Accepted**
- 날짜: 2026-07-21
- 수락일: 2026-07-22
- 상위 전략: [Stage 12.1 Hardening Strategy](../../engineering/stage-12-1-hardening-strategy.md)
- 관련 결정: [ADR-086 — Stage 6 Canonical Commit, History and Outbox](ADR-086-stage-6-canonical-commit-history-outbox.md), [ADR-087 — Stage 7 Cited Search Projection](ADR-087-stage-7-cited-search-projection.md), [ADR-090 — Stage 10 Compiled Truth and Discovery](ADR-090-stage-10-compiled-truth-and-discovery.md), [ADR-096 — Stage 12.1 AI Durable Materialization](ADR-096-stage-12-1-ai-durable-materialization.md)

## Context

Stage 6은 Canonical Commit과 Outbox를 한 PostgreSQL Transaction에 저장하고, Stage 7과 Stage 10은 Canonical에서 재생성 가능한 Projection을 제공한다. 그러나 현재 Runtime은 Canonical Commit 처리 중 Outbox dispatch만 시도한다. 프로세스가 그 전에 종료되거나 Projection Consumer가 Dead Letter가 되면 다음 시작 시 전체 Project를 찾아 자동 복구하는 경로가 없다.

Search Projection은 `CanonicalCommitted`를 소비하지만 Compiled Truth는 수동 `BuildCompiledTruth` Command에 의존한다. Backup·Restore는 정책 문서만 있고, Database·Original Asset·Contract Registry를 함께 보존하고 새 격리 환경에서 실제 복원하는 실행 가능한 절차가 없다.

이번 결정은 Canonical 의미나 Projection 계약을 교체하지 않는다. 기존 Stage 6·7·10 Port와 PostgreSQL 저장소를 사용해 자동 복구와 clean restore 증거를 추가한다.

## Decision

### 1. Canonical Project 발견은 Canonical Repository Port가 제공한다

`CanonicalKnowledgeRepositoryPort.listProjectIds()`는 Canonical Project State와 미완료 Outbox에 존재하는 Project ID를 결정적 순서로 반환한다. Assembly와 Projection Module은 Canonical Table을 직접 조회하지 않는다.

### 2. Recovery Coordinator는 Outbox와 Projection을 순서대로 복구한다

각 Project는 다음 순서로 복구한다.

```text
discover Canonical project
→ drain pending or stale Canonical Outbox in bounded batches
→ inspect Search Projection readiness
→ FULL_REBUILD when Search is STALE or DEGRADED
→ inspect Compiled Truth status
→ FULL_REBUILD when Compiled Truth is NOT_BUILT, STALE or DEGRADED
→ report READY or fail-closed result
```

Startup에서 한 번 실행하고 이후 고정 간격 Worker가 같은 Coordinator를 다시 실행한다. Worker 실행은 겹치지 않으며 Timer는 Application shutdown에서 정리한다.

Recovery Actor는 별도 Service Identity와 `owner` scope를 사용한다. 사용자 승인이나 Canonical write를 만들지 않고, 기존 Outbox 전달과 파생 Projection 재생성만 수행한다.

### 3. Outbox와 Projection 실패 의미를 분리한다

- Outbox publish가 실패하면 기존 lease·attempt 조건으로 `pending`에 돌려 다음 실행에서 재시도한다.
- Event Consumer Dead Letter는 Canonical Commit을 되돌리지 않는다.
- 이미 `published`인 Outbox라도 Projection Watermark·Status가 뒤처지면 Full Rebuild로 복구한다.
- Project 하나의 실패가 다른 Project 복구를 막지 않는다.
- 자동 복구 실패는 `failed` 결과와 Projection `DEGRADED` 상태로 남고 최신 Truth처럼 제공하지 않는다.

### 4. Backup은 Database, 참조 Asset과 Contract Snapshot을 함께 보존한다

Backup Bundle v1은 다음을 포함한다.

- PostgreSQL 16 custom-format logical dump
- Database가 참조하는 Original Asset bytes
- 각 Asset의 content hash·크기·storage key
- Canonical·History·Audit·Asset 권위 Table의 row count와 deterministic digest
- 적용 Migration 목록
- Versioned Contract Schema와 Module Manifest의 파일 digest
- 비밀값을 제외한 Backup format·storage configuration metadata

`.env`, Database password, API key, Session·Token 원문과 Provider Secret은 Backup Bundle에 기록하지 않는다.

### 5. Restore는 새 격리 대상에만 수행한다

- Source Database와 동일한 Database에는 Restore하지 않는다.
- Target Database는 `template0` 기반의 새 빈 Database여야 한다.
- Target Asset Root는 존재하지 않거나 비어 있어야 한다.
- `pg_restore --exit-on-error --no-owner --no-privileges`로 복원한다.
- 권위 Table digest와 Asset hash를 Backup Manifest와 비교한다.
- 복원된 Search·Compiled Truth Projection을 제거하고 Canonical에서 Full Rebuild한다.
- Projection Watermark·Canonical version·digest와 Compiled Truth readiness가 `READY`인지 확인한다.

Production Database를 삭제하거나 제자리 덮어쓰는 Command는 제공하지 않는다. 실제 Production 전환은 별도 승인과 운영 Runbook이 필요하다.

### 6. OSS Integration Decision

| 후보                              | Version·Pin                                 | License                         | 결정             | 경계                                                                                 |
| --------------------------------- | ------------------------------------------- | ------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| PostgreSQL `pg_dump`·`pg_restore` | PostgreSQL `16.14`, 기존 Docker digest 고정 | PostgreSQL                      | `ADOPT`          | 전체 Database logical dump와 새 빈 DB restore에 사용한다.                            |
| garrytan/gbrain                   | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`  | MIT                             | `REFERENCE_ONLY` | migration·recovery·idempotency 패턴만 참고하고 Runtime·DB는 포함하지 않는다.         |
| pgBackRest                        | `2.58.0` 검토 기준                          | MIT                             | `DEFER`          | 지속적 WAL archive, differential backup, object storage 운영이 승인될 때 재평가한다. |
| WAL-G                             | `3.0.8` 검토 기준                           | Apache-2.0, 선택 LZO는 GPL-3.0+ | `DEFER`          | Cloud object storage와 PITR 요구가 생길 때 암호화·Key 운영과 함께 평가한다.          |
| Barman                            | `3.19.1` 검토 기준                          | GPL-3.0                         | `DEFER`          | 다중 PostgreSQL Server의 원격 DR 관리가 필요할 때 별도 서비스로 평가한다.            |

이번 Section은 새 Runtime Package를 설치하지 않는다. PostgreSQL 공식 Client Utility는 고정된 Server major와 같은 major를 사용한다.

## Alternatives Considered

| 대안                                                  | 배제 이유                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Outbox가 `published`이면 Projection도 성공했다고 간주 | Event Consumer는 독립적으로 Dead Letter가 될 수 있어 손실을 숨긴다.       |
| Projection Table을 권위 Backup으로 취급               | Projection은 Canonical에서 재생성 가능하며 stale 상태까지 복제할 수 있다. |
| 시작 시에만 한 번 복구                                | Runtime 중 일시 실패 뒤 다음 재시작 전까지 Projection이 stale로 남는다.   |
| 기존 Database에 `--clean` Restore                     | 잘못된 대상 선택 시 운영 데이터를 파괴할 수 있다.                         |
| Asset Root 전체를 무검증 복사                         | 미참조 파일·임시 파일과 손상된 bytes를 권위 Backup에 섞는다.              |
| 즉시 pgBackRest·WAL-G·Barman 도입                     | 현재 단일 DB MVP보다 Server·Repository·Credential·WAL 운영 범위가 크다.   |

## Consequences

- Canonical Commit은 Projection 장애와 독립적으로 보존된다.
- Outbox가 이미 published여도 readiness 기반 Full Rebuild로 Projection을 복구할 수 있다.
- Backup 성공과 Restore 가능성을 분리하지 않고 실제 새 Database round-trip으로 검증한다.
- Logical dump만으로 point-in-time recovery를 제공하지 않는다. RPO/RTO와 WAL archive는 운영 배포 전 별도 결정이 필요하다.
- Asset bytes와 Database dump의 저장 위치 암호화·외부 보관·Retention은 이번 로컬 MVP 범위 밖이다.

## Change History

- 2026-07-21: Independent review placed this decision on hold. The design remains proposed while batch-failure handling, recovery-result observability, and section approval boundaries are corrected. This ADR does not authorize a `main` merge or a Durability Gate completion claim.
- 2026-07-22: Section 2 user approval completed; Section 3 independent technical review and user approval completed; Section 4 isolated Backup→Restore drill and independent technical review passed, and user approval completed. Sections 1–4 are approved. ADR final acceptance remains pending; the Durability Gate and Stage 12.1 remain `IN_PROGRESS`; no `main` merge authorization was granted.
- 2026-07-22: Sections 1–4 implementation, verification, independent review and user approval completed. ADR-097 received final user acceptance, Durability Gate completion was authorized, and PR #14 `main` merge was conditionally authorized after Canonical ADD synchronization, full validation and successful head CI. Stage 12.1 remains `IN_PROGRESS` because Quality and Reuse and Operations Gates are not complete; Stage 13 remains `NOT STARTED`.

## Implementation Gate

Current verification status is recorded below; the conditions that follow are not removed or weakened.

- Canonical Outbox Recovery: **PASS / USER APPROVED**
- Projection Recovery: **PASS / USER APPROVED**
- Clean Backup→Restore Drill: **PASS / USER APPROVED**

- ADR-097: **ACCEPTED**
- Durability Gate: **COMPLETE**

다음 조건이 모두 통과하기 전에는 Durability Gate의 Outbox·Projection Recovery와 clean restore Section을 완료로 표시하지 않는다.

- 시작 시 pending 및 stale processing Outbox 자동 drain
- 주기 Worker의 비중첩 실행과 shutdown 정리
- published Outbox + 누락 Search Projection 자동 Full Rebuild
- stale·degraded Compiled Truth 자동 Full Rebuild
- Project별 실패 격리와 재실행 멱등성
- PostgreSQL custom dump와 새 빈 Database restore 성공
- Canonical·History·Audit digest 일치
- 참조 Original Asset hash·size 일치
- Projection 삭제 뒤 Canonical 기반 Search·Compiled Truth `READY`
- 기존 Stage 6·7·10 Contract와 Architecture 회귀 통과
