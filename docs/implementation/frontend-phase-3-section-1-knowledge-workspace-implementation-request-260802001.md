---
id: FRONTEND-PHASE-3-SECTION-1-KNOWLEDGE-WORKSPACE-IMPLEMENTATION-REQUEST-260802001
classification: IMPLEMENTATION_REQUEST
status: APPROVED_FOR_IMPLEMENTATION
work_item: FE-P3-S1
approved_by: user
approved_at: 2026-08-02
base_commit: cb2513bc311891ac89f53c7d67d6a401da65a2a8
tracking_issue: 52
---

# Frontend Phase 3 Section 1 — Knowledge Workspace 구현 요청

## 1. 목표

`FE-P3-S1 — Knowledge Workspace`를 구현한다.

이 Section은 새 Canonical·Search·Graph 엔진을 만들지 않는다. 기존 Stage 6 Canonical Knowledge, Stage 7 Search Projection, Stage 9 Knowledge Model, Stage 10 Compiled Truth의 Server 권위 Query를 Frontend 전용 Read Projection과 보호된 Product API로 조립한다.

## 2. 기준 상태와 Gap Audit

- Canonical base: `main@cb2513bc311891ac89f53c7d67d6a401da65a2a8`
- Working branch: `codex/frontend-phase-3-section-1-knowledge-workspace`
- Tracking Issue: `#52`
- PR #51 post-merge CI: run `30704764708` SUCCESS
- Governing contract: `docs/architecture/frontend/phase-3-knowledge-understanding-editing.md`
- Governing decision: ADR-106

현재 확인된 기반:

- `PostgresCanonicalKnowledgeRepository`, `PostgresSearchProjectionRepository`, `PostgresKnowledgeModelRepository`, `PostgresCompiledTruthRepository`가 persistent Assembly에 이미 연결돼 있다.
- Kernel Query에는 Canonical Snapshot/Claim/History, Search/Readiness, Compiled Truth/Status, Knowledge Group/Graph/Derived Inference 조회가 존재한다.
- `FrontendProductReadCoordinator`에는 Knowledge 전용 Projection Port가 없다.
- `/knowledge`는 Route Guard만 연결된 Placeholder다.
- `CanonicalClaim`은 Claim, SourceVersion, Evidence, Manifest 계보를 가진다.
- Search 결과는 Commit, Revision, Canonical version, SourceVersion, Evidence와 readiness를 가진다.
- Compiled Truth는 Canonical version, logical/source digest, temporal state, typed items, graph와 lag/status를 가진다.

따라서 첫 구현 경계는 기존 Domain Query를 변경 없이 우선 재사용하고, Product View에서 필요한 계보 또는 상태가 실제로 빠진 경우에만 bounded Query extension을 추가하는 것이다.

## 3. 구현 범위

1. `KnowledgeWorkspaceView`, `KnowledgePageView`, search/filter/compare request·response와 strict runtime decoder를 추가한다.
2. `KnowledgeWorkspaceProjectionPort`와 `FrontendProductReadCoordinator`의 Knowledge read methods를 추가한다.
3. 기존 Server Query를 조합하는 In-memory 및 persistent Adapter를 구현한다.
4. 보호된 versioned Knowledge Product Read API를 추가한다.
5. `/knowledge` 목록·검색·필터 Workspace와 stable detail deep link를 구현한다.
6. Canonical, Approved Knowledge, Compiled Truth Projection, Derived Inference를 authority/type 수준에서 구분한다.
7. Evidence, SourceVersion, Revision, Commit, Manifest, ChangeSet 계보와 pinned 원문 복귀를 제공한다.
8. Search·Compiled Truth readiness, lag, stale, degraded, not-built, partial 상태를 표시한다.
9. Project/access revision 기반 cache key와 invalidation을 적용한다.
10. Contract, Unit, Integration, Database, Architecture, Frontend, Chromium E2E 검증을 추가한다.

## 4. 핵심 계약

- Workspace는 read/search/exploration 전용이다.
- 기본 사용자 단위는 Server가 구성한 `KnowledgePageView`다.
- Compiled Truth는 `ProjectionKind`이며 Canonical Resource 또는 편집 대상이 아니다.
- Fact, Claim, Entity, Relation, Event, Decision, Conflict, Knowledge Gap, Derived Inference와 temporal state를 typed discriminant로 유지한다.
- Search 결과는 Canonical match와 Projection match를 구분한다.
- Server가 ranking, readiness, lag, temporal meaning, access와 sensitivity를 결정한다.
- Browser는 Principal, Session, Project, access scope, sensitivity, policy context, Canonical version 또는 Resource authority를 제출하거나 추론하지 않는다.
- Stable Product/Projection ID는 navigation과 focus에 사용하되 Canonical ID를 대체하지 않는다.
- stale/degraded/not-built Projection을 READY처럼 표시하거나 자동 Canonical 승격하지 않는다.
- 접근 불가능한 deep link는 `NOT_FOUND`로 마스킹한다.
- Workspace는 Canonical write, Approval, Commit, DraftChangeSet materialization, Graph mutation 또는 외부 Action을 실행하지 않는다.

