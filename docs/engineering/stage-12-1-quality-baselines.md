# Stage 12.1 Quality Sections 2–4 — Baseline and Regression Gate Record

- Section 2 상태: **COMPLETE / USER APPROVED**
- Section 3 상태: **COMPLETE / USER APPROVED**
- Section 4 상태: **COMPLETE / USER APPROVED**
- 일자: 2026-07-22
- 평가 계약: [ADR-098](../architecture/adr/ADR-098-stage-12-1-quality-evaluation-contract.md) (`Accepted`)
- Baseline 실행 기준 SHA: `848b9b6762339a9f58dc80a62459f420849ff613`
- Corpus: `shotgun-quality-baseline@1.0.0`
- Label set revision: `2`
- Corpus digest: `sha256:b0bfdbbdf9e47aebd5d0508c95be8fdc4483d15ed185c02eaf15999eabc15f67`
- Metric implementation: `1.0.0`

## 1. 범위와 권위 경계

Quality Section 1에서 승인된 계약을 실행 가능한 Schema, TypeScript type·validator,
digest, deterministic metric과 result artifact로 구현했다. Production Claim 생성
로직·Prompt·Provider·Search ranking·FTS·`pg_trgm` 설정은 변경하지 않았다.

Corpus Label은 Production Claim·Fact·Canonical Knowledge가 아니다. 사용자는 같은
Golden Label의 내용을 변경하지 않고 review status를 `APPROVED`로 승인했으며
`labelSetRevision`과 case별 `labelRevision`을 `2`로 올렸다. 아래 수치는 승인된 현재
Baseline이자 초기 regression floor의 근거지만 품질 목표나 일반 성능 보장은 아니다.

## 2. 구현 산출물

- Corpus Manifest·Case·Run JSON Schema v1
- TypeScript type, Ajv validation, Source·Corpus·Recorded Output·Run digest 검증
- `CANDIDATE | REVIEWED | APPROVED | RETIRED` Label 상태와 baseline/Gate lane 분리
- Recorded/Fake와 live Provider 실행 경계
- 실제 Stage 4 `SubmitIntake` Command부터 Candidate Validation까지 통과하는 Claim runner
- order-independent exact Claim text+Evidence 최대 1:1 matching
- Claim·Search per-case/query, aggregate, slice metric
- approved Claim을 deterministic ID로 seed하는 PostgreSQL baseline
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

Golden Corpus 9 cases를 실제 Production Stage 4 흐름에 입력했다.

```text
SubmitIntake
→ EvidenceIndexed
→ GenerateStructured (FakeAIProviderAdapter)
→ ClaimCandidate
→ Candidate Validation
→ READY Candidate의 Metric 변환
```

Fake Provider는 Production `direct-claim-v1` Prompt가 전달한 Evidence를 파싱해 각
Evidence의 exact text와 runtime `evidenceId`를 구조화 Output으로 반환한다. 수기 오류를
주입하지 않는다. 실행마다 달라지는 Candidate·Evidence UUID는 Case ID와 Evidence
position 순으로 정규화하며, 정규화된 Output digest는
`sha256:5a3e44be3d2c2373a7d68221de181a9337ad4cace8ac55c1562a138b49f734c5`다.
9 Commands, 9 Provider calls, 11 ClaimCandidates와 11 Validation Results가 생성됐고
모든 Candidate가 현재 direct-only Validation에서 `READY`였다.

| Metric                 | 결과                 |
| ---------------------- | -------------------- |
| Precision              | `6 / 11 = 0.545455`  |
| Recall                 | `6 / 8 = 0.750000`   |
| F1                     | `12 / 19 = 0.631579` |
| Exact Claim Match      | `4 / 9 = 0.444444`   |
| Unsupported Claim Rate | `0 / 11 = 0.000000`  |
| Duplicate Claim Rate   | `0 / 11 = 0.000000`  |
| Evidence Exact Match   | `6 / 7 = 0.857143`   |
| Evidence Coverage      | `6 / 8 = 0.750000`   |
| No-Claim Accuracy      | `0 / 2 = 0.000000`   |

실패 cases:

- `duplicate-claim`: 서로 다른 Evidence 위치에서 같은 Claim text를 두 번 READY 처리
- `evidence-gap`: 직접 근거 문장 자체를 Claim으로 복사해 No-Claim label과 불일치
- `html-derived-status`: pre-derived text Intake에서 Golden CSS selector가 보존되지 않아 Evidence 불일치
- `ko-no-claim`: 감사 문장을 Claim으로 복사해 No-Claim 판정 실패
- `mixed-markdown-release`: Markdown heading을 별도 Claim으로 만들고 Golden Claim과 정확히 일치하지 않음

