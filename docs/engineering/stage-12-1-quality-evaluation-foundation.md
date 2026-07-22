# Stage 12.1 Quality Gate Section 1 — Golden Corpus and Evaluation Contract

- 상태: **DESIGN CANDIDATE / NOT APPROVED**
- 작성일: 2026-07-22
- Base SHA: `50a25dfab1458fffc6fecc80bc8c91852b2d7ff6`
- 관련 ADR 후보: [ADR-098 — Stage 12.1 Quality Evaluation Contract](../architecture/adr/ADR-098-stage-12-1-quality-evaluation-contract.md)
- 안전 경계: [ADR-084](../architecture/adr/ADR-084-stage-4-ai-candidate-validation.md), [ADR-087](../architecture/adr/ADR-087-stage-7-cited-search-projection.md)

## 1. 현재 구현과 평가 자산 Inventory

### 1.1 Claim 생성·승인 경로

```text
Source / SourceVersion / OriginalAsset
  -> TransformationRevision / DocumentIR / SourceMap
  -> EvidenceSpan
  -> GenerateStructured (AIProviderAdapterPort)
  -> ClaimCandidate (PENDING_VALIDATION)
  -> deterministic Validation
  -> ChangeSet review and explicit approval
  -> CanonicalClaim
```

| 단계                  | 현재 계약과 행동                                                                                                                                                       | 품질 평가에 쓸 수 있는 신호                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Source·Transformation | `TransformationRevision`이 immutable Source hash, `DocumentIR`, `SourceMap`, transformer version을 결속한다.                                                           | media type, source hash, transformer version, Unicode position     |
| Evidence              | `EvidenceSpan`은 `quote.exact`, prefix·suffix, `TextPositionSelector`와 형식별 selector를 보존한다. position unit은 `unicode-code-point`다.                            | exact quote/hash, position, structural selector, provenance        |
| AI Provider           | `stage4.ai-provider`uac00 `direct-claim-v1` prompt와 `direct-only-v1` policy로 sentence Evidence만 보낸다. Gemini·Fake Adapter는 같은 Port를 사용한다.                 | provider·adapter·model·prompt·policy·attempt·usage·latency         |
| Candidate             | `ClaimCandidate` v1은 trim된 `claimText`, 하나의 Evidence ID, `DIRECT_EVIDENCE`, `direct-only`를 갖는다. 같은 claim text+evidence fingerprint는 한 batch에서 제거된다. | predicted text, evidence ID, duplicate fingerprint, batch identity |
| Validation            | schema, evidence-reference, direct-text, policy를 결정적으로 검사하고 semantic은 `NOT_RUN`이다.                                                                        | dimension status, unsupported direct-text, rejection reason        |
| Canonical             | 승인된 ChangeSet만 `CanonicalClaim`으로 commit된다. Claim과 Fact는 분리된다.                                                                                           | approval boundary, committed claim ID, revision/history            |

현재 `ClaimCandidate` v1과 `CanonicalClaim` v1에는 `claimType`, confidence,
`temporalStatus`가 없다. 따라서 이 필드는 현재 Quality Gate의 결정적 정답이나
Type Accuracy 통과 조건이 될 수 없다.

### 1.2 Search·Citation 경로

```text
CanonicalClaim + CanonicalCommitted
  -> stage7.projection-search
  -> projection.search_documents + projection.watermarks
  -> SearchCanonicalKnowledge
  -> PostgreSQL FTS / pg_trgm / substring
  -> CanonicalSearchResult
  -> stage7.cited-answer
  -> EvidenceSpan citation
```

| 요소                | 현재 구현                                                                                     | 평가 주의점                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 검색 대상           | 승인된 Canonical Claim의 `claimText` 하나                                                     | Source 전체, Evidence quote, metadata는 검색 필드가 아님                             |
| Query normalization | Module은 outer whitespace를 trim함                                                            | PostgreSQL `simple` FTS와 in-memory NFKC/lowercase는 정확히 같은 ranking 구현이 아님 |
| PostgreSQL ranking  | `max(ts_rank_cd, similarity, substring 1.0)`                                                  | 단일 score이며 score 동률은 `claim_id` 오름차순                                      |
| Match type          | substring이면 `SUBSTRING`, 그 다음 FTS, 그 외 trigram                                         | 결과의 설명 signal이지 relevance label은 아님                                        |
| Readiness           | canonical version+digest가 watermark와 같아야 `READY`                                         | `STALE`·`DEGRADED`에서 결과를 비우는 것은 safety metric으로 분리                     |
| Citation            | 검색 문서의 Claim·Commit·Revision·SourceVersion·Evidence ID로 `EvidenceSpan` 원문을 다시 조회 | relevance와 citation correctness를 별도 계산                                         |

