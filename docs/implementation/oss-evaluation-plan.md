# Shotgun Open-source Evaluation Plan

> 목적: Module Architecture의 OSS 후보를 감으로 채택하지 않고 재현 가능한 검증을 통해 `ADOPTED` 또는 제외 상태로 전환한다.

## 1. 기준 문서

- [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md)
- [ADR-078 — Replaceable Open-source Assignments](../architecture/module-architecture/adr/ADR-078-replaceable-open-source-assignments.md)

Role Matrix의 상태는 초기 기준선이다. 실제 코드 의존 추가는 이 문서의 Gate를 통과해야 한다.

## 2. 상태 전이

```text
REFERENCE
→ EXTRACT or ADAPTER_CANDIDATE
→ EVALUATING
→ FOUNDATION_CANDIDATE
→ ADOPTED
```

대안 경로:

```text
EVALUATING → DEFERRED
EVALUATING → REJECTED
ADOPTED → DEPRECATED → REPLACED or REMOVED
```

### 상태 의미

- `REFERENCE`: 설계·UX·패턴만 참고
- `EXTRACT`: 일부 코드를 독립 Package로 추출 검토
- `ADAPTER_CANDIDATE`: Port 뒤에 연결할 구현 후보
- `EVALUATING`: 실제 Prototype·Benchmark 진행 중
- `FOUNDATION_CANDIDATE`: 기본 구현 후보이나 운영 검증 전
- `ADOPTED`: Version이 고정되고 Release에 사용 가능
- `DEFERRED`: 현재 필요성이나 준비가 부족
- `REJECTED`: 요구·안전·라이선스와 맞지 않음

## 3. 평가 요청서

OSS 평가 Issue에는 다음을 작성한다.

```text
Candidate:
Official repository:
Target module and Port:
Evaluation status:
Problem to solve:
Alternatives:
Expected benefit:
Data and security classification:
License hypothesis:
Prototype scope:
Golden corpus or benchmark:
Exit criteria:
Replacement and rollback plan:
```

## 4. 필수 Gate

### 4.1 Scope Fit

- 해결해야 할 실제 요구가 존재함
- Shotgun Port와 책임 경계가 명확함
- Candidate 내부 모델을 공통 Contract로 노출하지 않음
- 전체 Runtime 중첩이 아니라 필요한 역할만 사용
- 직접 구현 대비 복잡도 절감 또는 품질 향상이 확인됨

### 4.2 License

- SPDX Identifier
- LICENSE와 NOTICE 확인
- 의존성 License 확인
- 수정·배포·SaaS·비공개 사용 조건
- Copyleft 전파 범위
- Fork·Extract 시 고지 의무
- 모델·Dataset License 별도 확인

License가 불명확하면 코드 재사용을 금지하고 `REFERENCE`로만 유지한다.

### 4.3 Security

- Known CVE
- Dependency Scan
- Release Signing·Provenance
- Secret Handling
- Network Access
- File·URL Processing 공격면
- Prompt·Tool Injection 영향
- Sandbox 필요성
- 취약점 대응 속도

Critical 취약점이 해결되지 않았거나 관리자 부재가 확인되면 채택하지 않는다.

### 4.4 Maintenance

- 최근 Release와 Commit
- Maintainer 수와 Bus Factor
- Issue·PR 응답
- Breaking Change 빈도
- Roadmap과 Deprecation 정책
- Runtime·Language 호환성
- Documentation·Test 수준

활동이 적어도 코드가 작고 안정적이며 Fork 비용이 낮으면 채택할 수 있지만 근거를 기록한다.

### 4.5 Architecture Fit

- Adapter 뒤에 격리 가능
- 직접 DB·Global State 강제 여부
- Idempotency·Cancellation·Timeout 지원
- Multi-tenant·Access Scope 적용 가능
- Telemetry Context 전달 가능
- Schema·Version 고정 가능
- Migration·Export 가능

Shotgun Canonical·Approval·Evidence 의미를 바꿔야 한다면 채택하지 않는다.

### 4.6 Quality and Performance

모듈별 Golden Corpus·Benchmark로 비교한다.

공통 지표:

- Correctness
- Failure Classification
- Latency
- Throughput
- CPU·Memory·GPU
- Storage
- Cost
- Determinism
- Recovery
- Operational Complexity

단일 점수로만 선택하지 않고 Dimension별 Trade-off를 기록한다.

### 4.7 Replaceability

- Data Export
- Adapter Contract Coverage
- Alternative Implementation 존재
- Fork 필요성
- Patch 수와 Upstream Divergence
- Rollback
- Migration 시간·위험

교체가 사실상 불가능한 경우 특별 ADR과 사용자 승인이 필요하다.

## 5. 모듈별 평가 방법

### 5.1 Contracts and Runtime

후보:

- JSON Schema
- OpenAPI·AsyncAPI
- CloudEvents
- Temporal
- NATS JetStream
- Redis Streams
- PostgreSQL Job Table

