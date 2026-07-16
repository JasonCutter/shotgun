# Shotgun Open-source Evaluation Plan

> 상태: **Baseline v0.2**  
> 목적: Module Architecture의 OSS 후보를 감으로 채택하지 않고 재현 가능한 검증을 통해 재사용·연기·제외·직접 구현 결정을 내린다.

## 1. 기준 문서

- [OSS Integration Roadmap](./oss-integration-roadmap.md)
- [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md)
- [ADR-078 — Replaceable Open-source Assignments](../architecture/module-architecture/adr/ADR-078-replaceable-open-source-assignments.md)
- [4-레퍼런스 통합 아키텍처 전략](../shotgun_reference_architecture_strategy_ko.html)

Role Matrix와 4-레퍼런스 전략의 상태는 초기 기준선이다. 실제 코드 의존 추가와 직접 구현은 이 문서의 Gate를 통과해야 한다.

## 2. 평가 우선 원칙

Shotgun은 **OSS-first, not OSS-forced** 원칙을 사용한다.

- 관련 후보가 있으면 새 구현 전에 평가한다.
- 검증된 기능은 `ADOPT`, `EXTRACT`, `AUGMENT`를 우선한다.
- 전체 Runtime·내부 DB·공급자 타입을 Shotgun 공통 경계로 가져오지 않는다.
- 재사용 불가 근거가 있을 때만 신규 구현을 허용한다.
- 안전·Canonical·Evidence·Approval·Action 경계는 재사용 편의를 위해 바꾸지 않는다.

## 3. 결정 상태와 결과

### 3.1 평가 상태

```text
IDENTIFIED
→ EVALUATING
→ DECIDED
→ INTEGRATING
→ VERIFIED
```

보조 상태:

```text
EVALUATING → BLOCKED
EVALUATING → DEFERRED
VERIFIED → RE_EVALUATING
```

### 3.2 결정 결과

| 결과 | 의미 |
|---|---|
| `ADOPT` | 공식 패키지를 Adapter 뒤에서 사용 |
| `EXTRACT` | 일부 코드를 독립 Package로 추출·개작 |
| `AUGMENT` | 핵심 패턴·코드를 사용하고 Shotgun 계약·정책으로 보완 |
| `REFERENCE_ONLY` | 설계·테스트 패턴만 참고 |
| `DEFER` | 현재 필요성이 없어 재평가 조건과 함께 연기 |
| `REJECT` | 범위·품질·보안·라이선스·결합도 문제로 제외 |
| `NO_RELEVANT_OSS` | 관련 후보가 없음을 조사 범위와 함께 기록 |

신규 구현은 후보별 `REJECT`·`DEFER` 또는 `NO_RELEVANT_OSS` 근거를 남기고 Port와 교체 경계를 먼저 정의해야 한다.

## 4. 검증된 4개 레퍼런스의 평가 우선순위

### 4.1 garrytan/gbrain

**필수 평가 영역**

- Minion Job·retry·timeout·lock recovery
- Page·Fact·Relation·Timeline operation
- Search·Think·Citation·Gap
- Graph·Timeline Projection
- MCP operation contract
- Dream Cycle
- migration·recovery

**기본 경계**

- 관련 모듈의 `EXTRACT`, `AUGMENT`, `REFERENCE_ONLY` 우선
- 전체 Runtime과 DB 모델을 Shotgun Kernel·Canonical 계약으로 고정하지 않음
- Shotgun Claim·Fact·Evidence·Approval 계약 우선

### 4.2 lucasastorian/llmwiki

**필수 평가 영역**

- HTML cleaner
- XLSX extractor
- Highlight·Annotation
- deterministic lint
- watcher event
- reconcile

**기본 경계**

- 독립 converter·validation package 추출 우선
- SQLite·FTS·VaultFS·MCP CRUD·전체 Runtime 제외
- filename Citation을 Stable Source ID·EvidenceSpan으로 교체

### 4.3 ddsyasas/llm-wiki

**필수 평가 영역**

- Source Intake
- Ask·Chat
- 모델·비용 preview
- Settings
- Action 중심 Home

**기본 경계**

- `AUGMENT`·`REFERENCE_ONLY`
- 기존 backend·SQLite·ingest/query/lint·LLM client 제외
- Shotgun typed API와 Job 상태를 사용

### 4.4 Inkeep OpenKnowledge

**필수 평가 영역**

- Visual/Source mode와 Markdown 보존 원칙
- 2D Semantic Graph
- Agent Activity
- Burst Diff
- Entity Vault template
- Yjs Draft CRDT

**기본 경계**

