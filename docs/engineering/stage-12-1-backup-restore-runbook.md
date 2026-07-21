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
