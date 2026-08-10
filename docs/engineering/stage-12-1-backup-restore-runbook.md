# Stage 12.1 Backup and Clean Restore Runbook

이 Runbook은 PostgreSQL, Original Asset과 versioned Contract를 하나의 검증 가능한 Backup Bundle로 만들고 새 격리 대상에 복원하는 절차다. 기존 Database나 Asset Root에 대한 in-place restore는 지원하지 않는다.

## 1. 사전 조건

- PostgreSQL Server와 Client Utility의 major version이 16으로 일치해야 한다.
- `DATABASE_URL`은 Backup 원본을 가리킨다.
- `ASSET_STORAGE_ROOT`는 Database의 `asset.original_assets.storage_key`가 참조하는 content-addressed Asset Root다.
- Docker 개발 환경에서는 `SHOTGUN_PG_TOOL_MODE=docker-compose`, 로컬 Client Utility를 사용할 때는 `local`을 사용한다.
- Backup 출력 Directory는 비어 있어야 한다.
- Restore 대상 Database는 새 빈 Database이고 대상 Asset Root도 비어 있어야 한다.

비밀번호, API Key, Session·Token 원문과 Provider Secret은 Bundle에 포함하지 않는다. Bundle 자체에는 private Canonical·Asset 데이터가 있으므로 저장소 암호화, 접근 제어와 Retention 정책을 별도로 적용한다.

## 2. Backup 생성과 검증

```powershell
npm run backup:create -- --output C:\backup\shotgun-2026-07-21
npm run backup:verify -- --backup C:\backup\shotgun-2026-07-21
```

Bundle은 다음을 포함한다.

- `database.dump`: PostgreSQL custom-format logical dump
- `assets/`: Database가 참조한 Original Asset bytes
- `contracts/`: Contract Schema와 Module Manifest snapshot
- `manifest.json`: Migration 목록, 파일 hash, 권위 Table row count와 deterministic digest

Backup 생성 중 권위 Table digest가 바뀌거나 Asset hash·size가 Database와 다르면 생성은 실패한다. `manifest.json`은 모든 복사가 끝난 뒤 마지막에 기록된다.

## 3. Clean Restore

다음 환경을 명시한다.

```text
RESTORE_DATABASE_URL=postgres://.../new_empty_database
RESTORE_ASSET_STORAGE_ROOT=C:\restore\assets
```

그 다음 복원한다.

```powershell
npm run backup:restore -- --backup C:\backup\shotgun-2026-07-21
```

Restore는 다음 조건에서 fail closed한다.

- Source와 Target Database host·port·database가 같음
- Target Database에 application table이 이미 존재함
- Target Asset Root가 비어 있지 않음
- dump, Asset 또는 Contract digest 불일치
- 복원 후 권위 Table digest 불일치

복원 성공 후 Application 시작 시 Canonical Project를 탐색하고 Outbox를 drain한 다음 Search와 Compiled Truth readiness를 검사한다. 누락·stale·degraded Projection은 Canonical에서 Full Rebuild한다.

## 4. 격리 복구 훈련

```powershell
npm run backup:drill
```

훈련은 현재 `DATABASE_URL`의 Database를 수정하지 않는다. 같은 PostgreSQL Server에 이름이 제한된 임시 원본 DB와 임시 복구 DB를 생성하고 다음을 검증한다.

1. 모든 Migration 적용
2. Canonical·Outbox·Original Asset fixture 생성
3. Source Projection 정상화
4. Backup 생성과 Manifest 검증
5. 새 빈 DB와 Asset Root에 Restore
6. 복원된 Projection 삭제
7. Application startup recovery로 Search와 Compiled Truth 재생성
8. Canonical version·digest, Outbox 상태, 검색 결과와 Asset bytes 확인

성공·실패와 관계없이 `shotgun_restore_` namespace의 임시 DB와 해당 실행이 생성한 임시 Directory만 정리한다.

## 5. Rollback과 장애 대응

- Restore 대상 전환 전에는 기존 Runtime과 Database를 그대로 유지한다.
- 검증 실패 시 대상 Runtime을 공개하지 않고 새 Restore 대상을 폐기한다.
- 기존 Database에 `--clean` 또는 in-place restore를 수행하지 않는다.
- Application version rollback은 권위 Canonical·Asset 데이터를 삭제하지 않는다. 이전 version이 현재 Contract·Migration을 읽을 수 있는지는 별도 Compatibility Gate에서 확인한다.
- Outbox·Projection recovery 실패 Project는 `FAILED`로 보고하고 다른 Project 복구를 계속한다. 실패 Projection을 최신 Truth로 표시하지 않는다.

## 6. 현재 제한

- logical backup 주기 사이의 Point-in-time recovery는 제공하지 않는다.
- 외부 Object Storage, 자동 Retention, cross-region 복제와 암호화 Key 운영은 포함하지 않는다.
- 목표 RPO가 backup 주기보다 짧거나 목표 RTO가 clean restore 시간보다 짧으면 pgBackRest, WAL-G 또는 Barman을 재평가한다.

