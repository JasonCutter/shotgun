# Shotgun OSS Integration Roadmap

> 상태: **Baseline v0.1**  
> 기준일: 2026-07-16  
> 원칙: 관련 OSS를 먼저 검토하고, 재사용 불가 근거가 있을 때만 신규 구현한다.

## 1. 목적

이 문서는 Shotgun 구현 Stage마다 어떤 오픈소스·레퍼런스를 우선 검토하고, 어떤 방식으로 재사용하며, 어떤 증거가 있어야 새로 구현할 수 있는지를 정의한다.

OSS Integration Roadmap은 [Implementation Roadmap](./implementation-roadmap.md)을 대체하지 않는다. Implementation Roadmap이 기능과 의존성 순서를 정의한다면, 이 문서는 각 Stage에서 수행해야 할 OSS 조사·추출·Adapter·채택·제외 작업을 정의한다.

## 2. 기준 전략

Shotgun은 여러 OSS 전체 Runtime을 병렬로 실행하는 제품이 아니다. 검증된 기능을 모듈 경계 안으로 가져오고 Shotgun의 Contract·Evidence·Approval·Canonical 정책을 유지한다.

### 2.1 네 레퍼런스의 역할

| 레퍼런스                | 기준 역할                  | 우선 적용 영역                                                       | 기본 태도                                      |
| ----------------------- | -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| `garrytan/gbrain`       | Brain·Execution 기반 후보  | Page·Fact·Search·Graph·Timeline·MCP·Job·Discovery·Migration          | Port 뒤에서 우선 추출·Adapter 검증             |
| `lucasastorian/llmwiki` | 수집·변환·검증 부품 공급원 | HTML/XLSX 변환, Highlight·Annotation, Lint, Watcher·Reconcile        | 필요한 부품만 독립 Package로 추출              |
| `ddsyasas/llm-wiki`     | Product Workflow UX 참고   | Source Intake, Ask·Chat, Cost·Model·Settings, Action-oriented Home   | Backend 제외, Interaction·Presentation만 참고  |
| Inkeep OpenKnowledge    | Human Cockpit 기술 참고    | Visual/Source UX, 2D Graph, Agent Activity, Burst Diff, Entity Vault | 전체 Runtime 제외, UI·보존 패턴·Adapter만 활용 |

### 2.2 Shotgun 소유 영역

다음은 OSS에 넘기지 않는다.

- Stable `Source`·`SourceVersion`·`OriginalAsset`
- `EvidenceSpan`과 Source Map의 공식 계약
- Candidate·Provenance·Validation 상태
- User Directive·Fact Priority·Conflict
- Draft ChangeSet·Approval·Canonical Write 정책
- Claim·Fact 분리와 HistoryEvent
- Compiled Truth의 파생 Projection 의미
- Risk Decision·Action Approval·Audit
- Module Contract와 Connector Runtime의 상위 의미

OSS 내부 데이터 모델은 Shotgun 공통 Contract가 될 수 없다.

## 3. OSS-first 개발 규칙

1. Stage 또는 Module Issue를 열 때 관련 OSS 후보를 먼저 연결한다.
2. 후보의 실제 코드·테스트·문서와 Shotgun 요구를 비교한다.
3. 다음 중 하나의 Integration Decision을 기록한다.
   - `ADOPT`: Port 뒤에서 그대로 또는 설정 중심으로 사용
   - `EXTRACT`: 일부 코드를 독립 Package로 추출
   - `AUGMENT`: 핵심 패턴을 사용하고 Shotgun 정책·계약을 보완
   - `REFERENCE_ONLY`: 코드 없이 설계·UX·테스트 사례만 참고
   - `DEFER`: 현재 Stage에서 사용하지 않음
   - `REJECT`: 요구·안전·라이선스·결합도 문제로 제외