Quality baseline은 PostgreSQL Adapter를 권위 구현으로 사용한다. In-memory Adapter는
Port·flow test double이며 PostgreSQL와 score parity를 주장하지 않는다.

### 1.3 기존 테스트·Golden 자산 분류

| 자산                                            | 분류                             | 재사용 범위                                                       | 품질 평가 한계                                 |
| ----------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| `tests/fixtures/stage-3-plain-text-golden.json` | 부분 재사용 가능                 | Unicode·CRLF·SourceMap·Evidence position fixture                  | Claim label·query·relevance·metric 없음        |
| `tests/fixtures/stage-8/*`                      | 부분 재사용 가능                 | HTML, PDF, DOCX, CSV, XLSX, PPTX, image 형식과 selector           | 변환 Golden이며 Claim/Search Golden이 아님     |
| `ai-candidate-validation.contract.test.ts`      | 회귀 테스트이지만 품질 평가 아님 | direct-only, unsupported inference, schema retry, provider policy | corpus version·aggregate precision/recall 없음 |
| `canonical-knowledge.contract.test.ts`          | 안전 회귀 테스트                 | Claim/Fact 분리, approval, commit, duplicate `NO_OP`              | extraction 출력과 Golden Label 비교 아님       |
| `cited-search.contract.test.ts`                 | 안전·Port 회귀 테스트            | Canonical-only, citation round-trip, no match, stale blocking     | qrels·ranking metric·query slice 없음          |
| `stage-7-postgres.test.ts`                      | Adapter 통합 회귀 테스트         | FTS·trigram·GIN·transaction·rebuild                               | ranking quality baseline 아님                  |
| `cited-search-ui.test.ts`                       | Product E2E                      | intake→approval→search→citation 종단 연결                         | 단일 flow이며 retrieval benchmark 아님         |

현재 저장소에는 Claim/Search 품질을 위한 versioned Golden Corpus, qrels, Benchmark
Runner, Precision·Recall·F1·MRR·nDCG 구현이 없다. 기존 fixture를 지우거나 완화하지
않고 Section 2·3에서 새 평가 계약에 명시적으로 편입해야 한다.

## 2. 문제 정의

Quality Gate는 “예시 하나가 지나간다”를 증명하는 회귀 테스트와 “대표 실패
축에서 어느 정도 잘한다”를 측정하는 품질 Evaluation을 분리해야 한다. 현재
부족한 것은 다음이다.

- 어떤 입력과 실패 유형을 대표하는지 설명하는 versioned corpus
- Claim prediction과 Golden Label을 중복 없이 1:1로 대응시키는 규칙
- Query별 relevant·irrelevant Claim을 완전히 기록한 judgment
- metric 분자·분모, empty-set convention, aggregation 단위
- corpus·code·provider·prompt·projection 버전을 묶는 run identity
- Golden Label을 Canonical Knowledge로 오인하지 않는 권위 경계

## 3. Section 1 범위

Section 1의 산출물은 실행 코드가 아닌 평가 계약 후보와 구현 계획이다.

포함:

- Claim·Search corpus case의 정체성, version, digest, provenance
- Golden Label review status와 Claim·Fact·Label 권위 분리
- direct-only Claim matching과 relevance judgment 규칙
- 결정적 metric 정의와 LLM Judge 경계
- recorded/Fake·live Provider의 재현성 분리
- 데이터·라이선스·민감도 제한
- 후속 Section 분해와 승인 단위

제외:

- fixture, runner, metric code, threshold, CI Gate의 실제 구현
- Prompt·Provider·Claim extraction·Search ranking의 변경
- embedding, vector DB, reranker, semantic retrieval 도입
- Quality Section 1 또는 Quality Gate 완료 선언

## 4. Golden Corpus Contract 후보

### 4.1 Corpus Manifest

Corpus 루트는 다음 identity를 가져야 한다.

```text
contractVersion
corpusId
corpusVersion
labelSetRevision
title
description
createdAt
updatedAt
digestAlgorithm = sha256
corpusDigest
caseIds
licenseSummary
dataPolicy
```

`corpusDigest`는 자신을 제외한 manifest와 case 모두를 경로·ID 순으로 정렬해
Shotgun의 `stableJson` 후 `sha256Text`로 계산하는 것을 우선 후보로 한다.
정확한 serialization version을 `contractVersion`에 결속해야 한다.

### 4.2 Corpus Case

```text
caseId
caseVersion
title
description

language
sourceFormat
sourceContent
sourceContentHash

projectContext
sensitivity
dataClassification

expectedClaims
expectedNoClaimReason
queries

tags
difficulty
riskCategory

labelAuthor
labelReviewStatus
labelReviewedAt
labelRevision

provenance
notes
```