검증:

- Schema Compatibility
- At-least-once Delivery
- Dedup·Ordering
- Retry·Replay
- Local Development Complexity
- Failure Recovery

MVP는 In-process Connector와 PostgreSQL 중심을 기본 비교점으로 둔다.

### 5.2 Transformation

후보:

- gbrain 관련 추출 패턴
- lucasastorian/llmwiki 부품
- Docling
- Apache Tika
- MarkItDown
- PyMuPDF
- Office 전용 라이브러리

검증:

- 형식별 Golden Corpus
- Text Coverage
- Reading Order
- Table·Layout
- Evidence BBox·Cell·Shape 복원
- Error Classification
- Resource Usage

하나의 도구가 모든 형식을 담당할 필요는 없다. Format별 최적 Adapter를 사용할 수 있다.

### 5.3 AI Provider

후보:

- 공급자 공식 SDK
- LiteLLM
- Structured Output 보조 도구
- Langfuse

검증:

- GPT·Gemini·Claude 기능 정합성
- Structured Output
- Vision
- Tool Calling
- Usage·Cost
- Timeout·Rate Limit Mapping
- Data Retention·Region
- Fallback·Challenger

AI Gateway를 사용해도 Shotgun `AIProviderPort`가 상위 계약이다.

### 5.4 Search and Graph

후보:

- PostgreSQL FTS·pg_trgm
- pgvector
- NetworkX
- Apache AGE
- OpenSearch
- Qdrant
- 전용 Graph DB

검증:

- Canonical Filter
- Citation Lookup
- Hybrid Retrieval
- Typed Edge
- Incremental Update
- Full Rebuild
- Access Scope Filtering
- Backup·Migration

별도 Search·Graph 제품은 PostgreSQL 기준 구현이 한계에 도달했을 때만 도입한다.

### 5.5 Policy and Action

후보:

- 코드 기반 Policy Engine
- OPA
- Casbin
- OpenFGA
- MCP SDK
- Provider 공식 SDK

검증:

- Deterministic Permit·Deny
- Policy Version
- Approval Binding
- Secret Isolation
- Dry-run·Preview
- Idempotency
- Outcome Verification

## 6. Prototype 규칙

- Prototype Branch 또는 격리 Directory에서 진행
- Domain Contract를 변경하지 않음
- 실제 개인 데이터 사용 금지
- 비용 한도 설정
- Prototype 성공을 Production 채택으로 간주하지 않음
- 코드·Patch·설정과 Test를 보존

## 7. 채택 PR 필수 내용

```markdown
## Candidate
- Repository:
- Version / Tag / Commit:
- License:
- Target module and Port:

## Evaluation
- Alternatives:
- Golden corpus / benchmark:
- Quality:
- Performance:
- Security:
- Maintenance:

## Integration
- Adapter boundary:
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
- Adopt / Defer / Reject:
- Reason:
- Known limits:
```

## 8. Version 고정

`ADOPTED` 상태는 다음을 요구한다.

- 정확한 Package Version·Tag·Commit SHA
- Lockfile
- Container Image Digest, 사용하는 경우
- Model Version·Revision, AI·Embedding인 경우
- Schema·Spec Version
- License Record
- SBOM
- Dependency Scan 결과

`latest`, unpinned Git Branch 또는 자동 Major Upgrade를 Production 기준으로 사용하지 않는다.

## 9. Upgrade 정책

- Patch Upgrade: 자동 Test 후 가능
- Minor Upgrade: Contract·Golden Corpus Regression 필요
- Major Upgrade: Migration·Rollback과 Architecture Review 필요
- Security Emergency: 영향 분석과 최소 안전 Patch 우선

Upgrade 후 품질·비용·Latency가 악화되면 Rollback 가능해야 한다.

## 10. Fork·Extract 정책

외부 코드를 추출·Fork할 경우:

- 원본 Commit SHA
- 변경 이유
- Patch 목록
- Upstream 동기화 방법
- License Header·NOTICE
- 소유 Module
- 교체 가능한 Port
- Fork 종료 조건

Shotgun Domain Contract가 Fork 내부 타입에 종속되지 않게 한다.

## 11. Re-evaluation Trigger

- Major Version
- License 변경
- Maintainer 중단
- Critical CVE
- API·Data Format 변경
- 비용 급증
- 품질 회귀
- 대체 후보의 명확한 개선
- Shotgun 요구 범위 변경

## 12. 제외된 범위

- 인기·Star 수만으로 채택
- Benchmark 없는 Default Engine 지정
- 라이선스 미확인 코드 복사
- Provider 내부 DB를 Canonical 원장으로 사용
- OSS의 전체 Runtime을 나란히 중첩
- Shotgun Assembly의 오디오·영상 직접 분석을 ffmpeg 등으로 우회 활성화
