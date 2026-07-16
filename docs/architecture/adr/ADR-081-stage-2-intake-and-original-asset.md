# ADR-081 — Stage 2 Intake and Original Asset

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 기준:
  [Shotgun Implementation Roadmap](../../implementation/implementation-roadmap.md),
  [ADR-077 Common Contracts and Connector Runtime](../module-architecture/adr/ADR-077-common-contracts-and-connector-runtime.md)

## 배경

Transformation과 Evidence를 시작하기 전에 사용자가 제공한 원본을 변경 없이 보존하고,
어떤 Source의 어느 Version인지 고정할 수 있어야 한다. 실제 파일 경로가 상위 Module이나
API에 노출되면 접근 제어와 저장소 교체가 어려워지므로 원본 접근 경계도 Stage 2에서 함께
고정해야 한다.

## 결정

- 초기 입력은 직접 텍스트, UTF-8 `.txt`, Plain Text로 취급하는 UTF-8 `.md`로 제한한다.
- 최대 원본 크기는 1 MiB다. 대용량·복합 형식은 후속 Format Stage에서 다룬다.
- Intake Module은 모든 입력을 `IntakeSubmission`으로 정규화하고 `IntakeAccepted` Event를
  발행한다.
- Original Asset Module만 Source, SourceVersion, OriginalAsset, StorageReceipt를 소유한다.
- 원본 Byte는 SHA-256 Content Address를 사용하는 Local Asset Storage에 저장한다.
- PostgreSQL에는 실제 Byte나 외부 파일 경로 대신 Hash, 크기, 내부 Storage Key와
  Version Metadata를 저장한다.
- 실제 Storage Key는 공개하지 않는다. 외부에는
  `asset://{assetId}/versions/{sourceVersionId}` Asset Reference만 제공한다.
- Resolver는 Project, Access Scope, Asset Reference 전체 일치, 저장 Byte의 Hash와 크기를
  모두 검증한 뒤 원본을 반환한다.
- Intake와 Original Asset Module은 PostgreSQL이나 파일 시스템을 직접 호출하지 않고 Port를
  사용한다.

## 중복과 Version 정책

| 입력 상황                        | 처리                                           |
| -------------------------------- | ---------------------------------------------- |
| 같은 `submissionId`와 같은 입력  | 기존 Submission과 SourceVersion 반환           |
| 같은 `submissionId`에 다른 입력  | `CONFLICT`로 거부                              |
| `sourceId` 없이 같은 Byte 재입력 | 새 Source·Version 1, 기존 OriginalAsset 재사용 |
| 같은 Source에 같은 Byte 재입력   | 기존 SourceVersion 재사용                      |
| 같은 Source에 다른 Byte 입력     | 다음 Version 생성                              |

PostgreSQL에서는 Submission별 Advisory Lock과 Source Row Lock을 사용해 동시 요청에서도
Version Number가 중복되지 않도록 한다.

## 결과

- Stage 3 Transformation은 실제 파일 경로가 아니라 SourceVersion 기반 Asset Reference를
  입력으로 사용할 수 있다.
- 같은 Byte는 한 번만 저장하면서 Source와 Version 의미는 분리된다.
- 저장 실패가 Retry되더라도 Content-addressed Write와 DB Unique Constraint로 중복 Version이
  생기지 않는다.
- Trace와 Audit에는 Payload를 기록하지 않고 메시지와 실행 결과만 남긴다.

## 제한

- 인증 자체는 Stage 2 범위가 아니다. HTTP Header의 Security Context는 향후 Auth Adapter가
  검증해 주입한다는 경계다.
- URL, PDF, Office 문서, 이미지, 오디오, 영상은 지원하지 않는다.
- Local Asset Storage의 미참조 파일 정리와 외부 Object Storage Adapter는 후속 운영 Stage에서
  추가한다.
- Audit, Job, Dead-letter는 아직 In-memory이므로 프로세스 재시작 내구성은 후속 Stage 범위다.

## Rollback

운영 데이터가 없는 현재 단계에서는 애플리케이션을 Stage 1 커밋으로 되돌리고
`intake`·`asset` Schema와 `.data/assets` 개발 저장소를 제거할 수 있다. 실제 데이터가 생성된
환경에서는 먼저 Asset 파일과 PostgreSQL Metadata를 함께 백업하고, SourceVersion 참조가
없는지 확인하기 전에는 Schema나 원본 파일을 삭제하지 않는다.

## OSS-first Addendum

- ddsyasas Source Intake UX는 `REFERENCE_ONLY`, 결합된 backend는 보안과 구조 이유로
  `REJECT`한다.
- lucas watcher/reconcile은 directory intake가 생길 때까지 `DEFER`하며, file path와
  Shotgun Source identity를 분리한다.
- fsspec은 TypeScript MVP의 작은 Storage Port에 Python runtime을 추가하므로 `REJECT`한다.
- MinIO/S3-compatible storage와 Apache Tika는 remote storage와 format expansion 시점까지
  `DEFER`한다.
- In-memory와 Local filesystem Storage는 동일 `AssetStoragePort` Contract Test를
  통과해야 한다.

세부 결정은 [ADR-082](./ADR-082-stage-0-to-2-oss-first-retrospective.md)를 따른다.
