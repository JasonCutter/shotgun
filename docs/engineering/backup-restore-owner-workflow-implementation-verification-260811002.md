# LPA-WP5 A2 Product Implementation — Verification Evidence

- **id**: LPA-WP5-A2-VERIFICATION-260811002
- **classification**: EVIDENCE
- **status**: COMPLETE (A2) — Correction Round 2 (Recovery Harness Isolation / Resource Safety) 후 GPT 재검토 대기
- **frozen_ir**: `docs/implementation/backup-restore-owner-workflow-implementation-request-260811001.md` (FROZEN / ACCEPTED)
- **a1_head**: `6a4b8a60c88ec609de48bb148cb309e39dc1a85c`
- **pr**: (Product PR — merge 전)

> Exact implementation head와 CI 번호는 이 문서에 기록하지 않고 GPT 완료
> 보고의 GitHub external evidence로 제출한다 (GPT §22 — self-referential CI
> metadata chase 방지). Governance Closure 시 정당한 canonical record로
> 확정한다.

## 1. 구현 범위 (LPA-BR-D01 ~ D16 mapping)

| 결정                      | 구현                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D01 Core Reuse            | `createBackup`/`verifyBackup`/`restoreBackup`/`createIsolatedRestoreDatabase`/`dropIsolatedRestoreDatabase` 재사용. `backup-restore.ts`는 `readManifest` export만 추가 (semantics 무변경, Bundle format 무변경)                                                                                                                                                                                                                                                                                                                                                                |
| D02 Default Root          | `os.homedir()/Shotgun Backups` (`backup-owner-core.ts` `defaultBackupRoot`) — precedence: `--output`(legacy) / `--root` / no-arg                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D03 Collision-safe        | `YYYYMMDDThhmmssSSSZ-<6hex>` (UTC sortable, Windows-safe, suffix) — `collisionSafeName`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D04 Owner Backup          | `npm run backup:create` → resolve → `createBackup()` → `verifyBackup()` → summary (`VERIFIED`/backupId/createdAt/path/version/dump/assets/contracts/tables/size/sensitive warning)                                                                                                                                                                                                                                                                                                                                                                                             |
| D05 Discovery             | `npm run backup:list` (+ `--root`, `--verify`). manifest discovery, newest-first, root count/size, corrupt는 숨기지 않고 error 표시                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D06 Latest                | `--latest` — newest candidate unreadable/corrupt이면 `BACKUP_INTEGRITY_INVALID` fail closed, silent fallback 없음                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D07 Scheduling            | 코드 없음 — README + runbook에 Windows(schtasks)/macOS(launchd)/Linux(cron·systemd) 문서. `backup:create` 자체를 scheduler command로 재사용                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D08 Retention             | 구현 없음 — prune/cleanup/keep-last-N 없음. `backup:list`에 count + total size + growth warning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D09 Running backup        | 허용 — Shotgun 자동 종료 없음, 기존 fail-closed consistency 신뢰, `BACKUP_CONSISTENCY_CHANGED`로 owner 안내                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D10 Guided restore-safe   | `npm run backup:restore-safe` (`--backup`/`--latest`/`--root`) — select→verify→safe target→restore→verify→bounded recovery→summary. explicit `RESTORE_*`(둘 다 필수) 또는 auto isolated target(`<USER_HOME>/Shotgun Restores/<ts>/assets`)                                                                                                                                                                                                                                                                                                                                     |
| D11 No cutover            | `.env` 수정/source DB·Asset 삭제/자동 교체 없음. 완료 = restored target safe+verified+recoverable. success target 보존, failed auto-created target만 cleanup                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D12 Recovery verification | `verifyBoundedRecovery` — 복원 타겟 **DB + 실제 복원 Asset Root**를 함께 사용해 기존 **STARTUP Canonical Projection Recovery를 실제 실행** (`startRecoveryApplication`: `createApplication` + `canonicalProjectionRecoveryIntervalMs: false` + `disableAskWorker: true` + `noSignals: true`), recovery report가 COMPLETED이고 전 project READY일 때만 성공. `productReadable`은 bounded owner-safe Canonical read의 별도 사실. Ask worker 미기동(외부 AI 실행 불가). 빈 Canonical(project 0)은 유효한 정상 케이스. fixture 없음, Stage12 drill 복제 없음 (ADR-097 경로 재사용) |
| D13 Failure taxonomy      | `BackupOwnerFailure` 13종 (code/message/check/action), LaunchFailure 형식, stack-only UX 금지                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D14 Sensitive warning     | `SENSITIVE_DATA_WARNING` — create success/list/restore 출력 + README/runbook 명시. encryption 없음                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D15 Architecture          | NEW ADR NOT_REQUIRED — ADR-097 authority 유지                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D16 OSS                   | NO_NEW_OSS — pg_dump/pg_restore ADOPT 재사용, pgBackRest/WAL-G/Barman DEFER                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 2. LPA-BR-AC-01 ~ AC-10 Evidence mapping

