# Shotgun Module Delivery Plan

> 목적: 각 모듈이 무엇을 소유하고, 언제 어떤 산출물을 내며, 언제 독립적으로 완료됐다고 판단하는지 정의한다.

## 1. 공통 납품물

모든 재사용 가능 모듈은 다음 산출물을 가진다.

- Module Manifest
- Public Port와 Versioned Contract
- Domain Model과 소유 Schema
- In-memory Adapter 또는 Test Double
- Unit Test와 Contract Test
- 오류·Retry·Idempotency 정책
- Security Context 요구사항
- Telemetry와 Audit Event
- 사용 예제
- Compatibility Matrix
- Migration 또는 Version Upgrade 안내

모듈의 내부 구현은 바뀔 수 있지만 공개 Port와 데이터 소유권 변경은 ADR 대상이다.

## 2. Core Infrastructure Modules

### 2.1 Contracts

**책임**

- 공통 ID와 Message Envelope
- Command·Event·Query·Asset Reference
- Security·Provenance·Job Context
- Error와 Capability Schema
- Contract Versioning

**주요 납품 Stage:** 1, 이후 전 Stage에서 확장

**필수 산출물**

- JSON Schema 또는 동등한 Schema Artifact
- 언어별 SDK Type
- Backward Compatibility Test
- Schema Registry

**완료 기준**

- 모든 Message가 Schema Validation을 통과
- Breaking Change가 새 Major Version으로 분리
- Consumer 지원 Version Range 검사
- Domain 구현이 Transport 타입에 의존하지 않음

### 2.2 Module SDK

**책임**

- Manifest Loader·Validator
- Handler Registration
- Context 전달
- Test Fixture
- Module Lifecycle

**주요 납품 Stage:** 1

**완료 기준**

- 새 모듈 Skeleton을 자동 또는 템플릿으로 생성 가능
- In-memory Contract Test 실행 가능
- Manifest와 구현 Handler 불일치 감지
- Security Context 누락 기본 거부

### 2.3 Module Registry

**책임**

- 모듈·Capability 등록
- Compatibility Validation
- Routing Table
- Assembly 검증

**주요 납품 Stage:** 1, 12

**완료 기준**

- Assembly 시작 전 필수 Capability 누락 감지
- Contract Version 충돌 감지
- 동일 Capability Provider 선택 정책 적용
- 모듈 교체 후 비관련 모듈 변경 없음

### 2.4 Connector Runtime

**책임**

- Command·Event·Query 전달
- In-memory·In-process Transport
- Idempotency·Dedup
- Retry·Dead-letter·Replay
- Correlation·Causation 전달

**주요 납품 Stage:** 1

**완료 기준**

- ADR-077 전달 보장 준수
- `at-least-once` 중복 안전성
- `ordering_key` 부분 순서와 누락 감지
- Side Effect Consumer의 Replay 안전성
- Queue 또는 HTTP Adapter 추가 시 Domain 변경 없음

### 2.5 Orchestration

**책임**

- Job·Attempt·Batch
- Retry·Timeout·Cancellation
- Schedule·Weekly Batch
- Lock·Recovery

**주요 납품 Stage:** 1의 최소 기능, 4·8·10에서 확장

**완료 기준**

- Job과 Attempt가 분리됨
- Retry가 새 Attempt로 기록됨
- 취소·Timeout·Terminal Failure가 구분됨
- Weekly Batch가 실패 후 안전하게 재개됨
- 동일 Idempotency Key로 중복 Job 생성 방지

### 2.6 Policy & Security

**책임**

- Actor·Project·Access Scope·Sensitivity
- Capability Permit·Deny
- Approval Token
- Risk Decision
- Secret Access Boundary

**주요 납품 Stage:** 1의 Context, 5의 Approval, 11의 Action Policy

**완료 기준**

- Context 누락 기본 거부
- 권한 검사 전 데이터 조회 금지
- Approval Token이 대상 Revision과 Digest에 결속
- Secret이 Domain·AI Prompt·일반 Log로 유출되지 않음

### 2.7 Observability & Audit

**책임**

- Trace·Metric·Log Context
- AI 비용·Token·Latency
- 사용자 승인·Canonical Commit·Action Audit

**주요 납품 Stage:** 1부터 전 Stage

**완료 기준**

- Correlation ID로 수직 슬라이스 전체 추적
- Audit 원장과 일반 Log 분리
- 민감 데이터 Redaction
- 실패한 Job·Provider·Connector 원인 조회

## 3. Knowledge Flow Modules

### 3.1 Intake

**책임**

- 파일·텍스트·URL 입력 정규화
- Intake Validation
- Source 생성 요청

**주요 Stage:** 2, 8