## 5. 제외 범위

- `FE-P3-S2` Knowledge Editor·DraftChangeSet Authoring
- `FE-P3-S3` Semantic Graph Canvas·Relationship Editing
- Canonical write·Approval·Commit
- User Directive 생성
- 외부 Action
- Yjs/CRDT
- 자동 Entity 병합
- 병렬 Search/Graph/Canonical 엔진
- 배포와 Production SLO
- 근거와 별도 승인 없는 Runtime Dependency 또는 DB Migration

## 6. 고정 Acceptance Criteria

| ID | 완료 조건 |
| --- | --- |
| AC-01 | `/knowledge`가 보호된 실제 Knowledge Workspace를 렌더링한다. |
| AC-02 | Active Project가 없으면 Knowledge 데이터 요청·표시가 발생하지 않는다. |
| AC-03 | Product API는 Server-derived Principal·Session·Project·access·sensitivity를 사용한다. |
| AC-04 | 다른 Project 또는 접근 불가 deep link는 보호 메타데이터 없이 `NOT_FOUND`다. |
| AC-05 | Knowledge Page가 typed kind, stable ID, label, temporal state, authority kind를 제공한다. |
| AC-06 | Canonical Claim, Approved Knowledge, Compiled Truth, Derived Inference가 혼동되지 않는다. |
| AC-07 | Search가 score, match type, revision, Canonical version과 readiness를 보존한다. |
| AC-08 | stale/degraded/not-built 상태·lag·reason이 표시되고 READY로 오인되지 않는다. |
| AC-09 | stale/degraded 결과를 자동 최신화·Canonical 승격하지 않는다. |
| AC-10 | 가능한 항목에서 Evidence·SourceVersion·Revision·Commit·Manifest·ChangeSet 계보가 보존된다. |
| AC-11 | Evidence 링크가 pinned SourceVersion으로 이동하고 정확한 복귀 Resource·Revision·focus를 복원한다. |
| AC-12 | Search·filter는 Server 계약 밖의 Client 권위 판단을 하지 않는다. |
| AC-13 | 두 Knowledge Page 비교는 read-only typed compare이며 write proposal을 생성하지 않는다. |
| AC-14 | Stable detail deep link와 새로고침 후 동일 Resource·Revision·focus가 복원된다. |
| AC-15 | Project 전환·access revision 변경 시 이전 Project cache가 재사용되지 않는다. |
| AC-16 | Workspace Capability에 Canonical write·Approval·Commit·external Action이 없다. |
| AC-17 | Projection 실패가 Canonical 권위·이력을 덮어쓰지 않는다. |
| AC-18 | normal·empty·stale·degraded·not-found·access-loss·network-failure UI가 키보드 접근 가능하다. |
| AC-19 | In-memory와 persistent Adapter가 동일 Product Read Contract를 통과한다. |
| AC-20 | Sources·Ask·Session·Project·Global Search와 Required Gates 회귀가 없다. |

AC는 구현 중 축소·완화·재해석하지 않는다. 새 요구는 별도 Backlog 또는 승인된 Scope Amendment로 분리한다.

## 7. 필수 테스트

- strict decoder의 unknown field·invalid discriminant 거부
- Project authority와 inaccessible resource `NOT_FOUND` 마스킹
- canonical/projection/derived type 구분과 계보 보존
- readiness READY/STALE/DEGRADED/NOT_BUILT 및 lag 표시
- stale projection에서 검색 결과를 current Canonical로 오인하지 않는 Negative Test
- Project switch/access revision cache isolation
- stable deep link, browser reload, scroll/focus return
- read-only compare와 금지 Capability Negative Test
- In-memory/persistent Adapter contract parity
- 기존 Sources·Ask route 회귀

## 8. 검증 명령

```text
npm run docs:knowledge-flow:check
npm run docs:frontend-work-items
npm run docs:completion-invariants
npm run docs:frontend-projections:check
npm run docs:validate
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:database
npm run test:architecture
npm run test:stage12-package
npm run frontend:typecheck
npm run frontend:test
npm run frontend:build
npm run frontend:test:e2e
npm run secret:scan
npm run oss:verify
```

하나라도 실패하면 완료 또는 Ready를 주장하지 않는다. 최초 실패, 수정, 동일 계약 재검증 이력을 보존한다.

## 9. 제출 조건

- Product 코드 전에 Gap Audit 결과와 재사용 Query 목록을 남긴다.
- 작은 검증 가능한 Commit으로 작업한다.
- 기존 계약으로 해결되지 않는 아키텍처 결정은 구현으로 숨기지 않고 ADR 후보로 중단·보고한다.
- 최종 보고는 exact Head, 변경 파일, AC별 상태, 명령별 결과, skip/retry, Migration/Dependency 영향과 Known Limit를 포함한다.
- Draft PR은 가능하나 Ready와 Merge는 사용자 승인 전 금지한다.
- `FE-P3-S2`, `FE-P3-S3`, 배포는 시작하지 않는다.
