<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81589574d4a54620b6b0 -->

## 문서 관리
- 범위: Phase 3 ADR-027\~ADR-036
- 상태: **ADR-027\~036 Accepted**
- 기준일: 2026-07-16
- 관련 ADD: [Phase 3 — 지식 후보 생성 ADD](https://app.notion.com/p/39f5181d71ad813494a2f1fed9a2b854)
## ADR-027 — FactCandidate 금지와 모든 AI 결과의 비Canonical 후보화
**상태:** Accepted
**맥락:** 후보 추출 단계에서 Fact 유형을 만들면 AI 결과가 승인 전에 사실처럼 취급될 수 있다.
**결정:** Phase 3는 Claim·Entity·Relation·Event·Decision·Action 후보만 만들며 `FactCandidate`를 만들지 않는다. 모든 결과는 Shotgun CandidateStore에 저장하고 Phase 4\~5 승인 전에는 Canonical이 아니다.
**제외 대안:** 높은 confidence 후보를 Fact로 자동 저장.
**영향:** gbrain Fact 저장소에는 Phase 3가 직접 쓰지 않는다.
## ADR-028 — CandidateStore와 gbrain Canonical Fact 저장소 분리
**상태:** Accepted
**맥락:** 후보와 공식 지식을 같은 저장소·상태로 관리하면 미승인 결과가 검색·그래프·답변에 섞일 수 있다.
**결정:** 후보·revision·Provenance는 Shotgun CandidateStore가 소유한다. gbrain은 Job·Attempt·Audit 기반과 Phase 5 이후 Canonical 저장 계약에 사용한다.
**제외 대안:** gbrain Fact에 candidate flag를 붙여 함께 저장.
**영향:** Phase 4 인계는 `Phase4CandidateManifest`를 통해서만 수행한다.
## ADR-029 — Evidence 중심 추출과 문서 간 숨은 종합 금지
**상태:** Accepted
**맥락:** 임의 chunk나 여러 문서를 한 프롬프트에 넣으면 후보가 어느 원문에서 나왔는지 불명확해질 수 있다.
**결정:** 기본 추출 단위는 EvidenceBundle이며 직접 추출은 하나의 SourceVersion 내부에서 수행한다. 문서 간 비교·종합·동일성 판정은 Phase 4로 넘긴다.
**제외 대안:** 제출 묶음이나 검색 결과 전체를 한 번에 종합 추출.
**영향:** 후보마다 정확한 Evidence와 source boundary를 유지한다.
## ADR-030 — 후보 field-level Evidence 결속과 번역 비근거 원칙
**상태:** Accepted
**맥락:** 후보 전체에 문서 수준 Citation만 붙이면 주체·시간·수량 등 세부 필드가 실제 근거를 갖는지 확인할 수 없다.
**결정:** 직접 후보는 최소 하나의 EvidenceSpan과 가능한 field-level evidence link를 갖는다. 번역문은 표시·후보 작성에 사용할 수 있지만 원문 Evidence를 대체하지 않는다.
**제외 대안:** 후보당 SourceVersion 하나만 연결하거나 번역문을 Evidence로 사용.
**영향:** 부분 근거 후보는 warning·KnowledgeGap을 갖고 과장 필드를 만들지 않는다.
## ADR-031 — 직접 추출·사용자 입력·추론 Provenance 분리
**상태:** Accepted
**맥락:** 원문에서 직접 나온 내용, 사용자가 주장한 내용과 AI가 조합한 결론을 한 종류로 저장하면 사실성과 책임을 구분할 수 없다.
**결정:** `DIRECT_EVIDENCE`, `USER_INPUT`, `DERIVED_INFERENCE`, `EXTERNAL_RESEARCH`, `SYSTEM_TRANSFORM`, `DISCOVERY_REENTRY`를 분리한다.
**제외 대안:** origin을 단일 source 문자열이나 confidence로 표현.
**영향:** Phase 4는 생성 방식별로 다른 비교·검토 정책을 적용할 수 있다.
## ADR-032 — 검증 가능한 도출 요약과 dependency graph 기록
**상태:** Accepted
**맥락:** 추론 후보는 결과만 저장하면 나중에 왜 만들어졌는지 검증하거나 의존 지식 변경의 영향을 계산할 수 없다.
**결정:** 사용한 Evidence·후보·Canonical 지식·Directive·정책을 typed dependency로 연결하고 전제·미확인 가정·도출 요약을 기록한다.
**제외 대안:** 결과 텍스트와 모델 confidence만 저장.
**영향:** dependency 변경 시 stale 처리와 재검증이 가능하다.
## ADR-033 — CandidateRevision 불변성과 자동 덮어쓰기 금지
**상태:** Accepted
**맥락:** 사용자 수정·재추출·모델 변경 결과를 현재값으로 덮어쓰면 AI 원본과 판단 이력을 잃는다.
**결정:** 후보는 안정 ID와 불변 revision을 분리한다. 수정·재추출·정책 변경은 새 CandidateRevision과 Attempt를 만든다.
**제외 대안:** 후보 현재값만 유지.
**영향:** 수정 전후와 Evidence 변경을 감사할 수 있다.
## ADR-034 — 품질 신호의 다차원 분리와 종합 신뢰도 승인 금지
**상태:** Accepted
**맥락:** 모델 confidence, 근거 적합성, 출처 권위와 시간 유효성을 하나의 점수로 합치면 서로 다른 문제를 숨긴다.
**결정:** schema validity, evidence alignment, extraction fidelity, attribution, temporal parsing, visual grounding, dependency completeness, model uncertainty와 policy compliance를 분리한다.
**제외 대안:** 하나의 0\~1 trust score로 후보 통과·거절.
**영향:** 출처 권위·Priority·충돌은 Phase 4가 별도로 판단한다.
## ADR-035 — WeeklyAIBatch 내 독립 후보 Job과 선택적 semantic verifier
**상태:** Accepted
**맥락:** 모든 자료를 하나의 대형 요청으로 처리하거나 모든 후보를 이중 모델로 검사하면 복구가 어렵거나 비용이 과도하다.
**결정:** SourceVersion·후보 유형·단계별 독립 Job을 batch_id로 묶는다. 결정적 검증을 기본으로 하고 의미 정합성이 불명확하거나 영향도가 높은 후보에만 semantic verifier를 실행한다.
**제외 대안:** 단일 대형 요청, 모든 후보 무조건 이중 AI 검증, 실패 시 무언 모델 대체.
**영향:** 실패 항목만 재시도하고 비용·지연을 후보 유형별로 추적한다.
## ADR-036 — 기본 Batch의 AI 추론 후보 생성 범위
**상태:** Accepted
**결정일:** 2026-07-16
**맥락:** 추론 후보를 자동 생성하면 숨은 관계를 빨리 발견하지만 후보 수·비용·검토 부담과 오류 가능성이 증가한다.
**결정:** 기본 `WeeklyAIBatch`는 원문에 직접 명시된 후보만 자동 생성한다. 원문에 없는 결론·관계·예측을 만드는 추론 후보는 사용자의 명시적 요청 또는 Phase 5 Step 17 Knowledge Discovery에서만 생성한다.
**제외 대안:** 직접 후보와 추론 후보를 기본 Batch에서 함께 생성.
**결정 근거:** 근거 추적성, 오류 억제, 비용과 검토 부담을 우선하고 숨은 관계 발견은 별도 요청·Discovery 경로로 분리한다.
**영향:** 기본 `ExtractionProfile`은 direct-only로 고정한다. 추론 후보는 `DERIVED_INFERENCE` Provenance, typed dependency, 전제·미확인 가정·도출 요약을 반드시 기록하며 Phase 4 비교·승인을 통과해야 한다.