4. `ADOPT`, `EXTRACT`, `AUGMENT`는 정확한 version·tag·commit과 license 상태를 기록한다.
5. 신규 구현은 다음 증거가 있을 때만 허용한다.
   - 관련 후보가 없음
   - 후보가 Canonical·Evidence·Approval 경계를 위반함
   - 라이선스 또는 보안 Gate 실패
   - Adapter 격리가 불가능하거나 전체 Runtime 중첩을 강제함
   - Golden Corpus·Benchmark에서 필수 품질을 충족하지 못함
   - 유지보수·Migration·Rollback 위험이 직접 구현보다 큼
6. “익숙하지 않다”, “직접 만드는 것이 빠를 것 같다”만으로 OSS 검토를 생략할 수 없다.

## 4. Stage별 Integration Roadmap

## Stage 0 — Repository and Engineering Foundation

**우선 후보**

- PostgreSQL
- OpenTelemetry
- JSON Schema
- 선택 언어의 Workspace·Lint·Test·Migration 도구
- gbrain의 실제 Runtime·언어·DB·Migration 구조

**필수 작업**

- gbrain을 전체 기반으로 가져올지, 모듈별 추출 대상으로 둘지 코드 수준 평가
- gbrain의 upstream pin·fork·subtree·reference-only 방식 비교
- OSS Source Registry 초기화
- SBOM·license scan·dependency scan 실행 경로 확정

**종료 판정**

- gbrain Integration Decision 초안이 존재함
- PostgreSQL·OpenTelemetry·Schema 도구 선택 또는 비교 기준이 기록됨
- `upstream/`, `references/`, `adapters/` 사용 여부가 기술 ADR에 반영됨

## Stage 1 — Kernel, Contracts and Connector Runtime

**우선 후보**

- gbrain Minion Job·retry·timeout·lock recovery
- JSON Schema
- OpenAPI·AsyncAPI
- CloudEvents
- PostgreSQL Job Table
- Temporal, NATS JetStream, Redis Streams는 비교 후보

**필수 작업**

- gbrain Job 모델에서 재사용 가능한 Job·Attempt·Recovery 경계 추출
- Shotgun Message Envelope와 gbrain operation contract의 Adapter 가능성 검증
- In-process/PostgreSQL 기준 구현과 외부 Runtime 후보 비교

**MVP 기본 결정**

- In-process Connector와 PostgreSQL 중심을 기준 구현으로 둔다.
- Temporal·NATS·Redis는 실제 한계가 확인되기 전 도입하지 않는다.

**종료 판정**

- gbrain Minion 관련 결정이 `EXTRACT`, `AUGMENT`, `REFERENCE_ONLY` 또는 `REJECT` 중 하나로 기록됨
- 선택 OSS의 version·license·Adapter 경계가 고정됨
- 검토 없이 자체 Job Runtime을 새로 만들지 않음

## Stage 2 — Intake and Original Asset

**우선 후보**

- lucas Watcher event·Reconcile 패턴
- ddsyasas Source Intake UX
- gbrain Page 입력·namespace 패턴은 참고 대상
- 로컬 File·Object Storage OSS는 Adapter 후보

**필수 작업**

- ddsyasas의 Paste·File·URL 흐름을 Shotgun `IntakeSubmission`에 맞게 View Model로 재설계
- lucas Watcher·Reconcile에서 Source event와 staging recovery만 분리 가능한지 검증
- 기존 프로젝트의 SQLite·VaultFS·절대경로 identity는 도입하지 않음

**종료 판정**

- Source Intake UX 결정 기록
- Watcher·Reconcile Integration Decision 기록
- 원본 identity가 path나 OSS 내부 ID에 결합되지 않음

## Stage 3 — Plain Text Transformation and Evidence

**종료 상태: COMPLETE**

세부 결정과 검증 결과는
[Stage 3 OSS Integration Review](stage-validations/stage-3-oss-integration-review.md)에 고정한다.

**우선 후보**

- lucas Highlight·Annotation
- lucas deterministic lint 패턴
- W3C Web Annotation Data Model
- Text Position·Text Quote Selector

**필수 작업**

