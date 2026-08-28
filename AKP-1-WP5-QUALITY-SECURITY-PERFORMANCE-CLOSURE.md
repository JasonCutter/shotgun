# AKP-1 WP5 — Quality, Security, Privacy, Performance and Section Closure Evidence

- 상태: **IMPLEMENTATION COMPLETE / EXACT-HEAD CI PENDING**
- 작성일: 2026-08-28
- WP5 시작 head: `9e09c276e2b628c2de2a802c364d064df01fa361`
- 대상 PR: `#125` (`codex/akp-1r-semantic-runtime-repair`, Draft 유지)
- 관련 계약: [AKP-1 Contract Acceptance](docs/architecture/contracts/snapshots/akp-1/AKP-1-CONTRACT-ACCEPTANCE-260818001.md), [ADR-135](docs/architecture/adr/ADR-135-hybrid-semantic-retrieval-as-rebuildable-derived-projection.md), [ADR-147](docs/architecture/adr/ADR-147-akp-1-fact-authority-deferral-and-semantic-product-eligibility.md), [ADR-148](docs/architecture/adr/ADR-148-akp-1-semantic-runtime-authority-unification.md)
- 기존 R5 기준 증거: CI Run `#1052` / ID `33157103824` / Quality, Frontend, Required Gates 모두 PASS

이 문서는 WP5에서 새로 만든 Golden Query·보안·프라이버시·성능 증거와, R1–R5에서
이미 검증된 변경 불변 증거를 AKP1-AC-01..12별로 묶는다. 최종 Section head의
자동 CI가 이 문서의 exact-head verification을 완성한다.

## 1. 범위와 안전 경계

포함 범위는 다음과 같다.

- 기존 Stage 12 quality-evaluation contract와 `evaluateSearchObservations`를 재사용한 semantic Golden Query corpus와 3-way 비교
- `CLAIM`, `ENTITY`, `RELATION`, `EVENT`, `DECISION`의 authority·provenance·EvidenceSpan·SourceVersion citation 검증
- security-before-top-k, request-local semantic degradation, provider egress/secret non-disclosure를 확인하는 focused evidence
- deterministic representation v2, generation membership, measured local latency와 Section acceptance matrix

다음은 변경하거나 주장하지 않았다.

- Product runtime, Frontend Product code, Playwright test, R1–R5 semantic authority mechanics
- Canonical/Evidence를 vector로 승격하거나 FACT를 Product corpus에 포함하는 동작
- production source의 bulk vectorization, live paid provider call, raw query/secret 저장
- universal similarity·latency threshold, ANN 도입, rank/cutoff policy 변경
- migration, lockfile, new runtime dependency, Ready/merge/deploy, AKP-2

WP5 변경은 test fixture, test helper, focused unit evidence, closure documentation으로
한정된다. Product runtime 변경은 **NO**이다.

## 2. Reuse 및 OSS 결정

기존 Stage 12 평가 foundation을 독립 benchmark로 복제하지 않고, semantic fixture의
resource metadata를 표준 `GoldenCorpus` projection으로 변환하여 기존 digest,
qrels, deterministic metric, run validation을 그대로 사용했다.

| 후보/기반                              | WP5 결정                   | 범위와 제외                                                        |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Stage 12 `packages/quality-evaluation` | `AUGMENT`                  | 기존 evaluator·run digest·validation 재사용; 새 metric engine 없음 |
| `garrytan/gbrain`                      | 기존 `REFERENCE_ONLY` 유지 | WP5 execution/runtime/DB 도입 없음                                 |
| `lucasastorian/llmwiki`                | 기존 `REFERENCE_ONLY` 유지 | 변환/annotation runtime 도입 없음                                  |
| `ddsyasas/llm-wiki`                    | 기존 `REFERENCE_ONLY` 유지 | UX/backend/runtime 도입 없음                                       |
| Inkeep OpenKnowledge                   | 기존 `REFERENCE_ONLY` 유지 | UI pattern만 참고; graph/Yjs/runtime 도입 없음                     |

새 OSS package, upstream version, lockfile 또는 adapter는 추가하지 않았다. 기존
OSS 검토·license·security·maintenance 근거는 [Open Source Role Matrix](docs/architecture/module-architecture/open-source-role-matrix.md)와 R1–R5 implementation records가 소유한다.

## 3. Golden Query corpus

정본 fixture는 [akp-1-semantic-golden-corpus.v1.json](tests/fixtures/akp-1-semantic-golden-corpus.v1.json)이다.

- Corpus kind: `SEMANTIC_SEARCH`
- Raw fixture digest: `sha256:b12bf32f22be7d4de9032d71dffbeedce4bd6e97703fcae03bb6728517501c5f`
- Stage 12 evaluator projection digest: runtime `sha256:b7cb53737ee7dfd68707565c5d98e4e9cab99559e70fb53bbc0120a068b1121d`
- Data policy: synthetic only, production data 없음, live provider 호출 부적격
- Closed set: 8 resources와 8 query qrels; 모든 query가 8개 resource judgment를 정확히 한 번씩 보유
- Authority: canonical Claim 3개, approved Knowledge Entity/Relation/Event/Decision 5개
- FACT: 0개. Product semantic eligibility는 정확히 5개 type이다.
- Source text와 Evidence position은 Unicode code-point 기준으로 deterministic 검증한다.