- UI·검토 패턴은 `AUGMENT`·`REFERENCE_ONLY`
- Yjs는 Draft ChangeSet 전용이며 초기 `DEFER`
- 전체 Runtime, Markdown/Yjs Canonical, Git·MCP 중복 엔진 제외
- Graph는 목록·표 fallback 필수

## 5. 평가 요청서

OSS Evaluation Issue에는 다음을 작성한다.

```text
Candidate:
Official repository:
Target Stage:
Target module and Port:
Evaluation status:
Problem to solve:
Alternatives:
Expected benefit:
Data and security classification:
License hypothesis:
Prototype or extract scope:
Golden corpus or benchmark:
Exit criteria:
Decision options:
Replacement and rollback plan:
```

## 6. 필수 Gate

### 6.1 Scope Fit

- 해결할 실제 요구가 존재함
- Target Stage·Module·Port가 명확함
- Candidate 내부 모델을 공통 Contract로 노출하지 않음
- 전체 Runtime 중첩이 아니라 필요한 역할만 사용
- 직접 구현 대비 복잡도 절감 또는 품질 향상이 확인됨

### 6.2 License

- SPDX Identifier
- LICENSE·NOTICE 확인
- 의존성 License 확인
- 수정·배포·SaaS·비공개 사용 조건
- Copyleft 전파 범위
- Fork·Extract 고지 의무
- 모델·Dataset License 별도 확인

License가 불명확하면 코드를 재사용하지 않고 `REFERENCE_ONLY` 또는 `BLOCKED`로 유지한다.

### 6.3 Security

- Known CVE와 Dependency Scan
- Release Signing·Provenance
- Secret Handling
- Network Access
- File·URL Processing 공격면
- Prompt·Tool Injection 영향
- Sandbox 필요성
- 취약점 대응 속도

Critical 취약점이 해결되지 않았거나 관리자 부재가 고위험으로 판단되면 채택하지 않는다.

### 6.4 Maintenance

- 최근 Release·Commit
- Maintainer 수·Bus Factor
- Issue·PR 응답
- Breaking Change 빈도
- Roadmap·Deprecation 정책
- Runtime·Language 호환성
- Documentation·Test 수준

### 6.5 Architecture Fit

- Adapter·Fork Boundary 뒤에 격리 가능
- 직접 DB·Global State 강제 여부
- Idempotency·Cancellation·Timeout 지원
- Access Scope 적용 가능
- Telemetry Context 전달 가능
- Schema·Version 고정 가능
- Migration·Export 가능

Shotgun Canonical·Approval·Evidence 의미를 바꿔야 한다면 채택하지 않는다.

### 6.6 Quality and Performance

모듈별 Golden Corpus·Benchmark로 다음을 비교한다.

- Correctness
- Failure Classification
- Latency·Throughput
- CPU·Memory·GPU
- Storage·Cost
- Determinism
- Recovery
- Operational Complexity

단일 점수로 선택하지 않고 Dimension별 Trade-off를 기록한다.

### 6.7 Replaceability

- Data Export
- Adapter Contract Coverage
- 대체 구현 존재
- Fork 필요성
- Patch 수·Upstream Divergence
- Rollback
- Migration 시간·위험

교체가 사실상 불가능한 경우 특별 ADR과 사용자 승인이 필요하다.

## 7. Stage별 평가 큐

| Stage | 필수 후보 범주 |
|---|---|
| 0 | PostgreSQL, JSON Schema, OpenTelemetry, 4개 레퍼런스 baseline |
| 1 | gbrain Minion, CloudEvents, PostgreSQL Job Table, Temporal·NATS·Redis 비교 |
| 2 | ddsyasas Intake UX, fsspec, S3-compatible Asset, Tika MIME |
| 3 | lucas Highlight·Lint·Watcher·Reconcile, W3C Annotation |
| 4 | 공식 AI SDK, LiteLLM, Pydantic/Zod, Langfuse, ddsyasas 비용 UX |
| 5 | OpenKnowledge Activity·Burst Diff, diff 도구, ddsyasas Action UX |
| 6 | gbrain Fact·Relation·Timeline·migration, PostgreSQL, Outbox |
| 7 | gbrain Search·Citation·Gap, PostgreSQL FTS, pgvector, ddsyasas Ask UX |
| 8 | lucas HTML/XLSX, Docling, Tika, MarkItDown, PyMuPDF, Office library |
| 9 | gbrain Graph, NetworkX, OpenKnowledge 2D Graph·Entity Vault, Cytoscape.js |
| 10 | gbrain Dream Cycle·Projection, pgvector, AGE, OpenSearch·Qdrant 조건부 |
| 11 | gbrain MCP 패턴, MCP SDK, Provider SDK, OPA·Casbin·OpenFGA, Temporal 조건부 |
| 12 | Adapter 교체, OSS 제거, Extract Package 독립 재사용 |

