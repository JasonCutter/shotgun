# Stage 6 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Canonical Claim Commit, History, Transactional Outbox
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 6: COMPLETE**

관련 OSS와 설계 패턴을 먼저 검토한 뒤, PostgreSQL은 채택하고 gbrain은 패턴 참고로
제한했으며 범용 Job·ORM 도구는 현재 MVP 범위보다 커서 명시적으로 보류했다.

## OSS 결정

| 후보                         | 결정              | 적용 범위                                                   |
| ---------------------------- | ----------------- | ----------------------------------------------------------- |
| PostgreSQL 16.14             | `ADOPT`           | 원자적 Commit, 행 잠금, append-only 원장, Outbox claim      |
| garrytan/gbrain `a25209b`    | `REFERENCE_ONLY`  | Timeline append, idempotency, lock, migration·recovery 패턴 |
| Transactional Outbox pattern | `NO_RELEVANT_OSS` | Shotgun Canonical 트랜잭션 내부의 최소 구현                 |
| pg-boss 12.26.0              | `DEFER`           | 범용 Job·schedule·worker가 필요할 때 재검토                 |
| Graphile Worker 0.17.3       | `DEFER`           | 독립 worker와 cron이 필요할 때 재검토                       |
| node-pg-migrate 8.0.4        | `DEFER`           | 현재 ordered SQL runner로 완료 기준 충족                    |
| Drizzle ORM 0.45.2           | `DEFER`           | 작은 명시적 SQL보다 추가 추상화 비용이 큼                   |
| Kysely 0.29.3                | `DEFER`           | 동적·복합 query가 없는 Stage 6에는 불필요                   |

## gbrain Mapping과 Gap

| gbrain에서 확인한 장점               | Shotgun 적용                            | 차이와 경계                                       |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------- |
| Page·Fact·Timeline append            | Revision·HistoryEvent append-only       | Shotgun은 Claim과 Fact를 분리한다.                |
| 고유 identity와 idempotent migration | Manifest ID 기반 Commit 중복 제거       | 승인 Manifest와 Snapshot precondition이 추가된다. |
| PostgreSQL lock·stale recovery       | project row lock, Outbox lease recovery | gbrain DB와 worker runtime은 포함하지 않는다.     |
| migration 완료 상태 보존             | ordered SQL migration ledger            | Shotgun Contract와 schema가 공식 소유권을 가진다. |

gbrain의 코드·DB를 Canonical 원장으로 직접 사용하지 않았다. gbrain은 승인 경계와
Claim·Fact 분리가 Shotgun Contract와 다르기 때문이다.

## 직접 구현 근거

- Stage 6은 범용 Job 시스템이 아니라 승인된 Canonical Commit에서 나오는 단일 Outbox 흐름만 필요하다.
- pg-boss나 Graphile Worker를 넣으면 package-owned schema, worker lifecycle, 운영 설정이 추가된다.
- ORM을 넣어도 핵심 원자성은 PostgreSQL transaction, unique constraint, row lock, `SKIP LOCKED`
  SQL로 다시 검증해야 한다.
- 따라서 Repository Port 뒤에 최소 SQL을 두는 편이 MVP와 교체 가능성을 동시에 만족한다.

## Contract·안전 검증

| 검증                                               | 결과 |
| -------------------------------------------------- | ---- |
| 미승인 Candidate 직접 저장 차단                    | PASS |
| 승인 Event와 저장 Manifest 불일치 차단             | PASS |
| Claim의 Fact 자동 승격 금지                        | PASS |
| Claim·Commit·Revision·History·Outbox 단일 트랜잭션 | PASS |
| 동일 Manifest ID 재실행 중복 없음                  | PASS |
| 승인 후 Snapshot 변경 `STALE_APPROVAL`             | PASS |
| 과거 History update·delete 차단                    | PASS |
| Outbox publish와 재시작 복구                       | PASS |
| 중간 실패 전체 rollback                            | PASS |
| 동시 Commit 중 하나만 성공                         | PASS |
| 메모리·PostgreSQL Adapter Contract                 | PASS |

## 다음 Stage 전달

Stage 7은 `CanonicalCommitted`와 Canonical Query만 사용해 Projection·Search를 구현한다.
Canonical 테이블을 검색 모듈이 직접 수정하거나 gbrain DB를 공식 원장으로 사용할 수 없다.