계약 제약:

- `caseId`는 의미적으로 불변이고 `caseVersion`은 content·label·query 변경 시
  증가한다.
- `sourceContentHash` 대상은 UTF-8 `sourceContent` 원문이다. binary fixture의 hash를
  대체하지 않는다.
- `projectContext`는 평가용 project key, access scopes, locale/timezone같은 가상
  context만 담고 Production identifier를 담지 않는다.
- `labelReviewStatus`는 `CANDIDATE | REVIEWED | APPROVED | RETIRED`다. Gate에는
  `APPROVED`만 사용한다.
- AI가 라벨을 제안할 수는 있지만 자동으로 `APPROVED`가 될 수 없다.
- `expectedClaims` 공백이면 `expectedNoClaimReason`이 필수이고, 비어 있으면
  `expectedNoClaimReason`을 두지 않는다.

### 4.3 Claim·Fact·Golden Label 권위

| 개념         | 의미                                                      | 생성·변경 권위                                             | 평가 실행의 효과                                              |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Claim        | Source와 Evidence에서 추출된 검토 대상 지식 주장          | Candidate→Validation→Review→Canonical Commit 경계          | prediction·retrieval 대상이지 label이 아님                    |
| Fact         | 사용자 승인 또는 권위 근거의 별도 계약을 거쳐 확정된 사실 | Claim 승인으로 자동 생성되지 않음                          | corpus 실행이 생성·변경하지 않음                              |
| Golden Label | 특정 corpus version에서 metric을 계산하는 test oracle     | label reviewer의 versioned review·approval; AI 제안은 후보 | Production Canonical Knowledge 권위가 아니며 table write 금지 |

Golden Label을 고친다고 Canonical History를 쓰지 않고, Canonical Knowledge가
변경됐다고 label이 자동 변경되지도 않는다. 두 권위 사이의 차이는
label revision 또는 corpus gap으로 명시적으로 review한다.

### 4.4 입력 형식·언어·실패 축

초기 corpus는 변환 품질과 Claim extraction 품질을 한 점수에서 섞지 않도록
다음처럼 분리한다.

| 축   | Section 2 초기 포함                          | 후속 확장                                                           | 근거                                                                                           |
| ---- | -------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 형식 | Plain Text, Markdown, 로컬 HTML-derived text | PDF·DOCX·Spreadsheet-derived, Image/OCR-derived, Public URL-derived | 초기에는 현재 direct sentence Evidence를 격리 측정. Stage 8 fixture는 별도 format slice로 편입 |
| 언어 | Korean, English, Korean-English mixed        | translation pair                                                    | 한국어 조사·어미와 mixed notation을 초기부터 측정                                              |
| 번역 | 원문 군과 분리                               | 승인된 translation provenance 전용 slice                            | 번역 오류를 Claim extraction 오류로 숨기지 않음                                                |

최소 실패 slice:

- 명시적 단일 Claim, 한 문장 복수 Claim, 문단을 걸친 주장
- 수치·단위, 시간 조건, 부정, 불확실성·추정
- 충돌 Claim, 반복·유사 Claim, Claim이 없어야 하는 문서
- Evidence가 부족한 주장, 표·목록·제목 Claim
- exact keyword, 자연어 질문, 동의어, 표기 변형, 한국어 조사·어미 변형
- 복합·시간·부정 조건, no-result query, 충돌 상태 query

각 case는 하나 이상의 slice tag를 가지며 aggregate와 별개로 slice 성적을
보고해야 한다. 단일 aggregate만으로 어려운 case 실패를 숨기지 않는다.

## 5. Claim Evaluation Contract 후보

### 5.1 `expectedClaims`

Production `claimId`와 평가 ID를 혼동하지 않도록 `goldenClaimId`를 사용한다.

```text
goldenClaimId
claimText
normalizedMeaning?
evidence:
  exact
  prefix?
  suffix?
  position:
    start
    end
    unit = unicode-code-point
  selectors?
expectedDisposition = EXTRACT
semanticAliases?
annotations?:
  claimType?
  confidenceExpectation?
  temporalStatus?
```

- `claimText`는 현재 direct-only profile의 정답이며 Evidence `exact`의 연속
  substring이어야 한다.
- `normalizedMeaning`과 `semanticAliases`는 사람이 검토한 diagnostic metadata다.
  현재 결정적 Gate의 exact TP를 대체하지 않는다.
- position은 기존 `EvidenceSpan` 계약과 같은 Unicode code point이다. byte·UTF-16
  code unit·token offset을 사용하지 않는다.
