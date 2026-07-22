# Shotgun Implementation Roadmap

> 상태: **Baseline v0.2**  
> 원칙: 모듈 단위로 만들고, 수직 슬라이스로 통합하며, Phase Gate와 OSS Integration Gate로 검증한다.

## 1. 로드맵 목적

이 문서는 Shotgun을 어떤 순서로 구현하며 각 Stage가 언제 완료됐다고 판단하는지 정의한다.

로드맵은 달력 일정이 아니라 **의존성·사용자 가치·안전 경계·OSS 검증 순서**를 기준으로 한다. 실제 기간은 구현 속도, 기술 선택과 OSS 평가 결과에 따라 조정한다.

Stage별 OSS 후보와 세부 적용 방식은 [OSS Integration Roadmap](./oss-integration-roadmap.md)을 따른다.

## 2. 완료 상태 정의

- `NOT_STARTED`: 착수 전
- `IN_PROGRESS`: 구현 중
- `BLOCKED`: 외부 결정·의존성으로 중단
- `VALIDATING`: 기능과 OSS Gate 검증 중
- `COMPLETE_WITH_LIMITS`: 제한이 문서화된 사용 가능 상태
- `COMPLETE`: 모든 필수 Gate 통과

`COMPLETE_WITH_LIMITS`는 다음 Stage 진행을 허용할 수 있지만 제한, OSS 결정과 제거 계획을 Release Note에 기록해야 한다.

## 3. 모든 Stage에 적용하는 개발 규칙

1. 관련 OSS 후보를 먼저 평가한다.
2. 결과를 `ADOPT`, `EXTRACT`, `AUGMENT`, `REFERENCE_ONLY`, `DEFER`, `REJECT` 중 하나로 기록한다.
3. 관련 후보를 검토하지 않은 직접 구현은 금지한다. 후보가 없으면 `NO_RELEVANT_OSS`와 조사 범위를 기록한다.
4. 외부 OSS는 Module Port·Adapter·Fork Boundary 안에 둔다.
5. OSS 재사용을 이유로 Canonical·Evidence·Approval·Action 경계를 완화하지 않는다.
6. Stage 완료는 [Definition of Done](./definition-of-done.md)의 Module·Flow·Product·Architecture·OSS Integration Gate를 모두 통과해야 한다.

## 4. Stage 0 — Repository, Engineering and OSS Foundation

**상태: COMPLETE (2026-07-17)**

### 목표

개발 환경, 프로젝트 구조, 품질 검사와 OSS 평가 기반을 재현 가능하게 만든다.

### 개발 항목

- 주 언어와 Web/API Framework 선정
- Monorepo 또는 Package Workspace 구성
- `packages/`, `modules/`, `adapters/`, `assemblies/`, `tests/` 기본 구조
- Lint, Formatter, Type Check, Unit Test
- PostgreSQL 개발 환경
- 환경변수·Secret 처리 원칙
- CI Pipeline
- Architecture Test 최소 골격
- 로컬 개발 Bootstrap 명령
- OSS Source Registry와 Evaluation Issue Template

### 필수 OSS 검토

- PostgreSQL
- JSON Schema validator와 type generation
- OpenTelemetry
- gbrain, lucasastorian/llmwiki, ddsyasas/llm-wiki, OpenKnowledge의 baseline commit·license·검증 자료

### 완료 기준

- 깨끗한 환경에서 문서화된 명령으로 설치·실행 가능
- CI에서 Lint, Type Check와 Unit Test 통과
- PostgreSQL Schema 초기화·삭제·재생성 가능
- 빈 Kernel과 테스트 모듈이 로딩됨
- 금지 의존성을 검사하는 Architecture Test 실행
- Secret이 저장소와 테스트 출력에 포함되지 않음
- 4개 레퍼런스와 Stage 0 후보가 OSS Source Registry에 등록됨
- 미확인 License 코드는 `REFERENCE_ONLY`로 제한됨

## 5. Stage 1 — Kernel, Contracts and Connector Runtime

**상태: COMPLETE (2026-07-17)**

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
- In-memory·In-process Connector
- Handler 등록과 Capability 탐색
- Idempotency Key와 Consumer Dedup
- Correlation·Causation·Trace 전달
- 기본 Retry와 Error Model

### 필수 OSS 검토

- gbrain Minion Job·retry·timeout·lock recovery
- JSON Schema, OpenAPI·AsyncAPI, CloudEvents
- PostgreSQL Job Table
- OpenTelemetry
- Temporal, NATS JetStream, Redis Streams는 확장 비교군

### 수직 검증

