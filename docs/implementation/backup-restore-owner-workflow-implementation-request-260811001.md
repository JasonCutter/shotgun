---
id: BACKUP-RESTORE-OWNER-WORKFLOW-IR-260811001
classification: CANONICAL
status: FROZEN / ACCEPTED
verification_gate: BACKUP-RESTORE-OWNER-WORKFLOW
created_at: 2026-08-11
subject_base: a471b2e5b747ff72056ac32d514166b5c9436dbd
canonical_main: a471b2e5b747ff72056ac32d514166b5c9436dbd
a0_audit: docs/engineering/backup-restore-owner-workflow-gap-audit-260811001.md
a0_head: cd1bdfe76e2808885903338cf43aed3c0f2078af
a0_verdict: ACCEPTED / COMPLETE (GPT 2026-08-10; Contract Freeze AUTHORIZED)
a1_head: 6a4b8a60c88ec609de48bb148cb309e39dc1a85c
a1_verdict: ACCEPTED / FROZEN (GPT 2026-08-11; Product Implementation AUTHORIZED)
next_gate: LPA-WP5 A2 Product Implementation → GPT A2 review → LPA-WP6
---

# Shotgun — Backup / Restore Owner Workflow Implementation Request (LPA-WP5, Frozen — ACCEPTED)

## 0. Authority