**초기 Port**

- `SubmitIntake`
- `IntakeAccepted`
- `IntakeRejected`

**완료 기준**

- Channel과 MaterialKind 분리
- 지원·미지원·부분 지원 상태 명확
- 중복 Submission 멱등 처리
- 원본 보존 이전에 내용 임의 변환 금지

### 3.2 Original Asset

**책임**

- Source·SourceVersion·OriginalAsset
- Hash·MIME·Size·Version
- Asset Reference Resolver
- 접근 범위와 민감도

**주요 Stage:** 2

**완료 기준**

- 원본 불변성
- Content Address와 Version 구분
- 권한 있는 Resolver만 Byte 제공
- 파생물과 원본 저장 영역 구분
- 중복·신규 Version 정책 검증

### 3.3 Transformation

**책임**

- 형식별 입력을 DocumentIR로 변환
- SourceMap 생성
- Transformer Attempt·Revision

**주요 Stage:** 3, 8

**완료 기준**

- Format Adapter가 공통 Contract 출력
- 동일 입력·Version 멱등성
- 구조 손실과 Failure 상태 기록
- 오디오·영상 직접 분석은 Shotgun Assembly에서 비활성화

### 3.4 Evidence

**책임**

- EvidenceSpan·CompositeEvidence
- 원문 Selector
- Citation Lookup
- 원문 복귀

**주요 Stage:** 3, 8

**완료 기준**

- Evidence가 불변 SourceVersion에 결속
- 페이지·BBox·Cell·Shape Selector 지원 확장 가능
- Translation·Summary가 Evidence로 취급되지 않음
- Field-level Evidence와 접근 통제

### 3.5 AI Provider

**책임**

- GPT·Gemini·Claude 공통 Port
- Capability Routing
- Structured Output
- Fallback·Challenger
- 비용·Provenance

**주요 Stage:** 4, 이후 전 AI 기능

**완료 기준**

- Domain Module에 Provider SDK 타입 미노출
- Provider Adapter Contract Test
- Task Profile 기반 Routing
- 모델 불일치와 Fallback Attempt 보존
- Shotgun Assembly에서 비활성 Capability 강제

### 3.6 Candidate Generation

**책임**

- Claim·Entity·Relation·Event·Decision·Action 후보
- CandidateRevision
- CandidateProvenanceGraph

**주요 Stage:** 4, 9

**완료 기준**

- Direct-only 기본 Profile
- 모든 후보의 Provenance
- Evidence 없는 Direct Candidate 거부
- Unknown 값을 추측하지 않음
- Immutable Revision과 Discard·Supersede

### 3.7 Validation

**책임**

- Schema·Evidence·시간·시각·정책 정합성
- Deterministic와 Semantic Validation 분리

**주요 Stage:** 3·4, 이후 전 Flow

**완료 기준**

- Validation Dimension 개별 상태
- 하나의 종합 신뢰도 점수로 승인하지 않음
- Multimodal 결과의 재렌더링 검증
- Validation Revision과 Revalidation Trigger

### 3.8 Comparison & Conflict

**책임**

- Candidate와 Canonical Snapshot 비교
- Duplicate·Support·Update·Conflict·Temporal Coexistence
- Directive·Priority 적용

**주요 Stage:** 5, 9

**완료 기준**

- Versioned Snapshot 사용
- Directive·Priority·Evidence Strength 분리
- Entity·시간 불명확 상태 보존
- 모델 불일치가 자동 Fact 판정으로 이어지지 않음

### 3.9 Impact Analysis

**책임**

- Typed Edge 기반 직접·재귀 영향
- Cycle·Budget·Truncation
- Impact Projection

**주요 Stage:** 9

**완료 기준**

- 실제 Edge만 자동 영향 경로로 사용
- AI Inferred Link는 별도 후보
- Cycle 안전성과 Depth·Node·Time Budget
- Stale Output과 Regeneration Target 식별

### 3.10 ChangeSet & Review

**책임**

- DraftChangeSet·Revision
- Machine Diff·Burst Diff
- Item Decision·Atomic Group
- Approval·Hold·Reject

**주요 Stage:** 5, 9

**완료 기준**

- 사용자 승인 전 Canonical Write 금지
- 승인 대상 Digest와 Expected Version 고정
- 사용자 수정 유형별 Revalidation
- 보류·거절 기록과 반복 제안 억제

### 3.11 Canonical Knowledge

**책임**

- Fact·Claim·Entity·Relation·Event·Conflict 원장
- Revision·HistoryEvent
- Transactional Commit·Outbox

**주요 Stage:** 6, 9

**완료 기준**

