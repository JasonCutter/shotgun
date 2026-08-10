# LPA-WP5 A2 Product Implementation — Verification Evidence

- **id**: LPA-WP5-A2-VERIFICATION-260811002
- **classification**: EVIDENCE
- **status**: COMPLETE (A2) — GPT review pending
- **frozen_ir**: `docs/implementation/backup-restore-owner-workflow-implementation-request-260811001.md` (FROZEN / ACCEPTED)
- **a1_head**: `6a4b8a60c88ec609de48bb148cb309e39dc1a85c`
- **pr**: (Product PR — merge 전)

> Exact implementation head와 CI 번호는 이 문서에 기록하지 않고 GPT 완료
> 보고의 GitHub external evidence로 제출한다 (GPT §22 — self-referential CI
> metadata chase 방지). Governance Closure 시 정당한 canonical record로
> 확정한다.

## 1. 구현 범위 (LPA-BR-D01 ~ D16 mapping)

| 결정                      | 구현                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D01 Core Reuse            | `createBackup`/`verifyBackup`/`restoreBackup`/`createIsolatedRestoreDatabase`/`dropIsolatedRestoreDatabase` 재사용. `backup-restore.ts`는 `readManifest` export만 추가 (semantics 무변경, Bundle format 무변경)                            |
| D02 Default Root          | `os.homedir()/Shotgun Backups` (`backup-owner-core.ts` `defaultBackupRoot`) — precedence: `--output`(legacy) / `--root` / no-arg                                                                                                           |
| D03 Collision-safe        | `YYYYMMDDThhmmssSSSZ-<6hex>` (UTC sortable, Windows-safe, suffix) — `collisionSafeName`                                                                                                                                                    |
| D04 Owner Backup          | `npm run backup:create` → resolve → `createBackup()` → `verifyBackup()` → summary (`VERIFIED`/backupId/createdAt/path/version/dump/assets/contracts/tables/size/sensitive warning)                                                         |
| D05 Discovery             | `npm run backup:list` (+ `--root`, `--verify`). manifest discovery, newest-first, root count/size, corrupt는 숨기지 않고 error 표시                                                                                                        |
| D06 Latest                | `--latest` — newest candidate unreadable/corrupt이면 `BACKUP_INTEGRITY_INVALID` fail closed, silent fallback 없음                                                                                                                          |
| D07 Scheduling            | 코드 없음 — README + runbook에 Windows(schtasks)/macOS(launchd)/Linux(cron·systemd) 문서. `backup:create` 자체를 scheduler command로 재사용                                                                                                |
| D08 Retention             | 구현 없음 — prune/cleanup/keep-last-N 없음. `backup:list`에 count + total size + growth warning                                                                                                                                            |
| D09 Running backup        | 허용 — Shotgun 자동 종료 없음, 기존 fail-closed consistency 신뢰, `BACKUP_CONSISTENCY_CHANGED`로 owner 안내                                                                                                                                |
| D10 Guided restore-safe   | `npm run backup:restore-safe` (`--backup`/`--latest`/`--root`) — select→verify→safe target→restore→verify→bounded recovery→summary. explicit `RESTORE_*`(둘 다 필수) 또는 auto isolated target(`<USER_HOME>/Shotgun Restores/<ts>/assets`) |
| D11 No cutover            | `.env` 수정/source DB·Asset 삭제/자동 교체 없음. 완료 = restored target safe+verified+recoverable. success target 보존, failed auto-created target만 cleanup                                                                               |
| D12 Recovery verification | `verifyBoundedRecovery` — canonical readable + projection 4종 empty(rebuildable) bounded read. fixture 없음, Stage12 drill 복제 없음                                                                                                       |
| D13 Failure taxonomy      | `BackupOwnerFailure` 13종 (code/message/check/action), LaunchFailure 형식, stack-only UX 금지                                                                                                                                              |
| D14 Sensitive warning     | `SENSITIVE_DATA_WARNING` — create success/list/restore 출력 + README/runbook 명시. encryption 없음                                                                                                                                         |
| D15 Architecture          | NEW ADR NOT_REQUIRED — ADR-097 authority 유지                                                                                                                                                                                              |
| D16 OSS                   | NO_NEW_OSS — pg_dump/pg_restore ADOPT 재사용, pgBackRest/WAL-G/Barman DEFER                                                                                                                                                                |

## 2. LPA-BR-AC-01 ~ AC-10 Evidence mapping

