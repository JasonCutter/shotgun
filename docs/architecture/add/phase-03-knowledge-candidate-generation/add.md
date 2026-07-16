<!-- Canonical source: https://app.notion.com/p/39f5181d71ad813494a2f1fed9a2b854 -->

## 문서 관리
- 상태: **완료**
- 범위: Phase 3 — 지식 후보 생성, Step 8\~9
- 기준일: 2026-07-16
- 기준 입력: Phase 2의 `Phase3EvidenceManifest`
- 다음 Phase 인계: `Phase4CandidateManifest`
- Canonical 저장소: Notion
- 사용자 결정: [Phase 3 — 사용자 결정 1건 (확정)](https://app.notion.com/p/39f5181d71ad810c8da0c6d93db9f7ff)
- 완료일: 2026-07-16
- 승인자: 사용자
- 최종 선택: 기본 주간 Batch는 원문에 직접 명시된 후보만 자동 생성
## Phase 3 완료 선언
Step 8\~9의 16개 Section, 후보 유형·Evidence 결속·CandidateRevision·Provenance Graph·품질 신호·검증 게이트·오픈소스 연계와 Phase 4 인계 계약이 확정됐다. 기본 `WeeklyAIBatch`는 원문에 직접 명시된 후보만 생성하며, AI 추론 후보는 사용자 요청 또는 Phase 5 Step 17 Knowledge Discovery에서만 생성한다. 구현 제품·모델·수치·벤치마크 선택은 Phase 3 완료를 막지 않는 구현 검증 대기 항목으로 관리한다.
## 1. 목적
Phase 3는 Phase 2에서 검증된 원문 근거를 사용해 Claim·Entity·Relation·Event·Decision·Action 후보를 생성하고, 각 후보의 근거와 생성 계보를 검증한다.
이 Phase의 결과는 모두 **검토 전 후보**다. `FactCandidate`라는 유형은 만들지 않으며 gbrain Fact 저장소나 Canonical 지식에 직접 기록하지 않는다. Phase 4가 기존 Canonical 지식·User Directive·Fact Priority와 비교하고 사용자가 승인하기 전에는 공식 지식이 아니다.
## 2. Phase 경계
### 입력
- `Phase3EvidenceManifest`
- `StableSource`, `SourceVersion`
- `DocumentIR`, `SourceMap`, `EvidenceSpan`, `CompositeEvidence`
- `VisualAnalysisRevision`, `TranslationRevision`
- 접근 범위·민감도 정책
- 모델·파서·정책·Attempt Provenance
### 출력
- 버전화된 `KnowledgeCandidate`와 `CandidateRevision`
- `CandidateProvenanceGraph`
- 다차원 `CandidateQualitySignals`
- 후보 집합 단위 `CandidateSet`
- Phase 4 인계용 `Phase4CandidateManifest`
### 이 Phase에서 하지 않는 일
- 후보를 Fact로 확정하지 않는다.
- 기존 Canonical 지식과 의미 중복·충돌·우선순위를 판정하지 않는다.
- Entity를 기존 Canonical Entity와 자동 병합하지 않는다.
- Decision을 User Directive로 자동 승격하지 않는다.
- Action을 실행하거나 일정·메일·파일 등 외부 상태를 바꾸지 않는다.
- 대화 자료를 기본 자동 지식화 파이프라인에 투입하지 않는다.
## 3. 공통 불변 조건
- 모든 후보는 Provenance를 가진다.
- 직접 추출 후보는 하나 이상의 유효한 원문 `EvidenceSpan`에 결속한다.
- 한국어 번역문은 후보 표현을 만드는 데 사용할 수 있지만 Evidence가 아니다.
- 시각 의미에서 파생한 후보는 원본 렌더링 region과 `VisualAnalysisRevision`에 결속한다.
- 원문에 없는 값을 추측해 필드를 채우지 않는다. 알 수 없으면 `unknown` 또는 미해결 상태로 둔다.
- 후보와 검증 결과는 불변 revision으로 누적하며 과거 결과를 덮어쓰지 않는다.
- 모델 confidence를 출처 권위나 사실성으로 해석하지 않는다.
- 하나의 종합 신뢰도 점수로 승인 여부를 결정하지 않는다.
- 접근 범위와 민감도는 후보·Provenance·로그·Phase 4 인계에 상속한다.
- 후보 ID와 Phase 4 인계는 재시도·재실행에도 멱등하게 처리한다.
## 4. 처리 흐름
`Phase3EvidenceManifest`
→ 후보 추출 범위 계획
→ Evidence 중심 extraction unit 생성
→ 결정적 전처리·보조 NLP
→ 구조화된 AI 후보 추출
→ 스키마·Evidence·시각 grounding 검증
→ CandidateRevision 생성
→ Provenance Graph 구성
→ 품질 신호 분리 평가
→ Phase 4 인계 게이트
→ `Phase4CandidateManifest`
비용성 AI 작업은 Phase 2의 `WeeklyAIBatch`에 포함한다. SourceVersion·후보 유형·처리 단계별 독립 Job을 같은 `batch_id`로 묶고 실패한 항목만 재시도한다.
## 5. 오픈소스·기존 구현 연계
### gbrain — 실행 기반과 후속 호환성
**재사용 우선**
- Minion Queue, Job, Attempt
- idempotency key, locking, retry, timeout, recovery
- Audit 이벤트와 비용 기록
- Page·Fact·Relation·Timeline의 후속 저장 계약 참고
**경계**
- Phase 3 후보는 gbrain Fact 저장소에 쓰지 않는다.
- Shotgun `CandidateStore`가 후보와 revision을 소유한다.
- gbrain Canonical 지식 검색·비교는 일반 Source 추출 모드에서 사용하지 않고 Phase 4가 담당한다.
- Phase 5 Step 17에서 재진입한 discovery 후보만 명시적 dependency를 통해 기존 지식을 사용할 수 있다.
### lucasastorian/llmwiki — 원문 검토·lint 패턴
**선별 재사용·검증 후보**
- Highlight·Annotation의 원문/사용자 메모/AI 산출물 분리 패턴
- deterministic lint와 reconcile 패턴
- 후보에서 EvidenceSpan으로 복귀하는 viewer 패턴
**제외**
- filename 기반 Citation
- Markdown·SQLite를 후보 또는 Canonical 저장소로 사용
- lint 결과를 사실 판정으로 사용
### ddsyasas/llm-wiki — 운영 UX 참고
- 모델 선택, 비용 예상, Batch 상태, 실패·재시도 UX
- 후보 수와 처리 상태를 보여주는 화면 패턴
- 기존 ingest/query/lint backend와 LLM client는 사용하지 않는다.
### Inkeep OpenKnowledge — Human Cockpit 참고
- Agent Activity, changed-item grouping, Burst Diff
- 후보·근거·변경 이력 검토 UI
- 2D Graph를 이용한 후보 관계 시각화
- OpenKnowledge 전체 런타임과 Canonical write는 사용하지 않는다.
### 범용 오픈소스·표준 도구
- JSON Schema·Pydantic·Zod 계열의 구조 검증
- 문장 분할·토큰화·NER·날짜 파싱 라이브러리는 후보 창 생성과 교차 검증의 보조 도구로 사용
- 보조 NLP 결과도 모델·버전·설정과 원문 위치를 기록하며 최종 후보를 단독 확정하지 않는다.
### Shotgun 고유 구현
- `CandidateStore`, `CandidateSet`, `CandidateRevision`
- `CandidateProvenanceGraph`
- `ExtractionProfile`, 후보 유형 registry와 validation gate
- Evidence field-level 결속
- 추론·직접 추출의 분리
- Phase 4 인계 계약과 재검증 orchestration
# Step 8. Claim·Entity·Relation·Event·Decision·Action 후보 추출
## 8.1 후보 유형 체계
공통 envelope는 `KnowledgeCandidate`이며 실제 내용은 유형별 payload로 분리한다.
### 핵심 후보 유형
- `ClaimCandidate`: 누가 무엇을 주장했는지 보존한다. statement, attribution, modality, negation, quantifier, temporal scope를 가진다.
- `EntityCandidate`: 원문 mention, 제안 label, 제안 type, 명시 alias를 가진다. Canonical Entity ID는 확정하지 않는다.
- `RelationCandidate`: subject·predicate·object 또는 역할 기반 n-ary argument, 방향, 시간 범위를 가진다.
- `EventCandidate`: 발생 사건, 참여자, 시간, 장소, 상태를 가진다.
- `DecisionCandidate`: 결정 주체, 결정 내용, 적용 범위, 조건, 효력 시점과 상태를 가진다.
- `ActionCandidate`: 제안·지시·배정·진행·완료된 행동의 주체, 대상, 기한, 상태와 의존성을 가진다.
### 보조 레코드
- `AttributeCandidate`: Entity의 값·속성 후보
- `TemporalExpressionCandidate`: 원문 시간 표현과 파싱 결과
- `UserDirectiveProposal`: 반복 적용 가능성이 있는 사용자 명시 지침의 제안 상태. Phase 4에서 별도 판단한다.
- `KnowledgeGap`: 후보가 아니라 검증 결과로서 필요한 정보·근거 부족을 기록한다.
`FactCandidate`는 만들지 않는다. Claim과 Fact의 구분은 Phase 4\~5에서 유지한다.
## 8.2 추출 단위·범위
- 기본 추출 단위는 임의 토큰 chunk가 아니라 `EvidenceBundle`이다.
- `EvidenceBundle`은 하나 이상의 연속 또는 명시적으로 연결된 EvidenceSpan, DocumentIR node, 필요한 인접 문맥, 번역 revision과 시각 region을 포함한다.
- 문장·문단·목록 항목·표 행·셀·슬라이드 shape·이미지 region·페이지 시각 그룹을 형식에 맞는 최소 단위로 사용한다.
- 직접 추출은 기본적으로 하나의 SourceVersion 내부에서 수행한다.
- 다른 SourceVersion과 기존 Canonical 지식을 조합한 비교·종합은 Phase 4가 담당한다.
- 한 번의 IntakeSubmission에 함께 들어왔다는 이유만으로 자료 간 후보 관계를 만들지 않는다.
- `MaterialKind=CONVERSATION`은 Phase 1 결정에 따라 기본 자동 추출 대상에서 제외한다.
- 사용자가 저장된 대화를 명시적으로 요약·분석해 달라고 요청한 결과는 일회성 파생 결과이며 기본 CandidateSet에 자동 편입하지 않는다.
## 8.3 후보 스키마·상태
### 공통 필드
- `candidate_id`, `candidate_revision_id`, `candidate_set_id`
- `candidate_type`, `payload_schema_version`
- `source_version_id`, `extraction_profile_id`
- 원문 표현, 한국어 표시 표현, 언어
- 시간·범위·attribution·modality
- Evidence와 Provenance 참조
- 품질 신호와 warning
- provider·model·prompt·tool·policy 버전
- `batch_id`, Job, Attempt, 생성 시각
- 접근 범위·민감도
- supersedes·derived_from 관계
### 상태
`CREATED`
→ `EXTRACTED`
→ `VALIDATING`
→ `VALID` 또는 `VALID_WITH_WARNINGS`
→ `READY_FOR_PHASE_4`
종결 상태는 `REJECTED_SCHEMA`, `REJECTED_NO_PROVENANCE`, `REJECTED_EVIDENCE_MISMATCH`, `DISCARDED`, `SUPERSEDED`, `CANCELLED`로 구분한다.
후보의 안정 ID와 revision ID를 분리한다. 사용자 수정·재추출·모델 변경은 같은 후보 계열의 새 revision 또는 새 후보로 기록하며 기존 revision을 수정하지 않는다.
## 8.4 EvidenceSpan 결속
- 직접 후보는 최소 하나 이상의 유효한 EvidenceSpan을 가져야 한다.
- 후보 payload의 의미 있는 필드는 가능하면 field-level evidence link를 가진다.
- 여러 구간이 함께 필요한 경우 `CompositeEvidence`를 사용하고 각 구간의 역할을 기록한다.
- Evidence가 뒷받침하지 않는 필드는 null·unknown·unresolved로 남긴다.
- 번역문만으로 직접 후보를 검증하지 않는다. 원문과 정렬된 EvidenceSpan을 사용한다.
- 시각 정보에서 나온 문자·표·차트·도형 관계는 원본 region bbox와 `VisualAnalysisRevision`을 함께 참조한다.
- 후보 문장이 원문보다 강한 단정, 넓은 범위, 다른 시점, 다른 주체를 갖지 않도록 검증한다.
## 8.5 Entity·Alias·Relation 후보
- Entity mention과 Canonical identity를 분리한다.
- 원문에 명시된 별칭은 AliasCandidate로 만들 수 있지만 동일인·동일 조직의 자동 병합은 하지 않는다.
- 같은 SourceVersion 내부의 명확한 대명사·약칭 연결은 `coreference_candidate`로 기록하며 확정 관계가 아니다.
- Relation은 방향과 역할을 보존한다. 다자 관계는 억지로 여러 이항 관계로 단순화하지 않고 역할 기반 argument를 사용할 수 있다.
- versioned relation type registry를 사용한다.
- registry에 없는 관계를 임의의 `RELATED_TO`로 덮어쓰지 않는다. 원문 predicate를 보존하고 `UNMAPPED_RELATION`으로 Phase 4에 전달한다.
- 시간에 따라 변하는 관계는 valid_from·valid_to·observed_at을 분리한다.
- 다른 SourceVersion의 EntityCandidate와 동일성 판정은 Phase 4로 넘긴다.
## 8.6 Event·Decision·Action 후보
- `EventCandidate`는 발생한 일과 예정·가정·반복 사건을 modality와 함께 구분한다.
- `DecisionCandidate`는 원문에 결정 행위가 명시된 경우 직접 후보로 만든다. 제안·검토·희망을 결정으로 바꾸지 않는다.
- DecisionCandidate는 자동으로 User Directive가 되지 않는다.
- `ActionCandidate`는 proposed, assigned, in_progress, completed, cancelled, unknown 상태를 구분한다.
- 행동 주체·대상·기한·상태가 불명확하면 추측하지 않는다.
- 상대 날짜와 시간대는 Phase 2의 시간 분석 결과를 사용하며 불명확한 날짜를 임의 절대 날짜로 확정하지 않는다.
- ActionCandidate는 외부 실행 권한을 갖지 않는다. Phase 6 Step 21의 승인된 Action과 별도 자원이다.
- 문서에 적힌 완료 보고와 앞으로 할 일을 구분한다.
## 8.7 모델·비용·Batch 전략
- `CandidateExtractionProvider`를 교체 가능한 인터페이스로 둔다.
- 출력은 유형별 versioned structured schema를 사용한다.
- 자료 형식, 길이, 언어, 시각 복잡도, 민감도와 후보 유형에 따라 extraction profile을 선택한다.
- 시각 의미가 있는 EvidenceBundle에는 원본 렌더링과 region을 모델 입력에 포함한다.
- 결정적 전처리와 보조 NLP로 후보 창을 줄이되 최종 의미 후보는 Evidence 검증을 통과해야 한다.
- 첫 추출 후 스키마·locator·문자 일치 등 결정적 검증을 수행한다.
- 의미 정합성이 불명확하거나 영향도가 높은 후보에만 별도 semantic verifier를 실행한다.
- 같은 모델 제품에 영구 고정하지 않는다. provider·model·prompt schema를 Provenance에 기록한다.
- 비용 한도 초과 시 중요도 순으로 Job을 보류하고 조용히 저가 모델로 대체하지 않는다.
- 재시도와 provider 폴백은 새 Attempt로 남긴다.
## 8.8 후보 편집·폐기·재추출
- AI 산출물을 직접 덮어쓰지 않는다. 사용자 수정은 새 `CandidateRevision`으로 저장한다.
- 수정자는 변경 이유를 선택적으로 기록하며 수정 전후와 Evidence 변경 여부를 보존한다.
- 표현 수정은 내부 스키마·Evidence 정합성을 재검증한다.
- 사실 내용·주체·시간·근거 수정은 Step 9 전체를 다시 통과한다.
- 자동 폐기는 스키마 불능, Provenance 없음, Evidence 불일치와 같은 명확한 실패에 한정한다.
- 낮은 confidence나 모호함만으로 후보를 조용히 삭제하지 않고 warning 또는 KnowledgeGap으로 남긴다.
- 같은 Attempt 안의 완전 동일 후보는 fingerprint로 접을 수 있지만 발생 위치와 Evidence는 모두 보존한다.
- 의미 중복·부분 중복·기존 지식 중복은 Phase 4에서 판단한다.
- 재추출은 새 Attempt와 CandidateSet revision을 만들며 과거 후보를 덮어쓰지 않는다.
- 사용자가 폐기한 후보는 논리 상태와 이유를 보존한다. 물리 삭제는 공통 보존·삭제 정책을 따른다.
# Step 9. 각 후보의 근거·추론 계보 검증
## 9.1 Provenance 유형
`CandidateProvenanceGraph`는 후보와 입력·도구·정책·사람의 행위를 typed edge로 연결한다.
### 유형
- `DIRECT_EVIDENCE`: SourceVersion의 EvidenceSpan에서 직접 추출
- `USER_INPUT`: 직접 텍스트·사용자 메모·사용자 수정 등 입력 기록에서 발생
- `DERIVED_INFERENCE`: 여러 근거·후보·정책을 조합한 도출 후보
- `EXTERNAL_RESEARCH`: 외부 조사로 확보한 자료에서 발생. 외부 자료도 Phase 1\~2를 거쳐 SourceVersion·EvidenceSpan을 가져야 한다.
- `SYSTEM_TRANSFORM`: 결정적 parser·NLP·시간 파서 등 시스템 변환 결과
- `DISCOVERY_REENTRY`: Phase 5 Step 17의 발견 결과가 Phase 3으로 재진입
한 후보는 복수 Provenance edge를 가질 수 있다. 생성 방식과 근거 종류를 하나의 문자열로 합치지 않는다.
## 9.2 직접 추출 근거 검증
직접 추출 검증은 다음을 분리해 수행한다.
- 스키마와 필수 필드
- EvidenceSpan 존재·무결성·접근 가능성
- 후보 표현과 원문 의미의 일치
- 주체·대상·부정·조건·가능성·수량·시간의 보존
- 시각 후보의 region grounding
- 번역 사용 시 원문 정렬 상태
지원 관계는 `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONTRADICTED`, `UNSUPPORTED`, `UNRESOLVED`로 기록한다.
결정적 비교가 가능한 필드는 문자열·숫자·날짜·cell·locator 규칙으로 검사한다. 의미 검증이 필요한 경우 별도 verifier가 원문과 후보의 entailment·과장·누락을 확인한다. 직접 후보는 `SUPPORTED` 또는 정책상 허용한 `PARTIALLY_SUPPORTED` 상태와 명확한 warning이 있어야 Phase 4로 전달된다.
## 9.3 추론 후보 도출 근거
- 추론 후보는 직접 후보와 별도 `DERIVED_INFERENCE` 유형으로 표시한다.
- 사용한 EvidenceSpan, 후보, Canonical Fact·Claim, User Directive와 정책 버전을 dependency로 기록한다.
- 검증 가능한 도출 요약, 전제, 미확인 가정, 반대 근거를 함께 기록한다.
- 원문에 직접 쓰이지 않은 결론을 직접 추출로 표시하지 않는다.
- dependency가 변경·폐기·만료되면 후보를 stale로 만들고 재검증한다.
- 사용자 결정 `P3-DEC-01`에 따라 기본 WeeklyAIBatch에서 추론 후보를 만들지 여부를 확정한다.
## 9.4 사용자 아이디어·지침 계보
- 사용자 직접 텍스트의 주장은 `USER_INPUT` provenance를 가진 ClaimCandidate로 만들 수 있다.
- 사용자 메모는 Source Item에 연결된 입력 기록이며 외부 사실 Evidence로 간주하지 않는다.
- 사용자가 입력한 내용이라는 이유만으로 Fact가 되지 않는다.
- 반복 적용 가능한 명시 지침은 `UserDirectiveProposal`로 분류해 Phase 4의 별도 승인을 거친다.
- 사용자 수정이 원문과 다른 사실을 주장하면 원문 Evidence를 덮어쓰지 않고 별도 사용자 주장 revision으로 기록한다.
- 대화 자료는 기존 Phase 1 정책에 따라 자동 후보 생성에서 제외한다.
## 9.5 모델·프롬프트·도구·정책 기록
각 실행은 다음을 기록한다.
- run·Job·Attempt·batch ID
- provider, model ID와 가능하면 model revision
- extraction profile과 payload schema version
- prompt template ID·version·hash
- 사용 도구·parser·NLP·validator ID와 version
- 적용 정책·User Directive version
- 입력 SourceVersion·EvidenceSpan·revision의 ID와 digest
- 생성 시각, token·비용·지연·종료 이유
- 지원되는 경우 seed·sampling 설정
- 결과 schema validation report
비밀값·자격 증명과 민감 원문을 일반 로그에 복제하지 않는다. 모델이 비결정적일 수 있으므로 동일 결과의 완전 재현을 보장한다고 표현하지 않고, 같은 입력·설정의 재실행과 차이 비교가 가능하도록 기록한다.
## 9.6 근거 없는 후보·KnowledgeGap
- 생성 출처를 추적할 수 없는 AI 후보는 Phase 4로 전달하지 않고 `REJECTED_NO_PROVENANCE`로 종결한다.
- 후보의 일부 필드만 근거가 부족하면 과장해 완성하지 않고 `KnowledgeGap`을 만든다.
- KnowledgeGap은 부족한 항목, 필요한 근거 종류, 영향을 받는 후보, 발견 이유와 우선순위를 가진다.
- Source가 불완전하거나 잘린 경우, 시각 분석이 실패한 경우, 날짜·주체·관계가 모호한 경우를 구분한다.
- 정책상 의도적으로 처리하지 않은 대화 자료나 제외 콘텐츠를 자동 KnowledgeGap으로 만들지 않는다.
- Gap은 Claim이나 Fact가 아니며 Phase 5 Step 17 또는 사용자 질문 후보로 활용할 수 있다.
## 9.7 품질 신호·불확실성
품질은 하나의 종합 점수가 아니라 다음 차원으로 분리한다.
- `schema_validity`
- `evidence_alignment`
- `extraction_fidelity`
- `attribution_preservation`
- `temporal_parsing_status`
- `entity_resolution_status`
- `visual_grounding_status`
- `inference_dependency_completeness`
- `model_uncertainty`
- `policy_compliance`
각 신호에는 값, 산출 방법, validator version과 설명을 둔다. 모델의 self-reported confidence는 하나의 참고 신호일 뿐이다. 출처 권위·Fact Priority·기존 지식과의 충돌은 Phase 4가 판단한다.
## 9.8 검증 게이트·재검증
### Phase 4 전달 최소 조건
- 허용된 후보 type과 유효 schema
- 현재 CandidateRevision
- 완전한 Provenance chain
- 직접 후보의 유효 EvidenceSpan 또는 사용자 후보의 InputRecordRef
- dangling Source·Evidence·dependency 참조 없음
- provider·model·prompt·tool·policy metadata
- 접근 범위·민감도 결속
- 직접·추론·사용자 입력 구분
- 필수 quality signal과 validation report
- SourceVersion과 EvidenceSpan의 현재 유효 상태
- CandidateSet과 Manifest schema 검증
### 재검증 트리거
- SourceVersion 교체·격리·삭제·보안 상태 변경
- EvidenceSpan 손상·무효화
- VisualAnalysisRevision 또는 사용된 TranslationRevision 변경
- 후보 payload schema, extraction profile, prompt, model, validator, policy 변경
- 사용자 수정
- 추론 dependency 변경·폐기
- 접근 범위·민감도 변경
- 오류 수정 후 재추출
재검증은 기존 결과를 덮어쓰지 않고 새 Attempt와 CandidateRevision을 만든다. 유효성을 잃은 후보는 Phase 4 인계를 중단하고 영향 범위를 기록한다.
## 6. CandidateStore와 인계 계약
### CandidateSet
하나의 SourceVersion·extraction profile·policy snapshot에 대한 후보 revision 집합이다. 같은 입력과 계약의 중복 실행은 같은 logical set을 가리키고 새 실행은 Attempt로 구분한다.
### Phase4CandidateManifest
최소 포함 항목:
- manifest·schema version
- CandidateSet ID와 유효 revision
- SourceVersion·EvidenceManifest 참조
- 후보 ID·type·status·payload digest
- Evidence와 Provenance graph 참조
- quality signal·warning·KnowledgeGap 참조
- provider·model·prompt·policy snapshot
- 접근 범위·민감도
- Batch·Job·Attempt·생성 시각
- Phase 4 허용·금지 작업
Manifest 생성과 Queue 전달은 멱등하게 수행한다. Queue 실패가 CandidateStore의 검증 완료 상태를 롤백하지 않으며 재시도 가능한 인계 실패로 관리한다.
## 7. 관측성·보안·개인정보
- 후보 수, 유형별 성공·경고·거절, Evidence mismatch, Gap 수를 JobEvent로 기록한다.
- Agent Activity는 실제 backend 상태와 일치해야 한다.
- 비용은 SourceVersion·후보 유형·provider·Attempt별로 추적한다.
- 민감 원문과 후보 payload를 일반 Telemetry에 기록하지 않는다.
- provider 전송은 Phase 2에서 확정한 접근·민감도와 외부 처리 정책을 따른다.
- 후보 API와 Phase 4 Manifest는 원본보다 넓은 권한을 부여하지 않는다.
- 접근 권한이 없는 후보·Entity의 존재를 다른 사용자에게 노출하지 않는다.
## 8. 완료 조건
Phase 3 설계는 다음을 만족하면 완료된다.
1. Step 8·9의 16개 Section 정책과 데이터 계약이 정의됐다.
2. 직접·사용자 입력·추론·외부 조사 후보의 계보가 분리됐다.
3. CandidateStore가 gbrain Canonical Fact 저장소와 분리됐다.
4. 모든 직접 후보가 원문 Evidence로 역추적된다.
5. 후보 수정·폐기·재추출이 revision과 Attempt로 보존된다.
6. 품질과 불확실성을 다차원으로 표현한다.
7. `Phase4CandidateManifest`와 재검증 트리거가 정의됐다.
8. 오픈소스 재사용과 Shotgun 고유 구현 경계가 명시됐다.
9. 사용자 결정 `P3-DEC-01`이 확정됐다.
## 9. 사용자 결정 대기
- `P3-DEC-01`: 기본 WeeklyAIBatch에서 AI 추론 후보까지 자동 생성할지 여부
- 권장안: 원문에 직접 명시된 후보만 자동 생성하고 추론 후보는 사용자 요청 또는 Phase 5 Step 17에서 생성
- 결정 페이지: [Phase 3 — 사용자 결정 1건](https://app.notion.com/p/39f5181d71ad810c8da0c6d93db9f7ff)
사용자 결정이 반영되면 ADR 상태와 완료 선언을 갱신한다.
## 10. 관련 기록
- [Phase 3 — Architecture Decision Records](https://app.notion.com/p/39f5181d71ad81589574d4a54620b6b0)
- [Phase 3 — 미결사항·구현 검증 대기](https://app.notion.com/p/39f5181d71ad81e68a22f268707c0dcd)
- [Phase 3 — 변경 이력](https://app.notion.com/p/39f5181d71ad81299e59fd1878a424ee)
- [Phase 3 — 사용자 결정 1건](https://app.notion.com/p/39f5181d71ad810c8da0c6d93db9f7ff)
