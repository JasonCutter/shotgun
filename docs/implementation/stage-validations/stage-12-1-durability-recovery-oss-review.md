# Stage 12.1 Durability Recovery OSS Integration Review

- 검토일: 2026-07-21
- 대상: Canonical Outbox Worker, Search·Compiled Truth Recovery, Backup·Restore
- 상태: **OSS GATE COMPLETE — IMPLEMENTATION VERIFIED**

## Integration Decision

| 후보                              | 공식 소스                                      | 검토 기준                                  | License                       | 결정             |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------ | ----------------------------- | ---------------- |
| PostgreSQL `pg_dump`·`pg_restore` | https://www.postgresql.org/docs/16/backup.html | PostgreSQL 16.14                           | PostgreSQL                    | `ADOPT`          |
| garrytan/gbrain                   | https://github.com/garrytan/gbrain             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT                           | `REFERENCE_ONLY` |
| pgBackRest                        | https://github.com/pgbackrest/pgbackrest       | `2.58.0`                                   | MIT                           | `DEFER`          |
| WAL-G                             | https://github.com/wal-g/wal-g                 | `3.0.8`                                    | Apache-2.0, 선택 LZO GPL-3.0+ | `DEFER`          |
| Barman                            | https://github.com/EnterpriseDB/barman         | `3.19.1`                                   | GPL-3.0                       | `DEFER`          |

## 결정 근거

- 기존 PostgreSQL 16.14와 Transactional Outbox를 유지하면 Module Contract나 Canonical 소유권을 변경하지 않는다.
- `pg_dump` custom format과 `pg_restore`는 새 빈 Database round-trip과 선택적 검사에 필요한 최소 공식 도구다.
- gbrain은 lock·idempotency·migration/recovery 패턴만 참고하며 DB와 Runtime을 포함하지 않는다.
- pgBackRest·WAL-G·Barman은 WAL archive, PITR, 원격 Object Storage, Retention과 별도 Credential 운영이 필요한 도구다. 현재 Section은 단일 Database의 검증 가능한 logical backup과 clean restore가 목표다.
- Backup Bundle은 Shotgun이 소유하는 Asset·Contract·Integrity Manifest를 PostgreSQL dump와 함께 조립한다. 외부 도구의 내부 Metadata를 Shotgun Contract로 노출하지 않는다.

## Security·Maintenance

- Database URL과 password는 Manifest·Command argument·일반 로그에 기록하지 않는다. PostgreSQL Client에는 child-process 환경으로만 전달한다.
- Backup은 참조된 content-addressed Asset만 복사하고 Database content hash와 실제 bytes를 대조한다.
- Restore는 새 빈 Database와 빈 Asset Root만 허용하며 Source와 동일한 대상은 거부한다.
- PostgreSQL Client major는 Server major 16과 맞춘다.
- pgBackRest·WAL-G·Barman은 설치하지 않으므로 현재 Lockfile·SBOM 변화가 없다.

## 재평가 조건

- 목표 RPO가 logical backup 주기보다 짧아짐
- Point-in-time recovery 또는 continuous WAL archive 필요
- 암호화된 외부 Object Storage와 Retention 자동화 필요
- 다중 PostgreSQL Server·Replica의 중앙 DR 운영 필요
- restore latency가 대표 RTO를 초과함

## 검증 결과

- 시작 시 pending·stale processing Outbox를 bounded batch로 drain하고 Project별 실패를 격리한다.
- 이미 published인 Outbox에서도 Search·Compiled Truth readiness를 독립 확인하고 누락 Projection을 Full Rebuild한다.
- 주기 Worker는 중첩 실행하지 않으며 Application shutdown 시 Timer를 정리한다.
- Backup Manifest의 Database dump와 Original Asset 손상·누락을 fail closed하는 negative test가 통과했다.
- PostgreSQL 16.14 custom dump를 새 `template0` 기반 Database에 복원하는 격리 훈련이 통과했다.
- Clean restore 훈련에서 14개 Migration, Original Asset 1개, Contract·Module Manifest 90개와 Canonical Project 1개의 무결성을 검증했다.
- 복원된 Projection을 삭제한 뒤 Canonical에서 Search `READY`, Compiled Truth version 1과 published Outbox를 자동 복구했다.
- 새 Runtime Package나 Lockfile 변경 없이 기존 Stage 6·7·10 Port와 Adapter를 재사용했다.

실행 명령:

```text
npm run backup:drill
npx vitest run tests/unit/backup-restore.test.ts tests/unit/canonical-projection-recovery.test.ts
node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/stage12-1-outbox-projection-recovery.test.ts --maxWorkers=1
```

## 남은 운영 재평가

- 현재 검증은 logical backup과 clean restore 범위다. 목표 RPO·RTO, PITR, WAL archive, 외부 암호화 저장소와 Retention은 배포 환경 승인 후 별도 Gate로 다룬다.
