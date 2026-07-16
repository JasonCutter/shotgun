# Stage 2 — Intake and Original Asset

## 완료 상태

**COMPLETE**

Stage 2는 직접 텍스트와 간단한 UTF-8 텍스트 파일을 정규화하고, 원본 Byte를 변경 없이
저장한 뒤 Asset Reference를 통해서만 다시 읽는다.

```text
SubmitIntake
→ IntakeSubmission
→ IntakeAccepted
→ Source + SourceVersion + OriginalAsset
→ OriginalAssetStored
→ ResolveAsset
```

## 지원 범위

| 입력                  | 지원              |
| --------------------- | ----------------- |
| 직접 텍스트           | 지원              |
| UTF-8 `.txt`          | 지원              |
| UTF-8 `.md`           | Plain Text로 지원 |
| 최대 크기             | 1 MiB             |
| URL·PDF·Office·이미지 | 미지원            |
| 오디오·영상 직접 분석 | 미지원            |

Intake는 줄바꿈, 뒤 공백, Markdown 기호를 정리하거나 변환하지 않는다.

## 실행 방법

```powershell
Copy-Item .env.example .env
docker compose up -d --wait
npm ci
npm run db:reset
npm run check
npm run test:database
npm run dev
```

직접 텍스트 접수:

```powershell
$body = @{
  submissionId = 'demo-intake-1'
  input = @{
    kind = 'direct_text'
    text = "첫 줄 그대로`r`nSecond line  "
  }
} | ConvertTo-Json -Depth 5

$result = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/intake `
  -ContentType 'application/json; charset=utf-8' `
  -Body $body
```

원본 복원:

```powershell
$resolveBody = @{
  assetReference = $result.stored.assetReference
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/assets/resolve `
  -ContentType 'application/json' `
  -Body $resolveBody
```

응답에 실제 로컬 파일 경로는 포함되지 않는다.

## 구현 구조

```text
modules/
  intake/                  입력 정규화와 IntakeSubmission
  original-asset/          Source·Version·Asset·Resolver
adapters/
  stage2-in-memory/        빠른 Contract Test용 저장소
  asset-storage-local/     SHA-256 기반 불변 원본 Byte 저장
  postgres/                intake·asset Metadata 저장
db/migrations/
  002_stage2_intake_asset.sql
```

## Database 구조

```text
intake.submissions

asset.sources
  └─ asset.source_versions
       └─ asset.original_assets

asset.storage_receipts
  └─ Submission과 SourceVersion 연결
```

- `Source`: 사용자가 관리하는 논리적 원본
- `SourceVersion`: Source의 특정 시점 Version
- `OriginalAsset`: SHA-256으로 식별되는 실제 원본 Byte
- `StorageReceipt`: Intake Submission이 어떤 SourceVersion으로 저장됐는지 기록

같은 Byte라도 `sourceId`가 없으면 새 Source가 된다. 같은 Source에 다른 Byte를 넣으면 새
Version이 된다.

## 완료 기준과 증거

| 완료 기준                                   | 검증                                      |
| ------------------------------------------- | ----------------------------------------- |
| 모든 입력을 `IntakeSubmission`으로 정규화   | Intake Unit·Contract Test                 |
| 원본 Byte·입력 텍스트 변경 없이 보존        | Byte Preservation Contract Test·HTTP Test |
| 재입력과 새 Version 구분                    | SourceVersion Contract·PostgreSQL Test    |
| Asset Reference로만 원본 접근               | Resolver Contract·HTTP Test               |
| 권한 없는 Resolver 거부                     | Project·Scope Contract Test·HTTP 403      |
| 중복 Command가 Version을 중복 생성하지 않음 | 재시작 Contract·PostgreSQL Test           |
| Intake부터 저장까지 Audit·Trace 확인        | Audit·Trace Contract Test                 |
| 저장 실패 후 안전한 Retry                   | Reliability Integration Test              |
| 동시 Version Number 충돌 방지               | PostgreSQL 동시 실행 Test                 |
| 저장 Byte 변조 탐지                         | Hash Tamper Integration Test              |

## 보안과 불변성

- Resolver는 요청의 Project와 저장된 Source Project가 다르면 존재 여부를 노출하지 않고
  `NOT_FOUND`를 반환한다.
- 저장 당시 Access Scope가 현재 요청에 없으면 `POLICY_DENIED`를 반환한다.
- Asset Reference의 ID, Version, Hash, 크기, MIME, URI, Scope 중 하나라도 저장값과 다르면
  거부한다.
- Local Asset Storage는 같은 Hash 경로를 덮어쓰지 않고 기존 Byte의 Hash를 재검증한다.
- Trace와 Audit에는 원본 Payload와 실제 Storage Key를 기록하지 않는다.

## 알려진 제한

- HTTP Header Security Context는 아직 Auth Adapter가 검증하지 않는다.
- Audit·Job·Dead-letter는 In-memory다.
- DB 저장이 영구 실패한 뒤 남은 미참조 Content-addressed 파일을 자동 정리하지 않는다.
- Object Storage, Multipart Upload, 대용량 Streaming은 후속 Stage 범위다.