`PingCommand → TestModule → PongEvent → QueryResult`

### 완료 기준

- 독립 테스트 모듈 두 개가 Manifest만으로 등록·연결됨
- 호환되지 않는 Contract Version Assembly가 시작 전에 차단됨
- 중복 Command의 Side Effect가 한 번만 발생
- Event `at-least-once` 중복 안전성 검증
- Security Context 누락 시 보호 Handler 거부
- Command부터 Event·Query까지 하나의 Trace로 조회
- In-memory와 In-process Adapter가 동일 Contract Test 통과
- gbrain Minion의 `EXTRACT/AUGMENT/REFERENCE_ONLY/REJECT` 결정 기록
- 직접 구현한 Job 기능에 후보 대비 재사용 불가 근거가 존재

## 6. Stage 2 — Intake and Original Asset

**상태: COMPLETE (2026-07-17)**

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
- `.md` Plain Text 제한 지원

### 필수 OSS·레퍼런스 검토

- ddsyasas Source Intake·Action Home UX
- fsspec
- Local filesystem·S3-compatible Asset Adapter
- content-addressed storage
- Apache Tika MIME·metadata 범위

### 완료 기준

- 모든 입력이 `IntakeSubmission`으로 정규화됨
- 원본 Byte 또는 입력 텍스트가 변경 없이 보존됨
- 동일 원본 재입력과 새 Version을 구분함
- Asset Reference를 통해서만 원본에 접근함
- 권한 없는 Resolver 요청 거부
- 중복 Command에서 SourceVersion 중복 생성 없음
- Intake부터 저장까지 Audit·Trace 확인
- ddsyasas에서 반영한 UX 요소와 제외한 backend 요소가 추적됨
- Storage Adapter 선택 결과와 교체 방법이 기록됨

## 7. Stage 3 — Plain Text Transformation and Evidence

**상태: COMPLETE (2026-07-17)**

구현 및 검증 근거:

- [Stage 3 Engineering Guide](../engineering/stage-3-plain-text-transformation-evidence.md)
- [Stage 3 OSS Integration Review](stage-validations/stage-3-oss-integration-review.md)
- [ADR-083](../architecture/adr/ADR-083-stage-3-plain-text-transformation-and-evidence.md)

### 목표

보존된 텍스트를 `DocumentIR`로 변환하고 의미 구간을 원문 위치와 연결한다.

### 개발 모듈

- Transformation
- Evidence
- Plain Text Format Adapter

### 개발 항목

- `DocumentIR`
- `SourceMap`
- `EvidenceSpan`
- Text Position·Text Quote Selector
- 변환 Attempt·Revision
- 원문 복귀 Query

### 필수 OSS 검토

- lucas Highlight·Annotation
- lucas deterministic lint
- lucas watcher·reconcile
- W3C Web Annotation과 Selector
- JSON Pointer

### 완료 기준

- 지원 텍스트가 안정적인 DocumentIR로 변환됨
- DocumentIR 문단·문장 위치가 SourceMap에 연결됨
- EvidenceSpan에서 정확한 원문 구간 복원
- 잘못된 Offset·Hash·SourceVersion 참조 거부
- 동일 Input·Transformer Version 재실행 멱등
- Translation·Summary를 Evidence로 오인하지 않음
- Transformation과 Evidence가 직접 DB 접근 없이 연결됨
- lucas 부품별 Extract Feasibility와 결정 결과 존재
- 원문 왕복·offset·hash Golden Test 통과

## 8. Stage 4 — AI Provider, Direct Claim Candidate and Validation

**상태: COMPLETE (2026-07-17)**

구현·검증 근거:

- [Stage 4 Engineering Guide](../engineering/stage-4-ai-candidate-validation.md)
- [Stage 4 OSS Integration Review](stage-validations/stage-4-oss-integration-review.md)
- [ADR-084](../architecture/adr/ADR-084-stage-4-ai-candidate-validation.md)

### 목표

원문에 직접 적힌 Claim만 후보로 생성하고 Evidence 정합성을 검증한다.

### 개발 모듈

- AI Provider
- Candidate Generation
- Validation

### 초기 지원 범위

- `ClaimCandidate`
- `DIRECT_EVIDENCE`
- `direct-only` Extraction Profile
- 실제 Provider 한 개 이상
- 다른 Provider Fake·Contract Adapter 또는 두 번째 실제 Adapter

### 필수 OSS 검토

- OpenAI·Gemini·Anthropic 공식 SDK
- LiteLLM
- Pydantic 또는 Zod
- Structured Output 보조 도구
- Langfuse와 OpenTelemetry
- ddsyasas 모델·비용 UX