| AC                          | Evidence                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 Simple Backup         | smoke: `npm run backup:create` no-arg → default root backup 생성 + `VERIFIED`                                                                                                   |
| AC-02 Verified Backup       | create 직후 `verifyBackup()` 자동 수행 (focused test: create→verify ordering)                                                                                                   |
| AC-03 Discoverable Backup   | `backup:list`/`--root`/`--latest` 구현 + focused test (list ordering, metadata, `--verify`, corrupt surfaced, latest fail-closed)                                               |
| AC-04 Scheduled Backup      | runbook §7.4 Windows/macOS/Linux 등록 절차 문서                                                                                                                                 |
| AC-05 Safe Restore          | `restore-safe` isolated/explicit target만, source=target 거부 (focused + smoke)                                                                                                 |
| AC-06 Restore Verification  | `restoreBackup` integrity + `verifyBoundedRecovery` (기존 STARTUP recovery 실제 실행, COMPLETED + 전 project READY일 때만 검증 성공, non-READY는 `RESTORE_VERIFICATION_FAILED`) |
| AC-07 Actionable Failure    | 13종 taxonomy에 check/action 필드 (focused tests)                                                                                                                               |
| AC-08 Secrets Excluded      | `secretsIncluded: false` 유지 + sensitive warning                                                                                                                               |
| AC-09 No Silent Destruction | 자동 retention/prune/cutover/source overwrite 없음 (구현 부재 + focused tests)                                                                                                  |
| AC-10 Existing Core Reused  | `backup-restore.ts` core 재사용 (export 1개 추가만), `backup:drill` 유지                                                                                                        |

## 3. Focused Verification 결과

`tests/integration/backup-owner-contract.test.ts` — **24 tests PASS** (20 + D12 보정 4):

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
- D12 보정 focused: restore 후 recovery 호출 순서(restore→recovery) / recovery
  failure → `RESTORE_VERIFICATION_FAILED` + auto target cleanup / owner-supplied
  target은 recovery failure에도 삭제 안 함 / non-READY 결과(projection-empty
  heuristic 제거)는 성공으로 보고하지 않고 실패
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
  생성, integrity matches manifest, recovery canonicalReadable=true /
  startupRecoverySucceeded=true / searchReady=true / compiledTruthReady=true /
  productReadable=true (기존 STARTUP recovery 실제 실행, COMPLETED report
  확인), target retained, NO CUTOVER (source 무변경). 빈 Canonical(project 0)
  = 유효한 정상 케이스로 검증 성공.