세부 적용은 [OSS Integration Roadmap](./oss-integration-roadmap.md)을 따른다.

## 8. Prototype·Extract 규칙

- 격리 Branch 또는 Directory에서 진행
- Shotgun Domain Contract를 후보 내부 타입에 맞춰 변경하지 않음
- 실제 개인 데이터 사용 금지
- 비용·시간 한도 설정
- Prototype 성공을 Production 채택으로 간주하지 않음
- 코드·Patch·설정·Test·Benchmark 보존
- Extract 시 원본 commit과 파일·함수 범위 기록
- 전체 Runtime을 가져오기 전에 독립 package 추출 가능성을 먼저 검토

## 9. 신규 구현 규칙

신규 구현 Issue·PR에는 다음을 포함한다.

```markdown
## Problem
- 구현할 기능과 Target Port

## OSS reviewed
- 후보와 version/commit
- Prototype·code review 범위

## Reuse decision
- Adopt/Extract/Augment가 불가능한 이유
- Reject/Defer 근거

## Custom implementation
- 범위
- 예상 유지보수 비용
- 교체 가능한 Port
- Contract Test

## Exit
- 향후 OSS 교체 조건
- Migration·rollback
```

후보가 있는데 이 기록이 없으면 신규 구현 PR을 완료 처리하지 않는다. 후보가 없으면 `NO_RELEVANT_OSS`와 검색 범위를 기록한다.

## 10. 채택·추출 PR 필수 내용

```markdown
## Candidate
- Repository:
- Version / Tag / Commit:
- License:
- Target Stage, module and Port:

## Evaluation
- Alternatives:
- Golden corpus / benchmark:
- Quality:
- Performance:
- Security:
- Maintenance:

## Integration
- Adopt / Extract / Augment:
- Adapter or fork boundary:
- Data owned or stored:
- Config and secrets:
- Telemetry:

## Operations
- Migration:
- Rollback:
- Upgrade policy:
- Fork and patches:
- SBOM and lockfile:

## Decision
- Result:
- Reason:
- Known limits:
```

## 11. Version 고정

채택·추출 상태는 다음을 요구한다.

- 정확한 Package Version·Tag·Commit SHA
- Lockfile
- Container Image Digest, 사용하는 경우
- Model Version·Revision, AI·Embedding인 경우
- Schema·Spec Version
- License Record
- SBOM
- Dependency Scan 결과

`latest`, unpinned Git Branch 또는 자동 Major Upgrade를 Production 기준으로 사용하지 않는다.

## 12. Upgrade 정책

- Patch Upgrade: 자동 Test 후 가능
- Minor Upgrade: Contract·Golden Corpus Regression 필요
- Major Upgrade: Migration·Rollback·Architecture Review 필요
- Security Emergency: 영향 분석과 최소 안전 Patch 우선

Upgrade 후 품질·비용·Latency가 악화되면 Rollback 가능해야 한다.

## 13. Fork·Extract 정책

외부 코드를 추출·Fork할 경우 다음을 기록한다.

- 원본 Commit SHA
- 추출 파일·함수·동작 범위
- 변경 이유
- Patch 목록
- Upstream 동기화 방법
- License Header·NOTICE
- 소유 Module
- 교체 가능한 Port
- Contract·Regression Test
- Fork 종료 조건

Shotgun Domain Contract가 Fork 내부 타입에 종속되지 않게 한다.

## 14. Re-evaluation Trigger

- Major Version
- License 변경
- Maintainer 중단
- Critical CVE
- API·Data Format 변경
- 비용 급증
- 품질 회귀
- 대체 후보의 명확한 개선
- Shotgun 요구 범위 변경
- Adapter 교체 Test 실패
- Upstream Divergence 증가

## 15. 제외된 방식

- 인기·Star 수만으로 채택
- Benchmark 없는 Default Engine 지정
- 라이선스 미확인 코드 복사
- Provider 내부 DB를 Canonical 원장으로 사용
- OSS 전체 Runtime을 병렬 중첩
- 검증된 후보를 보지 않고 직접 구현
- Shotgun Assembly의 오디오·영상 직접 분석을 ffmpeg 등으로 우회 활성화

## 16. 변경 이력

### v0.2 — 2026-07-16

- OSS-first 원칙과 신규 구현 사전 검토 규칙 추가
- 4개 검증 레퍼런스의 필수 평가 영역·금지 경계 명시
- Stage별 평가 큐를 OSS Integration Roadmap과 연결
- 검토 없는 직접 구현을 완료 불가 상태로 정의

### v0.1 — 2026-07-16

- OSS 후보 평가·채택·version 고정·upgrade·fork 정책 최초 정의
