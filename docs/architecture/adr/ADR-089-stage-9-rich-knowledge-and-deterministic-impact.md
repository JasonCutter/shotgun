# ADR-089 — Stage 9 Rich Knowledge and Deterministic Impact

- 상태: Accepted
- 날짜: 2026-07-17

## 결정

1. `Entity`, `Relation`, `Event`, `Decision`, `Action`, `Conflict`,
   `KnowledgeGap` 후보는 Shotgun 소유 JSON Schema와 Evidence ID를 사용한다.
2. 참조 관계가 있는 후보는 하나의 Atomic Group으로 저장하고 전체 묶음만 승인한다.
3. `POSSIBLY_SAME` Entity에는 Canonical Entity ID를 기록하지 않으며 자동 병합하지 않는다.
4. Relation·Event·Action의 시간 값은 Candidate Evidence 안의 별도 temporal Evidence를
   요구한다. 값이 없으면 추측하지 않는다.
5. Impact는 승인된 `RelationCandidate`의 방향이 있는 Typed Edge만 너비 우선으로
   탐색한다. 깊이·노드 수 제한과 순환 방지를 적용한다.
6. NetworkX 3.6.1은 production runtime이 아니라 독립 graph oracle로 채택해 같은
   fixture의 방문 노드와 edge를 비교한다.
7. Entity Vault는 `PENDING_APPROVAL → APPROVED_FOR_REVIEW` staging만 제공하며
   Canonical 양방향 동기화는 금지한다.
8. Cytoscape.js 도입은 Stage 10으로 연기하고 같은 `KnowledgeGraphView`를 사용하는
   목록·표 fallback을 Stage 9의 기본 UI로 제공한다.
9. Stage 9의 `APPROVED`는 검토 원장의 승인 상태이며 Canonical write 권한은 계속
   `stage6.canonical-knowledge`만 가진다.

## 이유

gbrain의 graph traversal은 방향·유형·깊이와 cycle 처리에 유용하지만 내부 `pages`,
`links`, timeline DB 모델에 결합되어 있다. OpenKnowledge의 Graph·Entity Vault UX는
유용하지만 GPL runtime을 현재 제품 경계 안에 포함할 수 없다. Shotgun Contract를
소유하면서 검증 가능한 알고리즘과 UX 패턴만 재사용하는 것이 가장 작은 안전 경계다.

## 결과

- 모델 출력이 달라도 모든 원본 출력과 불일치 표시가 보존된다.
- 일부 항목만 승인해 dangling reference가 생기는 경로가 없다.
- Action은 계속 후보 상태이며 외부 실행 권한을 얻지 않는다.
- Graph renderer를 바꿔도 Impact·Typed Edge·목록·표 계약은 유지된다.
- 향후 Stage 10 Projection은 승인된 Stage 9 계약을 입력으로 사용할 수 있다.