- 유일한 Canonical Write 권한
- 승인 Manifest 검증
- Claim·Fact 분리
- Append-only History와 Optimistic Concurrency
- Commit·History·Outbox 원자성

### 3.12 Projection

**책임**

- Compiled Truth
- Search·Citation·Graph·Cache Projection
- Watermark·Readiness

**주요 Stage:** 7, 10

**완료 기준**

- Canonical에서 재생성 가능
- Projection Revision 불변
- Incremental과 Full Rebuild 동등성
- Stale·Lag·Degraded 상태 표시

### 3.13 Knowledge Discovery

**책임**

- KnowledgeGap·새 관계·Pattern·Trend 후보
- 증분·주간·요청형 Discovery
- Phase 3 재진입

**주요 Stage:** 10

**완료 기준**

- 모든 결과 `DERIVED_INFERENCE`
- Canonical 직접 Write 금지
- Dependency·Assumption·Model Provenance
- Suppression과 Loop Budget

### 3.14 Output Generation

**책임**

- 검색 답변·요약·보고서·파일
- Citation과 Result Revision
- Canonical·Source Exploration·External Research Mode 분리

**주요 Stage:** 7, 10

**완료 기준**

- 사실 문장의 Citation
- Mode 혼합 금지 또는 명시적 표시
- Projection Readiness와 Conflict 표시
- 생성물이 Canonical을 수정하지 않음

### 3.15 Risk & Policy

**책임**

- R0~R4
- 자동 제공·검토·실행 필요 여부
- 위임 Scope와 Approval 요구

**주요 Stage:** 5의 기본 승인, 11의 전체 Risk

**완료 기준**

- 결정적 정책 평가
- AI 설명과 정책 집행 분리
- 공개·금전·계약·민감·비가역 Action 보수적 처리
- Policy Version과 Decision Audit

### 3.16 Action Execution

**책임**

- Connector validate·preview·preflight·execute·verify·compensate
- 승인된 외부 Side Effect

**주요 Stage:** 11

**완료 기준**

- ActionCandidate와 실행 상태 분리
- Approval Token 검증
- Idempotency와 `OUTCOME_UNKNOWN`
- Provider Result Verification
- Secret Isolation과 Audit

### 3.17 Feedback & Reentry

**책임**

- 표현·사실·근거·Directive·새 자료·Action 결과 분류
- 적절한 Phase로 재진입
- 반복 제안 억제

**주요 Stage:** 7부터 최소, 9·11에서 확장

**완료 기준**

- 일회성 표현 수정의 Fact·장기 기억 자동 저장 금지
- 유형별 Event와 Routing
- 기존 Revision 보존
- Reentry Loop와 Duplicate 방지

## 4. Module Delivery 순서

### Wave A — Kernel

- Contracts
- Module SDK
- Registry
- Connector Runtime
- Security Context
- Observability
- 최소 Orchestration

### Wave B — Walking Skeleton Input and Evidence

- Intake
- Original Asset
- Transformation Plain Text
- Evidence Text Selector

### Wave C — Knowledge Candidate and Approval

- AI Provider
- Candidate Generation Claim
- Validation
- Comparison
- ChangeSet & Review

### Wave D — Canonical and Use

- Canonical Knowledge Claim
- History·Outbox
- Projection Search·Citation
- Output Generation Answer
- Feedback 최소 기능

### Wave E — Rich Formats and Knowledge

- Format Adapters
- Rich Candidate Types
- Conflict·Impact·Advanced Review

### Wave F — Projection, Discovery and Action

- Compiled Truth·Graph
- Knowledge Discovery
- Risk & Policy 전체
- Action Execution

### Wave G — Reusable Assemblies

- Document Review
- Research Assistant
- Work Automation

## 5. 모듈 완료와 제품 완료의 차이

모듈 완료는 해당 모듈의 Contract와 독립 테스트가 통과한 상태다. 제품 완료는 여러 모듈이 실제 수직 슬라이스에서 사용자 목표를 달성한 상태다.

다음은 완료가 아니다.

- Unit Test만 통과한 모듈
- Mock으로만 연결된 수직 흐름
- UI는 있지만 Canonical·Approval 경계가 없는 기능
- Contract 없이 직접 DB로 연결한 통합
- Known Failure를 숨긴 Demo

## 6. 모듈 변경 규칙

- 모듈 병합·분할은 응집도·성능·운영 측정 근거가 있어야 한다.
- 데이터 소유권 이전은 Migration과 ADR이 필요하다.
- 공개 Port Breaking Change는 Major Version을 만든다.
- OSS Adapter 교체는 Domain Contract를 바꾸지 않는 것을 기본으로 한다.
- 모듈이 다른 프로젝트에서 재사용되지 못하면 원인을 기록하고 경계를 재검토한다.