### 완료 기준

- Candidate Module이 특정 Provider SDK에 직접 의존하지 않음
- 유효 EvidenceSpan 없는 ClaimCandidate가 `READY`가 되지 않음
- 원문에 없는 추론 후보가 기본 Batch에서 생성되지 않음
- Schema 불일치가 명확히 실패·재시도됨
- 모델·Prompt·Policy·비용·Token·Attempt 기록
- 동일 입력·Idempotency Key의 Candidate 중복 없음
- Fake와 실제 Adapter가 동일 Contract Test 통과
- 공식 SDK 직접 Adapter와 LiteLLM 비교 결과 기록
- 선택한 Provider·telemetry 구성의 version·license·data policy 고정

## 9. Stage 5 — Comparison, ChangeSet and Human Review

**상태: COMPLETE (2026-07-17)**

구현·검증 근거:

- [Stage 5 Engineering Guide](../engineering/stage-5-comparison-change-set-review.md)
- [Stage 5 OSS Integration Review](stage-validations/stage-5-oss-integration-review.md)
- [ADR-085](../architecture/adr/ADR-085-stage-5-comparison-change-set-review.md)

### 목표

후보를 기존 지식과 비교하고 사용자가 승인·거절·보류할 수 있게 한다.

### 개발 모듈

- Comparison & Conflict
- ChangeSet & Review
- 최소 Review UI

### 필수 OSS·레퍼런스 검토

- OpenKnowledge Agent Activity
- OpenKnowledge Burst Diff와 changed-item grouping
- diff-match-patch 계열
- ddsyasas Action 중심 Home·검토 진입 UX

### 완료 기준

- 고정 Canonical Snapshot과 Candidate 비교
- 비교 결과와 Evidence를 같은 화면에서 확인
- 승인 전 Canonical Write 요청 미생성
- 승인 후 Candidate·Diff·Snapshot 변경 시 `STALE`
- 승인·보류·거절 이유와 Actor 기록
- 정확 중복은 새 Canonical Claim 생성 금지 제안
- 승인 대상 Content Digest와 Expected Version 고정
- Activity·Burst Diff 패턴의 적용 범위와 제외 범위 기록
- UI state가 Approval을 대체하지 않는 Negative Test 통과

## 10. Stage 6 — Canonical Claim Commit and History

**상태: COMPLETE (2026-07-17)**

구현·검증 근거:

- [Stage 6 Engineering Guide](../engineering/stage-6-canonical-commit-history-outbox.md)
- [Stage 6 OSS Integration Review](stage-validations/stage-6-oss-integration-review.md)
- [ADR-086](../architecture/adr/ADR-086-stage-6-canonical-commit-history-outbox.md)

### 목표

승인된 ChangeSet만 Canonical 원장에 원자적으로 반영한다.

### 개발 모듈

- Canonical Knowledge
- HistoryEvent
- Transactional Outbox

### 필수 OSS 검토

- gbrain Page·Fact·Relation·Timeline operation
- gbrain migration·recovery 패턴
- PostgreSQL
- Transactional Outbox
- ORM·migration 도구

### 완료 기준

- 승인 Manifest와 유효 Approval만 Commit 가능
- 미승인 Candidate 직접 저장 차단
- Claim 자동 Fact 승격 금지
- Canonical Revision·HistoryEvent·Outbox 단일 Transaction
- 동일 Commit ID 중복 Revision 없음
- Snapshot 불일치 시 `STALE_APPROVAL`
- 과거 Revision과 변경 이유 조회
- gbrain mapping·gap 분석서 존재
- 재사용 operation과 Shotgun-owned Canonical 영역이 분리됨
- gbrain DB가 병렬 Canonical로 운영되지 않음

## 11. Stage 7 — Search, Citation and Cited Answer

**상태: COMPLETE (2026-07-17)**

### 목표

Canonical Claim을 검색하고 원문 Citation이 포함된 답변을 제공한다.

### 개발 모듈

- Projection
- Search
- Citation Lookup
- Output Generation

### 필수 OSS·레퍼런스 검토

- gbrain Search·Think·Citation·Gap·Timeline Query
- PostgreSQL FTS·pg_trgm
- pgvector 비교
- ddsyasas Ask·Chat UX

### 완료 기준

- 승인된 Canonical Claim 검색 가능
- 미승인 Candidate 기본 검색 미노출
- 검색 결과에서 EvidenceSpan으로 이동 가능
- 답변 사실 문장이 Canonical 또는 Evidence Citation에 연결
- Projection Watermark가 Canonical Commit을 추적
- 오래된 Projection을 최신으로 표시하지 않음
- Projection 실패가 Canonical Commit을 되돌리지 않음
- Search·Ask UX 후보의 적용·제외 결정 기록
- Stage 2~7 E2E가 연결되어 Walking Skeleton MVP 선언 가능

