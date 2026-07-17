# Stage 7 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Search Projection, Citation Lookup, Cited Answer, Ask UI
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 7: COMPLETE — Walking Skeleton MVP**

## 결정

| 후보                        | 결정             | 적용 범위                                             |
| --------------------------- | ---------------- | ----------------------------------------------------- |
| PostgreSQL 16.14 FTS        | `ADOPT`          | `tsvector`, `websearch_to_tsquery`, GIN 전문검색      |
| PostgreSQL `pg_trgm`        | `ADOPT`          | 오타 허용 검색과 GIN trigram index                    |
| garrytan/gbrain `a25209b`   | `REFERENCE_ONLY` | 검색 근거 유형, 인용 검증, 검색 품질 fixture 패턴     |
| ddsyasas/llm-wiki `e8dd69e` | `REFERENCE_ONLY` | 질문 입력, 처리 중 상태, 오류 복구, 출처 이동 UI 흐름 |
| pgvector 0.8.5 `159b79a`    | `DEFER`          | 의미 검색의 필요성이 benchmark로 확인될 때 재검토     |

## 재사용 경계

- gbrain runtime과 DB schema는 가져오지 않았다. Shotgun의 Canonical/Approval/Evidence 계약과 소유권이 다르기 때문이다.
- ddsyasas backend와 파일 저장소는 가져오지 않았다. 검증된 UI 흐름만 Shotgun typed API 위에 독립 구현했다.
- PostgreSQL FTS와 `pg_trgm`은 `SearchProjectionRepositoryPort` 뒤에 격리했다.
- pgvector를 미리 설치하지 않았다. 현재 fixture는 FTS와 trigram으로 충족되며 embedding provider와 운영 비용이 불필요하다.

## Contract 및 안전 검증

| 검증 항목                                            | 결과 |
| ---------------------------------------------------- | ---- |
| 승인된 Canonical Claim만 기본 검색                   | PASS |
| 미승인 Candidate 검색 제외                           | PASS |
| SearchResult에서 Commit·Revision·Evidence 식별       | PASS |
| 답변의 모든 사실 문장에 Evidence Citation            | PASS |
| EvidenceSpan 원문 화면 이동                          | PASS |
| Projection Watermark와 Canonical version/digest 비교 | PASS |
| Stale·Degraded Projection에서 답변 차단              | PASS |
| Projection 실패 후 Canonical Commit 유지             | PASS |
| Projection 재실행·rebuild 멱등성                     | PASS |
| PostgreSQL FTS·trigram·GIN·transaction               | PASS |
| Stage 2→7 HTTP E2E                                   | PASS |

## MVP 출력 방식

AI가 검색 결과를 다시 요약하지 않는다. 승인된 Canonical Claim 문장을 그대로 반환하고, 각 문장에 원문 Evidence를 연결한다. 이 방식은 가장 단순하며 Stage 7에서 근거 없는 문장이 생기는 것을 막는다. AI 기반 종합 답변은 별도 품질 기준과 인용 coverage 검증이 준비된 뒤 확장한다.