## 7. Owner Workflow (LPA-WP5)

### 7.1 정상 backup

PostgreSQL 내부 구조를 몰라도 하나의 명령으로 backup을 만들 수 있다. 기본
위치는 `<USER_HOME>/Shotgun Backups`이고, 생성 직후 자동 integrity 검증과
요약(`VERIFIED`, backupId, 경로, counts, size)이 출력된다.

```powershell
npm run backup:create
```

- 외장 드라이브: `npm run backup:create -- --root "E:\Shotgun Backups"`
- exact directory (legacy): `npm run backup:create -- --output "C:\specific\backup-directory"`

### 7.2 발견 / 검증

```powershell
npm run backup:list                  # backup 목록 + metadata
npm run backup:list -- --verify      # 각 backup을 실제 검증
npm run backup:verify -- --latest    # 가장 최근 backup 검증
npm run backup:verify -- --backup <directory>
```

- `--latest`는 최신 candidate가 손상/읽기 불가면 이전 backup으로 조용히
  넘어가지 않고 **실패**한다. 이전 backup을 쓰려면 경로를 직접 지정한다.
- `backup:list`는 기본적으로 manifest discovery만 수행하며 대형 bundle을
  매번 full hash 검증하지 않는다. `--verify`에서만 `verifyBackup()`을
  수행한다.

### 7.3 안전 복원 (guided restore-safe)

```powershell
npm run backup:restore-safe -- --latest
npm run backup:restore-safe -- --backup <directory>
```

동작 순서: backup 선택 → full verify → 안전 target 준비 → restore → 권위
data/asset 검증 → Canonical 기반 bounded recovery 검증 → 요약.

- explicit `RESTORE_DATABASE_URL` + `RESTORE_ASSET_STORAGE_ROOT`가 둘 다
  설정되어 있으면 그 target에 복원한다 (source와 같으면 거부).
- 설정이 없으면 새 isolated DB와
  `<USER_HOME>/Shotgun Restores/<timestamp>/assets`에 복원한다.
- **복원과 cutover는 분리**되어 있다. `restore-safe`는 `.env`를 바꾸지 않고
  source DB/Asset을 건드리지 않는다. 복원된 환경으로 전환하려면 owner가
  직접 `DATABASE_URL`/`ASSET_STORAGE_ROOT`를 복원된 target으로 바꾸고
  Shotgun을 실행한다.
- 성공한 restored target은 검토를 위해 보존된다. 실패 시 자동 생성된
  target만 정리되고 owner-supplied target은 삭제하지 않는다.

### 7.4 정기 backup (OS scheduler)

Shotgun 내부 scheduler를 만들지 않는다. OS scheduler가
`npm run backup:create`를 호출하도록 등록한다. 이 명령은 Shotgun 프로세스가
꺼져 있어도 DB와 runtime prerequisites만 있으면 독립 실행된다.

Windows (Task Scheduler / schtasks):

```bat
schtasks /Create /TN "Shotgun Backup" /SC DAILY /ST 02:00 ^
  /TR "cmd /c \"cd /d C:\path\to\shotgun && npm run backup:create\""
```

- 실행 계정의 HOME 경로와 npm 위치, `cmd /c`와 working directory
  (`cd /d`) 인용을 확인한다.

macOS (launchd plist):

```xml
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>-lc</string>
  <string>cd /path/to/shotgun && npm run backup:create</string>
</array>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
```

- WorkingDirectory와 npm executable path(예: `~/.nvm/.../bin`)를 명시한다.

Linux (cron):

```text
0 2 * * * cd /path/to/shotgun && npm run backup:create
```

- machine-specific path는 hard-code하지 말고 owner 환경에 맞춘다.
- systemd timer로도 동일하게 `npm run backup:create`를 실행할 수 있다.
- Shotgun은 OS scheduler task를 자동 생성/삭제하지 않는다.

### 7.5 Retention / 민감 데이터

- **자동 retention은 없다.** `backup:list`에 backup count와 total storage
  usage가 표시되고, 정기 backup은 계속 disk를 사용한다는 경고가 나온다.
  backup 삭제는 owner가 직접 수행한다 (LPA-WP5는 prune/cleanup 명령을
  제공하지 않는다).
- Backup Bundle에는 secret이 없지만(`secretsIncluded: false`) private
  Canonical·Asset 데이터가 있다. **공개 공유 금지**, 외장 disk 접근권한,
  cloud-sync folder 사용 시 provider privacy/security 확인이 필요하다.
- `<USER_HOME>/Shotgun Backups`가 source와 같은 physical disk면 hardware
  loss backup이 아니다. 별도 disk가 필요하면 `--root`로 외장 드라이브를
  지정한다.