| Query category            | Query ID                       | 목적                                                                     | expected top-1      |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------ | ------------------- |
| exact                     | `q-release-exact`              | exact lexical/semantic agreement                                         | `r-release-claim`   |
| typo                      | `q-release-typo`               | spelling variation recovery                                              | `r-release-claim`   |
| synonym                   | `q-release-synonym`            | deployment/cadence semantic alias                                        | `r-release-claim`   |
| paraphrase                | `q-release-paraphrase`         | natural-language paraphrase                                              | `r-release-claim`   |
| Korean-English alias      | `q-atlas-korean-alias`         | mixed-language entity alias                                              | `r-atlas-entity`    |
| temporal                  | `q-migration-temporal`         | event/date retrieval                                                     | `r-migration-event` |
| ambiguous neighbor        | `q-release-ambiguous-neighbor` | policy vs claim close-neighbor ordering                                  | `r-release-policy`  |
| negative security control | `q-transfer-negative-control`  | approved transfer policy while private credential controls remain absent | `r-transfer-policy` |

Negative control은 “무관 query를 무조건 no-result로 판정”하는 방식이 아니다. 현재
Product corpus에서 의미가 있는 transfer policy를 확인하면서, 동일 query의 가까운
private/restricted credential resource가 결과에 섞이지 않는지를 검증하는 security
negative control이다.

## 4. Retrieval quality evidence

Focused test는 [akp-1-wp5-closure.test.ts](tests/unit/akp-1-wp5-closure.test.ts)이며,
실제 `HybridRetrievalCoordinator`와 semantic index Port를 통해 lexical-only,
semantic-only, Hybrid 세 lane을 각각 실행한다. quality output은 기존 Stage 12
`evaluateSearchObservations`, `createEvaluationRun`, `validateEvaluationRun`을
사용하며 query text를 observation/run에 저장하지 않는다.

최근 focused 실행 결과는 다음과 같다. 수치는 corpus/adapter evidence를 설명하는
관찰값이며, 보편적인 품질 threshold를 새로 정의하지 않는다.

| Lane          | Queries | Passed cases |   MRR | HitRate@1 | nDCG@3 | Citation correctness |
| ------------- | ------: | -----------: | ----: | --------: | -----: | -------------------: |
| lexical-only  |       8 |            1 | 0.125 |     0.125 |  0.125 |                1.000 |
| semantic-only |       8 |            8 | 1.000 |     1.000 |  1.000 |                1.000 |
| Hybrid        |       8 |            8 | 1.000 |     1.000 |  1.000 |                1.000 |

Lexical-only의 1/8은 fixture에서 exact lexical candidate만 의도적으로 제공한
baseline이다. Semantic-only와 Hybrid는 8개 expected top-1을 모두 회수하고, 모든
반환 item의 citation binding이 맞았다. Hybrid fusion policy는 production
`rrf:v1`, `k=60`을 그대로 사용했다.

## 5. Security, privacy and degradation evidence

WP5 focused matrix는 다음을 통과했다.

- public/owner request에서 private `r-credential-safety`와 restricted `r-private-key-warning`이 semantic top-k에 나타나지 않음
- 두 unauthorized resource가 release query vector와 같은 가까운 거리여도 public candidate가 올바르게 반환됨; filter가 top-k 전에 적용됨
- typed `POLICY_DENIED` semantic failure가 lexical result와 함께 `DEGRADED` readiness로 반환됨
- evaluation observation/run serialization에 raw query text, provider secret marker, `apiKey`, `credentialBytes`가 없음
- canonical Claim과 approved Knowledge resource가 각각의 authority와 revision을 유지하고, EvidenceSpan → SourceVersion lineage가 확인됨

PostgreSQL-required evidence는 새 in-memory assertion으로 대체하지 않는다. 기존
[semantic-index-postgres.database.test.ts](tests/database/semantic-index-postgres.database.test.ts)의
test 10이 PostgreSQL adapter에서 closer unauthorized item이 Top-K slot을
소비하지 못하는 security-before-top-k를 직접 검증하고, tests 9·12·13·15가
fail-closed input, normalization, transaction atomicity, Canonical isolation을
검증한다.

Provider egress와 lifecycle의 unchanged evidence는 [semantic-runtime-r4.test.ts](tests/unit/semantic-runtime-r4.test.ts)의
conservative classification, stale-before-provider, deployment/project denial,
revoked credential, vector identity 검증과 [semantic-runtime-r5-production-chain.database.test.ts](tests/database/semantic-runtime-r5-production-chain.database.test.ts)의
normal startup/restart/policy/stale/reuse/CAS production-chain test를 재사용한다.

## 6. Representation, citation and lifecycle evidence

