# Stage 12.1 Outbox, Projection and Clean Restore Implementation Record

- Date: 2026-07-21
- Decision: [ADR-097](../ADR-097-stage-12-1-outbox-projection-clean-restore.md)
- Feature branch: `codex/stage12-1-outbox-projection-restore`
- Section status: **COMPLETE / USER APPROVED — MAIN MERGE PENDING**
- Stage 12.1 status: **IN_PROGRESS**

## Implemented Scope

- Canonical Repository가 Project State와 미완료 Outbox의 Project ID를 결정적 순서로 탐색한다.
- Application startup과 비중첩 periodic Worker가 bounded Outbox drain을 수행한다.
- Search와 Compiled Truth readiness를 Outbox publish 상태와 독립 검사하고 Canonical 기반 Full Rebuild한다.
- Project별 복구 실패를 격리하고 재실행을 멱등하게 유지한다.
- PostgreSQL custom dump, 참조 Original Asset, Contract·Module Manifest와 권위 Table digest를 포함한 Backup Bundle v1을 생성·검증한다.
- Restore는 Source와 다른 새 빈 Database와 빈 Asset Root만 허용한다.
- 격리된 두 임시 DB에서 실제 Backup→Restore→Projection 삭제→Canonical 재생성 훈련을 제공한다.

## Excluded Scope

- in-place restore와 운영 Database 삭제·덮어쓰기
- PITR, continuous WAL archive, 외부 Object Storage, Retention 자동화
- pgBackRest, WAL-G, Barman Runtime 설치
- Stage 12.1 Quality·Reuse·Operations Gate 완료 선언
- Stage 13 개시

## OSS Decisions

- PostgreSQL 16.14 `pg_dump`·`pg_restore`: `ADOPT`
- garrytan/gbrain pinned commit: `REFERENCE_ONLY`
- pgBackRest 2.58.0, WAL-G 3.0.8, Barman 3.19.1: `DEFER`
- 새 npm·Python Runtime dependency는 없다.

## Verification Evidence

- Unit: recovery coordinator bounded drain, Project isolation, Worker non-overlap와 shutdown
- Unit negative: dump tamper, Original Asset corruption·missing, in-place restore rejection
- PostgreSQL: stale processing Outbox와 published Outbox의 누락 Projection startup recovery·replay idempotency
- Clean restore drill: 14 Migration, Original Asset 1개, Contract·Module Manifest 90개, Canonical Project 1개
- Drill outcome: Outbox `published`, Search `READY`, Compiled Truth version 1, expected Claim 검색 성공
- Static: TypeScript typecheck, ESLint, Prettier, Secret Scan과 OSS Gate
- Technical approval basis SHA: `27f3c5c2c6f3e3bdb17dfc84369d2f9f20514b94`
- Remote CI: CI #53 PASS
- `npm audit --audit-level=high`: PASS — 0 vulnerabilities
- `npm run format:check`: PASS
- `npm run check`: PASS
- Backup Restore unit tests: 3 passed
- PostgreSQL Database tests: 68 passed in 14 files
- `db:verify`: PASS
- `git diff --check`: PASS
- Architecture boundary와 Stage 12 standalone package build·pack·install PASS
- Clean restore drill PASS: `shotgun-backup-v1`, 14 migrations, Original Asset 1, Contract and Module Manifest snapshots 90, Canonical Project 1; Outbox `published`, Search `READY`, Canonical digest matched, Compiled Truth version 1, expected Claim searchable, and Original Asset bytes matched. Projection rows were cleared before rebuild; temporary Databases and Directories were cleaned; remaining `shotgun_restore_*` Databases: 0. The 5,347ms measurement is a local isolated fixture result, not a Production RTO.

## Review and Approval Status

- Remote CI quality: PASS (CI #53 at the technical approval basis SHA)
- Local isolated clean restore drill: PASS (local evidence only; CI #53 does not run `backup:drill`)
- Section 1: COMPLETE
- Section 2: COMPLETE / USER APPROVED
- Section 3: COMPLETE / USER APPROVED
- Section 4: COMPLETE / USER APPROVED
- Independent technical review: PASS
- Section approval: GRANTED FOR SECTIONS 1–4
- ADR-097 final acceptance: PENDING
- Durability Gate: IN_PROGRESS
- Stage 12.1: IN_PROGRESS
- Main merge: NOT PERFORMED

Historical note: the earlier Independent architecture review `HOLD` and Section approval `NOT GRANTED` recorded the previous checkpoint. The current approvals do not authorize ADR-097 final acceptance, Durability Gate completion, Stage 12.1 completion, PR Ready conversion, `main` merge, or Stage 13.

## Migration and Rollback

새 Database migration은 없다. Repository Port 확장과 Assembly orchestration, 운영 Script만 추가한다.

Application rollback은 기존 Canonical·History·Outbox·Asset 데이터를 변경하지 않는다. Backup Restore 실패 시 대상 Database와 Asset Root를 공개하지 않고 폐기하며 Source는 그대로 유지한다. Projection은 언제든 Canonical에서 재생성한다.

## Known Limits and Handoff

- Direct automated negative tests do not yet cover Contract tamper, Contract missing, Backup path traversal, Target Database non-empty rejection, Target Asset Root non-empty rejection, PostgreSQL major mismatch, cleanup failure, or backup-time source mutation. The corresponding defense logic and normal isolated drill are implemented and verified; this limited direct test coverage was not a Section 4 approval blocker.
- Logical dump 기반이므로 대표 환경의 RPO·RTO 측정과 WAL/PITR 결정이 남아 있다.
- Production scheduling, off-site encryption, retention과 restore operator approval은 Operations Gate 범위다.
- `main` 반영과 원격 CI 검증은 별도 승인·실행 후 기록한다.
