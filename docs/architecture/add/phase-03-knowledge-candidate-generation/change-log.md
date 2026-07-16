<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81299e59fd1878a424ee -->

## 문서 관리
- 범위: Phase 3 설계·결정·사용자 선택 이력
- 상태: **누적 기록**
- 관련 ADD: [Phase 3 — 지식 후보 생성 ADD](https://app.notion.com/p/39f5181d71ad813494a2f1fed9a2b854)
## 2026-07-16
### Phase 3 전체 ADD 작성 시작
사용자는 Phase 3 전 구간을 기술·정책적으로 검토해 ADD에 기록하고, 사용자 판단이 꼭 필요한 문제만 별도로 제시하도록 요청했다.
### Step 8·9의 16개 Section 통합 설계
Detailed Map의 8.1\~8.8과 9.1\~9.8을 모두 검토해 후보 유형·추출 범위·스키마·Evidence 결속·Entity·Relation·Event·Decision·Action·모델·Batch·revision과 Provenance 검증·KnowledgeGap·품질·Phase 4 인계 계약을 작성했다.
### FactCandidate 금지와 CandidateStore 분리
Phase 3는 Fact를 만들지 않고 모든 AI 결과를 비Canonical 후보로 유지한다. 후보와 revision은 Shotgun CandidateStore가 소유하며 gbrain Fact 저장소에는 직접 쓰지 않는다. ADR-027·028에 기록했다.
### Evidence 중심 추출
기본 추출 단위를 EvidenceBundle로 정하고 직접 추출은 하나의 SourceVersion 내부에서 수행한다. 후보의 의미 필드는 가능한 field-level Evidence link를 갖고 번역문은 Evidence로 사용하지 않는다. ADR-029·030에 기록했다.
### Provenance 유형과 추론 계보
직접 근거, 사용자 입력, AI 추론, 외부 조사, 시스템 변환과 Discovery 재진입을 구분한다. 추론 후보는 dependency와 검증 가능한 도출 요약을 기록하고 직접 후보로 표시하지 않는다. ADR-031·032에 기록했다.
### 후보 revision과 품질 신호
사용자 수정·재추출·모델·정책 변경은 불변 CandidateRevision과 Attempt로 누적한다. 품질은 Evidence alignment, extraction fidelity, attribution, temporal·visual grounding 등 다차원으로 분리하고 하나의 trust score로 합치지 않는다. ADR-033·034에 기록했다.
### 오픈소스 연계
- gbrain: Minion Queue, Job·Attempt, 멱등성·복구·Audit 재사용
- lucasastorian/llmwiki: Highlight·Annotation·deterministic lint·reconcile 패턴 선별 재사용
- ddsyasas/llm-wiki: 모델·비용·Batch 상태 UX 참고
- Inkeep OpenKnowledge: Agent Activity·Burst Diff·후보 관계 검토 UI 참고
- Shotgun: CandidateStore·CandidateRevision·ProvenanceGraph·validation gate·Phase 4 인계 소유
### WeeklyAIBatch와 검증 전략
Phase 3 후보 추출은 Phase 2의 WeeklyAIBatch에 연결하고 SourceVersion·후보 유형·단계별 독립 Job으로 실행한다. 결정적 검증을 우선하고 불명확하거나 영향도가 높은 후보만 별도 semantic verifier로 검사한다. ADR-035에 기록했다.
### 사용자 결정 1건 분리
기본 WeeklyAIBatch에서 원문에 직접 적힌 후보만 만들지, 근거 조합 추론 후보까지 자동 생성할지를 `P3-DEC-01`로 분리했다. 권장안은 직접 후보만 자동 생성하고 추론 후보는 사용자 요청 또는 Phase 5 Step 17에서 생성하는 것이다. ADR-036은 Proposed 상태로 기록했다.
## 2026-07-16 — 사용자 결정과 Phase 3 완료
- `P3-DEC-01`에서 A안을 확정했다.
- 기본 `WeeklyAIBatch`는 원문에 직접 명시된 Claim·Entity·Relation·Event·Decision·Action 후보만 자동 생성한다.
- 원문에 없는 결론·관계·예측을 만드는 AI 추론 후보는 사용자의 명시적 요청 또는 Phase 5 Step 17 Knowledge Discovery에서만 생성한다.
- ADR-036을 Proposed에서 Accepted로 변경했다.
- Phase 3 Step 8\~9 전체 설계와 Phase 4 인계 계약을 완료 처리했다.
