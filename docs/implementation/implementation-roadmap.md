# Shotgun Implementation Roadmap

> 상태: **Baseline v0.1**  
> 원칙: 모듈 단위로 만들고, 수직 슬라이스로 통합하며, Phase Gate로 검증한다.

## 1. 로드맵 목적

이 문서는 Shotgun을 어떤 순서로 구현하며 각 Stage가 언제 완료됐다고 판단하는지 정의한다.

로드맵은 달력 일정이 아니라 **의존성과 검증 순서**를 기준으로 한다. 실제 기간은 구현 속도, 기술 선택과 OSS 평가 결과에 따라 조정한다.

## 2. 완료 상태 정의

각 Stage는 다음 상태를 사용한다.

- `NOT_STARTED`: 착수 전
- `IN_PROGRESS`: 구현 중
- `BLOCKED`: 외부 결정·의존성으로 중단
- `VALIDATING`: 기능 구현 후 Gate 검증 중
- `COMPLETE_WITH_LIMITS`: 제한이 문서화된 사용 가능 상태
- `COMPLETE`: 모든 필수 Gate 통과

`COMPLETE_WITH_LIMITS`는 다음 Stage 진행을 허용할 수 있지만 제한과 제거 계획을 Release Note에 기록해야 한다.

## 3. Stage 0 — Repository and Engineering Foundation

### 목표

개발 환경, 프로젝트 구조와 품질 검사를 재현 가능하게 만든다.

### 개발 항목

- 주 언어와 Web/API Framework 선정
- Monorepo 또는 Package Workspace 구성
- `packages/`, `modules/`, `adapters/`, `assemblies/`, `tests/` 기본 구조
- Lint, Formatter, Type Check, Unit Test
- PostgreSQL 개발 환경
- 환경변수·Secret 처리 원칙
- CI Pipeline
- Architecture Test의 최소 골격
- 로컬 개발 Bootstrap 명령

### 필수 산출물

- 기술 선택 ADR
- 저장소 구조
- 개발 환경 문서
- CI Workflow
- 기본 Health Check
- 빈 Module Manifest 예시

### 완료 기준

- 깨끗한 환경에서 문서화된 명령으로 설치·실행 가능
- CI에서 Lint, Type Check와 Unit Test 통과
- PostgreSQL Schema 초기화와 삭제·재생성이 가능
- 빈 Kernel과 테스트 모듈이 Application에서 로딩됨
- 금지된 의존성을 검사하는 Architecture Test가 실행됨
- Secret이 저장소와 테스트 출력에 포함되지 않음

### 제외

- 실제 Knowledge Flow 기능
- 분산 Queue
- 독립 서비스 배포

## 4. Stage 1 — Kernel, Contracts and Connector Runtime

### 목표

모듈을 독립적으로 등록하고 공통 계약으로 연결할 최소 Kernel을 만든다.

### 개발 모듈

- Contracts
- Module SDK
- Module Registry
- Connector Runtime
- Job·Attempt Runtime
- Security Context
- Observability Context

### 개발 항목

- Message Envelope
- Command, Event, Query, Asset Reference
- Schema Registry와 Version 검증
- In-memory Connector
- In-process Connector
- Handler 등록과 Capability 탐색
- Idempotency Key와 Consumer Dedup
- Correlation·Causation·Trace 전달
- 기본 Retry와 Error Model

### 수직 검증

`PingCommand → TestModule → PongEvent → QueryResult`

### 완료 기준

- 독립 테스트 모듈 두 개가 Manifest만으로 등록·연결됨
- 호환되지 않는 Contract Version의 Assembly가 시작 전에 차단됨
- 같은 Command가 두 번 전달되어도 Side Effect가 한 번만 발생
- Event는 `at-least-once`를 전제로 중복 처리에 안전함
- Security Context 누락 시 보호된 Handler가 거부됨
- Command에서 Event와 Query까지 하나의 Trace로 조회됨
- In-memory와 In-process Adapter가 동일 Contract Test를 통과

## 5. Stage 2 — Intake and Original Asset

### 목표

직접 텍스트와 간단한 텍스트 파일을 원본 그대로 접수·보존한다.

### 개발 모듈

- Intake
- Original Asset
- Local Asset Storage Adapter
- Runtime integration

### 초기 지원 범위

- 직접 텍스트 입력
- `.txt`
- `.md`는 Plain Text로 제한 지원 가능

### 개발 항목

