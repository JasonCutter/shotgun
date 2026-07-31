<!-- Legacy source: https://app.notion.com/p/39f5181d71ad81a6a51ff7f2a3a88ee6 -->

# Project Shotgun ADD

Project Shotgun의 승인된 Phase 1–6 Architecture Design Document(ADD)를 관리하는 Git Canonical 영역입니다.

> **Authority migration — 2026-07-29:** 이 문서 계층은 2026-07-16 Notion ADD 허브에서 Export한 승인 기록을 보존한 것입니다. ADR-120에 따라 현재 권위는 `JasonCutter/shotgun` 저장소 `main`의 이 경로이며, Notion 페이지는 Legacy Reference·Provenance·변경 이력으로 유지합니다. 하위 문서에 남은 과거 `Notion Canonical` 표현은 당시 운영 상태를 설명하는 역사적 기록이며 현재 권위를 의미하지 않습니다.

## 문서 기준

- Canonical 정책은 [`docs/CANONICAL.md`](../../CANONICAL.md)를 따른다.
- 승인된 원문 정책, ADR, 사용자 결정, 미결사항, 구현 검증 대기와 변경 이력을 임의로 삭제하거나 조용히 재작성하지 않는다.
- 각 문서의 Notion URL은 Legacy Source 식별자다. Notion 단독 변경은 Candidate이며 Git PR과 `main` 병합 전에는 Canonical이 아니다.
- Google Drive와 기타 외부 저장소는 별도 Reference 또는 Archive 경계를 따른다.

## 완료 상태와 문서 범위

| Phase | 설계 상태 | 범위 | 문서 |
| --- | --- | --- | --- |
| Phase 1 | 완료 | Step 1–3, Section 1.1–3.8 | [Phase 1](phase-01-input-and-original-preservation/README.md) |
| Phase 2 | 완료 | Step 4–7 | [Phase 2](phase-02-transformation-and-grounding/README.md) |
| Phase 3 | 완료 | Step 8–9 | [Phase 3](phase-03-knowledge-candidate-generation/README.md) |
| Phase 4 | 완료 | Step 10–14 | [Phase 4](phase-04-comparison-change-approval/README.md) |
| Phase 5 | 완료 | Step 15–17 | [Phase 5](phase-05-canonical-knowledge-and-discovery/README.md) |
| Phase 6 | 완료 | Step 18–22, Section 43개 | [Phase 6](phase-06-utilization-results-feedback/README.md) |

`완료`는 승인된 Architecture 설계 완료를 뜻한다. 코드 구현·제품 검증·배포·운영 완료는 각 Engineering Evidence와 Completion Record에서 별도로 판정한다.

## 주요 확정 경계

- GPT·Gemini·Claude를 폭넓게 활용하되 특정 공급자에 Canonical 계약을 고정하지 않는다.
- AI 결과는 사용자 승인 전 후보이며, 권한·정책 집행·상태 전이·Canonical 반영은 결정적 시스템과 승인 경계가 담당한다.
- Claim과 Fact를 구분하고 모든 후보와 파생 결과는 Provenance를 가진다.
- 중요한 결정은 ADR로 기록하며 과거 결정을 조용히 덮어쓰지 않는다.
- Compiled Truth는 Canonical 기록에서 재생성되는 파생 Projection이다.
- 시각 의미가 있는 자료와 시각 산출물은 멀티모달 AI 검증을 거친다.
- 비한국어 의미 구간은 자동 번역할 수 있지만 Citation은 원문 EvidenceSpan을 가리킨다.
- 원본 검증은 즉시 수행하고 비용성 AI 작업은 승인된 Batch 정책에 따라 실행한다.
- 승인된 Action 후보와 실제 외부 Action 실행을 분리한다.
- 사용자 피드백은 Fact·Directive·Preference를 구분해 재진입시킨다.

## ADR 범위

Phase 2부터 Phase 6까지의 과거 승인 ADR-018–ADR-075는 Phase별 ADR 문서에 보존한다. 저장소 전역 ADR 번호·중복·Supersession의 현재 상태는 전역 ADR Registry가 별도로 관리한다.

## Frontend Phase 2 Section 2 완료 기록

- 완료일: `2026-08-01`
- 상태: **COMPLETE**
- 구현 PR: `#48` — Frontend Phase 2 Section 2: Ask Write, Persistence and Outcome Recovery
- 검증 Branch Head: `433535a79db9e18f42c1f628640627aae33ba3ba`
- 검증 CI Run: `30660197226` — Quality, Frontend, Required Gates **SUCCESS**
- Merge Commit: `9a4fadda51ff686cf762217108fe75ffa5d9a311`
- governing ADR: [`ADR-123`](../adr/ADR-123-ask-command-conversation-persistence-and-outcome-recovery-boundary.md)
- Frozen Contract: [`frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md`](../contracts/snapshots/frontend-phase-2-section-2/frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md)
- Verification Record: [`frontend-phase-2-section-2-slices-4-5-verification-and-completion-record-260801001.md`](../../implementation/frontend-phase-2-section-2-slices-4-5-verification-and-completion-record-260801001.md)

