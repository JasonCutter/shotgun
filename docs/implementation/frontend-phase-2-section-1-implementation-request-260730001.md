# Frontend Phase 2 Section 1 — Sources Workspace 구현 요청서

- Request ID: `frontend-phase-2-section-1-implementation-request-260730001`
- 작성일: 2026-07-30
- 대상 저장소: `JasonCutter/shotgun`
- 기준 Branch: `main`
- 기준 완료 상태: Frontend Phase 1 `COMPLETE / USER APPROVED`
- 대상 Section: Frontend Phase 2 Section 1 — Sources Workspace
- 설계·Contract 상태: **APPROVED AND FROZEN**
- 구현 착수 상태: **별도 사용자 지시 전 PENDING**
- Canonical authority: GitHub `main`
- Notion classification: Execution Mirror / Candidate

## 1. 요청 목적

기존 Stage 2, 3, 8의 Intake, Original Asset, Transformation, Evidence 기능을 Phase 1의 Session, Project, Product API, Command, Failure, Cache와 Route Guard 경계 안에서 실제 Sources Workspace로 제공한다.

이 작업은 단순 화면 추가가 아니다. 다음 Product 경계를 구현하고 검증하는 것이 목적이다.

```text
SourceIntakeDraft
→ Validation
→ Versioned Frontend Command
→ IntakeSubmissionSnapshot
→ Exact Duplicate Decision 또는 Processing
→ Source + SourceVersion + OriginalAsset
→ DocumentIR + SourceMap + EvidenceSpan
→ Source Library / Preview / Evidence Return
```

## 2. 구현 권위 문서

구현은 다음 Git 문서를 기준으로 한다.

- `docs/architecture/frontend/phase-2-knowledge-input-question.md`
- `docs/architecture/frontend/cross-phase-contract-and-completion-audit.md`
- `docs/architecture/frontend/adr-100-113-consolidated-record.md`
- `docs/architecture/adr/ADR-122-sources-workspace-intake-duplicate-url-and-lifecycle-boundary.md`
- `docs/architecture/contracts/snapshots/frontend-phase-2-section-1/frontend-phase-2-section-1-contract-snapshot-260730001.md`
- `docs/engineering/frontend-phase-2-section-1-gap-audit-260730001.md`
- `docs/engineering/stage-2-intake-original-asset.md`
- `docs/engineering/stage-3-plain-text-transformation-evidence.md`
- `docs/engineering/stage-8-format-expansion.md`

문서 간 충돌 시 최신 승인된 ADR-122와 Section Contract Snapshot이 Sources Product 경계에 우선한다. 기존 Stage 모듈의 내부 저장·Evidence 계약은 폐기하지 않고 Product API 뒤에서 재사용한다.

## 3. Branch와 PR 경계

구현 착수 승인 후:

- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: 1개
- Base: 착수 시점의 최신 `main`
- Section 2 병렬 구현: 금지
- Ready 전환과 Merge: 별도 승인 전 금지
- Phase 2 완료 선언: Section 2 완료 전 금지

Draft PR 본문에는 AC-01~AC-32 Matrix, Migration·Dependency 상태, 검증 결과, 실패·재시도 이력과 명시적 비범위를 유지한다.

## 4. 필수 구현 범위

### 4.1 Product API와 Application Coordinator

- Sources 전용 Versioned Request/View Contract
- Deep Runtime Decoder
- Server-derived Session·Project·Capability·Sensitivity·Policy Context
- Stage 2, 3, 8 Port를 조합하는 Sources Application Coordinator
- Legacy Browser authority header 거부
- Typed Product Failure Envelope

### 4.2 Draft Queue와 Intake

- Project-fixed `SourceIntakeDraft`
- Direct Text, File, URL Descriptor
- Draft Seed re-entry
- Server Validation Summary
- Upload/Submission Progress
- Multi-item Partial Result
- Action Required Presentation
- Cancel·Retry·Outcome Unknown Recovery