- `IntakeSubmission`
- `OriginalAsset`, `Source`, `SourceVersion`
- Hash, MIME, Size, Created Time
- 접근 범위와 민감도
- 중복 감지
- Asset Reference Resolver
- `OriginalAssetStored` Event

### 완료 기준

- 모든 입력이 `IntakeSubmission`으로 정규화됨
- 원본 Byte 또는 입력 텍스트가 변경 없이 보존됨
- 동일한 원본의 재입력과 새 Version을 구분함
- Asset Reference를 통해서만 원본에 접근함
- 권한 없는 Resolver 요청이 거부됨
- 중복 Command 재처리 시 SourceVersion이 중복 생성되지 않음
- Intake부터 저장까지 Audit와 Trace를 확인 가능

## 6. Stage 3 — Plain Text Transformation and Evidence

### 목표

보존된 텍스트를 `DocumentIR`로 변환하고 모든 의미 구간을 원문 위치와 연결한다.

### 개발 모듈

- Transformation
- Evidence
- Plain Text Format Adapter

### 개발 항목

- `DocumentIR`
- `SourceMap`
- `EvidenceSpan`
- Text Position·Text Quote Selector
- 변환 Attempt와 Revision
- 원문 복귀 Query

### 완료 기준

- 지원 텍스트가 안정적인 DocumentIR로 변환됨
- DocumentIR의 문단·문장 위치가 SourceMap에 연결됨
- EvidenceSpan에서 원문의 정확한 구간을 복원함
- 잘못된 Offset·Hash·SourceVersion 참조가 거부됨
- 동일 Input·Transformer Version 재실행이 멱등함
- Translation이나 요약을 Evidence로 오인하지 않음
- Transformation Module과 Evidence Module이 직접 DB 접근 없이 연결됨

## 7. Stage 4 — AI Provider, Direct Claim Candidate and Validation

### 목표

원문에 직접 적힌 Claim만 후보로 생성하고 Evidence와 정합성을 검증한다.

### 개발 모듈

- AI Provider
- Candidate Generation
- Validation

### 초기 지원 범위

- `ClaimCandidate` 한 유형
- `DIRECT_EVIDENCE` Provenance
- `direct-only` Extraction Profile
- 실제 AI Provider 한 개 이상
- 다른 Provider는 Fake·Contract Adapter 또는 두 번째 실제 Adapter

### 개발 항목

- `AIProviderPort`
- Task Profile과 Structured Output
- Provider·Model·Prompt·Policy Provenance
- `CandidateRevision`
- Schema Validation
- Evidence Alignment Validation
- Unsupported·Partial·Contradicted 상태

### 완료 기준

- Candidate Module이 특정 Provider SDK에 직접 의존하지 않음
- ClaimCandidate가 유효한 EvidenceSpan 없이 `READY`가 되지 않음
- 원문에 없는 추론 후보가 기본 Batch에서 생성되지 않음
- Provider 응답이 Schema에 맞지 않으면 명확히 실패·재시도됨
- 모델, 버전, Prompt, Policy, 비용, Token, Attempt가 기록됨
- 동일 입력과 Idempotency Key가 Candidate를 중복 생성하지 않음
- Fake Adapter와 실제 Adapter가 동일 Provider Contract Test를 통과

## 8. Stage 5 — Comparison, ChangeSet and Human Review

### 목표

후보를 기존 지식과 비교하고 사용자가 승인·거절·보류할 수 있게 한다.

### 개발 모듈

- Comparison & Conflict
- ChangeSet & Review
- 최소 Review UI

### 초기 지원 범위

- `NEW`
- `EXACT_DUPLICATE`
- 단순 `CONTRADICTS`
- `CREATE`와 `NO_CHANGE`
- `APPROVE`, `HOLD`, `REJECT`

### 개발 항목

- Versioned Canonical Snapshot Query
- `ComparisonResult`
- `DraftChangeSet`
- Machine Diff
- Evidence Viewer
- Review Decision
- Approval Invalidation

### 완료 기준

- Candidate와 고정된 Canonical Snapshot을 비교함
- 비교 결과와 Evidence를 같은 화면에서 확인 가능
- 승인 전에는 Canonical Write 요청이 생성되지 않음
- 승인 후 Candidate, Diff 또는 Snapshot 변경 시 승인이 `STALE` 처리됨
- 승인·보류·거절 이유와 Actor가 기록됨
- 정확 중복은 새 Canonical Claim을 만들지 않도록 제안됨
- 승인 대상의 Content Digest와 Expected Version이 고정됨

