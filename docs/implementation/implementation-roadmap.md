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