## 12. Stage 8 — Format Expansion

**상태: COMPLETE (2026-07-17)**

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

### 필수 OSS 검토

- lucas HTML cleaner·XLSX extractor
- Docling
- Apache Tika
- MarkItDown
- PyMuPDF
- python-docx, python-pptx, openpyxl

### 명시적 제외

- 오디오·영상 파일 직접 분석
- 자동 음성 전사
- 영상 프레임·음성·장면 분석
- ffmpeg의 Shotgun Assembly 활성화

### 완료 기준

- 형식별 Golden Corpus 통과
- 페이지·셀·Shape·BBox 원문 위치 복원
- 표·구조 손실이 허용 기준 이내
- 이미지 의미가 필요할 때 Multimodal Validation
- 번역 Revision과 원문 Evidence 분리
- 손상·암호화·미지원 입력의 명확한 실패 상태
- Adapter 교체가 상위 Contract에 영향 없음
- 형식별 OSS 결정과 exact version·license·benchmark 존재
- 직접 구현 Parser에는 후보 대비 우위 또는 필수 차이 증거가 있음

## 13. Stage 9 — Knowledge Model, Impact and Advanced Review

**상태: COMPLETE (2026-07-17)**

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

### 필수 OSS·레퍼런스 검토

- gbrain Relation Graph·Timeline
- NetworkX
- OpenKnowledge 2D Graph·Burst Diff·Entity Vault
- Cytoscape.js

### 완료 기준

- 유형별 Schema와 Evidence 정책 통과
- `POSSIBLY_SAME` Entity 자동 병합 금지
- Relation·Event 시간 추측 금지
- Impact가 실제 Typed Edge를 결정적으로 탐색
- 부분 승인 Dangling Reference 방지
- User Edit의 올바른 Phase 재진입
- 모델 불일치 보존·표시
- 2D Graph에 목록·표 fallback 제공
- Entity Vault staged import·approval 검증
- NetworkX·gbrain Graph·UI 후보별 결정 기록

## 14. Stage 10 — Compiled Truth, Graph and Discovery

**상태: COMPLETE (2026-07-17)**

### 목표

Canonical에서 읽기 Projection을 재생성하고 Gap·관계 후보를 탐색한다.

### 개발 모듈

- Compiled Truth Projector
- Search·Graph Projector
- Knowledge Discovery
- Cache Invalidation

### 필수 OSS 검토

- gbrain Dream Cycle
- gbrain Search·Graph·Timeline Projection
- pgvector
- Apache AGE
- OpenSearch·Qdrant는 규모 한계 시 비교

### 완료 기준

- 동일 Snapshot·Projector Version의 동일 논리 결과
- 증분과 Full Rebuild 결과 동등
- 현재·과거·예정·충돌 상태 구분
- AI 추론 Edge가 Canonical Graph에 섞이지 않음
- Discovery 결과가 `DERIVED_INFERENCE`로 Phase 3 재진입
- 반복 제안 Suppression
- 증분·주간 Discovery 비용·범위 제한
- Projection 상태·Lag 표시
- Dream Cycle·Graph/Search 후보의 적용 결정과 재사용 경계 기록

## 15. Stage 11 — Risk-controlled External Action

**상태: COMPLETE (2026-07-17)**

### 목표

승인된 외부 Action을 안전하게 실행하고 결과를 검증한다.

### 첫 Connector 후보

- Gmail Draft
- Google Calendar 읽기·일정 Draft
- 로컬 파일 생성
- GitHub Issue 또는 Draft PR

### 필수 OSS 검토

- gbrain MCP operation contract
- MCP SDK·Specification
- Provider 공식 SDK
- OPA, Casbin, OpenFGA
- Temporal 장기 Action 비교

### 필수 흐름

`Validation → ActionCandidate → Risk Decision → Preview → User Approval → Preflight → Execute → Verify → Feedback & Reentry`

### 완료 기준

- Candidate 생성과 실행 상태·권한 분리
- Approval Token이 Action Revision·대상·Parameter Digest에 결속
- 승인 후 변경 시 Token 무효
- Preflight 권한·대상·중복·상태 재검증
- Provider에서 결과 재조회·검증
- Timeout·응답 유실 시 `OUTCOME_UNKNOWN`
- Connector Secret이 AI Prompt·일반 Log에 노출되지 않음
- 보상 Action도 별도 후보·승인·Audit
- MCP·Policy·Provider 후보 결정과 version·license·rollback 기록