- format-specific selector는 해당 slice에서만 필수다. selector array 순서는 점수에
  영향을 주지 않고 type+value로 canonical sort한다.
- `annotations` 하위 필드는 현재 Production contract에 없으므로 Section 1–2 Gate
  metric에서 제외한다.

### 5.2 1:1 matching

1. predicted claim의 `claimText` 비교는 Production과 같은 outer trim 후 Unicode scalar
   sequence exact equality를 사용한다. case fold·구두점 제거·의미 유사도를
   자동 적용하지 않는다.
2. exact text와 expected Evidence span이 같은 pair만 exact match 후보가 된다.
3. 정답과 prediction을 결정적 최대 1:1 matching한다. 입력 순서와 Provider
   출력 순서는 점수에 영향을 주지 않는다.
4. 한 Golden Claim에 두 번 맞은 prediction의 두 번째 항목은 duplicate FP다.
5. 부분 일치 prediction은 TP가 아니다. unmatched prediction FP와 unmatched Golden
   FN으로 계산하고 partial-match diagnostic을 남긴다.
6. Golden에 없는 추가 prediction은 원문 substring인지와 무관하게 extraction FP다.
   원문에도 없으면 unsupported FP로 추가 분류한다.
7. no-claim case는 `expectedClaims=[]` + non-empty `expectedNoClaimReason`으로
   표현한다. prediction이 하나라도 있으면 실패다.

## 6. Search Evaluation Contract 후보

### 6.1 Query·relevance judgment

```text
queryId
queryText
language
queryType
kValues
expectedNoResult
judgments:
  - goldenClaimId
    relevance: 0 | 1 | 2
    rationale?
```

- `0=not relevant`, `1=relevant`, `2=highly relevant`로 한다.
- Precision·Recall·Hit Rate·MRR의 binary mapping은 `relevance >= 1`이다.
- nDCG는 원래 graded value를 사용한다.
- closed corpus의 query는 실행 시점에 seed된 모든 Golden Claim을 judgment에
  포함한다. unjudged result를 조용히 nonrelevant로 치환하지 않고 contract
  validation error로 거부한다.
- `expectedNoResult=true`면 모든 relevance가 0이어야 한다.
- runtime의 random Canonical ID는 seed manifest로 `goldenClaimId`에 mapping하며 라벨에
  Production ID를 기록하지 않는다.

### 6.2 Search 평가 단위

- 각 query를 독립 평가 단위로 하고 query 당 점수의 macro mean을 기본
  aggregate로 한다.
- language·query type·difficulty·risk slice를 별도 보고한다.
- 검색 포함 여부(Recall·Hit Rate)와 정렬 품질(MRR·nDCG)을 분리한다.
- `matchType`과 raw score는 diagnostic으로 남기지만 relevance를 대체하지 않는다.
- Citation은 retrieval relevance와 분리해 Claim→Revision→SourceVersion→Evidence
  binding이 Golden와 같은지 검사한다.

## 7. Metric 후보와 계산 정의

이 Section은 정의만 제안하며 통과 Threshold를 고정하지 않는다.

### 7.1 Claim metric

Exact 1:1 matching 후 corpus 전체의 `TP`, `FP`, `FN`을 합산한 micro metric을
기본으로 하고 case/slice 결과를 함께 보고한다.

| Metric                 | 정의                                                                                       | 단위·결정성               | 숨김 위험과 보완                                        |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------- |
| Claim Precision        | `TP / (TP + FP)`                                                                           | corpus micro, 결정적      | 보수적으로 아무 것도 안 내면 높아짐; Recall과 함께 표시 |
| Claim Recall           | `TP / (TP + FN)`                                                                           | corpus micro, 결정적      | 과다 추출 숨김; Precision과 함께 표시                   |
| Claim F1               | `2PR / (P + R)`                                                                            | corpus micro, 결정적      | 단일 숫자가 slice 실패를 숨김; slice·P·R 필수           |
| Exact Claim Match      | expected set과 predicted set이 text+Evidence 1:1로 완전 일치한 case 비율                   | case macro, 결정적        | 작은 오차도 전체 case를 실패시킴; P/R/F1과 함께 사용    |
| Semantic Claim Match   | reviewed alias 또는 사람 판정으로 의미 일치                                                | diagnostic, 비결정적 가능 | exact 실패를 자동 TP로 바꾸지 않음                      |
| Unsupported Claim Rate | direct-text/evidence-reference를 통과하지 못한 prediction / 전체 prediction                | corpus micro, 결정적      | prediction 0일 때 `N/A`; No-Claim Accuracy와 분리       |
| Duplicate Claim Rate   | 1:1 matching에서 이미 사용된 text+Evidence fingerprint의 추가 prediction / 전체 prediction | corpus micro, 결정적      | 의미적 중복은 별도 diagnostic                           |
| Evidence Exact Match   | matched Claim 중 quote+position+required selector가 모두 맞은 Claim / matched Claim        | corpus micro, 결정적      | Claim text만 맞고 근거가 틀린 실패를 보여 줌            |
| Evidence Coverage      | correct Evidence를 갖는 matched Claim / 전체 Golden Claim                                  | corpus micro, 결정적      | extraction omission을 포함                              |
| Type Accuracy          | correct type / type-labeled matched Claim                                                  | 현재 `N/A`                | v1에 type이 없으므로 임의 score 금지                    |
| No-Claim Accuracy      | prediction이 0개인 no-claim case / 전체 no-claim case                                      | case macro, 결정적        | no-claim case 수와 slice를 함께 보고                    |