### 4.3 Exact Duplicate

- Server exact-content detection
- Immutable Decision View와 Revision
- Reuse Existing Version
- Create Version Candidate
- Create Separate Source
- Cancel Submission
- Concurrent decision and stale revision protection

### 4.4 Source Library

- Active-Project-scoped bounded list
- Search, filter, sort and cursor pagination
- User Attention and Capability
- Library visibility, Preview readiness and Ask usage state separation
- Source detail and SourceVersion history

### 4.5 Preview·Evidence·Citation Return

- Original/Transformed Preview
- Text, Page/BBox, Cell, Shape, CSS locator support as available
- Evidence list and highlight
- SourceVersion pinning
- CitationReturnTarget and focus/scroll restoration
- Access loss and protected metadata masking

### 4.6 Secure URL Acquisition

- Server-side replaceable `UrlAcquisitionPort`
- Protocol·DNS·IP·redirect hop validation
- Private/link-local/metadata/multicast and policy-blocked destination rejection
- Timeout, header/body, compressed/decompressed size and content-type limits
- Credential/cookie/header non-forwarding
- Provenance receipt and safe failure reporting
- SSRF and DNS-rebinding negative tests

### 4.7 State, Cache and Offline

- typed Query Key factories
- Principal·Session·Project·Source·Version·Revision·Sensitivity·Policy isolation
- protected cache purge/masking
- offline read-only stale Snapshot presentation
- no offline Submit, Search, Duplicate Decision, Cancel, Retry or protected Download

## 5. AC Traceability

`frontend-phase-2-section-1-contract-snapshot-260730001.md`의 AC-01~AC-32 번호와 의미를 변경하지 않는다.

구현 시작 시 Verification Record를 생성한다.

권장 경로:

`docs/engineering/frontend-phase-2-section-1-verification-260730001.md`

Matrix Status는 다음 값만 사용한다.

```text
PASS
FAIL
BLOCKED
NOT_RUN
```

구현되지 않았거나 실행하지 않은 항목을 PASS로 기록하지 않는다.

## 6. Migration 경계

현재 문서 단계에서는 Migration을 승인하지 않는다.

구현 착수 후 실제 Schema Gap Audit에서 다음이 기존 Schema로 표현되지 않으면 additive Migration 후보를 제시한다.

- Exact Duplicate Decision과 Disposition
- URL Acquisition Attempt와 Provenance Receipt
- Product-facing Intake state/user attention
- Source display/readiness/ask-usage projection revision
- durable Draft Seed handoff metadata가 필요한 경우

Migration 원칙:

```text
Preflight
→ Expand
→ Compatibility
→ Activate
→ Validate and Constrain
```

필수 조건:

- 기존 Stage 2–8 데이터와 V1 API 보존
- 결정적·재실행 안전 Backfill
- 기존 Writer Compatibility
- 부분 생성 방지와 Transaction 경계
- Rollback은 호환 애플리케이션 기준
- Schema contraction과 Legacy 제거는 별도 승인

Migration 파일 생성·로컬 실행 전 사용자 승인을 요청한다.

## 7. Dependency와 OSS 경계

초기 구현은 기존 Runtime Dependency를 우선 재사용한다.

신규 Runtime Dependency는 자동 추가하지 않는다.

후보가 필요한 경우 다음을 먼저 제출한다.

- 필요한 기능과 현재 구현 불가능 근거
- 후보와 exact version
- license와 공급망 위험
- Port/Adapter 경계
- 대체 가능 Contract Test
- Bundle/운영 영향
- Migration·Rollback 영향

Parser, URL fetch, upload, list virtualization 또는 state library를 OSS 기본 동작 때문에 권위 계층으로 승격하지 않는다.

## 8. 보안 필수 항목