## 16. Stage 12 — Module and OSS Reuse Validation

**상태: COMPLETE (2026-07-17)**

구현·검증 근거:

- [Stage 12 Engineering Guide](../engineering/stage-12-module-reuse-validation.md)
- [Stage 12 OSS Integration Review](stage-validations/stage-12-oss-integration-review.md)
- [Package Compatibility, Migration and Rollback](stage-12-module-compatibility-and-migration.md)
- [ADR-092](../architecture/adr/ADR-092-stage-12-module-and-oss-reuse-validation.md)

### 목표

Shotgun 내부 Package가 아니라 실제 재사용·교체 가능한 모듈임을 증명한다.

### 검증 Assembly

- Document Review System
- Research Assistant
- Work Automation System

### 완료 기준

- Shotgun 전체 설치 없이 필요한 모듈만 등록 가능
- In-memory Adapter로 독립 Contract Test 실행
- Canonical Knowledge 없는 Assembly 구성 가능
- Provider·Storage·Transport Adapter 하나 이상 교체 성공
- 채택 OSS 하나를 제거·대체해도 비관련 모듈 코드 변경이 없음 또는 최소
- gbrain 또는 lucas Extract Package를 별도 Assembly에서 사용
- ddsyasas·OpenKnowledge 기반 UX를 Mock Contract로 실행
- 별도 예제 Project에서 최소 한 모듈 재사용
- Package Version·Compatibility Matrix·Migration Guide 제공
- Fork·Extract upstream sync와 rollback 연습 완료

## 17. Stage 전환 규칙

다음 Stage 착수는 이전 Stage의 모든 선택 기능 완료를 요구하지 않는다. 그러나 Critical Path 기능과 해당 Stage의 필수 OSS Evaluation은 반드시 완료 또는 명시적 `DEFER` 상태여야 한다.

- Stage 4 전 Stage 3 Plain Text Evidence 완료
- Stage 8 PDF Prototype은 Stage 7 전에 가능하지만 Product Integration은 Stage 7 이후
- Stage 11 실행 기능은 Stage 5 Review와 Stage 1 Security Context 전 구현 금지
- OSS 후보가 `BLOCKED`면 직접 구현으로 조용히 우회하지 않고 Stage를 `BLOCKED` 또는 승인된 `DEFER`로 표시

## 18. 구현 우선순위

1. Walking Skeleton 차단 의존성
2. Canonical·Evidence·승인 안전 경계
3. 검증된 OSS의 재사용 가능성
4. 사용자가 확인 가능한 종단 가치
5. 재사용 가능한 Contract 안정화
6. 오류·복구·관찰 가능성
7. 성능 최적화
8. 고급 UX와 확장 기능

## 19. Stage 완료 선언 책임

Stage 완료 PR에는 다음을 포함한다.

- 구현·제외 범위
- 통과한 Definition of Done Gate
- 관련 OSS 후보와 결정 결과
- 채택 version·commit·license·SBOM 또는 신규 구현의 재사용 불가 근거
- E2E·Golden Corpus·Contract Test 결과
- Migration·Rollback 방법
- Known Limit와 Risk Register 변경
- 다음 Stage에 전달하는 Contract Version
- 관련 ADD·ADR 준수 확인

## 20. 변경 이력

### v0.2 — 2026-07-16

- 4-레퍼런스 전략과 Stage별 OSS 후보를 직접 연결
- 모든 Stage에 OSS Integration Gate 추가
- 검토 없는 직접 구현 금지와 재사용 불가 근거 조건 추가
- Stage 12에 OSS 제거·교체·Extract Package 재사용 검증 추가

### v0.1 — 2026-07-16

- Stage 0~12 최초 구현 순서와 완료 조건 정의

## Stage 7 완료 기록 — 2026-07-17

Stage 7 Search, Citation and Cited Answer는 `COMPLETE`다. PostgreSQL FTS·`pg_trgm`, Projection Watermark, Canonical-only 검색, 문장별 Evidence Citation, Stale 차단, rebuild, Ask UI가 구현되었다. Stage 2→7 Walking Skeleton MVP E2E가 연결되었다. 상세 근거는 [Stage 7 OSS Integration Review](stage-validations/stage-7-oss-integration-review.md)와 [ADR-087](../architecture/adr/ADR-087-stage-7-cited-search-projection.md)을 따른다.

## Stage 8 완료 기록 — 2026-07-17