- Repository: `JasonCutter/shotgun`, Canonical branch: `main`
- Canonical main: `a471b2e5b747ff72056ac32d514166b5c9436dbd`
- LPA-WP4: COMPLETE / FINAL_AFTER_MERGE (PR #85/#86 MERGED, post-merge CI #762/#764 SUCCESS)
- LPA-WP5 A0 audit head: `cd1bdfe76e2808885903338cf43aed3c0f2078af`
- A0 verdict: **ACCEPTED / COMPLETE** (GPT 2026-08-10) — Contract Freeze /
  Implementation Request 진행 AUTHORIZED
- 기존 branch `docs/lpa-wp5-a0-backup-restore-gap-audit`를 그대로 사용한다.
  새 branch/PR을 만들지 않는다.
- 이번 단계는 **Contract Freeze / Implementation Request 작성만** 수행한다.
  **Product implementation은 아직 시작하지 않는다.**

## 1. Goal

기존 Stage 12.1 Backup Bundle v1 / Clean Restore 엔진을 재구현하지 않고,
`TECHNICALLY_RECOVERABLE` 상태를 `OWNER_OPERABLE_BACKUP_RESTORE`로 전환하기
위한 owner workflow 계약을 동결한다. 최종 목표는 Shotgun 소유자가
PostgreSQL 내부 구조나 개발용 restore drill을 이해하지 않아도 다음이
가능한 것이다:

- 안전하게 백업을 만들고
- 백업이 정상인지 확인하고
- 정기 백업을 설정할 수 있고
- 문제가 발생했을 때 어떤 백업을 선택해 어떤 절차로 복구할지 이해하는 것

## 2. Frozen Decisions (LPA-BR-D01 ~ LPA-BR-D16)

### LPA-BR-D01 — Stage 12.1 Core Reuse

- ADR-097과 기존 core를 authority로 유지한다.
- REUSE: `createBackup` / `verifyBackup` / `restoreBackup` / Backup Bundle
  `shotgun-backup-v1` / `createIsolatedRestoreDatabase` / restore drill
  recovery pattern / PostgreSQL `pg_dump`·`pg_restore`.
- 금지: backup format v2 / in-place restore / active source overwrite / DB
  schema·migration 변경 / Projection을 backup authority로 승격 / secrets를
  bundle에 추가.
- 이번 WP는 **owner workflow wrapper**다.

### LPA-BR-D02 — Default Backup Root

- A0의 `.data/backups` 후보는 수정한다.
- **Canonical default root**: `<USER_HOME>/Shotgun Backups` — Node
  `os.homedir()` 기반.
- 이유: application `.data`와 backup을 논리적으로 분리 / owner가
  Finder·Explorer에서 쉽게 발견 / repository checkout 삭제와 backup을 분리 /
  cross-platform.
- 단, 같은 physical disk일 가능성을 명시한다. 실제 device/disk failure
  보호가 필요하면 external drive 등 다른 storage root를 사용하도록 안내.
- 지원 precedence:
  1. legacy `--output <exact-directory>` — 기존 one-off exact target 유지
  2. `--root <backup-root>` — root 아래 자동 timestamp directory 생성
  3. 인자 없음 → `<USER_HOME>/Shotgun Backups`
- `--root`로 external drive path 사용 가능해야 한다.
- 새 cloud storage abstraction은 만들지 않는다.

### LPA-BR-D03 — Collision-safe Backup Directory

- 자동 생성 directory 이름은 Windows-safe해야 한다.
- 예: `20260811T004300123Z-a1b2c3` 또는 동등한 형식 — colon 없음 /
  filesystem-safe / sortable timestamp / collision 방지 suffix.

### LPA-BR-D04 — Owner Backup Command

- 기존 canonical command `npm run backup:create`를 owner-facing command로
  유지한다. 인자 없이 실행 가능해야 한다.
- 동작: resolve backup location → `createBackup()` → `verifyBackup()` →
  owner summary.
- 즉 backup 생성 후 **자동 integrity verification**을 반드시 수행한다.
- 성공 출력 최소: `VERIFIED` / backupId / createdAt / full backup path /
  database dump 존재 / asset count / contract count / authoritative table
  count / 전체 backup size / sensitive-data warning.
- 기존 `--output` 사용 방식은 깨지지 않아야 한다.

### LPA-BR-D05 — Backup Discovery

- 새 canonical command: `npm run backup:list`.
- 기본 root: `<USER_HOME>/Shotgun Backups`. 지원: `--root <directory>`.
- 표시: createdAt / backupId / path / format version / approximate·total
  size / asset count / contract count.
- `backup:list` 기본 동작은 manifest discovery이며 모든 대형 bundle을 매번
  full hash verification하지 않는다.
- 추가: `npm run backup:list -- --verify`는 발견된 backup을 실제
  `verifyBackup()`으로 검증.
- Unreadable/corrupt backup을 정상 backup처럼 숨기지 않는다.

### LPA-BR-D06 — Latest Selection

- 지원: `npm run backup:verify -- --latest` 및 guided restore의 `--latest`.
- `--latest`는 configured/default backup root에서 가장 최근 backup을
  선택한다.
- 안전 계약: 더 최신 candidate가 corrupted/unreadable인데 그것을 조용히
  건너뛰고 이전 backup을 선택하면 안 된다. latest candidate가 invalid이면
  **fail closed**하고 owner에게 문제를 알린다. 명시적 older backup 사용은
  owner가 경로를 직접 선택해야 한다.

### LPA-BR-D07 — Scheduling

- Shotgun 내부 persistent scheduler를 만들지 않는다. OS scheduler 등록/
  수정 helper도 이번 WP에서는 만들지 않는다. **(후보 C 선택)**
- 정기 backup은 owner-ready `npm run backup:create` 명령을 OS scheduler가
  호출하는 방식으로 한다.
- 문서에 최소:
  - Windows: Task Scheduler / `schtasks` 설정 예
  - macOS: launchd 또는 동등한 system scheduler 설정 예
  - Linux: cron/systemd timer 중 최소 한 경로
- Shotgun process가 꺼져 있어도 DB/PostgreSQL과 repository/runtime
  prerequisites가 존재하면 backup command가 독립 실행 가능해야 한다.
- 자동 OS task 생성/삭제는 하지 않는다.
- `backup:scheduled`라는 중복 wrapper도 만들지 않는다 — owner-ready
  `backup:create` 자체를 scheduler command로 재사용한다.

### LPA-BR-D08 — Retention

- LPA-WP5에서는 **자동 Retention을 구현하지 않는다**.
- 금지: keep-last-N 자동 삭제 / age-based 자동 삭제 / scheduled cleanup /
  backup 생성 직후 자동 pruning.
- 이유: backup 삭제는 owner data destruction이며 LPA-BR-AC-09에 반한다.
- 이번 WP에서는 `backup:list`에 backup count / total storage usage /
  scheduled backup은 계속 disk를 사용한다는 warning을 제공한다.
- 자동 retention/cleanup은 FUTURE / 별도 safety contract로 남긴다.
- 새 `backup:prune` 명령도 이번 WP에서는 만들지 않는다.

### LPA-BR-D09 — Backup While Shotgun Runs

- Shotgun이 실행 중이어도 backup을 **허용**한다. Owner에게 사전 종료를
  요구하지 않는다.
- 기존 core의 authoritative digest before → dump/assets → digest after →
  fail closed semantics를 그대로 신뢰한다.
- 동시 Product write로 consistency가 바뀌면 `BACKUP_CONSISTENCY_CHANGED`로
  실패한다.
- Owner action: 다시 시도 / 반복되면 Shotgun을 정상 종료하고 backup 재시도.
- 자동 Product stop / stop-the-world lock은 만들지 않는다.

### LPA-BR-D10 — Guided Safe Restore

- 새 owner-facing command: `npm run backup:restore-safe`.
- 입력: `--backup <directory>` 또는 `--latest`, 필요 시 `--root <directory>`.
- 순서: select backup → full verify → safe target prepare → restore →
  authoritative/asset verification → canonical recovery/Product recovery
  verification → success summary.
- ADR-097 safety boundary를 그대로 유지한다.
- **Default Target**: explicit `RESTORE_DATABASE_URL` /
  `RESTORE_ASSET_STORAGE_ROOT`가 제공되면 기존 safety validation을 거쳐
  사용 가능. 제공되지 않으면 기존 isolated restore primitives를 REUSE해 새
  sibling/isolated target DB를 생성한다. Default restored asset area는
  owner가 찾을 수 있는 별도 restore workspace — 예:
  `<USER_HOME>/Shotgun Restores/<backup-id-or-timestamp>/assets`. Target
  DB/Asset Root는 source와 절대로 같지 않아야 한다.
- **Failure cleanup**: wrapper가 이번 시도에서 새로 만든 target만
  cleanup할 수 있다. existing owner-supplied target을 임의 삭제하지 않는다.
- **Success**: 성공한 restored target은 자동 삭제하지 않는다. Owner가
  inspection/recovery에 사용할 수 있도록 보존하고 다음을 출력한다:
  restored database identity / URL-safe description / asset root / backupId /
  verification result / recovery result / 어떻게 restored Shotgun을 확인할지.

### LPA-BR-D11 — No Automatic Cutover

- `backup:restore-safe`는 다음을 **하지 않는다**: `.env` 자동 수정 / active
  database rename·drop / source database 삭제 / source asset root 삭제 /
  restored target을 active source로 자동 교체.
- Restore와 cutover는 분리한다.
- LPA-WP5의 완료 조건은 **restored target is safe + verified + recoverable**
  까지다. active environment cutover는 owner 명시 행동/문서 단계로 유지.

### LPA-BR-D12 — Product Recovery Verification

- Restore 성공은 `pg_restore` 성공만으로 판단하지 않는다.
- 기존 Stage 12.1 recovery authority를 REUSE해서 최소:
  - authoritative integrity matches manifest
  - Original Asset integrity
  - projection authority remains Canonical
  - startup/recovery path succeeds
  - restored Product state가 읽을 수 있는 상태
- 를 확인한다.
- Stage12 restore drill 전체를 매 restore마다 복제하지 않는다. Fixture
  생성도 하지 않는다. 실제 restored target의 기존 data를 대상으로 bounded
  recovery verification만 수행한다.

### LPA-BR-D13 — Failure Taxonomy (13종 FREEZE)

각 owner-facing failure는 LPA-WP4 LaunchFailure 형식과 정합한다. 최소:
category / 무엇이 실패했나 / 무엇을 확인할지 / 다음 corrective action·
command. Expected owner failure에서 raw stack trace만 보여주는 것은
허용하지 않는다.

1. `BACKUP_OUTPUT_NOT_EMPTY`
2. `DATABASE_UNAVAILABLE`
3. `POSTGRES_TOOL_UNAVAILABLE`
4. `POSTGRES_VERSION_MISMATCH`
5. `ASSET_MISSING_OR_CORRUPT`
6. `BACKUP_CONSISTENCY_CHANGED`
7. `BACKUP_NOT_FOUND`
8. `BACKUP_INTEGRITY_INVALID`
9. `BACKUP_STORAGE_UNAVAILABLE` — disk-full / permission / path creation
   failure 같은 storage write failure 포함
10. `RESTORE_TARGET_UNSAFE`
11. `RESTORE_TARGET_PREPARATION_FAILED`
12. `RESTORE_FAILED`
13. `RESTORE_VERIFICATION_FAILED`

### LPA-BR-D14 — Sensitive Data Warning

- 기존 `secretsIncluded: false` 계약을 유지한다.
- 그러나 backup bundle에는 private Canonical/Asset data가 들어 있으므로
  create/list/restore documentation에서 다음을 명시한다: backup은 민감
  데이터다 / 공개 공유 금지 / 외장 disk 접근권한 고려 / cloud-sync folder를
  사용할 경우 해당 provider의 privacy/security를 owner가 책임지고 확인 /
  same-disk backup은 disk-loss protection이 아니다.
- 새 encryption/key-management system은 이번 WP scope 밖이다.

### LPA-BR-D15 — Architecture

- **NEW ADR: NOT_REQUIRED**. 기존 ADR-097을 그대로 authority로 사용한다.
- 이번 결정은 owner CLI orchestration / defaults / discovery / guided
  restore composition / documentation 수준의 extension이다.
- Architecture Amendment도 현재는 **NOT_REQUIRED**.
- 다음이 실제 구현상 필요해지면 STOP 후 Amendment 후보 제출: in-place
  restore / active DB cutover automation / persistent scheduler service /
  automatic retention·deletion / new backup storage abstraction /
  encryption·key management / PITR·WAL.

### LPA-BR-D16 — OSS

- **NO_NEW_OSS**. 기존 PostgreSQL `pg_dump`/`pg_restore` ADOPT를
  재사용한다.
- pgBackRest / WAL-G / Barman은 계속 DEFER.
- Node built-ins, existing `pg`, existing Shotgun primitives로 구현한다.

## 3. Frozen Acceptance Criteria (LPA-BR-AC-01 ~ LPA-BR-AC-10)

| #            | 기준                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LPA-BR-AC-01 | Simple Backup — `npm run backup:create` 하나로 explicit `--output` 없이 verified backup 생성 가능.                                                       |
| LPA-BR-AC-02 | Verified Backup — 생성 직후 full integrity verification을 자동 수행하고 owner가 성공/실패를 즉시 앎.                                                     |
| LPA-BR-AC-03 | Discoverable Backup — `backup:list`·`--root`·`--latest`로 backup과 metadata를 찾을 수 있음. Latest 선택은 corrupted newer backup을 조용히 건너뛰지 않음. |
| LPA-BR-AC-04 | Scheduled Backup — owner가 OS scheduler에 canonical `npm run backup:create` 명령을 등록할 수 있는 정확한 절차 제공. Shotgun 내부 scheduler 불필요.       |
| LPA-BR-AC-05 | Safe Restore — `backup:restore-safe`가 active source를 파괴하거나 덮어쓰지 않고 isolated/new target에만 restore.                                         |
| LPA-BR-AC-06 | Restore Verification — Restore 후 authoritative data, assets, Canonical-based recovery와 Product readability 확인.                                       |
| LPA-BR-AC-07 | Actionable Failure — Frozen failure taxonomy가 owner-actionable message로 제공.                                                                          |
| LPA-BR-AC-08 | Secrets Excluded — Backup Bundle v1의 secrets-excluded 계약 유지 + private-data warning 제공.                                                            |
| LPA-BR-AC-09 | No Silent Destruction — LPA-WP5는 자동 backup deletion, retention pruning, source overwrite, active cutover를 수행하지 않음.                             |
| LPA-BR-AC-10 | Existing Core Reused — Stage 12.1 Backup Bundle v1 / Clean Restore architecture를 복제·교체하지 않음.                                                    |

## 4. Expected Implementation Scope

Implementation candidate 범위를 다음으로 제한한다.

- root `package.json`
- owner-facing backup workflow script (예: `scripts/backup-owner.ts`)
- 필요 시 deterministic/testable helper (예: `scripts/backup-owner-core.ts`)
- `scripts/backup-restore.ts` — reusable manifest/discovery primitive export
  정도의 최소 변경만 허용. Backup Bundle format/restore semantics 변경 금지.
- README owner Backup/Restore section
- `docs/engineering/stage-12-1-backup-restore-runbook.md` 보강
- focused LPA-WP5 tests
- implementation verification evidence

Product Domain module 변경은 기본 scope 밖. DB migration 없음. Dependency
추가 없음.

## 5. Focused Verification Contract

Implementation 단계에서 새 owner workflow delta만 검증한다.

- **Backup**: no-arg default root / collision-safe path / explicit `--output`
  compatibility / `--root` / auto verify / summary / concurrent-write
  consistency failure mapping / storage failure mapping.
- **Discovery**: list ordering / metadata / `--root` / latest selection /
  corrupted newest backup을 silent skip하지 않음.
- **Scheduling**: OS task를 실제 생성하지 않는다. schedule documentation/
  command suitability만 검증한다.
- **Guided Restore**: backup verify가 target preparation보다 먼저 /
  source=target 금지 유지 / auto isolated target / explicit safe target /
  successful restore verification / recovery verification / failed
  auto-created target cleanup / owner-supplied target은 임의 삭제하지 않음 /
  successful target 유지 / no automatic cutover.
- **Failure taxonomy**: 13개 category를 deterministic focused tests로
  검증. 모든 category에 actionable fields가 존재해야 한다.
- **Existing core**: 기존 Stage12 `backup:drill`을 습관적으로 재실행하지
  않는다. Core semantic 변경이 없으면 기존 drill을 다시 실행하지 않는다.
  Implementation에서 실제 core semantic delta가 불가피해지면 STOP하고
  GPT에 보고한다.
- **CI**: 새 exact-head의 normal automatic CI만 authority로 사용한다.
  금지: 기존 CI 재실행 / manual duplicate CI / empty commit / CI 번호 기록용
  commit / metadata chase.

## 6. Excluded

- automatic retention/pruning
- cloud backup integration
- encryption/key-management
- object storage
- WAL/PITR
- pgBackRest/WAL-G/Barman 도입
- in-place restore
- automatic active cutover
- source DB/Asset deletion
- desktop installer/service
- Product Domain 변경
- DB migration
- LPA-WP6
- Deployment/Production Verification

## 7. A1 Contract Freeze Deliverable (A1 완료 보고)

- exact head
- A0 status / subject_base normalization 결과
- Frozen IR path
- LPA-BR-D01 ~ LPA-BR-D16
- LPA-BR-AC-01 ~ LPA-BR-AC-10
- default backup root decision (`<USER_HOME>/Shotgun Backups`)
- scheduling decision (후보 C — OS scheduler가 `npm run backup:create` 호출)
- retention decision (자동 retention 없음 + list에 count/size/warning)
- running-backup decision (허용 — 기존 fail-closed consistency 신뢰)
- guided restore / cutover boundary (isolated target만, cutover 없음)
- failure taxonomy 13종
- ADR/Amendment decision (NEW ADR NOT_REQUIRED)
- OSS decision (NO_NEW_OSS)
- expected implementation scope
- focused verification contract
- excluded scope
- unresolved items — 목표 **NONE**
- Product implementation이 아직 시작되지 않았음
- docs validation 결과

GPT가 이 Frozen IR을 ACCEPTED하기 전에는 Product implementation을
시작하지 않는다. LPA-WP6 Final Local Acceptance와 Deployment/Production
Verification은 계속 시작하지 않는다.

## 8. A1 Acceptance Record (append-only)

- **2026-08-11 — GPT ACCEPTED / FROZEN** (page: Make Shotgun)
  - A1 head: `6a4b8a60c88ec609de48bb148cb309e39dc1a85c`
  - A1 verdict: LPA-WP5 Contract Freeze 승인 — LPA-BR-D01~~D16,
    LPA-BR-AC-01~~10을 구현 계약으로 동결.
  - default backup root: `<USER_HOME>/Shotgun Backups` (`.data/backups` 아님).
  - scheduling: 후보 C — OS scheduler가 `npm run backup:create` 호출.
  - retention: 자동 retention 없음. running backup 허용 (기존 fail-closed
    consistency 신뢰). guided restore는 isolated target만, cutover 없음.
  - failure taxonomy 13종 / NEW ADR NOT_REQUIRED / NO_NEW_OSS.
  - 다음 게이트: LPA-WP5 A2 Product Implementation AUTHORIZED.
  - 이 record는 첫 substantive A2 commit에 포함되어 status를
    `FROZEN / ACCEPTED`로 정규화한다. A2 구현은 AUTHORIZED 상태이며,
    LPA-WP6 Final Local Acceptance와 Deployment/Production Verification은
    계속 시작하지 않는다.