- lucas Highlight·Annotation의 provenance 분리 방식을 검토
- Shotgun `EvidenceSpan`으로 변환하는 Adapter 또는 재구현 범위 확정
- lucas Evidence·Citation 테스트 사례를 Golden Fixture로 활용 가능한지 판단

**종료 판정**

- Evidence 구현 PR에 lucas·W3C 검토 결과가 포함됨
- 직접 구현 시 재사용 불가 이유가 기록됨
- Translation·Summary·Annotation이 원문 Evidence와 분리됨

## Stage 4 — AI Provider, Candidate and Validation

**우선 후보**

- GPT·Gemini·Claude 공식 SDK
- LiteLLM
- Pydantic 또는 Zod
- Instructor 계열 structured output 보조
- Langfuse
- OpenTelemetry
- lucas deterministic lint

**필수 작업**

- Provider 공식 SDK 직접 Adapter와 LiteLLM Gateway 비교
- Structured Output 오류율·Rate Limit·Timeout·Usage mapping 비교
- Langfuse와 OpenTelemetry 역할 중복·분리 검토
- lucas Lint를 deterministic Validator 패턴으로 재사용 가능한지 검증

**종료 판정**

- 최소 한 Provider Adapter가 `ADOPTED` 또는 `AUGMENT` 상태
- 다른 Provider 교체 Contract Test 통과
- AI Gateway를 선택하지 않은 경우에도 비교 결과가 기록됨

## Stage 5 — Comparison, ChangeSet and Human Review

**우선 후보**

- OpenKnowledge Agent Activity
- OpenKnowledge Burst Diff
- OpenKnowledge Visual/Source 보존 원칙
- ddsyasas Action-oriented Home·Review 진입 UX
- Tiptap·ProseMirror는 별도 후보
- Yjs는 `DEFERRED`

**필수 작업**

- Burst Diff를 Shotgun Draft ChangeSet에 연결하는 Prototype
- Agent Activity를 JobEvent·Audit View에 연결하는 Adapter 검증
- OpenKnowledge Runtime·Markdown/Yjs를 Canonical Store로 사용하지 않음
- MVP는 Source editor·Preview·typed diff 중심으로 제한 가능

**종료 판정**

- Burst Diff와 Activity 각각 `ADOPT`, `AUGMENT`, `REFERENCE_ONLY`, `REJECT` 결정
- Review UI가 OSS 내부 저장 모델에 결합되지 않음
- Yjs는 별도 ADR 전까지 Draft CRDT로도 활성화하지 않음

## Stage 6 — Canonical Claim Commit and History

**완료 판정: COMPLETE (2026-07-17)**

- PostgreSQL `ADOPT`
- gbrain append·lock·migration·recovery 패턴 `REFERENCE_ONLY`
- Transactional Outbox 최소 구현은 `CanonicalKnowledgeRepositoryPort` 뒤에 격리
- pg-boss·Graphile Worker·ORM·migration 도구는 exact version 검토 후 `DEFER`
- 상세 근거:
  [Stage 6 OSS Integration Review](stage-validations/stage-6-oss-integration-review.md)

**우선 후보**

- gbrain Page·Fact·Timeline·Migration·Recovery
- PostgreSQL
- Transactional Outbox 패턴

**필수 작업**

- gbrain Fact·Page 모델을 Shotgun Claim·Fact·Approval 정책 뒤에 배치할 수 있는지 검증
- gbrain DB를 직접 Canonical Module로 사용할지, Adapter·Projection·Migration 대상으로 사용할지 결정
- gbrain이 사용자 승인과 Claim·Fact 분리를 우회할 수 없음을 증명

**종료 판정**

- `shotgun-gbrain-adapter` 또는 명시적 대체 구현 결정
- gbrain version·commit·migration plan·rollback plan 기록
- gbrain을 사용하지 않으면 품질·경계·비용 근거가 ADR에 존재함

## Stage 7 — Search, Citation and Cited Answer

**우선 후보**

