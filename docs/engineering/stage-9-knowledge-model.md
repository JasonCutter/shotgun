# Stage 9 Knowledge Model, Impact and Advanced Review

## 목적

Claim 외 지식 유형을 근거와 함께 묶어 검토하고, 승인된 실제 관계만 따라 영향을
계산한다.

## 제공 유형

- EntityCandidate
- RelationCandidate
- EventCandidate
- DecisionCandidate
- ActionCandidate (`CANDIDATE_ONLY`)
- Conflict
- KnowledgeGap

모든 유형은 `sourceVersionId`, 하나 이상의 `evidenceIds`, 하나 이상의 `modelOutputs`를
가진다. 모델별 값은 합치지 않고 그대로 보존하며 값이 다르면 UI에 검토 필요로 표시한다.

## 안전 규칙

- `POSSIBLY_SAME`은 후보 Canonical ID 목록만 보존하며 자동 병합하지 않는다.
- 시간 값에는 Candidate Evidence의 일부인 `temporalEvidenceIds`가 필요하다.
- Relation·Event·Decision·Action의 Entity 참조는 존재하는 Entity를 가리켜야 한다.
- 참조가 연결된 Atomic Group은 전체 항목만 승인·보류·거절할 수 있다.
- Impact는 `APPROVED` Group의 Relation만 사용하고 AI가 추측한 link는 사용하지 않는다.
- ActionCandidate는 실행 API가 없으며 외부 작업은 Stage 11 승인 흐름 전까지 불가능하다.

## API와 화면

| 경로                                   | 역할                                  |
| -------------------------------------- | ------------------------------------- |
| `POST /knowledge/groups/stage`         | Evidence 검증 후 Atomic Group staging |
| `POST /knowledge/groups/review`        | 전체 Group 승인·보류·거절·수정 재진입 |
| `POST /knowledge/groups/resolve`       | Group과 모델 불일치 조회              |
| `POST /knowledge/impact`               | 승인 Typed Edge 영향 조회             |
| `POST /knowledge/graph/query`          | Graph·목록·표 공통 View Model 조회    |
| `GET /knowledge`                       | 목록·표 fallback 화면                 |
| `POST /knowledge/entity-vault/stage`   | Entity Vault import staging           |
| `POST /knowledge/entity-vault/review`  | Canonical 반영 전 별도 승인           |
| `POST /knowledge/entity-vault/resolve` | 재시작 후 staged Entity 목록 재조회   |

사용자 수정은 의미에 따라 다음 Phase로 돌아간다.

| 수정 유형          | 재진입            |
| ------------------ | ----------------- |
| WORDING_LAYOUT     | PROJECTION_ONLY   |
| FACTUAL_CORRECTION | VALIDATION        |
| NEW_KNOWLEDGE      | EVIDENCE          |
| REFERENCE_CHANGE   | COMPARISON_IMPACT |

## 실행 준비

NetworkX 검증용 의존성을 고정 버전으로 설치한다.

    python -m pip install -r adapters/networkx-impact-oracle/requirements.lock

전체 개발 검사는 다음 명령으로 실행한다.

    npm run check
    npm run db:reset
    npm run test:database
    npm run db:verify

## Migration과 Rollback

`009_stage9_knowledge_model.sql`은 `knowledge.review_groups`와
`knowledge.entity_vault_imports`를 만든다. 개발 환경은 `npm run db:reset`으로 001부터
009까지 재생성한다. 배포 rollback은 Stage 9 writer를 먼저 중지하고 `knowledge` schema를
백업한 뒤 이전 application revision으로 되돌린다. 아직 Stage 10 consumer가 없으므로
이번 Stage 데이터는 기존 Claim Canonical과 분리되어 있다.

## 현재 한계

- 2D canvas는 Stage 10에서 Cytoscape.js를 재평가한다. 목록·표는 항상 유지한다.
- Entity Vault 승인은 import를 Canonical에 쓰지 않고 다음 검토 단계로 넘기는 승인이다.
- Stage 9는 rich knowledge의 승인 원장을 제공하며 Compiled Truth projection은 Stage 10이다.
