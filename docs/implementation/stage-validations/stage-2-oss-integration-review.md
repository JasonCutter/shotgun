# Stage 2 OSS Integration Review

- 재검증일: 2026-07-16
- 대상: Intake and Original Asset
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 2: COMPLETE**

직접 텍스트와 UTF-8 `.txt`, `.md`의 원본 Byte 보존, Source와 Version 분리, 권한 있는
Asset Reference 해석은 완료됐다. 이번 재검증에서는 Intake UX, watcher, storage 후보를
검토하고 직접 구현의 이유와 교체 Contract를 추가했다.

## 후보별 결정

| 후보                        | 결정              | 적용 또는 제외                                             |
| --------------------------- | ----------------- | ---------------------------------------------------------- |
| ddsyasas Source Intake UX   | `REFERENCE_ONLY`  | Form과 Action hierarchy를 Web UI Stage에서 재구현          |
| ddsyasas backend            | `REJECT`          | SQLite, local path, ingest/query/LLM core와 강하게 결합    |
| lucas watcher/reconcile     | `DEFER`           | directory intake가 생길 때 Intake Port 뒤에서 사용 검토    |
| lucas path identity         | `REJECT`          | 파일 이동·이름 변경이 Source identity를 바꾸면 안 됨       |
| gbrain Page input/namespace | `REFERENCE_ONLY`  | namespace 개념 참고, Page ID를 Source ID로 사용하지 않음   |
| fsspec                      | `REJECT`          | TypeScript MVP에 Python bridge를 추가할 이유가 없음        |
| Local Asset Storage         | `NO_RELEVANT_OSS` | 두 메서드 Port와 SHA-256 검증만 필요한 작은 고유 구현      |
| MinIO/S3-compatible storage | `DEFER`           | remote, multipart, large asset 요구가 생길 때 Adapter 추가 |
| Apache Tika                 | `DEFER`           | 복합 문서 파싱은 Stage 8과 격리된 Format Adapter 범위      |

## ddsyasas 검증 반영

고정 commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`에서 MIT 라이선스,
195개 테스트 통과와 1개 외부 smoke skip을 확인한 기존 검증을 사용했다.

가져갈 내용:

- Source 추가 Form의 단계와 입력 묶음
- Home에서 다음 Action을 먼저 보여주는 정보 구조
- Loading, empty, error 상태의 표현 방식
- 모바일에서도 유지되는 입력 우선순위

가져오지 않을 내용:

- URL ingest backend
- SQLite와 파일 경로 기반 source of truth
- 임의 absolute path로 workspace를 만드는 API
- repository 전용 ingest, query, lint, LLM client

SSRF와 workspace path escape 위험이 확인되었으므로 backend 재사용은 금지한다.

## Storage 직접 구현 근거

현재 `AssetStoragePort`는 `put(contentHash, bytes)`와 `read(storageKey)` 두 동작만 가진다.
Stage 2의 파일 최대 크기는 1 MiB이며 remote object storage나 streaming 요구가 없다.

따라서 대형 Storage Framework를 넣는 것보다 다음 규칙을 작은 Adapter로 직접 보유하는
편이 단순하다.

- SHA-256과 실제 Byte 일치 확인
- hash별 한 번만 저장
- 임시 파일 작성 후 atomic rename
- 저장 root 밖으로 나가는 path 차단
- 기존 파일을 다시 읽어 hash 재검증

이 결정은 Storage 기술을 고정하지 않는다. 새로 추가한 공통 `AssetStoragePort` Contract
Test를 In-memory와 Local filesystem Adapter가 함께 통과해야 한다. 향후 S3 Adapter도 같은
테스트를 통과하면 Module 코드를 바꾸지 않고 교체할 수 있다.

## Contract와 Database 검증

- 두 Transport에서 원본 Byte와 line ending을 그대로 복원한다.
- 같은 Submission 재실행은 새 SourceVersion을 만들지 않는다.
- 같은 Byte와 같은 Source의 의미를 분리한다.
- Project와 Access Scope가 다르면 Resolver가 정보를 노출하지 않는다.
- 저장 실패 후 retry는 content-addressed write로 안전하다.
- PostgreSQL restart 후에도 Submission dedup을 유지한다.
- 같은 Source의 동시 입력은 version number를 직렬화한다.
- In-memory와 Local storage가 같은 Storage Contract를 통과한다.

## 교체와 Rollback

- `AssetStoragePort` 구현만 바꾸고 Module Contract와 Asset Reference는 유지한다.
- Object Storage 도입 시 기존 local blob을 content hash로 복사하고 read-back 검증 후
  metadata Adapter를 전환한다.
- 전환 실패 시 기존 Local Adapter로 rollback한다.
- watcher는 Source를 직접 생성하지 않고 `IntakeSubmission`을 호출해야 한다.
- file path, OSS row ID, gbrain Page ID를 Shotgun `sourceId`로 사용하지 않는다.

## Gate 체크

- [x] ddsyasas UX 적용/제외 범위 기록
- [x] ddsyasas backend 보안상 제외
- [x] lucas watcher/reconcile 결정
- [x] path와 OSS ID로부터 Source identity 분리
- [x] fsspec, object storage, Tika 결정
- [x] 직접 구현 Storage의 작은 범위와 이유 기록
- [x] Storage Adapter 공통 Contract Test
- [x] 교체와 rollback 방법 기록

## 최종 실행 증거

| 검사                          | 결과                            |
| ----------------------------- | ------------------------------- |
| Stage 2 Contract Test         | 두 Transport 포함, PASS         |
| AssetStoragePort Contract     | In-memory·Local, 6 tests passed |
| Stage 2 Reliability Test      | 5 tests passed                  |
| PostgreSQL restart dedup      | PASS                            |
| PostgreSQL concurrent version | PASS                            |
| Database Test                 | 2 tests passed                  |
| Database Bootstrap Verify     | PASS                            |
