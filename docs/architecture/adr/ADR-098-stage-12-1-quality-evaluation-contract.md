# ADR-098: Stage 12.1 Quality Evaluation Contract

- 상태: **Proposed**
- 일자: 2026-07-22
- 상위 전략: [Stage 12.1 Hardening Strategy](../../engineering/stage-12-1-hardening-strategy.md)
- 세부 제안: [Stage 12.1 Quality Evaluation Foundation](../../engineering/stage-12-1-quality-evaluation-foundation.md)
- 관련 결정: [ADR-084 — Stage 4 AI Candidate Validation](ADR-084-stage-4-ai-candidate-validation.md), [ADR-087 — Stage 7 Cited Search Projection](ADR-087-stage-7-cited-search-projection.md)

## Context

Stage 4의 direct-only Claim 추출과 Stage 7의 Canonical-only 검색은 구조·권한·Evidence·Projection
안전성을 검증하지만, 품질을 정량 비교할 Golden Corpus, relevance judgment, metric
계약과 재현 가능한 실행 기록은 없다. 기존 Golden fixture는 변환과 Evidence 위치
회귀를 고정하며 Claim Precision·Recall이나 Search MRR·nDCG를 측정하지 않는다.

Golden Label을 Canonical Claim이나 Fact로 취급하면 평가 권위가 사용자의 지식 승인
권위를 침범한다. 반대로 검색 결과를 라벨 없이 평가하거나 LLM Judge 단일
점수로 Gate를 통과시키면 회귀와 근거 실패를 숨길 수 있다.

## Proposed Decision

1. Golden Corpus는 Production Canonical 저장소와 분리된 versioned test artifact로
   관리하며 Production table에 write하지 않는다.
2. Golden Label은 평가를 위한 test oracle일 뿐 Claim이나 Fact가 아니다. AI가 제안한
   Label은 사람이 검토하기 전까지 `CANDIDATE`로 남긴다.
3. Corpus case, label revision, Source content, query relevance judgment와 실행 결과에
   version·provenance·digest를 남긴다.
4. 현재 direct-only profile의 Gate 계산은 exact Claim text, Unicode code-point Evidence
   selector와 1:1 set matching을 사용한다. 순서는 점수에 영향을 주지 않는다.
5. Search judgment는 closed corpus의 모든 Claim에 대한 `0`, `1`, `2` graded relevance를
   사용한다. Binary metric은 `relevance >= 1`을 relevant로 해석한다.
6. Claim과 Search의 결정적 metric을 먼저 계산하며 LLM Judge를 대체제로
   사용하지 않는다. LLM Judge는 검토된 semantic diagnostic에만 제한한다.
7. Recorded/Fake Provider 회귀와 live Provider 통계 평가를 분리한다. 완전한
   결정성을 보장할 수 없는 live 결과를 단일 실행으로 Gate하지 않는다.
8. 통과 Threshold, corpus 크기, `k` 집합과 live 반복 횟수는 baseline 결과와
   사용자 승인 전에 고정하지 않는다.

## Proposed Consequences

- Section 2와 3은 같은 Corpus·Label·Run identity를 사용해 Claim과 Search baseline을
  재현할 수 있다.
- Semantic retrieval은 lexical baseline이 한계를 증명하기 전까지 필수 요구가
  아니다.
- Corpus 원문이나 Label을 Canonical table에 쓰지 않으므로 평가 실행이
  사용자 Knowledge를 변경하지 않는다.
- 결정적 TypeScript metric 구현을 우선하고 Python·C 평가 도구는 교차 검증
  후보로 두어 현재 runtime을 늘리지 않는다.

## Approval Boundary

이 ADR은 `Proposed`이다. 사용자 승인 전에 `Accepted`로 바꾸지 않으며, Quality
Section 1이나 Quality Gate를 `COMPLETE`로 표시하지 않는다.