Empty denominator는 0으로 위조하지 않고 `N/A` + raw count로 보고한다.

### 7.2 Search metric

`rel(d) = 1 if judgment >= 1 else 0`, `grade(d) = judgment`로 한다.

| Metric                      | Query별 정의                                                                              | 적합성·주의점                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Precision@k                 | top k의 relevant 개수 / `k`; 부족한 rank는 nonrelevant                                    | 상위 결과 순도. 관련 Claim이 k보다 적은 query에서 낮아질 수 있음 |
| Recall@k                    | top k에서 찾은 relevant 개수 / 전체 relevant 개수                                         | 검색 누락. no-result query는 별도 지표로 처리                    |
| Hit Rate@k                  | top k에 relevant가 하나라도 있으면 1                                                      | 소수 query에서 직관적이지만 복수 relevant 누락을 숨김            |
| Reciprocal Rank             | 첫 relevant rank `r`이 있으면 `1/r`, 없으면 0                                             | 첫 정답 정렬. 나머지 relevant 순서는 무시                        |
| MRR                         | query별 Reciprocal Rank의 macro mean                                                      | 첫 relevant 순위 비교에 적합                                     |
| nDCG@k                      | `DCG=sum((2^grade-1)/log2(rank+1))`, ideal DCG로 나눔                                     | graded relevance 순서 측정. ideal DCG 0은 `N/A`                  |
| No-result Accuracy          | expectedNoResult query 중 반환 item이 0개인 query 비율                                    | 관련 없는 질문의 false positive 측정                             |
| Citation Correctness        | emitted citation 중 Golden Claim·Revision·SourceVersion·Evidence binding이 모두 맞은 비율 | relevance와 분리. citation 0은 `N/A`로 보고                      |
| Stale-result Rejection Rate | STALE·DEGRADED trial 중 result 0 + stale status를 모두 만족한 비율                        | 품질보다 안전 계약. 결과 0만으로 통과하지 않음                   |

query 결과 수가 적은 초기 corpus에서는 P@k보다 Hit Rate·Recall·MRR이 더
직관적일 수 있다. 그러나 지표를 삭제하지 않고 raw counts, k, relevant count를
함께 보고한다.

### 7.3 LLM Judge 경계

- exact text, Evidence span, schema, relevance ID, rank, citation binding, stale blocking은 LLM
  Judge 없이 계산한다.
- Semantic Claim Match·평가 이유 제안에만 Judge를 사용할 수 있다.
- Judge run은 provider, model, model version, prompt text+version, temperature, seed 지원
  여부, input digest, raw output digest와 사람 review status를 남긴다.
- Judge 결과만으로 Quality Gate를 통과하지 않고, disagreement·abstention을
  숨기지 않는다.

## 8. Reproducibility Contract

각 run은 다음을 불변 result manifest에 남겨야 한다.

```text
runId
runMode = deterministic-recorded | live-provider
corpusId
corpusVersion
corpusDigest
labelSetRevision
evaluationContractVersion
applicationCommitSha
moduleVersions
adapterVersions
projectorVersions
databaseVersion
databaseExtensionVersions
databaseSearchConfiguration
providerName
providerAdapterVersion
providerModel
providerModelVersion
promptVersion
policyVersion
randomSeedOrDeterministicSettings
startedAt
completedAt
metricImplementationVersion
caseResults
aggregateResults
sliceResults
failureDetails
environmentSummary
```

재현성 구분:

| 범위                         | 기대                                             | 전략                                                                                          |
| ---------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Corpus parsing·digest·metric | 동일 input+version에 byte-identical result       | 정렬·clock·ID 주입, float convention version 고정                                             |
| Transformation·Evidence      | 결정적 Adapter에서 동일 hash·selector            | 기존 Golden을 재사용하되 Quality slice와 분리                                                 |
| Fake/recorded Provider       | 동일 stored output으로 동일 Candidate            | Provider를 재호출하지 않고 immutable output digest 사용                                       |
| PostgreSQL search            | 동일 DB/extension/config/seed에 동일 order·score | PostgreSQL·`pg_trgm` version, collation, FTS config, tie-break 기록                           |
| Live Provider                | 완전한 결정성 비보장                             | 반복 run, per-run raw result, 분포·disagreement·cost·latency 보고; recorded regression과 분리 |

Run timestamp는 실행 식별용이지 metric input이 아니다. Failure detail에 원문
전체를 기본 로그로 남기지 않고 case ID, digest, safe reason을 기록한다.

## 9. Data·Security·License 경계

### 9.1 허용·금지 데이터

허용:

- 직접 작성한 synthetic Korean·English·mixed corpus
- 저장소의 기존 비식별 fixture를 명시적으로 versioned case에 편입한 자료
- 정확한 사용·재배포 라이선스와 source URL이 기록된 공개 자료
- 명시적 승인과 비식별 검증을 거친 test data

금지:

- API key, session token, credential, secret과 실제 사용자 이메일 원문
- 실제 비공개 문서, 개인 대화, Production DB dump
- 라이선스·provenance가 불명확한 대규모 corpus 복제
- Production project ID·actor ID·access token을 평가 context로 재사용하는 것

### 9.2 권한·Provider 전송

- Corpus와 Label은 Production Canonical table에 write하지 않는다.
- 기본 corpus는 `public` 또는 synthetic `internal`로 한다. `private` test data는
  별도 승인·비식별·Provider policy를 요구한다.
- 현재 정책과 같이 `restricted`는 live external Provider에 전송하지 않는다.
- result artifact는 raw Source 전체보다 ID·hash·metric·safe failure를 기본으로
  보존한다.

### 9.3 라이선스 기록

외부 자료 또는 도구에는 repository/source URL, tag/commit, code license, data
license, retrieved date, modification, redistribution scope, removal/replacement 방법을 기록한다.
Code license가 dataset license를 대체하지 않는다.

## 10. OSS·표준 비교

검토 기준일은 2026-07-22이다. 이 Section에서 새 의존성을 추가하지 않는다.