| AC                          | Evidence                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 Simple Backup         | smoke: `npm run backup:create` no-arg → default root backup 생성 + `VERIFIED`                                                     |
| AC-02 Verified Backup       | create 직후 `verifyBackup()` 자동 수행 (focused test: create→verify ordering)                                                     |
| AC-03 Discoverable Backup   | `backup:list`/`--root`/`--latest` 구현 + focused test (list ordering, metadata, `--verify`, corrupt surfaced, latest fail-closed) |
| AC-04 Scheduled Backup      | runbook §7.4 Windows/macOS/Linux 등록 절차 문서                                                                                   |
| AC-05 Safe Restore          | `restore-safe` isolated/explicit target만, source=target 거부 (focused + smoke)                                                   |
| AC-06 Restore Verification  | `restoreBackup` integrity + `verifyBoundedRecovery` (canonical readable, projections rebuildable)                                 |
| AC-07 Actionable Failure    | 13종 taxonomy에 check/action 필드 (focused tests)                                                                                 |
| AC-08 Secrets Excluded      | `secretsIncluded: false` 유지 + sensitive warning                                                                                 |
| AC-09 No Silent Destruction | 자동 retention/prune/cutover/source overwrite 없음 (구현 부재 + focused tests)                                                    |
| AC-10 Existing Core Reused  | `backup-restore.ts` core 재사용 (export 1개 추가만), `backup:drill` 유지                                                          |

## 3. Focused Verification 결과

`tests/integration/backup-owner-contract.test.ts` — 20 tests PASS:

- owner backup: no-arg default root / collision-safe name / `--root` / legacy
  `--output` / create→verify ordering / auto-verify failure / storage failure
  (BACKUP_STORAGE_UNAVAILABLE) / consistency failure (BACKUP_CONSISTENCY_CHANGED)
- discovery: newest-first ordering / metadata / total count+size / corrupt
  surfaced / `--verify` / `--latest` fail-closed (corrupt newest → no silent
  fallback) / `BACKUP_NOT_FOUND`
- guided restore-safe: verify-before-target-prep / partial `RESTORE_*` fails /
  auto isolated target retained on success / auto target cleanup on failure /
  owner-supplied target never deleted / source=target → RESTORE_TARGET_UNSAFE /
  target prep failure
- taxonomy: 13종 모두 category + actionable check/action 필드

기존 affected test: `tests/unit/backup-restore.test.ts` 3 tests PASS (core
semantics 무변경 확인).

## 4. Local Smoke 결과 (로컬 PostgreSQL, Docker)

- `npm run backup:create` (no-arg) → `VERIFIED 7a959c46-...` — default root
  `C:\Users\lhm24\Shotgun Backups\20260810T161627614Z-72c180`, format v1,
  assets 0, contracts 95, tables 39, size 561.4 KiB, sensitive warning.
- `npm run backup:list` → backup 목록 + count/size + retention warning +
  불완전 candidate(이전 실패 흔적, manifest 없음)를 ERROR로 표시 (corrupt
  surface 실증).
- `npm run backup:verify -- --latest` → `VERIFIED` (최신 backup 검증).
- `npm run backup:restore-safe -- --latest` → `RESTORED_AND_VERIFIED` —
  isolated DB `shotgun_restore_...` + `<USER_HOME>/Shotgun Restores/<ts>/assets`
  생성, integrity matches manifest, recovery canonical readable=true /
  projectionsRebuildable=true, target retained, NO CUTOVER (source 무변경).
- smoke 산출물(disposable)은 증거 확보 후 수동 정리 (backup dir 2개, restore
  dir, isolated DB drop).

## 5. 실패 분류 실증

- 최초 smoke에서 DB가 참조하는 Asset이 로컬 asset root에 없는 상태
  (ENOENT) → `ASSET_MISSING_OR_CORRUPT`로 분류되어야 했으나 버그로
  `POSTGRES_TOOL_UNAVAILABLE` → 수정 (spawn ENOENT vs asset-read ENOENT
  구분). 이후 `db:reset`으로 일관된 source에서 smoke 성공.

## 6. Product Domain / DB / OSS 변경 여부

- Product Domain module 변경: **없음**
- DB schema/migration 변경: **없음** (`db:reset`은 smoke용 로컬 dev 상태
  재설정이며 소스 변경 아님)
- Dependency 추가: **없음** (NO_NEW_OSS)
- `backup-restore.ts`: `readManifest` export 1개만 추가 (semantics 무변경)

## 7. Excluded (Frozen IR §6 준수)

- 자동 retention/pruning, cloud backup, encryption/key-management, object
  storage, WAL/PITR, pgBackRest/WAL-G/Barman, in-place restore, automatic
  cutover, source DB/Asset 삭제, desktop/service, Product Domain, DB
  migration, LPA-WP6, Deployment.

## 8. 알려진 제한

- `--latest` fail-closed는 newest candidate의 manifest가 읽히는 경로에서
  full verify 실패 시에도 적용 (BACKUP_INTEGRITY_INVALID).
- Windows 콘솔에서 actual `backup:drill` 재실행은 하지 않음 (Frozen 계약).

## 9. GPT 보고용 요약

- changed files: `scripts/backup-owner-core.ts`, `scripts/backup-owner.ts`,
  `scripts/backup-restore.ts`(export 1개), `package.json`(commands),
  `tests/integration/backup-owner-contract.test.ts`(20), README, runbook,
  본 evidence, Frozen IR 정규화(FROZEN/ACCEPTED).
- focused tests 20 PASS + 기존 backup-restore core 3 PASS.
- smoke: create→list→verify --latest→restore-safe 전부 성공, cutover 없음.
- Product Domain/DB migration/new dependency 없음.
