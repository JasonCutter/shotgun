# Stage 12.1 Quality Sections 2·3 — Baseline Implementation Record

- 상태: **IMPLEMENTED CANDIDATE / NOT APPROVED**
- 일자: 2026-07-22
- 평가 계약: [ADR-098](../architecture/adr/ADR-098-stage-12-1-quality-evaluation-contract.md) (`Accepted`)
- 구현 기준 SHA: `fe65f67b7d4dd3515399e9dd7385224613180f5f`
- Corpus: `shotgun-quality-baseline@1.0.0`
- Corpus digest: `sha256:c8e7a51614df6262947a2de40834b80472988096897518a1e1a5921285e92381`
- Metric implementation: `1.0.0`

## 1. 범위와 권위 경계

Quality Section 1에서 승인된 계약을 실행 가능한 Schema, TypeScript type·validator,
digest, deterministic metric과 result artifact로 구현했다. Production Claim 생성
로직·Prompt·Provider·Search ranking·FTS·`pg_trgm` 설정은 변경하지 않았다.

Corpus Label은 Production Claim·Fact·Canonical Knowledge가 아니다. 이번 synthetic
Label은 `REVIEWED`이고 candidate baseline lane에서만 허용된다. `APPROVED` Label만
허용하는 Gate lane에서는 거부된다. 따라서 아래 수치는 Section 2·3 승인이나
Quality Gate 통과 Threshold가 아니다.

## 2. 구현 산출물

- Corpus Manifest·Case·Run JSON Schema v1
- TypeScript type, Ajv validation, Source·Corpus·Recorded Output·Run digest 검증
- `CANDIDATE | REVIEWED | APPROVED | RETIRED` Label 상태와 baseline/Gate lane 분리
- Recorded/Fake와 live Provider 실행 경계
- order-independent exact Claim text+Evidence 최대 1:1 matching
- Claim·Search per-case/query, aggregate, slice metric
- reviewed Claim을 deterministic ID로 seed하는 PostgreSQL baseline
- 실제 `stage7.projection-search` readiness와 PostgreSQL Search Adapter 실행
- 격리 Database 생성→Migration→seed→측정→삭제 실행기

결과 artifact:

- [Claim Extraction Baseline](baselines/claim-extraction-baseline.v1.json)
- [Search Baseline](baselines/search-baseline.v1.json)

## 3. Corpus와 Slice

Corpus는 9 cases, 8 Golden Claims, 6 exhaustive closed-corpus queries다. Query마다
8개 Golden Claim 모두에 `0 | 1 | 2` relevance를 기록했다. 초기 `k`는 작은 corpus와
상위 1개 정답·상위 3개 노출을 함께 보기 위해 `{1, 3}`으로 정했다.

주요 slice:

- 언어: Korean, English, Korean-English mixed
- 형식: Plain Text, Markdown, HTML-derived text
- Claim: 단일·복수, 수치·단위, 시간, 부정, 불확실성, 중복
- 실패: No-Claim, Evidence 부족
- Query: exact keyword, natural-language question, synonym, notation variation,
  한국어 조사·어미 변형, no-result

Synthetic data만 사용하며 Production identifier·개인정보·비밀은 포함하지 않는다.

## 4. Section 2 — Claim Extraction Baseline

Recorded fixture의 9 predictions를 현재 direct-only 계약으로 측정했다.

| Metric                 | 결과                 |
| ---------------------- | -------------------- |
| Precision              | `6 / 9 = 0.666667`   |
| Recall                 | `6 / 8 = 0.750000`   |
| F1                     | `12 / 17 = 0.705882` |
| Exact Claim Match      | `5 / 9 = 0.555556`   |
| Unsupported Claim Rate | `2 / 9 = 0.222222`   |
| Duplicate Claim Rate   | `1 / 9 = 0.111111`   |
| Evidence Exact Match   | `6 / 7 = 0.857143`   |
| Evidence Coverage      | `6 / 8 = 0.750000`   |
| No-Claim Accuracy      | `1 / 2 = 0.500000`   |

실패 cases:

- `en-uncertainty`: 불확실성 Claim 누락
- `en-multiple`: 시간 Claim의 Evidence position 오류
- `duplicate-claim`: 같은 text+Evidence prediction 중복
- `evidence-gap`: Source가 지지하지 않는 3일 지연 Claim 생성