- smoke 산출물(disposable)은 증거 확보 후 수동 정리 (backup dir 1개, restore
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

## 10. GPT 검토 이력 (append-only)

### A2 초기 제출 → GPT **CHANGES_REQUIRED** (2026-08-11)

- 제출 head: `8e41bd8dea74e6e7dcb7b8aa9a73829c795a8750`, PR #87, CI #766
  SUCCESS.
- GPT 단일 blocking 항목: **D12 / AC-06** — `verifyBoundedRecovery`가
  projection table count == 0 을 "rebuildable"로 판단한 것. GPT 판정:
  "projection table이 비어 있다는 사실은 rebuildable의 증거가 아닙니다."
  복원 타겟에서 기존 STARTUP Canonical Projection Recovery를 실제 실행해
  derived projection이 Canonical에서 복구되는지 검증해야 한다.

### Correction Round 1 (authorized 2026-08-11)

- 수정 내용:
  - `OwnerDeps.verifyRestoredRecovery` 추가 — `startRecoveryApplication`
    (`createApplication` + `canonicalProjectionRecoveryIntervalMs: false` +
    `noSignals: true`)으로 복원 타겟에서 기존 STARTUP recovery를 1회 실제
    실행, `recoveryState.latest()` report가 `COMPLETED`이고 전 project
    `READY`일 때만 성공, 리소스(pool/temp asset root)는 `finally`에서
    정리.
  - `verifyBoundedRecovery`는 `deps.verifyRestoredRecovery` 호출 + 실패는
    `classifyRecoveryError` → `RESTORE_VERIFICATION_FAILED` (check/action
    포함). non-READY 결과도 실패로 보고 (성공 보고 금지).
  - projection count heuristic 제거 (`queryRows`/`PROJECTION_TABLES` 삭제).
  - `RecoveryVerificationResult` = canonicalReadable / startupRecoverySucceeded /
    searchReady / compiledTruthReady / productReadable.
  - CLI 출력에 새 5개 flag 표기 (owner는 검증된 결과만 표시).
  - 테스트: fake를 `verifyRestoredRecovery`로 교체 + D12 focused 4종 추가
    (총 24).
- 변경 범위: `scripts/backup-owner-core.ts`, `scripts/backup-owner.ts`,
  `assemblies/shotgun-app/src/application.ts`(recovery harness 옵션 +
  `startRecoveryApplication` export), `tests/.../backup-owner-contract.test.ts`.
  Bundle v1 / `createBackup` / `verifyBackup` / `restoreBackup` semantics,
  ADR-097, default root, `--latest`, scheduling, retention, no-cutover 원칙
  무변경 (C7).
- 검증: tsc PASS, ESLint PASS, prettier PASS, docs:validate PASS,
  focused 24 tests PASS, real smoke 1회 (restore-safe → 실제 STARTUP recovery
  → RESTORED_AND_VERIFIED, NO CUTOVER). Product Domain/DB/dependency 변경
  없음.
- 정확한 correction head / CI 번호는 이 문서에 기록하지 않고 GPT 완료
  보고의 external evidence로 제출한다 (§22 메타데이터 chase 방지).
- smoke: create→list→verify --latest→restore-safe 전부 성공, cutover 없음.
- Product Domain/DB migration/new dependency 없음.

### Correction Round 1 제출 → GPT **CHANGES_REQUIRED** (2026-08-11)

- 제출 head: `c6f960b2eefbd11404de81f0a0267c103d20820b`, PR #87, 자동 CI
  #767 / run 31411242965 SUCCESS (Quality·Frontend·Required Gates).
- GPT 수용: 실제 STARTUP Canonical Projection Recovery 도입 ACCEPTED,
  projection-empty heuristic 제거 ACCEPTED, READY fail-closed ACCEPTED,
  target ownership ACCEPTED.
- GPT 단일 blocking 항목: **Recovery Harness Isolation / Resource Safety** —
  `startRecoveryApplication()`이 전체 `startShotgunApplication()`을 사용해
  **Ask background worker**(`askAnswerExecution.startWorker`)까지 기동. Ask
  worker `startWorker()`는 시작 즉시 `tick()`을 수행해 복원 DB에서
  `recoverInterrupted()` / `claimQueuedForWorker()` / `runClaimed()`를
  실행, queued/interrupted Ask가 있으면 Product execution state를 변경하고
  AI provider 실행(`recovery-harness-key` 가짜 키)까지 시도할 수 있음. 이는
  Frozen D12의 bounded recovery verification 경계를 넘어섬. 추가로 ①
  검증이 실제 복원 asset root가 아닌 임시 빈 root를 사용, ② temp root
  cleanup이 construction 성공 후에만 실행(throw 시 누수).
- 남은 scope: Recovery Harness Isolation / Resource Safety만. 기존
  create/list/latest/retention/no-cutover/taxonomy 영역 재수정 없음.

### Correction Round 2 (authorized 2026-08-11)

- 수정 내용:
  - **C2-1 Ask worker 미기동**: `StartShotgunApplicationOptions.disableAskWorker`
    추가. `startShotgunApplication`은 `options.disableAskWorker ?? recoveryHarness`
    로 Ask worker 시작을 건너뜀 (immediate `tick()` 없음 → 복원 DB에서 claim/
    recover/execute 불가능). `startRecoveryApplication`은 `disableAskWorker:
true` 명시. 정상 launch의 Ask worker 동작은 그대로.
  - **C2-2 fake credential 제거**: recovery harness는 기존
    `FakeAIProviderAdapter`(로컬 결정적, network 없음)를 사용해
    `GEMINI_API_KEY` 요구/`recovery-harness-key` 주입을 제거. Ask worker
    off + fake provider → external AI execution 불가능. 정상 app의
    GEMINI_API_KEY 요구/Ask provider policy 무변경.
  - **C2-3 실제 restored asset root**: `verifyRestoredRecovery(targetDatabaseUrl,
targetAssetRoot)`로 시그니처 변경, `runOwnerRestoreSafe`에서
    `target.databaseUrl` + `target.assetRoot`를 그대로 전달. 임시
    `shotgun-recovery-*` root 제거.
  - **C2-4 실제 사실만 표현**: handle에 `readCanonicalProjectIds()`(bounded
    owner-safe Canonical read) 추가. `productReadable`은 이 read 성공 +
    allProjectsReady의 별도 사실. `searchReady`/`compiledTruthReady`는
    project READY가 Search+Compiled Truth READY를 포괄한다는 authority
    (runCanonicalProjectionRecovery가 둘 다 READY일 때만 status READY)를
    코드 주석으로 명확화. Empty Canonical(0 projects) 정상 case 유지.
  - **C2-5 construction failure resource cleanup**: `startShotgunApplication`
    전체 construction을 try/catch로 감싸 실패 시 `stopAskAnswerWorker()` +
    `pool.end()` 실행 후 원본 에러 보존 (temp root 없어졌으므로 누수 대상은
    pool/worker). `close()`는 idempotent(정확히 1회).
  - handle에 `askWorkerStarted: boolean` 추가 — recovery-only 증거.
- 변경 범위: `assemblies/shotgun-app/src/application.ts`,
  `scripts/backup-owner-core.ts`, `tests/integration/backup-owner-contract.test.ts`,
  `tests/integration/recovery-harness-isolation.test.ts`(신규 3),
  evidence doc §10. Bundle v1 / `createBackup` / `verifyBackup` /
  `restoreBackup` / DB schema / Product Domain / defaults / latest /
  scheduling / retention / target ownership / no-cutover / taxonomy /
  dependency / NEW ADR NOT_REQUIRED / Architecture Amendment NOT_REQUIRED
  무변경 (C2-9).
- 검증: tsc PASS, ESLint PASS, prettier PASS, docs:validate PASS, contract
  25 + recovery-harness-isolation 3 = 28 tests PASS (Ask worker 미기동,
  bounded read, close idempotent, construction failure 원본 에러 보존),
  real smoke 1회 (restore-safe → 실제 STARTUP recovery + 실제 restored
  asset root 사용 → RESTORED_AND_VERIFIED, recovery 5 flag true, target
  retained, NO CUTOVER). Product Domain/DB migration/dependency 변경 없음.
- 정확한 Correction Round 2 head / CI 번호는 이 문서에 기록하지 않고 GPT
  완료 보고의 external evidence로 제출한다 (§22 메타데이터 chase 방지).
- 불필요한 test/CI rerun, metadata-chase commit 없음. backup:drill 미실행.