- 모든 fixture resource는 `semantic-representation:v2` builder로 deterministic text/digest를 생성한다.
- 같은 structured input을 두 번 build해 동일 representation/digest를 확인한다.
- generation은 `READY`, source projection digest, canonical base version, profile/model identity, dimension, distance metric, normalization policy를 고정한다.
- 8개 item을 generation-bound Port에 batch persist하고 membership count/digest를 확인한다.
- 결과 content는 authoritative resolver에서 복원하고, EvidenceSpan과 SourceVersion resolver를 거쳐 citation을 만든다.
- incremental/full generation equivalence, stale/reuse/CAS/rollback 및 FACT exclusion은 기존 R4/R5 lifecycle evidence를 재사용한다.
- Canonical table에 vector를 쓰지 않으며, generation 삭제/교체는 Canonical mutation이 아니다.

## 7. Measured performance

결정적 synthetic fixture, in-memory semantic index, real Hybrid coordinator를 대상으로
3회 warm-up 후 15회 query를 측정했다.

- Query: `q-release-ambiguous-neighbor`
- Workload: semantic query embedding fixture + security filtering + RRF fusion + authoritative citation resolution
- 최근 실행: median **0.081 ms**, p95 **0.227 ms**
- 이 수치는 현재 local test harness의 관찰값이며 Production SLO나 universal threshold로 승격하지 않는다.
- ANN index는 추가하지 않았다. WP5 측정에서 ANN 필요성을 입증하는 production-scale evidence가 없고, 현재 contract의 rebuildable Port 경계를 유지한다.

## 8. AKP-1 acceptance matrix

| Criterion  | Frozen intent                                                         | WP5 closure evidence                                                                 | Status |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| AKP1-AC-01 | vector는 derived/rebuildable이며 Canonical/Evidence/confidence가 아님 | R1–R5 projection boundary + generation/item Port evidence                            | PASS   |
| AKP1-AC-02 | unapproved/raw bulk content 제외                                      | 8개 synthetic approved/current typed resource fixture; FACT/raw bulk 0               | PASS   |
| AKP1-AC-03 | deterministic typed representation/digest/version                     | v2 builder repeatability + item digest assertions                                    | PASS   |
| AKP1-AC-04 | independent embedding profile                                         | R1 profile/identity contract 및 R4 exact execution evidence 재사용                   | PASS   |
| AKP1-AC-05 | vector store는 Port 뒤에 있고 pgvector는 adapter candidate            | in-memory Port flow + PostgreSQL adapter test 10; no external store                  | PASS   |
| AKP1-AC-06 | auth/sensitivity가 retrieval 전/중 적용                               | WP5 closer unauthorized control + PostgreSQL security-before-top-k evidence          | PASS   |
| AKP1-AC-07 | EvidenceSpan/SourceVersion citation 보존                              | 3-way response citation correctness 1.000 + citation contract tests                  | PASS   |
| AKP1-AC-08 | provider egress policy 준수                                           | R4 conservative classification/denial-before-provider evidence; WP5 no live provider | PASS   |
| AKP1-AC-09 | semantic degradation은 허용 범위에서 lexical fallback                 | WP5 typed policy denial fallback + existing R4 degradation matrix                    | PASS   |
| AKP1-AC-10 | incremental invalidation/tombstone/full equivalence                   | existing R4/R5 source snapshot, reuse, stale and production-chain evidence           | PASS   |
| AKP1-AC-11 | generation switch/rollback/pruning이 Canonical을 mutate하지 않음      | R3/R5 CAS, rollback, membership and PostgreSQL Canonical isolation evidence          | PASS   |
| AKP1-AC-12 | Golden Query가 final rank/cutoff policy를 증명                        | 8-query closed qrels; semantic/Hybrid 8/8; `rrf:v1`, `k=60` unchanged                | PASS   |

Matrix의 PASS는 각 criterion의 frozen intent와 기존 exact evidence를 결합한
Section closure 판정이다. Product runtime defect가 발견되거나 rank/cutoff policy와
Golden evidence가 충돌하면 이 matrix를 PASS로 바꾸지 않고 candidate/report에서
중단한다.

## 9. Verification and final boundary

WP5 implementation verification commands:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test:architecture
npm exec -- vitest run tests/unit/akp-1-wp5-closure.test.ts
```

R1–R5의 성공한 Quality evidence는 중복 실행하지 않는다. 새 Section head에서는
repository automation이 Quality, Frontend, Required Gates를 한 번 평가하며, exact
head와 automatic CI result는 PR check와 최종 작업 보고에서 확인한다.

현재 이 문서 작성 시점의 상태:

```text
AKP-1R implementation: COMPLETE
WP5 implementation: COMPLETE
WP5 exact-head CI verification: PENDING
AKP-1 acceptance matrix: PASS, pending exact-head CI closure
Product code modified by WP5: NO
Frontend Product code modified by WP5: NO
Playwright test modified by WP5: NO
Ready: NOT PERFORMED
Merge: NOT PERFORMED
Deploy: NOT PERFORMED
AKP-2: NOT STARTED
```