### 확정된 결정

1. Submit Question은 보호된 Product API와 기존 Frontend Command Ledger를 통하는 Server-authoritative 명령이다.
2. `AskCommandCoordinator`, Command Gateway, Conversation Repository와 Read Projection은 서로 분리된 책임이다.
3. Transaction A에서 명령을 `ACCEPTED`로 영속화하고, Transaction B에서 Conversation aggregate와 Ledger `COMPLETED`를 동일 PostgreSQL transaction으로 Commit한다.
4. 새 질문은 Server Active Project에 결속하고, Follow-up은 Conversation Resource Project에 결속한다. Follow-up이 Active Project를 변경하지 않는다.
5. Conversation·Branch·Turn·AnswerRun은 전역 고유 opaque ID와 독립적인 durable revision을 가진다.
6. Follow-up은 expected Conversation·Branch revision을 요구하며, row lock·optimistic predicate·Branch ordinal uniqueness로 lost update를 차단한다.
7. 의미 payload 전체와 순서가 보존된 SourceSelections·Evidence IDs를 semantic digest에 포함한다.
8. Outcome 복구는 별도 Ask outcome table이 아니라 기존 Ledger와 `producedResources`를 사용하고 Principal·target Project 범위로 제한한다.
9. Source·SourceVersion·Evidence의 존재, 소유 관계, Project 범위와 sensitivity를 aggregate mutation 전에 검증한다.
10. Production runtime은 PostgreSQL Ask Write·Query·Validation adapter를 사용하며 In-memory adapter는 테스트·명시적 로컬 fixture에 한정한다.
11. Browser는 `OUTCOME_UNKNOWN`에서 원래 `clientRequestId`, idempotency key와 Draft를 보존하고 mutation을 자동 재제출하지 않는다.
12. 모델 실행이 구성되지 않은 Slices 4–5 초기 AnswerRun은 `ACTION_REQUIRED / MODEL_EXECUTION_NOT_CONFIGURED`이며 생성된 답변 성공으로 표시하지 않는다.
13. Ask 결과는 Canonical 지식 또는 Transition Seed를 자동 생성·변경하지 않는다.

### 미결사항

Section 2 Frozen Contract 범위 내 Blocker는 없다.

다음 항목은 의도적으로 다음 Section 또는 별도 승인 범위에 남긴다.

- Ask 외부 AI provider와 실제 모델 실행
- Streaming과 partial-event recovery
- Cancel
- Domain Retry
- Export와 Feedback
- `IntakeDraftSeed`, `DraftChangeSetSeed`, `UserDirectiveProposalSeed`
- Ask 결과의 명시적 Canonical 전환 UI와 Workflow

### 제외한 대안

- Read Projection 내부의 in-memory command·outcome·mutation 소유
- 기존 Frontend Command Ledger와 병렬인 Ask 전용 command ledger 또는 `submission_outcomes` table
- aggregate transaction 밖에서 Ledger를 `COMPLETED`로 변경하는 방식
- Follow-up revision precondition 생략
- Production에서 array length로 Turn ordinal을 할당하는 방식
- SourceVersion·Evidence ID의 문자열 형태만 검사하는 방식
- uncertain response 후 새 idempotency key를 자동 생성하는 방식
- 모델 실행 없이 `QUEUED`를 실제 진행 상태처럼 노출하는 방식
- Ask 결과를 자동으로 Canonical에 반영하는 방식

### 영향 범위

- Product API: Submit Question과 outcome resolution이 durable protected operation으로 전환됨.
- Command infrastructure: 기존 Ledger에 transaction-bound completion 경계가 추가됨.
- Database: managed `frontend_ask` aggregate schema와 reset·verify lifecycle이 활성화됨.
- Browser: unresolved command recovery가 명시적이고 fail-closed로 동작함.
- Canonical knowledge: 자동 변경 없음.
- Frontend Phase 2 Section 3: 시작하지 않음. Knowledge Flow에 따른 별도 Section 개시와 승인이 필요함.

## 이관 출처

- Legacy Notion hub: `39f5181d-71ad-81a6-a51f-f7f2a3a88ee6`
- 최초 Git Export commit: `f0d7f7a65a11f28dc9e3bc3a6e47a084b46541eb`
- 최초 Export PR: `#1` — 폐쇄·미병합된 역사적 Export
- 현재 이관은 해당 Export를 현재 `main` Canonical 정책에 맞춰 재검증한 뒤 병합한다.