| 후보                                                                                     | 검토 버전·Commit                                                                                     | License·유지보수                                       | 제안 결정        | 경계·근거                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [NIST `trec_eval`](https://github.com/usnistgov/trec_eval)                               | `v10.0`, `f4253652c8efd0d86ddffd0d163cc0a0f813111a`; main `ba38899cbd4de0fb699b47f39b64ef1c107e4a5c` | NIST notice + original-code copyright; 2026-07-20 활동 | `REFERENCE_ONLY` | qrels/run 구조와 IR metric 정의 교차 검증. C binary/runtime은 도입하지 않음                                                                       |
| [TREC qrels/run convention](https://github.com/usnistgov/trec_eval/blob/v10.0/README.md) | `trec_eval v10.0`                                                                                    | NIST project                                           | `REFERENCE_ONLY` | Shotgun JSON contract이 권위. export/import 참고 형식으로만 사용                                                                                  |
| [`ir_measures`](https://github.com/terrierteam/ir_measures)                              | `v0.4.3`, `bb9ece5c1ec6a0027c8a9f7a8ee428614f8a2f44`                                                 | Apache-2.0; 2026-02-17 활동                            | `DEFER`          | 광범위 metric·trec provider는 유용하지만 Python toolchain을 추가함. Section 3에서 test-only 교차 검증으로 재평가                                  |
| [`ranx`](https://github.com/AmenRa/ranx)                                                 | `7363db0c35e92e90d6fa6fe73907b760678f765e`                                                           | MIT; 2025-08-07 최종 활동, 검토 시 tag 없음            | `DEFER`          | 통계 비교는 유용하지만 Python·Numba 부하와 현재 metric 범위 대비 과도함                                                                           |
| [`promptfoo`](https://github.com/promptfoo/promptfoo)                                    | `0.121.19`, `1ede17aaed940e6dff04f71d24e4ecc011809dae`                                               | MIT; 2026-07-14 release                                | `DEFER`          | Node·TypeScript·custom provider는 적합하지만 광범위 LLM eval/runtime과 큰 dependency surface. live Provider Section 2에서 test-only 후보로 재검토 |
| [OpenAI Evals](https://github.com/openai/evals)                                          | main `8eac7a7de5215c907fbddc30efdaf316913eccdd`                                                      | MIT code, dataset별 별도 license; 2026-04-14 활동      | `REFERENCE_ONLY` | sample·grader·result provenance 패턴만 참고. Python runtime과 bundled dataset은 도입하지 않음                                                     |
| 현재 Ajv                                                                                 | `8.20.0` lockfile pin                                                                                | MIT, 기존 `ADOPT`                                      | `ADOPT` 유지     | corpus/result JSON Schema 검증에 재사용. 새 validator 도입 불필요                                                                                 |
| Shotgun `stableJson` + `sha256Text`                                                      | application commit에 결속                                                                            | Node `crypto`, Shotgun 소유                            | `ADOPT` 유지     | corpus·result digest에 재사용. serialization contract version 필수                                                                                |

정량 metric 핵심은 작고 결정적이며 TypeScript로 구현 가능하다. 따라서
외부 framework를 Production runtime에 넣을 근거가 없다. 후속 구현은 Shotgun이
계약·identity·security를 소유하고, 외부 도구는 필요할 때 test-only 교차 검증으로
격리한다.

## 11. Section 분해 후보

| Section                                       | 독립 승인 단위                                | 입력                                             | 생성/Production 영향                                           |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| 1. Golden Corpus and Evaluation Contract      | corpus·label·metric·run 계약 승인             | 현재 코드·테스트·표준 조사                       | 문서와 Proposed ADR만; Production 변경 없음                    |
| 2. Claim Extraction Baseline Benchmark        | fixture·runner·recorded/live baseline 승인    | 승인된 Section 1                                 | test/eval artifact; 초기 Production 로직 변경 없음             |
| 3. Natural-language Search Baseline Benchmark | PostgreSQL qrels·ranking baseline 승인        | approved Claim corpus와 seeded Canonical mapping | test/eval artifact·DB test; 초기 ranking 변경 없음             |
| 4. Regression Thresholds and CI Enforcement   | metric별 threshold·slice·flaky/live 정책 승인 | Sections 2·3 baseline                            | CI workflow·threshold config; Production 로직 변경 없음        |
| 5A. Evidence-based Lexical Improvement        | baseline 대비 개선·rollback 승인              | 실패 slice·ablation                              | 필요할 때 normalization·FTS·trigram·ranking Production 변경    |
| 5B. Semantic Retrieval Decision               | 필요성·비용·보안·Port·rollback 별도 승인      | lexical baseline이 증명한 미해결 gap             | `DEFER`; 승인 시만 embedding/vector/reranker Architecture 변경 |

제안된 Section 1–4 분해는 적절하다. 다만 기존 Section 5는 lexical improvement와
semantic Architecture를 같은 승인 단위로 묶지 않고 5A·5B로 분리하는 것을
제안한다.

## 12. 확정 후보

다음은 사용자 승인 시 Section 1의 normative contract로 고정할 후보다.

1. Golden Label은 test oracle이며 Claim·Fact·Canonical Knowledge가 아니다.
2. Corpus run은 Production Canonical table을 변경하지 않는다.
3. Case·Label·Corpus·Run은 version, review history, provenance, digest를 가진다.
4. AI-generated Label은 사람 승인 전까지 `CANDIDATE`다.
5. 현재 direct-only Claim은 exact text + exact Evidence의 order-independent 1:1
   matching으로 Gate metric을 계산한다.
6. Evidence position은 Unicode code point이고 format selector는 해당 slice에서 검증한다.
7. Search relevance는 closed corpus의 exhaustive `0|1|2` judgment를 사용하고
   binary metric은 `>=1`을 relevant로 본다.
8. 결정적 metric에 LLM Judge를 사용하지 않고 Judge-only Gate를 금지한다.
9. Recorded/Fake Provider regression과 live Provider statistical evaluation을 분리한다.
10. Threshold, corpus 크기, `k`, live 반복 횟수는 baseline 전에 고정하지 않는다.
11. PostgreSQL Search Adapter가 baseline 권위이며 in-memory score parity를 가정하지
    않는다.
12. 새 runtime dependency는 OSS Gate·pin·license·replacement 검증 없이 도입하지
    않는다.

## 13. 미결사항

다음은 Section 2·3 착수 승인 전에 결정해야 한다.

- 초기 corpus의 case 수와 slice별 최소 개수
- 독립 label reviewer 수, self-review 허용 여부, disagreement 해결 절차
- reviewed semantic alias를 diagnostic에만 쓸지 보조 metric으로 보고할지
- 초기 `k` 집합(예: 1, 3, 5, 10)과 limit 20 계약의 관계
- macro metric의 slice weight와 class imbalance 보고 방식
- live Provider 반복 횟수, confidence interval, 비용 ceiling과 stop rule
- 전체 Source 형식을 한 corpus에 넣을지 format family별 sub-corpus로 버전할지
- `claimType`·temporal status가 Production contract에 추가될 때 label migration 방법
- benchmark result artifact의 repository 보존 범위와 CI artifact retention
- external public corpus를 사용할 필요가 있는지와 dataset별 license 승인
- Threshold 산정 규칙과 regression budget; Section 4 전까지 미정

## 14. 제외 대안

| 대안                                                  | 제외 이유                                                  | 재검토 조건                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Golden Label을 Canonical Claim/Fact로 저장            | 평가 권위가 사용자 Knowledge 권위를 침범                   | 재검토 없음; 항상 분리                                           |
| Production data dump로 corpus 생성                    | 개인정보·비밀·저작권·삭제 위험                             | 명시적 법적 근거·승인·비식별 계획이 별도로 있을 때만             |
| exact 비교 대신 LLM Judge 단일 점수                   | 비결정성과 model bias가 direct-only 실패를 숨김            | semantic profile이 별도 승인된 후에도 보조용만                   |
| Claim·Search·Citation을 하나의 composite score로 표시 | 안전·retrieval·extraction 실패 원인 상실                   | dimension은 유지하고 dashboard summary만 필요할 때               |
| 즉시 semantic retrieval 도입                          | lexical baseline과 필요성 증거 없음; ADR-087·090 경계 위반 | Section 5B의 독립 승인 후                                        |
| Python/C 평가 framework 즉시 설치                     | TypeScript toolchain 부하와 과도한 dependency surface      | 직접 metric 교차 검증이 필요함을 prototype이 증명할 때 test-only |
| in-memory ranking을 PostgreSQL baseline 대체로 사용   | normalization·score·threshold가 다름                       | Adapter parity contract을 별도로 도입한 후                       |
| 번역 Source와 원문 Source를 같은 slice로 aggregate    | translation 오류와 extraction 오류가 혼합                  | provenance별 독립 보고를 유지한 후에도 통합 점수는 금지          |

## 15. 영향 범위

현재 제안의 영향:

- 문서: 본 설계 후보와 Proposed ADR-098, hardening strategy의 stale merge 표현
- Production code: 변경 없음
- Test: 변경 없음
- Dependency·lockfile: 변경 없음
- Database·migration·index·FTS·`pg_trgm`: 변경 없음
- Prompt·Provider·model: 변경 없음
- CI threshold: 변경 없음
- Notion Canonical ADD: 사용자 승인 전 반영하지 않음

사용자 승인 전 상태:

```text
Security Gate: COMPLETE
Durability Gate: COMPLETE
Quality Gate: IN_PROGRESS
Quality Section 1: DESIGN CANDIDATE / NOT APPROVED
Quality Section 2: NOT STARTED
Quality Section 3: NOT STARTED
Quality Section 4: NOT STARTED
Quality Section 5: NOT STARTED / CONDITIONAL
Reuse and Operations Gate: NOT STARTED
Stage 12.1: IN_PROGRESS
Stage 13: NOT STARTED
```

## 16. 승인 후 구현 계획

Section 1 사용자 승인 후에만 다음을 순서대로 진행한다.

1. ADR-098의 확정 사항·미결사항을 승인 결과에 맞게 교정하고 별도
   승인 전에는 `Accepted`로 바꾸지 않는다.
2. Quality corpus·case·run JSON Schema v1과 TypeScript type을 추가하고 기존 Ajv
   contract test로 invalid label·digest·authority state를 거부한다.
3. synthetic 소규모 corpus를 작성하고 독립 label review·license·digest를 완료한다.
4. Section 2에서 recorded/Fake Provider를 사용한 결정적 Claim metric runner와
   선택적 live Provider 레인을 분리 구현한다.
5. Section 3에서 격리 PostgreSQL에 approved corpus Claim을 seed하고 완전한
   relevance judgment으로 Search metric을 계산한다.
6. TypeScript metric을 small hand-calculated fixture와 NIST/`ir_measures` reference result에
   교차 검증한다. 외부 tool 도입은 별도 OSS Gate를 적용한다.
7. baseline을 두 번 이상 재생해 결정적 레인의 digest parity와 live 레인의
   분포를 보고한다.
8. Section 4에서 baseline·risk slice·false-pass 검토 후 threshold와 CI 실행
   계층을 별도 승인받는다.
9. Section 5A에서만 실패 근거에 따라 lexical Production 개선을 검토하고,
   semantic retrieval은 Section 5B 독립 결정 전까지 `DEFER`를 유지한다.

이 문서가 Draft PR에 있다는 사실은 Section 1 승인, Claim/Search 품질 검증,
Quality Gate 완료, Stage 12.1 완료를 의미하지 않는다.
