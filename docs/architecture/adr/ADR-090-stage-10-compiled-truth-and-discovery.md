# ADR-090 — Stage 10 Compiled Truth and Discovery

- 상태: Accepted
- 날짜: 2026-07-17

## 결정

1. Compiled Truth는 Canonical Claim과 접근 가능한 Stage 9 승인 지식을 입력으로 하는 파생
   Projection이다. 독립 원본이나 Canonical write 권한을 갖지 않는다.
2. `projectorVersion + sourceSnapshotDigest`가 같으면 item·edge 정렬과 `logicalDigest`가 같다.
3. Full Rebuild와 Incremental은 같은 Shotgun 계약을 만들며 저장 방식만 교체 가능하다.
4. Claim과 일반 지식은 `CURRENT`, 시간 Evidence가 있는 Event·Relation·Action은
   `PAST`·`FUTURE`·`CURRENT`, Conflict는 `CONFLICT`로 표시한다.
5. Graph Edge는 승인된 `RelationCandidate`만 `APPROVED_TYPED_EDGE`로 투영한다.
   Discovery가 만든 추론 Edge는 Graph에 직접 기록하지 않는다.
6. Discovery는 관계가 없는 승인 Entity를 bounded scan으로 찾아 `DERIVED_INFERENCE`인
   `KNOWLEDGE_GAP` 후보로 만들고 Phase 3 `VALIDATION`에 재진입시킨다.
7. 같은 node·질문의 fingerprint를 Projection 재생성 이후에도 유지해 반복 제안을 억제한다.
8. Cytoscape.js 3.34.0은 화면 Adapter로만 사용한다. 같은 데이터의 목록·표 fallback은
   필수이며 renderer를 제거해도 Domain 계약은 유지된다.
9. PostgreSQL 16의 Shotgun 소유 표를 MVP 저장소로 사용한다. pgvector, Apache AGE,
   OpenSearch, Qdrant는 측정된 한계가 생길 때까지 도입하지 않는다.

## 이유

gbrain Dream Cycle은 순서가 있는 phase, dry-run, bounded drain과 주기 실행 패턴이 좋지만
gbrain의 Page·Link·PGLite/PostgreSQL 모델을 그대로 사용하면 Shotgun Canonical·Evidence·승인
경계에 결합된다. 현재 데이터 규모에서는 하나의 PostgreSQL Projection과 명시적 budget이
가장 단순하고 복구 가능하다.

## 결과

- Projection을 삭제해도 승인 원본에서 다시 만들 수 있다.
- Projection 지연과 실패를 Canonical 손실과 구분한다.
- AI 또는 규칙 기반 발견은 승인 전까지 공식 Graph가 되지 않는다.
- 대형 검색·그래프 제품은 실제 수치가 필요할 때만 추가한다.
