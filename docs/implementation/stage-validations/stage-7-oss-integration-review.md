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

## 2026-10-01 VP Ask 검색 계획 통계 유지 보강

이 추가 기록은 위 Walking Skeleton MVP의 원래 범위를 바꾸지 않는다. VP 원장 작업자가 새 주장·관계 데이터를 적재한 뒤 PostgreSQL 검색 계획이 이전 통계에 의존해 Ask 질의가 과도하게 느려지는 실측을 보강한다.

| 후보                          | 결정              | 경계                                                                                                                           |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Shotgun 기존 PostgreSQL 16.14 | `AUGMENT`         | bounded 원장 drain 뒤 검색 통계 갱신을 한 번 실행한다. PostgreSQL은 기존 adapter와 `AskKnowledgeEvidenceSearchPort` 뒤에 있다. |
| 신규 검색/작업 OSS            | `NO_RELEVANT_OSS` | 필요한 기능은 이미 채택된 PostgreSQL의 내장 통계 갱신이며, 별도 runtime이나 package를 추가할 필요가 없다.                      |

버전·기본 라이선스·보안 및 유지보수 상태는 기존 [OSS source registry](../oss-source-registry.json)의 PostgreSQL 16.14 평가를 따른다. 새로운 OSS 코드나 외부 전송은 없다. `VPKnowledgeLedgerPort.refreshSearchStatistics`는 선택 Port 기능이고, 실제 구현은 기존 PostgreSQL adapter가 소유한다. PostgreSQL 16은 테이블 소유자 또는 superuser만 `ANALYZE`할 수 있으므로, 초기 구현에서 `shotgun_runtime`의 직접 호출은 권한 거부되어 통계가 갱신되지 않았다. Migration 126은 정확히 나열된 11개 검색 입력 테이블을 기존 비로그인 `shotgun_schema_owner`에 귀속하고, 고정된 테이블에만 `ANALYZE`를 실행하는 매개변수 없는 `SECURITY DEFINER` 함수를 만든다. 함수의 `search_path`는 고정되고 `PUBLIC` 실행 권한은 회수되며 `shotgun_runtime`에만 실행 권한을 준다. worker는 bounded queue drain 뒤 한 번만 함수를 호출하고, 실패 시 PostgreSQL autovacuum이 대체 경로로 남는다. 롤백은 Migration 126 전 DB 백업 복구와 기존 코드 복귀로 한다. 별도 격리 PostgreSQL 16 DB에서 이 복구를 실행했고, Migration 126 전 상태로 백업 복원한 뒤 11개 테이블 소유자 일치, migration 행 부재, 함수 부재와 백업 무결성을 확인했다. 상세 결과는 [Migration 126 rollback rehearsal](../vp-finance-pdf-flat-formula-verification-2026-10-01.md#migration-126-rollback-rehearsal)에 있다. in-place down migration은 제공하지 않는다.

Contract/DB 확인은 `tests/database/vp-direct-assertion-ledger.database.test.ts`에서 worker drain 후 `vp.assertions`의 `analyze_count` 증가와 `shotgun_erasure_executor`의 함수 실행 거부를 검사한다. T3 저장소 인벤토리도 Migration 123의 `vp.relation_provider_calls.output_json`과 Migration 126의 고정 함수/소유권 변경을 포함한다. 실제 제공 재무 PDF의 최신 DeepSeek 브라우저 E2E는 새 페이지 근거 assertion으로 통과했다. 이 PDF에 대해 20/20 marker의 Evidence `PageSelector`가 인쇄 페이지와 일치했고, replay가 일치했으며, 네 질문 corpus의 인용 페이지가 통과했고 pending relation job은 0건이었다. 상세 결과와 범위 제한은 [원문 우선 검토 보고](../vp-finance-pdf-source-first-review-2026-10-01.md)에 있다. 본 기록은 Stage 7 검색 유지 보강을 추적하며 VP-04/05 품질 Gate와 Stage 7의 넓은 제품 인수는 닫지 않는다.

## 2026-10-02 PostgreSQL source pin reconciliation

The 2026-10-01 section above records the PostgreSQL version observed during that historical run. Read-only inspection on 2026-10-02 confirmed the active `compose.yaml` `db` and `db-test` services both use `pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`, whose server reports PostgreSQL 16.15. The current [OSS source registry](../oss-source-registry.json) now records this exact image digest and upstream `REL_16_15` source commit; no Stage 7 code, schema, or integration decision changed. Historical PostgreSQL 16.14 test evidence above is retained as run evidence, not as the current runtime pin.