Stage 8 Format Expansion은 `COMPLETE`다. HTML·PDF·DOCX·CSV·XLSX·PPTX·이미지와
공개 HTTPS 페이지의 접근 가능한 텍스트를 형식별 Adapter로 처리한다.
Page·BBox·Cell·Shape·CSS Selector, binary SourceVersion hash, 번역 provenance 분리,
손상·암호화·미지원 상태, Multimodal Validation 요구, Adapter 교체 Contract를
Golden·E2E·PostgreSQL 시험으로 검증했다. 상세 근거는
[Stage 8 OSS Integration Review](stage-validations/stage-8-oss-integration-review.md)와
[ADR-088](../architecture/adr/ADR-088-stage-8-format-adapter-and-structural-selectors.md)을 따른다.

## Stage 10 완료 기록 — 2026-07-17

[Stage 10 Engineering Record](../engineering/stage-10-compiled-truth-discovery.md),
[Stage 10 OSS Integration Review](stage-validations/stage-10-oss-integration-review.md),
[ADR-090](../architecture/adr/ADR-090-stage-10-compiled-truth-and-discovery.md)을 따른다.

## Stage 12 완료 기록 — 2026-07-17

Stage 12 Module and OSS Reuse Validation은 `COMPLETE`다. Canonical Knowledge가 없는
Document Review Assembly, 시작 전 Assembly Manifest 검증, lucas Extract Package 1.0.0,
jsdiff 교체 Adapter, ddsyasas·OpenKnowledge UX Mock Contract와 별도 Project 최소 설치를
구현했다. Package build·tarball install·Unicode Golden·In-memory E2E·Adapter Replacement와
upstream sync·rollback 절차를 검증했다. 상세 근거는
[Stage 12 OSS Integration Review](stage-validations/stage-12-oss-integration-review.md)와
[ADR-092](../architecture/adr/ADR-092-stage-12-module-and-oss-reuse-validation.md)을 따른다.

## Stage 12.1 Security Gate 완료 기록 — 2026-07-18

Stage 12.1 전체 상태는 `IN_PROGRESS`이며, 네 Gate 중 **Security Gate의 P0-1·P0-2만 `COMPLETE`**다.

- P0-1 `Authenticated Security Context`: Header 기반 actor·project·scope·sensitivity 신뢰와 no-header owner fallback을 제거하고, 서버 인증·Project Membership·Scope Ceiling에서 `TrustedSecurityContext`를 생성한다.
- P0-2 `Action Candidate server-side binding`: 서버 저장 Candidate·Validation·Evidence·SourceVersion·Transformation Revision을 독립 재검증하고, 불변 Preview Snapshot·Approval Record·Execution Projection을 상호 결속한다. Execute는 `approvalId`만 받고 승인된 Snapshot payload만 사용한다.
- 승인 소스 SHA: `62d2ef114f172aa0b8bd1903c84b15a215a01db3`
- `main` Merge SHA: `d9e29bc588ff8c2badfd20c87cd3d4c2e695ba28`
- 검증: 전체 `227 passed, 0 failed, 0 skipped`; PostgreSQL Security Gate `38 passed, 0 failed, 0 skipped`; 집중 Action API `2 passed, 0 failed, 0 skipped`.
- Evidence `exactHash`는 `quote.exact`의 Hash로 검증하고, SourceVersion 전체 Content Hash와 직접 비교하지 않는다. 두 권위 레코드는 Transformation Revision으로 결속한다.
- 동일 Approval의 동시 Execute는 Connector 호출과 `ACTION_EXECUTION_CLAIMED` Audit을 각각 1회로 제한한다.
- Token·Session 원문과 내부 Binding Digest는 DB 목록·Audit·일반 로그·HTTP 안전 오류에 노출하지 않는다.

구현·결정 근거:

- [Stage 12.1 Hardening Strategy](../engineering/stage-12-1-hardening-strategy.md)
- [ADR-093 — HTTP Identity and Authorization Boundary](../architecture/adr/ADR-093-http-identity-and-authorization-boundary.md)
- [ADR-094 — Action Candidate Server-side Binding and Approval Snapshot](../architecture/adr/ADR-094-action-candidate-server-side-binding-and-approval-snapshot.md)
- [Stage 12.1 Security Gate Implementation Record](../architecture/adr/implementation-records/stage-12-1-p0-1-p0-2-security-gate.md)

남은 Gate와 제한:

- 현재 상태에서 Durability Gate는 `COMPLETE`, Quality와 Reuse and Operations Gate는 `NOT STARTED`다.
- 실제 Gmail·Calendar·Drive·GitHub 등 외부 Connector는 Connector별 Capability·권한·Preflight·Verify·복구 Gate와 별도 활성화 승인을 통과하기 전까지 OFF 상태를 유지한다.
- Stage 12.1 전체를 `COMPLETE`, `production-ready`, `release-ready`로 표시하지 않는다.
- Merge SHA에 연결된 GitHub Actions 실행 기록은 없으므로 테스트 증거는 Codex 로컬 PostgreSQL 실행 결과와 원격 코드 독립 검토 기록으로 보존한다.

## Stage 12.1 Durability Section 1 완료 기록 — 2026-07-21

이 완료 기록 시점에는 Stage 12.1 전체와 Durability Gate 전체 상태가 `IN_PROGRESS`였으며, **AI Durable Materialization Section만 `COMPLETE`**였다. 최신 상태는 아래 Durability Gate 완료 기록을 따른다.

- Generation Request·Provider Attempt·버전화된 불변 Provider Output과 Candidate Materialization 상태를 PostgreSQL에 영속화한다.
- 저장 Output 기반 Resume·Replay는 Provider 재호출 없이 기존 Batch와 Candidate Revision 1을 재사용한다.
- `MATERIALIZATION_FAILED`와 기존 Batch의 불완전 완료 상태를 중복 Candidate 없이 복구한다.
- `OUTCOME_UNKNOWN`, Output 누락·형식 오류와 Digest 불일치는 자동 Provider 재호출 없이 fail closed한다.
- `main` Merge SHA: `06ce9b48328296856fc2eb70e6ef1a4a329243b6`
- Merge 방식: fast-forward
- 검증: Contract `12 passed`, Stage 4 PostgreSQL 회귀 `1 passed`, AI Durable Materialization PostgreSQL `6 passed`; lint, format, typecheck, architecture, migration과 DB verify 모두 PASS.
- PostgreSQL 16.14, Google Gen AI SDK 2.12.0과 Ajv 8.20.0의 기존 `ADOPT` 결정을 유지하고, gbrain은 `REFERENCE_ONLY`, pg-boss·Graphile Worker·Temporal은 `DEFER`한다. 새 Runtime 의존성은 없다.
- Migration 014는 추가형 Schema이며 Application Rollback 시 영속 Output을 보존한다. 파괴적 Down Migration은 제공하지 않는다.

구현·결정 근거:

- [Stage 12.1 Hardening Strategy](../engineering/stage-12-1-hardening-strategy.md)
- [ADR-096 — Stage 12.1 AI Durable Materialization](../architecture/adr/ADR-096-stage-12-1-ai-durable-materialization.md)
- [Stage 12.1 AI Durable Materialization Implementation Record](../architecture/adr/implementation-records/stage-12-1-ai-durable-materialization.md)

남은 Gate와 제한:

- Canonical Outbox·Compiled Truth Projection 자동 복구와 Backup·Restore는 Durability Gate 후속 Section이다.
- Quality와 Reuse and Operations Gate는 `NOT STARTED`다.
- 실제 외부 Action Connector와 외부 네트워크 공개는 계속 금지한다.
- Stage 12.1 전체를 `COMPLETE`, `production-ready`, `release-ready`로 표시하지 않는다.
- Stage 13은 이 Section 완료로 자동 개시되지 않는다.

## Stage 12.1 Durability Gate 완료 기록 — 2026-07-22

Sections 1–4의 구현·검증·독립 재검토와 사용자 승인이 완료됐다. ADR-097은 `ACCEPTED`, Durability Gate는 `COMPLETE`다. Quality Gate와 Reuse and Operations Gate는 `NOT STARTED`이며 Stage 12.1은 `IN_PROGRESS`, Stage 13은 `NOT STARTED`다. PR #14 merge는 Canonical ADD 동기화, 전체 검증과 성공한 head CI를 조건으로 승인됐다.

