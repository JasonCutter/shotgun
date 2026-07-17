# ADR-087: Stage 7 Cited Search Projection

- 상태: Accepted
- 날짜: 2026-07-17

## Context

Stage 6은 승인된 Claim과 `CanonicalCommitted`를 만든다. Stage 7은 Canonical 저장소의 소유권을 침범하지 않으면서 검색과 답변을 제공해야 한다. 검색 Projection은 비동기로 실패할 수 있으므로 오래된 결과를 최신 사실처럼 표시해서는 안 된다.

## Decision

1. `stage7.projection-search`가 `CanonicalCommitted`를 소비해 검색 문서와 Watermark를 갱신한다.
2. Projection은 Canonical 테이블을 직접 읽지 않고 `GetCanonicalSnapshot`, `GetCanonicalClaim`, `GetCanonicalCommit` Query만 사용한다.
3. PostgreSQL FTS와 `pg_trgm`을 채택하고 두 GIN index를 생성한다.
4. SearchResult는 Claim, Commit, Revision, SourceVersion, Evidence ID를 함께 반환한다.
5. Watermark의 Canonical version·digest가 현재 Snapshot과 다르면 결과를 비우고 `STALE` 또는 `DEGRADED`를 반환한다.
6. Projection 문서와 Watermark는 한 transaction에서 갱신한다. 실패는 Dead Letter로 남지만 Canonical Commit은 유지한다.
7. `stage7.cited-answer`는 검색과 Evidence Query만 조합하며 Canonical에 쓰지 않는다.
8. MVP 답변은 Canonical Claim 원문만 사용하고 각 문장에 하나 이상의 Evidence Citation을 강제한다.
9. gbrain과 ddsyasas는 검증된 패턴만 참고한다. pgvector는 의미 검색 benchmark가 필요성을 증명할 때까지 보류한다.

## Consequences

- Canonical 저장과 검색 장애가 분리된다.
- 사용자는 검색 지연 상태와 원문 근거를 확인할 수 있다.
- AI 요약보다 표현력은 제한되지만 근거 없는 사실 생성 경로가 없다.
- 향후 검색 엔진이나 pgvector를 Repository Port 뒤에서 교체할 수 있다.

## Verification

- 두 Transport의 Stage 7 Contract Test
- PostgreSQL FTS·trigram·GIN·Watermark·rollback·rebuild Test
- Stale Projection 및 Citation coverage Test
- Stage 2→7 Ask UI와 Evidence 이동 Integration Test
- Stage 7 OSS Gate와 exact pin·license 검증
