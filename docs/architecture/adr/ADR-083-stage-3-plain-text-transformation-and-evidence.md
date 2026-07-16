# ADR-083: Stage 3 Plain Text Transformation and Evidence

- 상태: Accepted
- 날짜: 2026-07-17

## Context

Stage 2는 원본 텍스트를 immutable SourceVersion과 Asset Reference로 보존한다. Stage 3은
이 원본을 문단·문장 구조로 변환하면서도 모든 의미 구간을 정확한 원문 위치로 되돌릴 수
있어야 한다.

lucasastorian/llmwiki는 Highlight 위치 탐색, prefix/suffix 중복 해소, chunk offset,
deterministic lint 사례를 제공하지만 Python·SQLite·VaultFS·파일 경로 identity에
결합되어 있다. Shotgun은 Stable Source ID와 모듈 소유 DB 경계를 유지해야 한다.

## Decision

1. `DocumentIR`, `SourceMap`, `EvidenceSpan`은 Shotgun 공통 계약으로 소유한다.
2. W3C Text Position·Text Quote Selector 의미를 사용하되 SourceVersion, SHA-256,
   origin, `unicode-code-point` unit을 추가한다.
3. DocumentIR 내부 위치는 RFC 6901 JSON Pointer를 사용한다. 빈 문자열은 문서 root다.
4. lucas 전체 Runtime은 포함하지 않고 위치 탐색과 검증 동작만 `AUGMENT`한다.
5. Transformation과 Evidence는 Event·Query 계약으로 연결하며 서로의 DB를 직접 읽지 않는다.
6. 같은 SourceVersion·transformer id·version은 하나의 Revision을 재사용하고 Attempt만 기록한다.
7. `source` origin만 EvidenceSpan으로 저장하며 translation·summary·annotation은 제외한다.

## Consequences

- 원문, DocumentIR, SourceMap, Evidence가 SourceVersion과 hash로 함께 검증된다.
- 변환기와 인용 위치 탐색기는 Port 뒤에서 독립적으로 교체할 수 있다.
- 저장소 재시작 뒤에도 Revision과 Evidence ID가 유지된다.
- 현재 문장 분리는 결정적 MVP 규칙이며 언어별 NLP 정밀도는 제공하지 않는다.
- HTML, XLSX, PDF 등은 같은 계약을 출력하는 별도 Format Adapter로 확장한다.

## Verification

- Korean·emoji·CRLF Golden Fixture
- SourceMap round-trip과 offset/hash/SourceVersion negative tests
- Summary origin exclusion
- In-memory·In-process Contract tests
- Adapter replacement test
- PostgreSQL restart idempotency
- Security negative test
- Architecture boundary test