- Canonical Project를 탐색해 startup과 비중첩 periodic Worker에서 pending·stale processing Outbox를 bounded batch로 drain한다.
- Search와 Compiled Truth readiness를 Outbox publish 상태와 독립 확인하고 누락·stale·degraded Projection을 Canonical에서 Full Rebuild한다.
- Project별 실패를 격리하고 replay를 멱등하게 유지하며 Application shutdown에서 Worker를 정리한다.
- Backup Bundle v1은 PostgreSQL custom dump, 참조 Original Asset, versioned Contract·Module Manifest, Migration 목록과 모든 비-Projection 영속 Table digest를 포함한다.
- Restore는 Source와 다른 새 빈 Database와 빈 Asset Root만 허용하며 dump·Asset·Contract·Table digest 불일치를 fail closed한다.
- 격리 clean restore drill에서 14개 Migration, Original Asset 1개, Contract·Module Manifest 90개와 Canonical Project 1개를 복원했다. Projection 삭제 뒤 Outbox `published`, Search `READY`, Compiled Truth version 1과 예상 Claim 검색을 확인했다.
- PostgreSQL 16.14 `pg_dump`·`pg_restore`는 `ADOPT`, gbrain은 `REFERENCE_ONLY`, pgBackRest 2.58.0·WAL-G 3.0.8·Barman 3.19.1은 `DEFER`한다. 새 Runtime dependency는 없다.
- Technical approval basis SHA: `27f3c5c2c6f3e3bdb17dfc84369d2f9f20514b94`
- Section approval documentation SHA: `5031ff3be616d8e126111859c7b08c988d7e498e`
- Remote CI #53과 #54: PASS
- Backup Restore unit tests: 3 passed
- PostgreSQL Database tests: 68 passed
- Architecture, Stage 12 package, DB verify, lint, format, typecheck, Secret Scan과 OSS Gate: PASS
- Local isolated Backup→Restore drill: PASS — `shotgun-backup-v1`, 14 migrations, Original Asset 1, Contract·Module Manifest 90, Canonical Project 1, Outbox `published`, Search `READY`, Compiled Truth version 1, remaining `shotgun_restore_*` Databases 0. 5,347ms는 로컬 fixture 측정값이며 Production RTO가 아니다.

구현·운영 근거:

- [ADR-097 — Stage 12.1 Canonical Outbox, Projection Recovery and Clean Restore](../architecture/adr/ADR-097-stage-12-1-outbox-projection-clean-restore.md)
- [Implementation Record](../architecture/adr/implementation-records/stage-12-1-outbox-projection-clean-restore.md)
- [Backup and Clean Restore Runbook](../engineering/stage-12-1-backup-restore-runbook.md)
- [Stage 12.1 Durability Recovery OSS Review](stage-validations/stage-12-1-durability-recovery-oss-review.md)

남은 Gate와 제한:

- Quality Gate와 Reuse and Operations Gate는 `NOT STARTED`다.
- PITR, continuous WAL archive, 외부 암호화 저장소, Retention과 Production RPO·RTO 승인은 Operations Gate에서 결정한다.
- 실제 외부 Action Connector와 외부 네트워크 공개는 계속 금지한다.
- Stage 12.1 전체를 `COMPLETE`, `production-ready`, `release-ready`로 표시하지 않는다.
- Stage 13은 Durability Gate 완료로 자동 개시되지 않는다.

## Stage 12.1 Quality Sections 1–3 진행 기록 — 2026-07-22

Quality Section 1의 Golden Corpus·Label·Metric·Run 계약은 사용자 승인을 완료했고
ADR-098은 `ACCEPTED`다. Section 2 Claim Extraction과 Section 3 Natural-language
Search는 synthetic reviewed corpus로 구현·측정한 candidate다. Section 2는 실제 Stage 4
경로 보완 후 independent review ready이며, Section 3은 independent review pass이고
사용자 승인 대기 상태다.

- Corpus: 9 cases, 8 Golden Claims, 6 exhaustive queries, Korean·English·mixed와
  Plain Text·Markdown·HTML-derived slice
- Claim: 실제 Stage 4 Command·Handler와 Validation 경로, Fake Provider 9회, READY Candidate 11개;
  Precision `0.545455`, Recall `0.75`, F1 `0.631579`, Exact Case `0.444444`, No-Claim Accuracy `0.0`
- Search: `k=1` Precision·Recall·Hit Rate·MRR·nDCG `0.8`, No-result·Citation·Stale rejection `1.0`
- 알려진 취약점: synonym query 미검색, no-claim 문장 복사, Markdown heading 과추출,
  HTML-derived selector 불일치, 서로 다른 Evidence 위치의 동일 Claim 중복
- Production Claim·Prompt·Provider·Search ranking과 Database Migration은 변경하지 않음
- Section 4 Threshold·CI 차단은 `NOT STARTED`, Section 5A는 `NOT STARTED`,
  Section 5B Semantic Retrieval은 `DEFERRED`

상세 근거는 [Quality Evaluation Foundation](../engineering/stage-12-1-quality-evaluation-foundation.md),
[Quality Baseline Implementation Record](../engineering/stage-12-1-quality-baselines.md)와
[ADR-098](../architecture/adr/ADR-098-stage-12-1-quality-evaluation-contract.md)을 따른다.
Quality Gate와 Stage 12.1은 `IN_PROGRESS`, Stage 13은 `NOT STARTED`다.
