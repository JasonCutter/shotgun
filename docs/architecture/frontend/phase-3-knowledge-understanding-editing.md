---
id: FRONTEND-PHASE-3-KNOWLEDGE-UNDERSTANDING-EDITING
classification: CANONICAL
status: design_and_contract_confirmed_implementation_verification_pending
approved_by: user
approved_at: 2026-07-24
legacy_source_id: 3a65181d-71ad-8124-9ae7-c1dbd602ec22
---

# Frontend Phase 3 — Knowledge Understanding·Editing

## 상태

- Section 설계·구현 Contract 정규화 완료
- Product 구현·E2E·보안·접근성 완료는 별도 판정
- 관련 ADR: ADR-106, ADR-107, ADR-108

## Section 1 — Knowledge Workspace

- Canonical Knowledge와 Compiled Truth를 탐색한다.
- Fact, Claim, Candidate, Derived Inference, Conflict와 Knowledge Gap을 구분한다.
- Evidence, SourceVersion, Revision과 시간 의미를 표시한다.
- Search·Filter·Compare·Stable ID·Deep Link를 제공한다.
- Compiled Truth는 `ProjectionKind`이며 Canonical Knowledge 또는 Domain Resource Kind가 아니다.

## Section 2 — Knowledge Editor·DraftChangeSet Authoring

- `DraftChangeSetSeed`를 받아 Typed DraftChangeSet과 Operation을 작성한다.
- Base Revision, Evidence, Rationale와 Impact Preview를 결속한다.
- Validation, Stale, Conflict와 Review 제출 상태를 구분한다.
- Browser Editor State는 Canonical을 직접 변경하지 않는다.
- Background Refetch 또는 Server Revision 변경이 Dirty Draft를 조용히 덮어쓰지 않는다.
- Canonical 변경은 승인된 DraftChangeSet Commit 경계만 사용한다.

## Section 3 — Semantic Graph·Relationship Exploration

- Entity, Fact, Claim, Relation, Event와 Evidence의 Typed Graph Projection을 탐색한다.
- Path, Neighborhood, Conflict, Gap와 Impact Overlay를 제공한다.
- Graph Canvas는 탐색 View이며 Recursive Impact 권위는 Server Analyzer에 있다.
- `ACTION_CANDIDATE`는 기본 Knowledge Graph Node가 아니라 Governance·Dependency Overlay 전용이다.
- Canvas 외에 List·Table·Path 접근성 Fallback을 제공한다.
- `POSSIBLY_SAME` Entity를 자동 병합하지 않는다.

## 통합 권위 계약

```text
Canonical Knowledge
DraftChangeSet
UserDirectiveProposal
Compiled Truth Projection
Graph View Projection
```

각 항목은 서로 다른 권위와 Lifecycle을 가진다.

- Compiled Truth와 Graph Overlay는 직접 Write·Approval·Commit 대상이 아니다.
- Canonical 수정은 Editor DraftChangeSet으로 라우팅한다.
- 반복 Directive 변경은 독립 `UserDirectiveProposal`로 라우팅한다.
- 외부 Action은 Phase 4 `ActionCandidate`로 라우팅한다.
- 같은 UI에 여러 Resource를 함께 표시해도 하나의 승인·Commit·Execution으로 목적을 혼합하지 않는다.
- Stale Snapshot을 자동 Merge·자동 최신화·자동 제출하지 않는다.

## Phase 3 완료 조건

```text
Knowledge 탐색
→ Evidence 확인
→ 변경 후보 작성
→ Impact 검토
→ DraftChangeSet 생성
→ Review 제출 준비
```

현재 판정은 설계·Contract 완료이며 Product 구현 완료가 아니다.
