---
id: FRONTEND-PHASE-2-KNOWLEDGE-INPUT-QUESTION
classification: CANONICAL
status: design_and_contract_confirmed_implementation_verification_pending
approved_by: user
approved_at: 2026-07-24
legacy_source_id: 3a65181d-71ad-8122-bfda-c9be8016ef33
---

# Frontend Phase 2 — Knowledge Input·Question

## 상태

- Section 설계·공통 Contract 정규화 완료
- Product 구현·Contract Test·E2E·보안·접근성 완료는 별도 판정
- 관련 ADR: ADR-100, ADR-101, ADR-102, ADR-103, ADR-104, ADR-105

## Section 1 — Sources Workspace

범위:

- Draft Queue
- 파일·URL·직접 Text 입력
- 형식·용량·안전·접근·중복 검증
- IntakeSubmission 이후 상태·부분 성공·취소·재시도
- 정확 중복과 사용자 선택
- Source Library 목록·검색·필터
- Source 상세·원문 Preview·Version History
- Citation·Evidence Highlight·원문 복귀

핵심 계약:

- Source Draft는 생성 Project에 고정하며 Project 전환으로 자동 이전하지 않는다.
- IntakeSubmission은 생성 시 `targetProjectId`에 결속한다.
- Source Library 표시 가능성과 Ask 사용 가능성을 분리한다.
- Ask 가능 여부는 Server `askUsageState`와 Capability로 제공한다.
- Source 선택은 특정 SourceVersion을 고정하고 새 Version으로 자동 이동하지 않는다.
- Exact Duplicate는 기존 자료 재사용, 새 Version 후보, 별도 Source 등록 또는 취소 선택을 제공한다.
- Citation은 SourceVersion·EvidenceSpan·Locator에 고정한다.

Legacy 하위 결정문은 Sources Workspace 1-1~1-7의 출처 이력으로 보존한다. 현재 효력 있는 공통 계약은 이 문서와 Cross-Phase 문서가 제공한다.

## Section 2 — Ask·Conversations Workspace

범위:

- Conversation·Branch·Turn
- QueryPlan·Source Exploration·Answer Run
- Citation·Model·Cost 표시
- Streaming·Partial Result·Cancel·Retry·Outcome Resolution
- Export·Feedback·Knowledge Transition
- DraftChangeSetSeed·IntakeDraftSeed·UserDirectiveProposal 진입

핵심 계약:

- 새 독립 질문은 Active Project에, 후속 질문은 기존 Conversation·Result의 Resource Project에 결속한다.
- 기본 Ask Mode는 Server `defaultAskMode`를 사용하며 사용 불가 시 Canonical fallback과 이유를 표시한다.
- Answer Run의 권위 Snapshot은 `AskAnswerRunSnapshot`이다.
- Source Exploration은 SourceVersion 선택을 필수로 하고 Evidence 선택은 선택 사항이다.
- Ask는 IntakeSubmission을 직접 생성하지 않고 `IntakeDraftSeed`를 통해 Sources Workspace로 재진입한다.
- Ask에서 생성한 Canonical 변경 후보는 `DraftChangeSetSeed → Knowledge Editor → DraftChangeSet` 경계를 따른다.
- AI 답변 자체는 원문 Evidence가 아니다.
- `OUTCOME_UNKNOWN`에서는 같은 질문·Command를 새 Key로 자동 재제출하지 않는다.
- Citation 복귀는 원래 Conversation·Branch·Turn·Result Revision·Scroll·Focus를 복원하고 최신 결과로 자동 이동하지 않는다.

## Phase 2 완료 조건

```text
자료 입력
→ 검증·중복 처리
→ SourceVersion 생성
→ 질문
→ 근거 포함 답변
→ Conversation 복원
→ 후속 Knowledge 작업으로 전환
```

이 완료 조건은 설계 기준이며 현재 Product 구현 완료를 의미하지 않는다.
