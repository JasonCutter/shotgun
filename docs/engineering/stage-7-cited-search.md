# Stage 7 — Search, Citation and Cited Answer

## 현재 구조

```text
CanonicalCommitted
  → stage7.projection-search
  → SearchProjectionRepositoryPort
  → PostgreSQL FTS + pg_trgm
  → SearchCanonicalKnowledge
  → stage7.cited-answer
  → GetEvidenceSpan
  → 문장별 Citation
```

## 주요 폴더

```text
modules/projection-search/       # Event 처리, Watermark, 검색 Query
modules/cited-answer/            # Canonical 검색과 Evidence를 인용 답변으로 조합
adapters/stage7-in-memory/       # Contract Test용
adapters/postgres-stage7/        # FTS·pg_trgm 영속 Adapter
db/migrations/007_stage7_cited_search.sql
tests/contract/cited-search.contract.test.ts
tests/database/stage-7-postgres.test.ts
tests/integration/cited-search-ui.test.ts
```

## API

| 경로                         | 역할                                     |
| ---------------------------- | ---------------------------------------- |
| `POST /search`               | 승인된 Canonical Claim 검색              |
| `POST /ask/query`            | 문장별 원문 인용 답변                    |
| `POST /projection/readiness` | Projection 최신 상태와 지연 확인         |
| `POST /projection/rebuild`   | Canonical Snapshot에서 Projection 재생성 |
| `GET /ask`                   | 최소 Ask UI                              |
| `GET /evidence/:evidenceId`  | 원문 EvidenceSpan 확인                   |

## 운영 규칙

- `READY`일 때만 검색 결과와 답변을 제공한다.
- `STALE` 또는 `DEGRADED`이면 답변을 만들지 않는다.
- Projection 재구축은 Canonical을 수정하지 않는다.
- 검색 relevance 변경 뒤에는 정확 검색, 오타 검색, 접근 범위, Citation round-trip을 다시 검사한다.

## 확인 명령

```powershell
npm.cmd run check
npm.cmd run db:reset
npm.cmd run test:database
```

OSS 결정은 [Stage 7 OSS Integration Review](../implementation/stage-validations/stage-7-oss-integration-review.md), 구조 결정은 [ADR-087](../architecture/adr/ADR-087-stage-7-cited-search-projection.md)에 기록했다.