## 5. Section 3 — Natural-language Search Baseline

PostgreSQL 16.14와 `pg_trgm` 1.6의 격리 Database에서 reviewed Golden Claim 8개를
seed했다. Production `GREATEST(ts_rank_cd, similarity, substring)` ranking과
`claim_id` tie-break를 그대로 사용했다.

| Metric                      | `k=1` | `k=3`    |
| --------------------------- | ----- | -------- |
| Precision@k                 | 0.8   | 0.266667 |
| Recall@k                    | 0.8   | 0.8      |
| Hit Rate@k                  | 0.8   | 0.8      |
| nDCG@k                      | 0.8   | 0.8      |
| MRR                         | 0.8   | N/A      |
| No-result Accuracy          | 1.0   | N/A      |
| Citation Correctness        | 1.0   | N/A      |
| Stale-result Rejection Rate | 1.0   | N/A      |

`Precision@3`은 relevant Claim이 query마다 하나인 작은 corpus에서 비어 있는 rank를
nonrelevant로 계산하므로 최대값이 `1/3`이다. 단독으로 품질 저하를 뜻하지 않으며
Recall·Hit Rate·MRR·nDCG와 함께 해석해야 한다.

실패 query:

- `q-migration-synonym` — `schedule completion estimate`가
  `The migration may finish by Friday.`를 찾지 못했다.

이는 현재 lexical-only 검색의 동의어 취약점이다. 이번 Section에서는 ranking을
변경하지 않으며 Section 5A lexical 개선 근거로만 보존한다. Semantic retrieval은
Section 5B 별도 승인 전까지 `DEFERRED`다.

## 6. OSS Integration Decision

| 후보                               | 결정                  | 이번 범위                             |
| ---------------------------------- | --------------------- | ------------------------------------- |
| Ajv 8.20.0                         | 기존 `ADOPT` 유지     | JSON Schema 검증 재사용               |
| PostgreSQL 16.14 FTS·`pg_trgm` 1.6 | 기존 `ADOPT` 유지     | 권위 Search baseline                  |
| Shotgun `stableJson`·`sha256Text`  | 내부 계약 재사용      | Corpus·Run digest                     |
| NIST `trec_eval` v10.0             | `REFERENCE_ONLY` 유지 | metric 정의 교차 검토; runtime 미도입 |
| `ir_measures` 0.4.3                | `DEFER` 유지          | Python toolchain 미도입               |
| `ranx` 검토 commit                 | `DEFER` 유지          | 현재 범위 대비 dependency 과다        |
| `promptfoo` 0.121.19               | `DEFER` 유지          | live Provider 후속 후보               |

새 Runtime Dependency와 lockfile 변경은 없다. 기존 Integration Decision이 바뀌지
않아 Open-source Role Matrix는 갱신하지 않았다.

## 7. 재현·Rollback·제한

실행 명령:

```powershell
npm run quality:claim-baseline
npm run quality:search-baseline
```

Search runner는 `shotgun_quality_*` 격리 Database를 만들고 14개 Migration을 적용한
뒤 결과를 기록하고 해당 Database를 삭제한다. Production table·migration·index를
변경하지 않는다. Rollback은 evaluation package, synthetic fixture, runner와 result
artifact를 제거하는 것으로 충분하며 Production data migration은 없다.

현재 제한:

- corpus가 9 cases로 작아 대표성과 통계적 신뢰 구간을 주장하지 않는다.
- Label은 `REVIEWED`이며 Quality Gate에 필요한 `APPROVED` 상태가 아니다.
- Recorded/Fake baseline만 실행했고 live Provider 분포·비용·반복성은 측정하지 않았다.
- PDF·DOCX·Spreadsheet·Image/OCR-derived slice는 후속 corpus 확장 범위다.
- Threshold·regression budget·CI 차단은 Section 4에서 별도 승인한다.

## 8. 상태

```text
ADR-098: ACCEPTED
Quality Section 1: COMPLETE / USER APPROVED
Quality Section 2: IMPLEMENTED CANDIDATE / NOT APPROVED
Quality Section 3: IMPLEMENTED CANDIDATE / NOT APPROVED
Quality Section 4: NOT STARTED
Quality Section 5A: NOT STARTED
Quality Section 5B: DEFERRED
Quality Gate: IN_PROGRESS
Stage 12.1: IN_PROGRESS
Stage 13: NOT STARTED
```
