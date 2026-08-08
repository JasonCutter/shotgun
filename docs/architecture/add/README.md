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

| Phase   | 설계 상태 | 범위                      | 문서                                                            |
| ------- | --------- | ------------------------- | --------------------------------------------------------------- |
| Phase 1 | 완료      | Step 1–3, Section 1.1–3.8 | [Phase 1](phase-01-input-and-original-preservation/README.md)   |
| Phase 2 | 완료      | Step 4–7                  | [Phase 2](phase-02-transformation-and-grounding/README.md)      |
| Phase 3 | 완료      | Step 8–9                  | [Phase 3](phase-03-knowledge-candidate-generation/README.md)    |
| Phase 4 | 완료      | Step 10–14                | [Phase 4](phase-04-comparison-change-approval/README.md)        |
| Phase 5 | 완료      | Step 15–17                | [Phase 5](phase-05-canonical-knowledge-and-discovery/README.md) |
| Phase 6 | 완료      | Step 18–22, Section 43개  | [Phase 6](phase-06-utilization-results-feedback/README.md)      |

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

## Frontend Product 구현 상태

<!-- FRONTEND-WORK-ITEM-STATUS:START -->

> 이 블록은 `docs/project/frontend-work-items.json`과 Section Completion Manifest에서 생성됩니다. 블록 내부를 직접 수정하지 않습니다.

| Work Item                              | Status        |
| -------------------------------------- | ------------- |
| FE-P5 — Operations and Audit           | `IN_PROGRESS` |
| FE-P5-S2 — History, Audit and Rollback | `NOT_STARTED` |

- 미충족 필수 기준: `manifest unavailable`
- Next valid Product Section: `NONE — none`

<!-- FRONTEND-WORK-ITEM-STATUS:END -->

### 2026-08-01 상태 정정

PR #48의 Ask Write·Persistence·Outcome Recovery 구현과 검증은 유효한 Increment 증거로 보존한다. 이후 ADD에 기록된 parent Section 완료 해석은 원 Section Contract의 미구현 필수 범위를 반영하지 못했으므로 현재 상태 권위에서 대체한다.

- 정정 기록: [`frontend-phase-2-completion-status-reconciliation-260801001.md`](../../engineering/frontend-phase-2-completion-status-reconciliation-260801001.md)
- Accepted governance ADR: [`ADR-124`](../adr/ADR-124-frontend-work-item-identity-scope-amendment-and-completion-authority-boundary.md)
- Work Item Registry: [`frontend-work-items.json`](../../project/frontend-work-items.json)
- Section Completion Manifest: [`FE-P2-S2.json`](../../project/completions/FE-P2-S2.json)
- 보존된 PR #48 검증 기록: [`frontend-phase-2-section-2-slices-4-5-verification-and-completion-record-260801001.md`](../../implementation/frontend-phase-2-section-2-slices-4-5-verification-and-completion-record-260801001.md)

이 정정은 Product API, Command infrastructure, Database, Browser, Canonical Knowledge 동작을 변경하지 않는다. 남은 Section 범위의 제거·연기·분할은 별도 승인된 Scope Amendment가 필요하다.

## 이관 출처

- Legacy Notion hub: `39f5181d-71ad-81a6-a51f-f7f2a3a88ee6`
- 최초 Git Export commit: `f0d7f7a65a11f28dc9e3bc3a6e47a084b46541eb`
- 최초 Export PR: `#1` — 폐쇄·미병합된 역사적 Export
- 현재 이관은 해당 Export를 현재 `main` Canonical 정책에 맞춰 재검증한 뒤 병합한다.