## 9. Stage 6 — Canonical Claim Commit and History

### 목표

승인된 ChangeSet만 Canonical 원장에 원자적으로 반영한다.

### 개발 모듈

- Canonical Knowledge
- HistoryEvent
- Transactional Outbox

### 초기 지원 범위

- Canonical Claim
- Evidence Reference
- Revision
- HistoryEvent
- Conflict 없이 단순 Create

### 개발 항목

- `ApprovedChangeSetManifest`
- Commit Precondition
- Optimistic Concurrency
- Claim Revision
- Append-only HistoryEvent
- Commit Ledger
- Transactional Outbox

### 완료 기준

- 승인된 Manifest와 유효한 Approval만 Commit 가능
- 미승인 Candidate 직접 저장 시도가 차단됨
- Claim이 자동 Fact로 승격되지 않음
- Canonical Revision, HistoryEvent와 Outbox가 한 Transaction으로 저장됨
- 동일 Commit ID 재요청 시 중복 Revision이 생성되지 않음
- 승인 Snapshot과 현재 상태가 다르면 `STALE_APPROVAL`로 중단됨
- 과거 Revision과 변경 이유를 조회 가능

## 10. Stage 7 — Search, Citation and Cited Answer

### 목표

Canonical Claim을 검색하고 원문 Citation이 포함된 답변을 제공한다.

### 개발 모듈

- Projection
- Search
- Citation Lookup
- Output Generation

### 초기 지원 범위

- PostgreSQL 기반 Exact·Text Search
- Canonical Claim 조회
- Citation이 붙은 간단한 답변
- Projection Watermark

### 개발 항목

- Search Projection
- Citation Lookup Projection
- `ProjectionReadiness`
- Canonical Query Mode
- Answer Revision
- Result Provenance

### 완료 기준

- 승인된 Canonical Claim을 검색 가능
- 미승인 Candidate가 기본 검색에 노출되지 않음
- 검색 결과에서 원문 EvidenceSpan으로 이동 가능
- 답변의 사실적 문장이 Canonical 또는 Evidence Citation에 연결됨
- Projection Watermark가 Canonical Commit을 따라감
- 오래된 Projection을 최신으로 표시하지 않음
- Canonical Commit 후 Projection 실패가 Commit을 되돌리지 않음

### Stage 7 완료 선언

Stage 2~7의 기능이 한 번의 E2E Test로 연결되면 **Walking Skeleton MVP**로 선언한다.

## 11. Stage 8 — Format Expansion

### 목표

Transformation Adapter를 확장하되 공통 DocumentIR·Evidence 계약을 유지한다.

### 권장 순서

1. Markdown·HTML
2. PDF
3. DOCX
4. CSV·XLSX
5. PPTX
6. 이미지
7. URL과 영상 페이지의 접근 가능한 텍스트 자막·스크립트

### 명시적 제외

- 오디오·영상 파일 직접 분석
- 자동 음성 전사
- 영상 프레임·음성·장면 분석

### 완료 기준

- 형식별 Golden Corpus 통과
- 페이지·셀·Shape·BBox 등 원문 위치 복원
- 표와 구조 손실이 허용 기준 이내
- 이미지 의미가 필요할 때 Multimodal Validation 수행
- 외국어 의미 구간은 번역 Revision과 원문 Evidence를 분리
- 손상·암호화·미지원 입력이 명확한 실패 상태를 반환
- Adapter 교체가 상위 Module Contract에 영향을 주지 않음

## 12. Stage 9 — Knowledge Model Expansion

### 목표

Claim 외 지식 유형과 복잡한 비교·영향·검토를 구현한다.

### 추가 유형

- EntityCandidate
- RelationCandidate
- EventCandidate
- DecisionCandidate
- ActionCandidate
- Conflict
- KnowledgeGap

### 개발 항목

- Entity Identity 후보
- 시간·범위·양태
- Relation 방향·역할
- Conflict Projection
- Recursive Impact
- Atomic Group
- Burst Diff
- 항목별 승인

### 완료 기준

- 유형별 Schema와 Evidence 정책을 통과
- `POSSIBLY_SAME` Entity가 자동 병합되지 않음
- Relation과 Event의 시간 정보를 추측하지 않음
- Impact는 실제 Typed Edge를 결정적으로 탐색함
- 부분 승인으로 Dangling Reference가 생기지 않음
- User Edit가 유형에 맞는 Phase로 재진입함
- 모델 불일치가 사용자에게 보존·표시됨