- gbrain Search·Think·Citation·Gap
- PostgreSQL FTS·pg_trgm
- ddsyasas Ask·Chat UX
- pgvector는 Stage 7 이후 확장 후보

**필수 작업**

- gbrain Search와 PostgreSQL 기준 구현을 Citation 정확도 중심으로 비교
- ddsyasas Ask·Chat 화면을 typed response로 재구성
- Citation·Conflict·Gap을 UI에서 분리 표시

**종료 판정**

- MVP 검색 엔진 결정과 근거 기록
- gbrain Search를 제외하면 비교 Fixture와 결과가 남음
- Ask UI가 기존 ddsyasas backend에 의존하지 않음

## Stage 8 — Format Expansion

**우선 후보**

- lucas HTML cleaner·XLSX extractor
- Docling
- Apache Tika
- MarkItDown
- PyMuPDF
- python-docx
- python-pptx
- openpyxl

**형식별 우선순위**

| 형식   | 첫 평가 후보                | 보조·대안               |
| ------ | --------------------------- | ----------------------- |
| HTML   | lucas HTML cleaner          | MarkItDown, Tika        |
| PDF    | Docling                     | PyMuPDF, Tika           |
| DOCX   | Docling                     | python-docx, MarkItDown |
| XLSX   | lucas XLSX extractor        | openpyxl, Docling       |
| PPTX   | python-pptx                 | Docling                 |
| 이미지 | Multimodal Provider Adapter | OCR은 별도 조건부 후보  |
| URL    | 안전한 Fetch Adapter        | HTML 후보 재사용        |

**필수 작업**

- 형식마다 최소 두 후보 또는 후보와 직접 기준 구현을 Golden Corpus로 비교
- 하나의 범용 변환기가 모든 형식을 독점하지 않음
- 오디오·영상 직접 분석과 자동 전사는 계속 제외

**종료 판정**

- 형식별 Integration Decision과 pin 기록
- SourceMap·Evidence 복원 시험 통과
- 채택 OSS 교체 시 상위 Contract가 유지됨

## Stage 9 — Knowledge Model Expansion

**우선 후보**

- gbrain Alias·Canonicalization·Timeline·Relation Graph
- NetworkX
- OpenKnowledge Burst Diff·Entity Vault 표현
- lucas Reconcile 패턴

**필수 작업**

- Entity·Relation·Timeline 표현을 gbrain에 Adapter 가능한지 검증
- Recursive Impact의 deterministic graph oracle로 NetworkX 평가
- Entity Vault는 staged import/export로만 검토

**종료 판정**

- Entity·Graph 구현의 gbrain Integration Decision 기록
- Impact 결과를 AI 추론이 아니라 실제 Typed Edge로 검증
- Entity Vault 직접 양방향 Canonical sync 금지

## Stage 10 — Compiled Truth, Graph and Discovery

**우선 후보**

- gbrain Graph·Timeline·Dream Cycle
- OpenKnowledge 2D Graph UX
- NetworkX
- PostgreSQL FTS·pgvector
- Apache AGE·OpenSearch·Qdrant는 한계 도달 후 후보

**필수 작업**

- gbrain Dream Cycle을 Knowledge Discovery 후보 생성기로 사용할 수 있는지 평가
- OpenKnowledge 2D Graph interaction을 Shotgun typed graph contract에 연결
- Graph Canvas와 동일 데이터의 목록·표 fallback 제공
- 별도 Graph·Vector 제품은 PostgreSQL 기준 한계가 확인된 경우에만 도입

**종료 판정**

- Dream Cycle Integration Decision 기록
- 2D Graph UX 결정 기록
- Projection 전체 재생성과 증분 갱신이 OSS 내부 데이터에 종속되지 않음

## Stage 11 — Risk-controlled External Action

**우선 후보**

- MCP SDK
- Gmail·Calendar·GitHub 등 공식 SDK
- OPA
- Casbin
- OpenFGA는 관계 권한 요구가 확인될 때만

**필수 작업**