`Unsupported Claim Rate=0`은 Fake Provider가 Evidence의 exact substring만 복사하고 현재
Validation이 이를 READY로 인정했기 때문이다. 이는 factual Claim 선별 품질이 확보됐다는
뜻이 아니며, 낮은 Precision과 No-Claim Accuracy가 그 취약점을 직접 보여준다.

## 5. Section 3 — Natural-language Search Baseline

PostgreSQL 16.14와 `pg_trgm` 1.6의 격리 Database에서 approved Golden Claim 8개를
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

## 6. Section 4 — Regression Threshold and CI Gate

사용자 승인된 Versioned policy는
[`quality-gate.v1.json`](../../packages/quality-evaluation/policies/quality-gate.v1.json)에
고정했다. Claim threshold는 Precision `0.545455`, Recall `0.750000`, F1 `0.631579`,
Exact Claim Match `0.444444`, Evidence Exact Match `0.857143`, Evidence Coverage
`0.750000` 이상과 Unsupported·Duplicate Claim Rate `0` 이하를 요구한다.
No-Claim Accuracy `0`은 Section 5A 개선 대상이므로 진단만 기록하고 차단하지 않는다.

Search threshold는 P/R/Hit/MRR/nDCG@1 `0.8` 이상, P@3 `0.266667` 이상,
R/Hit/nDCG@3 `0.8` 이상을 요구한다. No-result Accuracy, Citation Correctness,
Stale-result Rejection Rate는 정확히 `1.0`이어야 한다. 정책의 6자리 십진 표현과
결정적으로 비교하도록 관측값도 소수 여섯째 자리로 반올림한다. 원시 metric은
artifact에 그대로 보존하며 결과를 threshold에 맞춰 수정하지 않는다.

`npm run quality:gate`는 `APPROVED` Corpus·policy·digest를 검증한 뒤 실제 Stage 4
Claim runner와 격리 PostgreSQL Search runner를 실행한다. metric 또는 identity가
회귀하면 exit code 1로 실패하며 CI는 PostgreSQL reset 다음 단계에서 이를 blocking
step으로 실행한다. Policy status는 `APPROVED`, digest는
`sha256:fb5e4389fed4e111fc3e94e3ee23366b454fb82de1806b865717b12129d644b4`이며
현재 승인 Baseline은 Gate를 통과했다.

## 7. OSS Integration Decision

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

## 8. 재현·Rollback·제한

실행 명령:

```powershell
npm run quality:claim-baseline
npm run quality:search-baseline
npm run quality:gate
```

Search runner는 `shotgun_quality_*` 격리 Database를 만들고 14개 Migration을 적용한
뒤 결과를 기록하고 해당 Database를 삭제한다. Production table·migration·index를
변경하지 않는다. Rollback은 evaluation package, synthetic fixture, runner와 result
artifact를 제거하는 것으로 충분하며 Production data migration은 없다.

현재 제한:

- corpus가 9 cases로 작아 대표성과 통계적 신뢰 구간을 주장하지 않는다.
- Label 승인은 현재 9-case synthetic corpus에 한정되며 Production Knowledge 승인이 아니다.
- Stage 4 Fake Provider baseline만 실행했고 live Provider 분포·비용·반복성은 측정하지 않았다.
- Fake Provider는 Evidence 문장을 직접 복사하므로 Claim-worthiness를 판별하는 실제 모델 품질을 대표하지 않는다.
- PDF·DOCX·Spreadsheet·Image/OCR-derived slice는 후속 corpus 확장 범위다.
- Section 4 regression floor는 품질 목표가 아니라 현재 승인 Baseline의 저하만 차단한다.
- No-Claim·Evidence·구조 추출 약점은 Known Limit로 유지하고 Section 5A는 Frontend보다
  선행하지 않도록 `DEFERRED`다.
- lexical-only 동의어 실패는 Known Limit로 유지하며 Semantic Retrieval은 실제 제품
  사용 결과가 쌓인 뒤 결정하도록 Section 5B를 `DEFERRED`한다.

## 9. 상태

```text
ADR-098: ACCEPTED
Quality Section 1: COMPLETE / USER APPROVED
Quality Section 2: COMPLETE / USER APPROVED
Quality Section 3: COMPLETE / USER APPROVED
Quality Section 4: COMPLETE / USER APPROVED
Quality Section 5A: DEFERRED
Quality Section 5B: DEFERRED
Quality Gate: COMPLETE
Stage 12.1: IN_PROGRESS
Stage 13: NOT STARTED
```