## 13. Stage 10 — Compiled Truth, Graph and Discovery

### 목표

Canonical에서 읽기 Projection을 재생성하고 새로운 Gap·관계 후보를 탐색한다.

### 개발 모듈

- Compiled Truth Projector
- Search·Graph Projector
- Knowledge Discovery
- Cache Invalidation

### 완료 기준

- 동일 Snapshot·Projector Version이 동일 논리 결과를 생성
- 증분 Projection과 Full Rebuild 결과가 동등함
- 현재·과거·예정·충돌 상태가 구분됨
- AI 추론 Edge가 Canonical Graph에 섞이지 않음
- Discovery 결과는 `DERIVED_INFERENCE`로 Phase 3에 재진입
- 동일 의미 제안의 반복이 Suppression으로 억제됨
- 승인 직후 증분과 주간 Discovery가 비용·범위 제한을 준수
- Projection 상태와 Lag가 사용자에게 표시됨

## 14. Stage 11 — Risk-controlled External Action

### 목표

승인된 외부 Action을 안전하게 실행하고 결과를 검증한다.

### 첫 Connector 후보

- Gmail Draft 생성
- Google Calendar 읽기와 일정 Draft
- 로컬 파일 생성
- GitHub Issue 또는 Draft PR 생성

첫 기능은 되돌리기 쉬운 Draft·Create 중심으로 선택한다.

### 필수 흐름

```text
Validation
→ ActionCandidate
→ Risk Decision
→ Preview
→ User Approval
→ Preflight
→ Execute
→ Verify
→ Feedback & Reentry
```

### 완료 기준

- Candidate 생성과 실행이 별도 상태·권한임
- Approval Token이 Action Revision·대상·Parameter Digest와 결속됨
- 승인 후 변경 시 Token이 무효화됨
- Preflight가 권한·대상·중복·현재 상태를 재검증함
- 실행 결과가 Provider에서 재조회·검증됨
- Timeout·응답 유실 시 자동 재실행하지 않고 `OUTCOME_UNKNOWN` 처리
- Connector Secret이 AI Prompt와 일반 Log에 노출되지 않음
- 보상 Action도 별도 후보·승인·Audit을 가짐

## 15. Stage 12 — Module Reuse Validation

### 목표

Shotgun용 내부 Package가 아니라 실제 재사용 가능한 모듈임을 증명한다.

### 검증 Assembly

- Document Review System
- Research Assistant
- Work Automation System

### 완료 기준

- Shotgun 전체 설치 없이 필요한 모듈만 Assembly에 등록 가능
- In-memory Adapter로 각 모듈의 독립 Contract Test 실행 가능
- Canonical Knowledge 없는 Assembly도 구성 가능
- Provider·Storage·Transport Adapter 하나 이상 교체 성공
- 모듈 제거·교체 시 비관련 모듈 코드 변경이 없음 또는 최소임
- 별도 예제 Project에서 최소 한 모듈의 실제 재사용 성공
- Package Version, Compatibility Matrix와 Migration Guide 제공

## 16. Stage 전환 규칙

다음 Stage 착수는 이전 Stage의 모든 선택 기능 완료를 요구하지 않는다. 그러나 Critical Path 기능은 반드시 Gate를 통과해야 한다.

예:

- Stage 4 착수 전 Stage 3의 Plain Text Evidence는 완료돼야 한다.
- Stage 8의 PDF Adapter는 Stage 7 MVP 완료 전 Prototype할 수 있지만 Product Integration은 Stage 7 이후 한다.
- Stage 11 Action은 Stage 5 Review와 Stage 1 Security Context가 완료되기 전 실행 기능을 구현하지 않는다.

## 17. 구현 우선순위 판단 기준

1. Walking Skeleton의 차단 의존성
2. Canonical·Evidence·승인 안전 경계
3. 사용자가 확인 가능한 종단 가치
4. 재사용 가능한 Contract 안정화
5. 오류·복구·관찰 가능성
6. 성능 최적화
7. 고급 UX와 확장 기능

## 18. 완료 선언 책임

Stage 완료 선언 PR에는 다음을 포함한다.

- 구현된 범위와 제외 범위
- 통과한 Definition of Done Gate
- E2E 증거와 테스트 결과
- Migration·Rollback 방법
- 알려진 제한과 Risk Register 변경
- 다음 Stage에 전달하는 Contract Version
- 관련 ADD·ADR 준수 확인
