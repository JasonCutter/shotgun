<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81a6a51ff7f2a3a88ee6 -->

# Project Shotgun ADD

Project Shotgun의 완료된 Architecture Design Document(ADD)를 보관하는 프로젝트 문서 영역입니다.

## 문서 기준

- 현재 설계의 Canonical 기준본은 [Notion ADD 허브](https://app.notion.com/p/39f5181d71ad81a6a51ff7f2a3a88ee6)입니다.
- 이 저장소의 Markdown은 구현·검증·참조를 위한 보관본입니다.
- 원문 정책, ADR, 사용자 결정, 미결사항, 구현 검증 대기, 변경 이력을 임의로 요약하거나 재설계하지 않고 보존합니다.
- Google Drive는 ADD Canonical 저장소에서 제외합니다.

## 완료 상태와 문서 범위

| Phase | 상태 | 범위 | 문서 |
|---|---|---|---|
| Phase 1 | 완료 | Step 1~3, Section 1.1~3.8 | [Phase 1](phase-01-input-and-original-preservation/README.md) |
| Phase 2 | 완료 | Step 4~7 | [Phase 2](phase-02-transformation-and-grounding/README.md) |
| Phase 3 | 완료 | Step 8~9 | [Phase 3](phase-03-knowledge-candidate-generation/README.md) |
| Phase 4 | 완료 | Step 10~14 | [Phase 4](phase-04-comparison-change-approval/README.md) |
| Phase 5 | 완료 | Step 15~17 | [Phase 5](phase-05-canonical-knowledge-and-discovery/README.md) |
| Phase 6 | 완료 | Step 18~22, Section 43개 | [Phase 6](phase-06-utilization-results-feedback/README.md) |

## 주요 확정 경계

- GPT·Gemini·Claude를 폭넓게 활용하되 특정 공급자에 Canonical 계약을 고정하지 않습니다.
- AI 결과는 사용자 승인 전 후보이며, 권한·정책 집행·상태 전이·Canonical 반영은 결정적 시스템과 승인 경계가 담당합니다.
- Claim과 Fact를 구분하고, 모든 후보와 파생 결과는 Provenance를 가집니다.
- 중요한 결정은 ADR로 기록하며 과거 결정을 조용히 덮어쓰지 않습니다.
- Compiled Truth는 Canonical 기록에서 재생성되는 파생 Projection입니다.
- 시각 의미가 있는 자료와 시각 산출물은 멀티모달 AI 검증을 거칩니다.
- 비한국어 의미 구간은 자동 번역하되 Citation은 원문 EvidenceSpan을 가리킵니다.
- 원본 검증은 즉시 수행하고 비용성 AI 작업은 WeeklyAIBatch로 실행합니다.
- 승인된 Action 후보와 실제 외부 Action 실행을 분리합니다.
- 사용자 피드백은 Fact·Directive·Preference를 구분해 재진입시킵니다.

## ADR 범위

Phase 2부터 Phase 6까지의 ADR-018~ADR-075를 Phase별 문서에 보관합니다.