- Policy Engine 없이 코드 기반 정책을 사용할 경우 OPA·Casbin과 비교
- Connector마다 공식 SDK와 MCP Adapter의 경계 비교
- Secret 격리·idempotency·verify·outcome unknown을 Contract Test로 검증

**종료 판정**

- Policy·Connector별 Integration Decision 기록
- 승인·Preflight·Verify를 우회하는 OSS 기능 비활성화
- 공식 SDK나 MCP를 사용하지 않으면 이유와 유지보수 비용 기록

## Stage 12 — Module Reuse Validation

**우선 검증 대상**

- `shotgun-gbrain-adapter`
- Transformation Adapter
- AI Provider Adapter
- Storage Adapter
- Connector Runtime Adapter
- Graph UI Adapter

**필수 작업**

- 최소 한 OSS Adapter를 대체 구현으로 교체
- gbrain 없이 실행되는 Assembly와 gbrain을 사용하는 Assembly 비교
- Shotgun 전체가 아닌 필요한 Package만 설치하는 예제 제공

**종료 판정**

- Adapter 교체가 Domain Module 수정 없이 성공
- Version Compatibility Matrix·Migration·Rollback Guide 제공
- OSS 제거 후 데이터 Export와 기능 축소 상태가 명확함

## 5. Stage 완료에 필요한 OSS 증거

각 Stage Completion PR에는 다음이 포함돼야 한다.

- 관련 OSS 후보 목록
- 후보별 Integration Decision
- 검토한 repository URL·version·commit
- license·security·maintenance 상태
- Prototype·Golden Corpus·Benchmark 결과
- 채택·추출한 코드와 Shotgun Port의 경계
- 제외한 후보와 이유
- 직접 구현한 부분과 OSS 재사용이 불가능했던 근거
- migration·rollback·replacement 계획
- Open-source Role Matrix 상태 갱신 여부

해당 Stage에 관련 후보가 없으면 `NO_RELEVANT_OSS`를 선언하고 검색 범위와 근거를 남긴다.

## 6. 우선순위와 충돌 처리

우선순위는 다음과 같다.

1. Canonical ADD의 Evidence·Approval·Claim/Fact·Action 안전 경계
2. Module Architecture의 Port·Adapter·데이터 소유권
3. 검증된 OSS 재사용 가능성
4. 구현 속도와 코드량 절감
5. 고급 UX와 운영 편의

OSS 전략 문서의 과거 표현이 현재 Module Architecture와 충돌하면 기술적 가치는 유지하되 강결합 Runtime 결정은 Adapter·Module 단위로 재해석한다. 변경은 ADR 또는 Integration Decision 기록으로 남긴다.

## 7. 추적 방식

### GitHub Issue Label 권장

- `oss-evaluation`
- `oss-adopt`
- `oss-extract`
- `oss-augment`
- `oss-reference-only`
- `oss-deferred`
- `oss-rejected`
- `license-review`
- `security-review`

### Stage Integration Record 예시

```yaml
stage: 3
module: evidence
candidate: lucasastorian/llmwiki-highlight
source:
  repository: https://github.com/lucasastorian/llmwiki
  commit: <pin-before-adoption>
decision: EXTRACT
scope:
  include:
    - annotation separation pattern
    - highlight selector tests
  exclude:
    - VaultFS persistence
    - SQLite models
shotgun_port: EvidencePort
license_status: pending
security_status: pending
validation:
  - contract-test
  - golden-fixture
rollback: replace with native evidence adapter
```

## 8. 변경 원칙

- OSS 역할과 상태는 개발 결과에 따라 변경할 수 있다.
- 변경 이유와 영향 모듈을 기록한다.
- 이미 채택된 OSS를 교체할 때 과거 결정을 삭제하지 않는다.
- 특정 OSS의 내부 타입이나 DB Schema를 Shotgun Canonical 계약으로 승격하지 않는다.
- `ADOPTED`는 영구 고정이 아니라 현재 Release에서 검증된 선택을 의미한다.
