---
id: BACKUP-RESTORE-OWNER-WORKFLOW-GAP-AUDIT-260811001
classification: CANONICAL
status: A0_CANDIDATE (GPT review pending)
status_authority: PENDING_GPT_A0_REVIEW
verification_gate: BACKUP-RESTORE-OWNER-WORKFLOW
created_at: 2026-08-11
subject_base: a471b2e5b747ff72056ac32d514166b5c9436dbd
canonical_main: a471b2e5b747ff72056ac32d514166b5c9436dbd
governing_stage: LPA-WP5 (Backup / Restore Owner Workflow) — A0 Gap Audit / Contract Preparation
preceding_gates: LPA-WP4 COMPLETE / FINAL_AFTER_MERGE (PR #85/#86 MERGED, post-merge CI #762/#764 SUCCESS)
post_closure_main_ci: 764 / run 31401072454 / SUCCESS
gpt_a0_instruction: LPA-WP5 A0 authorized 2026-08-10 — docs/audit only, Product implementation 금지
next_gate: LPA-WP5 Contract Freeze / Implementation Request (GPT review)
---

# Shotgun — Backup / Restore Owner Workflow Gap Audit (LPA-WP5 A0)

## 1. Goal

Shotgun은 현재 `TECHNICALLY_RECOVERABLE` 상태이다. Stage 12.1의 Backup
Bundle v1과 Clean Restore engine은 검증되어 존재한다. A0의 목표는 이 기술을
**재구현하지 않고** `OWNER_OPERABLE_BACKUP_RESTORE` 상태로 전환하기 위해
실제로 부족한 owner workflow를 확정하는 것이다.

최종 목표는 Shotgun 소유자가 PostgreSQL 내부 구조나 개발용 restore drill을
이해하지 않아도 다음이 가능한 것이다:

- 안전하게 백업 생성
- 백업이 정상인지 확인
- 정기 백업 설정
- 장애 시 어떤 백업을 선택해 어떤 절차로 복구할지 이해

이번 A0는 **docs / audit 단계**이다. Product code 변경, DB migration,
dependency 추가, scheduler 구현, backup format / restore logic 변경을
수행하지 않는다.

## 2. FACT — 현재 main에 존재하는 Backup/Restore capability

### 2.1 명령 (root `package.json`)

| 명령                     | 진입점                               |
| ------------------------ | ------------------------------------ |
| `npm run backup:create`  | `scripts/backup-restore.ts backup`   |
| `npm run backup:verify`  | `scripts/backup-restore.ts verify`   |
| `npm run backup:restore` | `scripts/backup-restore.ts restore`  |
| `npm run backup:drill`   | `scripts/stage12-1-restore-drill.ts` |

### 2.2 구현 사실

- `scripts/backup-restore.ts` (646 lines): `createBackup` / `verifyBackup` /
  `restoreBackup` / CLI `main`.
- `scripts/stage12-1-restore-drill.ts` (401 lines): 격리 복구 훈련 —
  `createIsolatedRestoreDatabase` + fixture → `createBackup` →
  `restoreBackup` → projection rebuild → 정리.
- Backup Bundle v1 (`shotgun-backup-v1`):
  - `database.dump` — PostgreSQL 16 custom-format logical dump
    (`pg_dump --format=custom --no-owner --no-privileges
--serializable-deferrable`)
  - `assets/` — DB가 참조한 Original Asset bytes (content hash·size 검증)
  - `contracts/` — Contract Schema + Module Manifest snapshot (sha256)
  - `manifest.json` — formatVersion, backupId, createdAt, migration 목록,
    dump sha256, Asset/Contract digest, 권위 Table row count + deterministic
    digest, `configuration.secretsIncluded: false`,
    `projectionAuthority: rebuild-from-canonical`
- **Consistency (fail closed)**: 권위 Table digest를 dump 전/후와 Asset 복사
  후 세 번 snapshot — 변경이 감지되면 생성 실패. `manifest.json`은 모든
  복사가 끝난 뒤 마지막에 기록.
- **Verify**: dump sha256 / Asset digest / Contract digest 불일치 시 실패.
- **Restore 안전 경계**: source=target DB 동일 거부, PG major 16 확인,
  target DB가 빈 DB인지 확인, target Asset Root가 비어 있는지 확인,
  `pg_restore --exit-on-error --no-owner --no-privileges`, 복원 후 권위
  digest == manifest 비교, projection 4종 TRUNCATE + ANALYZE.
- **Secrets**: `.env`, DB password, API key, Session·Token 원문, Provider
  Secret은 Bundle에 포함되지 않음 (`secretsIncluded: false`).
- **CLI 인자 / 환경**:
  - backup: `--output <directory>` 필수 + `DATABASE_URL`,
    `ASSET_STORAGE_ROOT`, `SHOTGUN_PG_TOOL_MODE`
  - verify: `--backup <directory>` 필수
  - restore: `--backup <directory>` 필수 + `DATABASE_URL`(원본),
    `RESTORE_DATABASE_URL`, `RESTORE_ASSET_STORAGE_ROOT`
- `.env.example`: `ASSET_STORAGE_ROOT=.data/assets`,
  `SHOTGUN_PG_TOOL_MODE=docker-compose`, `RESTORE_*`는 주석.
- `.gitignore`: `.data/` 포함.

### 2.3 존재하지 않는 것 (FACT)

- 기본 backup 출력 디렉토리/기본값 없음 (`--output` 필수)
- backup 생성 후 자동 verify 없음
- backup 목록 / discovery / 사람이 읽을 수 있는 metadata 표시 없음
- 정기 backup(scheduling) 기능 없음
- Retention / cleanup 명령 없음
- owner-facing failure taxonomy 없음 (generic `Error` throw)
- restore target 자동 준비 / guided restore flow 없음
- restore 후 Product launch / 전환 / rollback 안내 명령 없음

## 3. REUSED AUTHORITY — 그대로 재사용하는 계약

- **ADR-097** (`docs/architecture/adr/ADR-097-stage-12-1-outbox-projection-clean-restore.md`):
  안전 계약 유지 — logical dump / 참조 Asset backup / Contract snapshot /
  deterministic integrity manifest / secrets excluded / source=target DB
  restore 금지 / non-empty target DB·Asset Root restore 금지 / Projection은
  Canonical에서 rebuild / in-place destructive restore 금지.
- `createBackup` / `verifyBackup` / `restoreBackup` (scripts/backup-restore.ts)
- `createIsolatedRestoreDatabase` / `dropIsolatedRestoreDatabase` /
  `temporaryRestoreAssetRoot` — 격리 restore target 준비 primitives
- `scripts/stage12-1-restore-drill.ts` — clean Backup→Restore engine 검증
  authority (A0에서 재실행하지 않음)
- `docs/engineering/stage-12-1-backup-restore-runbook.md` — 운영 절차 문서
- OSS: PostgreSQL `pg_dump`/`pg_restore` ADOPT, pgBackRest / WAL-G / Barman
  DEFER (ADR-097). LPA-WP5는 Local Personal Application owner workflow이므로
  cloud/remote DR stack 신규 도입 없음.

## 4. OWNER GAP — 실제 owner에게 부족한 usability/safety

### 4.1 Backup Create

- owner가 알아야 하는 것: output directory, `DATABASE_URL`,
  `ASSET_STORAGE_ROOT`, `SHOTGUN_PG_TOOL_MODE`, local `pg_dump` 또는 Docker
  의존성, "output directory는 비어 있어야 함" 조건.
- 기본값 없음 → "어디에 백업을 두어야 하는가"가 첫 장벽.
- 생성 후 자동 verify 없음 → owner가 별도로 `backup:verify --backup ...`를
  기억하고 정확한 경로를 입력해야 함.
- 실패 메시지는 raw `Error` (예: "Backup output directory must be empty",
  "Authoritative data changed while the backup was being created.") — 내용은
  기술적으로 정확하나 category/확인 방법/다음 실행 명령이 분리되어 있지 않음.

### 4.2 Backup Verify

- `npm run backup:verify -- --backup <directory>` 정확한 경로 필요.
- 최근 backup 발견, backup 목록, metadata(backupId·createdAt·크기·table
  수) 표시가 없음.
- 손상 backup을 목록에서 쉽게 구별할 방법 없음.

### 4.3 Restore

- owner가 직접 준비: `RESTORE_DATABASE_URL`(별도 빈 DB),
  `RESTORE_ASSET_STORAGE_ROOT`(별도 빈 dir), tool mode.
- 안전성 측면에서 올바르지만(ADR-097), owner 관점에서 부족:
  - restore target 자동 준비(빈 DB 생성·빈 asset root) 안내 없음
  - backup 선택 helper 없음
  - preflight(verify + target 안전성) 후 복원하는 guided flow 없음
  - restore 후 integrity + Product startup/recovery 검증 절차가 명령으로
    제공되지 않음 (runbook에 있으나 owner가 직접 조합)
  - 복원된 환경으로 전환하는 방법 / 실패 시 원본으로 되돌리는 방법 안내 없음
- in-place restore로 바꾸지 않는다 (ADR-097 safety 유지).

### 4.4 Scheduling

- 정기 backup 기능 **없음** (FACT).

### 4.5 Retention

- **없음**. 정기 backup을 추가하면 무제한 disk growth 발생.

### 4.6 Sensitive data

- Bundle에 secrets가 없다는 계약은 유지. 그러나 backup directory 자체에
  private Canonical·Asset data가 있으므로 owner 경고가 필요: 공유 금지,
  public cloud folder 저장 위험, external disk의 physical access,
  삭제 시 recycle/trash semantics. 새 encryption system은 scope에 넣지
  않는다 (GAP으로 분류).

### 4.7 Failure UX

- generic `Error` 또는 `pg_dump`/`pg_restore` failure를 owner가 해석해야 함.

## 5. DECISION CANDIDATE — LPA-WP5에서 구현할 최소 owner workflow 후보

> 후보이며 아직 FREEZE하지 않는다. Contract Freeze에서 확정.

- **DC-1 Owner backup defaults**: backup root 기본값
  `.data/backups/<timestamp>/` (`.gitignore`에 `.data/` 존재 — working tree
  분리 + git-ignore 충족). `backup:create`가 `--output` 없이도 기본 위치에
  생성. 생성 후 자동 `verifyBackup` + 사람이 읽을 수 있는 요약
  (backupId, createdAt, 경로, DB·Asset·Contract 파일 수, table 수).
- **DC-2 Discovery**: `backup:list`(또는 `backup:ls`) — backup root 아래
  backup 나열 + manifest metadata 표시 + verify 상태 표시. 최신 backup
  shortcut(`--latest`) 지원.
- **DC-3 Scheduling**: 후보 비교는 §6 참조. 우선 후보는 **E**(단순
  scheduled-command wrapper: `backup:scheduled` = 기본 위치 생성 + 자동
  verify를 OS scheduler가 호출) 또는 **C**(등록 안내 문서). Shotgun 내부
  scheduler는 배제.
- **DC-4 Guided restore flow**: backup 선택 → verify(preflight) → 격리
  target 준비(`createIsolatedRestoreDatabase` + 빈 asset root) → restore →
  integrity → Product startup/recovery → owner에게 restored location·다음
  action·rollback 제시. ADR-097 safety 유지(원본 덮어쓰기 없음).
- **DC-5 Failure taxonomy**: §7 후보 11종을 실제 구현과 대조해 확정.
  launch(D12)와 동일한 "category / 무엇이 실패했나 / 무엇을 확인하나 /
  corrective command" 형식.
- **DC-6 Retention**: §8 판단. 최소 `keep-last-N` 또는 명시적 cleanup 명령
  (owner 승인 + warning) 또는 retention 없음 + 경고. 자동 삭제는 별도
  safety contract 필요 (LPA-BR-AC-09).
- **DC-7 Secrets warning**: create/restore 시 backup directory가 민감
  데이터임을 경고 + 공유 금지 안내. secrets excluded 계약은 유지.

## 6. Scheduling 후보 비교

| 후보                                                   | Windows owner usability | macOS/Linux portability | Process off 동작 | 실패 관찰 | 중복 backup 방지 | retention 충돌 | 새 long-running runtime |
| ------------------------------------------------------ | ----------------------- | ----------------------- | ---------------- | --------- | ---------------- | -------------- | ----------------------- |
| A. Shotgun 내부 scheduler                              | 보통(앱 필요)           | 보통                    | ❌ 안 됨         | 앱 로그   | 필요             | 필요           | ❌ 필요 (배제)          |
| B. OS scheduler 등록 helper                            | schtasks helper         | cron/launchd helper     | ✅               | OS 로그   | 생성측에서 관리  | 필요           | 없음                    |
| C. scheduled-command 생성 안내                         | 문서 안내 (수동 등록)   | 문서 안내               | ✅               | OS 로그   | 생성측에서 관리  | 필요           | 없음                    |
| D. launch/shutdown 시 자동                             | 앱 실행 시에만          | 앱 실행 시에만          | ❌ 안 됨         | 앱 로그   | 중복 위험        | 필요           | 없음                    |
| E. `backup:scheduled` wrapper + OS scheduler 등록 안내 | 명령 1개 + 문서         | 명령 1개 + 문서         | ✅               | OS 로그   | 생성측에서 관리  | 필요           | 없음                    |

- 기준: Windows owner usability, macOS/Linux portability, Shotgun process가
  꺼져 있어도 동작, 실패 관찰 가능성, 중복 backup 방지, retention과 충돌,
  새 long-running runtime 불필요.
- **권장 후보**: E 또는 C. Shotgun 내부 scheduler(A)와 launch/shutdown
  자동(D)은 "process off 동작"과 "새 long-running runtime" 기준에서
  배제한다. OS scheduler 등록 자체는 LPA-WP5에서 스크립트/문서 중 어느
  수준까지 할지는 Contract Freeze에서 결정.

## 7. Failure taxonomy 후보 (A0 candidate — freeze 아님)

실제 구현 FACT와 대조해 분류를 줄이거나 수정할 수 있다:

- `BACKUP_OUTPUT_NOT_EMPTY` — "Backup output directory must be empty"
- `DATABASE_UNAVAILABLE` — DB 연결 실패
- `POSTGRES_TOOL_UNAVAILABLE` — pg_dump/pg_restore spawn 실패 / Docker
  service 부재
- `POSTGRES_VERSION_MISMATCH` — PG major 16 불일치
- `ASSET_MISSING_OR_CORRUPT` — "Original Asset failed hash or size
  verification"
- `BACKUP_CONSISTENCY_CHANGED` — "Authoritative data changed while the
  backup was being created"
- `BACKUP_INTEGRITY_INVALID` — verifyBackup의 dump/Asset/Contract digest
  불일치
- `RESTORE_TARGET_UNSAFE` — source=target 동일 / non-empty target DB /
  non-empty target Asset Root
- `RESTORE_FAILED` — pg_restore 실패
- `RESTORE_VERIFICATION_FAILED` — "Restored authoritative data does not
  match the Backup Manifest" / restored asset 검증 실패
- `BACKUP_STORAGE_UNAVAILABLE` / `DISK_FULL` — 출력 저장 실패 (후보; 실제
  코드 매핑 필요)

## 8. Retention 판단 후보

- ADR-097에서 자동 Retention은 범위 밖이었다.
- LPA-WP5 목표에 "자동 backup/스케줄"이 포함되므로, scheduled backup을
  추가할 경우 무제한 disk growth가 반드시 발생한다.
- 후보: ① retention 없음 + 명확한 owner warning / ② keep-last-N / ③
  age-based cleanup / ④ explicit cleanup command / ⑤ LPA-WP5 범위 밖 유지.
- **원칙**: 자동 삭제는 owner data destruction이므로 근거 없이 도입하지
  않는다. Retention을 도입하려면 별도 safety contract + `LPA-BR-AC-09`
  (No Silent Destruction) 충족 필요. A0에서는 후보만 기록하고 Freeze에서
  결정.

## 9. Restore Safety Boundary (고정 전제)

- Restore가 현재 active Shotgun DB/Asset Root를 직접 덮어쓰게 만들지 않는다.
- Owner-friendly UX라는 이유로 ADR-097 safety boundary를 약화시키지 않는다.
- 가능한 owner restore workflow:
  backup 선택 → verify → isolated/new target 준비 → restore → integrity
  verification → Product startup/recovery verification → owner에게 restored
  location/next action 제시.
- 실제 cutover가 필요하면 별도 명시적 단계로 취급한다.

## 10. Backup Consistency Audit (FACT)

- dump 전/후와 Asset 복사 후 권위 Table digest 3회 비교 — 변경 시 fail
  closed. ✅ 이미 처리됨 (재구현하지 않음)
- `manifest.json`은 모든 복사 후 마지막에 기록. ✅
- Asset은 hash·size로 DB와 비교. ✅
- Contract snapshot은 파일 digest 포함. ✅
- **running Shotgun 상태에서 backup 가능한지**: 구현상 DB에 대한
  non-destructive logical dump이므로 가능하나, backup 중 Shotgun write가
  발생하면 digest 비교가 fail closed한다 (owner가 application을 종료할
  필요가 있는지는 Owner UX에서 안내 후보 — UNRESOLVED).
- **owner가 application을 종료해야 하는지**: runbook에는 명시 없음 —
  Freeze에서 결정할 항목.

## 11. Secrets / Sensitive Data

- Backup Bundle에 secrets 미포함 계약 유지 (`secretsIncluded: false`). ✅
- backup directory 자체가 민감 데이터 — create/restore 시 경고 후보
  (공유 금지, public cloud folder 위험, external disk physical access,
  삭제 시 recycle/trash semantics).
- 새 encryption system은 scope에 자동 포함하지 않는다. 필요성만 GAP /
  FUTURE / REQUIRED 중 분류 — A0에서는 GAP으로 기록.

## 12. Existing Verification Reuse

- `backup:drill`은 clean Backup→Restore engine 검증 authority. **A0에서
  재실행하지 않는다.**
- Stage 12.1 drill이 이미 검증하는 것(engine round-trip, fail-closed,
  projection rebuild)과 LPA-WP5에서 새로 검증해야 할 것(owner workflow
  delta: default output, auto-verify, list/discovery, guided restore,
  taxonomy, scheduling wrapper)을 분리한다.
- 새 LPA-WP5 tests는 아직 작성하지 않는다.

## 13. ADR / Architecture Amendment 후보

- 기본 판정: **NEW ADR NOT_REQUIRED** (기존 ADR-097이 core authority).
- 다음이 필요해지면 A0에서 Architecture Amendment 후보로 명시 (임의 구현
  금지):
  1. active DB를 직접 교체하는 새로운 restore model
  2. persistent scheduler service
  3. 새로운 backup storage abstraction
  4. encryption / key-management architecture
  5. retention / destructive automation
  6. PITR / WAL architecture
- 이번 A0 후보(DC-1~DC-7)는 위에 해당하지 않는 bounded owner workflow
  확장으로 판단.

## 14. OSS Decision

- 기존 ADR-097 결정 재사용: `pg_dump`/`pg_restore` ADOPT, pgBackRest /
  WAL-G / Barman DEFER.
- LPA-WP5는 Local Personal Application owner workflow — cloud/remote DR
  stack 신규 도입 없음.
- 스케줄 구현에 새 dependency가 필요하다고 판단할 경우만 별도 후보 평가.
  Node/OS built-in으로 충분하면 `NO_NEW_OSS` 우선.

## 15. Acceptance Criteria 후보 (LPA-BR-AC-01 ~ LPA-BR-AC-10)

> 후보이며 아직 FREEZE하지 않는다. 실제 repository facts와 대조해 수정·
> 제안한다.

| #            | 기준                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| LPA-BR-AC-01 | Simple Backup — owner가 DB internals를 이해하지 않고 하나의 명확한 명령으로 backup 생성 가능.         |
| LPA-BR-AC-02 | Verified Backup — 생성된 backup이 integrity verification을 통과했는지 owner가 즉시 알 수 있음.        |
| LPA-BR-AC-03 | Discoverable Backup — owner가 사용 가능한 backup과 기본 metadata를 쉽게 확인 가능.                    |
| LPA-BR-AC-04 | Scheduled Backup — owner가 정기 backup workflow를 설정 가능.                                          |
| LPA-BR-AC-05 | Safe Restore — Restore는 active source를 파괴하지 않고 새 안전 target에 수행.                         |
| LPA-BR-AC-06 | Restore Verification — Restore 후 authoritative data/asset integrity와 Product recovery가 확인됨.     |
| LPA-BR-AC-07 | Actionable Failure — Backup/Restore 실패가 owner-actionable message로 제공됨.                         |
| LPA-BR-AC-08 | Secrets Excluded — Backup bundle에 secrets가 포함되지 않는 기존 계약 유지.                            |
| LPA-BR-AC-09 | No Silent Destruction — 자동 backup/restore/retention이 owner data를 조용히 삭제·덮어쓰지 않음.       |
| LPA-BR-AC-10 | Existing Core Reused — Stage 12.1 Backup Bundle v1 / Clean Restore architecture를 복제·교체하지 않음. |

## 16. IMPACT — 예상 변경 범위

- `scripts/backup-restore.ts` 또는 최소 owner wrapper module:
  - default backup root (`.data/backups/<ts>/`)
  - create 후 자동 verify + 요약 출력
  - `backup:list` / `--latest`
  - failure taxonomy 출력 형식
  - guided restore flow (격리 target 준비 + restore + verify + 안내)
  - `backup:scheduled` wrapper (스케줄 후보 확정 시)
- `package.json` scripts 확장
- `.env.example` (기본값·선택 옵션 문서화, RESTORE_* 유지)
- README owner Backup/Restore 섹션 + runbook 보강
- focused LPA-WP5 tests (Contract Freeze 확정 후)
- **Product Domain module / DB schema·migration 변경 없음** (예상)

## 17. REJECTED / EXCLUDED

- Cloud backup / remote DR (범위 밖)
- PITR / WAL archive (DEFER — pgBackRest/WAL-G/Barman 재평가 조건 유지)
- 새 encryption / key-management system (GAP으로만 기록)
- persistent scheduler service (Shotgun 내부 스케줄러)
- `pg_dump`/`pg_restore` 교체, backup format 변경, restore logic 변경
- in-place destructive restore
- backup 중 product write의 자동 정지(제한된 stop-the-world) — fail-closed
  유지로 대체
- LPA-WP6 Final Local Acceptance, Deployment/Production Verification

## 18. UNRESOLVED — Contract Freeze에서 결정할 항목

1. default backup root 확정 (`.data/backups/<ts>/` 후보 검증 — same-disk
   disaster protection 한계, external drive 경로 지원 여부)
2. scheduling 후보 확정 (E vs C; OS scheduler 등록 helper 수준 vs 문서
   안내 수준)
3. retention 수준 확정 (none+warning / keep-last-N / explicit cleanup /
   out of scope)
4. running Shotgun 상태 backup 허용 여부 + owner 종료 안내 필요 여부
5. guided restore flow 범위 (target 자동 준비 vs owner 제공 env) — cutover
   단계 포함 여부
6. failure taxonomy 최종 목록 + message 형식 (launch D12 형식 정합)
7. LPA-BR-AC-01~10 최종 확정
8. ADR/Amendment 필요 여부 최종 확인 (기본 NOT_REQUIRED)
9. 스케줄 구현에 새 OSS 필요 여부 (기본 NO_NEW_OSS)

## 19. A0 Completion Report 요약

- **audit exact head**: (커밋 후 확정)
- 현재 Backup/Restore topology: `scripts/backup-restore.ts` CLI
  (create/verify/restore) + `scripts/stage12-1-restore-drill.ts` + runbook +
  ADR-097
- 이미 충분한 core capability: Backup Bundle v1 (dump+asset+contract+
  integrity manifest), fail-closed consistency, verify, safe clean restore,
  secrets excluded, restore drill
- Owner GAP: 기본값·자동 verify·discovery·scheduling·retention·guided
  restore·failure taxonomy·민감 데이터 경고
- 재사용 계약: ADR-097 + createBackup/verifyBackup/restoreBackup +
  createIsolatedRestoreDatabase + drill + runbook
- 최소 owner workflow 후보: DC-1~DC-7
- scheduling 후보: A~E 비교, E/C 권장 (A·D 배제)
- default backup location 후보: `.data/backups/<ts>/`
- retention: 후보 5종 — Freeze에서 결정 (자동 삭제는 safety contract 필요)
- restore owner flow 후보: guided flow (select→verify→target→restore→
  verify→recovery→안내), cutover는 별도 단계
- failure taxonomy 후보: 11종
- Acceptance Criteria 후보: LPA-BR-AC-01~10
- ADR/Amendment: 기본 NEW ADR NOT_REQUIRED; amendment 후보 6종 기록
- OSS: pg_dump/pg_restore ADOPT 재사용, 신규 DEFER 유지, NO_NEW_OSS 우선
- 예상 implementation scope: §16
- excluded scope: §17
- unresolved items: §18 (9건)
- docs validation: (커밋 후 확정)
- **다음 단계**: LPA-WP5 Contract Freeze / Implementation Request 여부 —
  GPT 판정 대기

## 20. Verification Policy (A0)

- 금지: `backup:drill` 재실행, Stage 12.1 전체 test 재실행, LPA-WP4 test
  재실행, Cross-Phase test 재실행, 기존 CI 재실행, manual CI, Product code
  변경, DB migration, dependency 추가, scheduler 구현, backup format 변경,
  restore logic 변경.
- 필요한 작업: current main의 코드/문서 inspection과 docs validation으로
  제한.
- A0를 GPT가 ACCEPTED하기 전에는 LPA-WP5 Product implementation을 시작하지
  않는다. LPA-WP6 Final Local Acceptance와 Deployment/Production
  Verification은 시작하지 않는다.
