# Stage 3 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Plain Text Transformation and Evidence
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 3: COMPLETE**

보존된 UTF-8 텍스트를 안정적인 `DocumentIR`로 변환하고, 문서·문단·문장을
`SourceMap`과 `EvidenceSpan`으로 원본 `SourceVersion`에 고정했다. 원문 복원은 문자 위치,
인용문, SourceVersion, SHA-256을 함께 검증한다.

## OSS 결정

| 후보                                  | 결정      | 적용 범위                                                              |
| ------------------------------------- | --------- | ---------------------------------------------------------------------- |
| lucas Highlight·Annotation            | `AUGMENT` | 정확한 인용 위치, prefix/suffix 중복 해소, 모호한 짧은 인용 비추측     |
| lucas chunk offset tests              | `AUGMENT` | 분할 후 위치가 겹치지 않는 SourceMap 회귀 시험                         |
| lucas deterministic lint              | `AUGMENT` | 고정 오류 코드와 결정적 SourceMap 검증 패턴                            |
| lucas Watcher·Reconcile               | `DEFER`   | directory intake가 없으므로 Stage 3에서 제외                           |
| lucas Runtime·SQLite·VaultFS·MCP CRUD | `REJECT`  | Shotgun SourceVersion과 모듈 경계를 침범                               |
| W3C Web Annotation Selector           | `AUGMENT` | Text Position·Text Quote 의미를 사용하고 Shotgun hash·origin·unit 추가 |
| JSON Pointer RFC 6901                 | `ADOPT`   | DocumentIR 문서 root, 문단, 문장 위치                                  |

lucas 고정 commit은 `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, 라이선스는
Apache-2.0이다. 전체 Runtime을 포함하지 않고 `PlainTextTransformerPort`와
`EvidenceLocatorPort` 뒤에서 필요한 동작만 Shotgun TypeScript 코드로 재구현했다.

## 직접 구현 근거

lucas의 원본 구조는 Python, SQLite, VaultFS, 파일 경로 identity, filename citation에
결합되어 있다. 현재 Shotgun은 TypeScript 모듈 Runtime, Stable Source ID, immutable
SourceVersion, Asset Reference를 사용하므로 패키지 전체 추출은 경계를 깨뜨린다.

직접 구현 범위는 다음의 작은 계약에 한정했다.

- Plain text 문단·문장 범위 계산
- Unicode code-point 기반 start-inclusive/end-exclusive 위치
- Text Quote `exact`·`prefix`·`suffix`
- DocumentIR JSON Pointer
- SourceVersion·원문 hash·구간 hash 검증
- 변환 Attempt와 멱등 Revision

## 데이터 및 모듈 경계

```text
OriginalAssetStored
→ stage3.transformation
→ ResolveAsset Query
→ DocumentIR + SourceMap
→ DocumentTransformed
→ stage3.evidence
→ GetDocumentRevision Query
→ EvidenceSpan
```

- `stage3.transformation`은 `transformation.attempts`, `transformation.revisions`를 소유한다.
- `stage3.evidence`는 `evidence.spans`를 소유한다.
- 두 모듈은 서로의 DB를 읽지 않고 Query/Event 계약으로만 연결된다.
- Translation·Summary·Annotation origin은 원문 Evidence로 저장하지 않는다.

## Contract와 Golden 검증

| 검증                      | 결과                                         |
| ------------------------- | -------------------------------------------- |
| Plain Text Golden Fixture | Korean·emoji·CRLF·문단·문장·offset·hash PASS |
| Transport Contract        | In-memory·In-process PASS                    |
| SourceMap Round-trip      | 모든 source entry의 원문 복원 PASS           |
| 잘못된 Offset             | `VALIDATION_ERROR`                           |
| 잘못된 Hash               | `VALIDATION_ERROR`                           |
| 잘못된 SourceVersion      | `VALIDATION_ERROR`                           |
| Summary origin 분리       | Evidence 생성 제외 PASS                      |
| 모호한 짧은 인용          | 문맥 없이는 위치를 추측하지 않음             |
| Adapter Replacement       | 대체 Locator가 같은 Port 계약 통과           |
| 멱등 재실행               | Attempt 2, Revision 1, Evidence ID 유지      |
| PostgreSQL 재시작         | Revision·Evidence ID 유지 PASS               |
| Security                  | owner scope 없는 Query 거부                  |
| Architecture              | 모듈 직접 DB·상호 import 없음                |

## 교체와 Rollback

- 변환기는 `PlainTextTransformerPort`, 위치 탐색기는 `EvidenceLocatorPort`만 유지하면 교체할 수 있다.
- 교체 Adapter는 Golden, SourceMap round-trip, ambiguity, replacement contract를 모두 통과해야 한다.
- 새 Adapter 실패 시 현재 `shotgun.plain-text@1.0.0`으로 되돌리고 기존 Revision은 그대로 유지한다.
- 변환기 version이 바뀌면 기존 Revision을 덮어쓰지 않고 새로운 version key로 평가한다.

## 알려진 제한

- Markdown은 Stage 3에서 구조 해석 없이 plain text로 처리한다.
- 문장 분리는 `. ! ? 。！？”` 계열 구두점 뒤 공백을 사용하는 결정적 MVP 규칙이다.
- HTML, PDF, Office, 이미지 OCR은 Stage 8 Format Adapter 범위다.
- directory watcher와 reconcile은 계속 `DEFER`다.

## 다음 계약 Version 후보

- `DocumentIR.v2`: heading, list, table, code block
- `SourceMap.v2`: byte offset, page, table cell, image bounding box
- `EvidenceSpan.v2`: composite evidence와 외부 W3C Annotation serialization