- CSRF and Same-origin
- Browser authority-header injection rejection
- cross-Project read/write rejection
- sensitive Source existence masking
- storage key/path injection rejection
- original payload and credential log redaction
- URL SSRF, redirect, DNS/IP and decompression-bomb tests
- capability revalidation before original access, download, retry and duplicate disposition
- access loss cache purge
- untrusted filename and content-type handling

## 9. 접근성 필수 항목

- Desktop·Tablet·Mobile 기능 동등성
- Keyboard-only Draft, Upload, Duplicate Decision, Library, Preview and Evidence flow
- Heading/Landmark/Label/Error/Status semantics
- Progress and async outcome live region
- Dialog focus trap and trigger focus restoration
- Preview locator and Citation return focus restoration
- 200% zoom, reduced motion, high contrast and touch target
- status, duplicate disposition and failures not represented by color alone

## 10. 성능과 데이터 상한

구현 초기에 Representative·Stress Dataset과 측정 절차를 고정한다.

최소 측정 대상:

- Library query/projection/response size
- large bounded list render and interaction readiness
- Draft Queue and validation update
- Preview initial render and locator jump
- Version history and Evidence highlight
- URL acquisition progress Snapshot polling or refresh
- Query Cache, DOM, Heap and Browser Storage
- JavaScript bundle

숫자 예산은 측정 후 별도 사용자 승인을 받는다. 승인 전 Vite 경고나 임의 숫자를 완료 기준으로 사용하지 않는다.

Virtualization은 측정된 DOM/Heap/Interaction 예산 위반과 접근성·Stable Identity 검증이 있을 때만 도입한다.

## 11. 필수 테스트

- Unit
- Product Contract and Runtime Decoder
- Module/Adapter Replacement Contract
- Integration and Application Coordinator
- Database and Migration when approved
- Security Negative
- Accessibility
- Performance Baseline and Gate
- Chromium E2E
- Architecture Boundary
- Stage 12 Reuse and Operations Gate
- Dependency Audit and SBOM
- Documentation Governance

핵심 E2E:

1. Direct Text → Submit → SourceVersion → Preview
2. File → Validation → Progress → Source Library
3. URL → secure acquisition → provenance → Preview
4. Exact Duplicate → each allowed user disposition
5. Multi-input partial success → retry failed item only
6. Response loss → existing outcome recovery without resubmission
7. Project switch with dirty draft → Leave Guard and no draft migration
8. SourceVersion pin → new version creation → selection remains pinned
9. Evidence highlight → return to originating context
10. access revoked → protected Preview/cache removal
11. offline/degraded presentation and blocked writes
12. Desktop·Tablet·Mobile·Keyboard·200% zoom

## 12. 완료 및 승인 경계

이 요청서 작성은 구현 착수, Migration 실행, Dependency 추가, Ready 전환 또는 Merge를 자동 승인하지 않는다.

구현 착수에는 별도 사용자 지시가 필요하다.

구현 완료 후에도 다음을 분리한다.

```text
Implementation Evidence
→ AC-01~AC-32 PASS
→ Final Head CI
→ User Review
→ Ready
→ Merge
→ Separate Section Completion Review
```

아직 승인되지 않은 범위:

- Product 구현 착수
- Database Migration 생성·실행
- 신규 Runtime Dependency
- PR Ready·Merge
- Section 완료 선언
- Phase 2 Section 2 착수
- Phase 2 완료 선언
- Production SPA Serving·Deployment·Production SLO
- V1/Legacy Endpoint 제거

## 13. 구현 완료 보고 형식

최종 보고에는 다음을 포함한다.

- Base, Branch, Draft PR, Implementation Head, Final Evidence Head
- AC-01~AC-32 Matrix
- Migration·Dependency 결과
- Product API·Schema·Security impact
- Local and Remote verification
- Performance artifact digest and budget
- failure, retry, flaky and environment history
- known limits and deferred follow-up
- Ready, Merge, Section completion and next Section authorization state