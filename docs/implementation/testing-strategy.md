# Shotgun Testing Strategy

> 목적: 모듈 독립성, Knowledge Flow 정합성, Canonical·승인·Action 안전 경계를 자동 검증한다.

## 1. 테스트 피라미드

```text
Architecture and Contract Tests
           ↑
End-to-End Vertical Slice Tests
           ↑
Integration and Persistence Tests
           ↑
Module Unit Tests
```

Shotgun은 단순 Unit Test만으로 안전성을 증명할 수 없다. Contract, State Transition, Idempotency, Evidence, Approval과 Replay Test를 핵심 품질 기준으로 둔다.

## 2. 테스트 종류

### 2.1 Unit Test

검증 대상:

- Domain Rule
- State Transition
- Schema Mapping
- Risk Rule
- Temporal Rule
- Hash·ID·Digest
- Diff·Impact 계산

원칙:

- 외부 SDK와 실제 DB 없이 실행
- 결정적 입력과 출력
- 시간·ID·Random Provider 주입
- AI 결과는 Fixture 또는 Fake Adapter 사용

### 2.2 Contract Test

모든 Port 구현은 공통 Contract Suite를 통과해야 한다.

대상:

- Connector Transport
- Storage Adapter
- AI Provider Adapter
- Format Adapter
- Search·Graph Adapter
- External Action Connector

예:

```text
AIProviderContract
- structured output
- timeout mapping
- rate limit mapping
- usage recording
- cancellation
- unsupported capability
```

Adapter가 추가될 때 Domain Test를 복사하지 않고 같은 Contract Suite를 재사용한다.

### 2.3 Integration Test

검증 대상:

- PostgreSQL Transaction
- Transactional Outbox
- Migration
- Asset Storage
- Search Projection
- Provider Sandbox
- Connector Sandbox

원칙:

- 실제와 가까운 Container 또는 Test Service 사용
- Test 간 격리
- Schema 생성·삭제 재현
- 실패 주입 지원

### 2.4 End-to-End Test

Vertical Slice 단위로 실제 Module과 Adapter를 연결한다.

필수 E2E:

- Text Source Preservation
- Evidence-backed Plain Text
- Direct Claim Candidate
- Human-approved Canonical Claim
- Cited Search and Answer
- Safe External Draft Action

실제 AI 호출은 비용·불안정성 때문에 Nightly 또는 선택적 Test로 분리하고, CI 기본 경로는 Recorded·Fake Adapter를 사용한다.

### 2.5 Architecture Test

검증 대상:

- 모듈 간 금지 Import
- Provider SDK 직접 의존
- DB Schema 직접 접근
- Canonical Write Interface 사용 위치
- Action Execute Port 사용 위치
- Assembly와 Adapter 조립 경계

Architecture Test 실패는 Unit Test 성공 여부와 관계없이 Merge를 차단한다.

### 2.6 Golden Corpus Test

Transformation·Evidence·Candidate·Validation 품질을 고정된 자료 집합으로 측정한다.

Corpus 구성:

- 정상 문서
- 복잡한 Layout
- 표·병합 Cell
- 이미지·Caption
- 다국어
- 부정·수량·시간 문장
- 손상·암호화·미지원 입력
- 공격성 Prompt나 숨겨진 Instruction

Golden Corpus는 원본, 기대 DocumentIR, SourceMap, Evidence, Candidate와 실패 상태를 포함한다.

## 3. 단계별 필수 테스트

### Stage 0

- Clean Setup Test
- CI Smoke Test
- Database Bootstrap Test
- Secret Leak Scan

### Stage 1

- Manifest Compatibility
- Command·Event·Query Contract
- Duplicate Delivery
- Partial Ordering
- Retry·Dead-letter·Replay
- Security Context Missing
- Trace Propagation

### Stage 2

- Original Byte Preservation
- Hash·Dedup
- SourceVersion
- Access Control
- Asset Resolver
- Failed Upload Recovery

### Stage 3

- DocumentIR Determinism
- SourceMap Round-trip
- Evidence Offset·Quote
- Invalid SourceVersion
- Transformer Retry

### Stage 4

- Direct-only Extraction
- Unsupported Inference Rejection
- Structured Output Validation
- Provider Failure Mapping
- Evidence Alignment
- Cost·Provenance Recording

### Stage 5

- Comparison Classification
- Review Decision
- Approval Digest
- Stale Approval
- Hold·Reject History
- Unauthorized Approval

### Stage 6

- Atomic Commit
- Commit Idempotency
- History Append-only
- Outbox Delivery
- Optimistic Concurrency
- Claim·Fact Separation

### Stage 7

- Projection Watermark
- Search Visibility
- Citation Round-trip
- Stale Projection
- Canonical-only Retrieval
- Answer Citation Coverage

### Stage 8

- Format별 Golden Corpus
- Page·BBox·Cell·Shape Selector
- Translation Provenance
- Multimodal Re-render Validation
- Unsupported Media Policy

### Stage 9

- Entity Ambiguity
- Relation Direction
- Temporal Conflict
- Recursive Impact Cycle
- Atomic Group
- Model Disagreement

### Stage 10

- Incremental vs Full Rebuild
- Conflict Projection
- Discovery Reentry
- Suppression
- Budget·Depth Limit

### Stage 11

- Preview Digest
- Approval Token
- Preflight State Change
- Connector Idempotency
- Provider Verification
- Timeout and Outcome Unknown
- Secret Isolation

### Stage 12

- Standalone Assembly
- Adapter Replacement
- Package Compatibility
- Minimal Installation

## 4. Canonical 안전 테스트

반드시 자동화한다.

- 미승인 Candidate로 Commit 시도 → 거부
- 승인된 대상과 다른 Payload Commit → 거부
- 승인 후 Snapshot 변경 → `STALE_APPROVAL`
- Claim 승인 → Fact 자동 생성 안 됨
- HistoryEvent 수정·삭제 시도 → 거부 또는 Audit
- 동일 Commit ID 재전송 → 동일 결과
- 부분 Transaction 실패 → Canonical과 History 모두 미반영

## 5. External Action 안전 테스트

- Candidate 없이 Execute 요청 → 거부
- Validation 실패 Candidate → 거부
- Preview와 Execute Parameter 불일치 → 거부
- 만료·재사용·다른 Actor Approval Token → 거부
- Preflight 중 대상 상태 변경 → 중단
- Timeout 후 같은 Idempotency Key 재요청 → Provider 상태 확인
- 결과 불명확 → `OUTCOME_UNKNOWN`
- Secret이 Trace·Prompt·Error Message에 포함되지 않음

Side Effect Test는 Sandbox나 Fake Provider를 기본으로 하고 실제 계정 Test는 격리된 Test Resource로 제한한다.

## 6. AI 품질 테스트

AI는 결정적 Test와 통계적 Evaluation을 분리한다.

### 결정적 검증

- Schema
- Required Fields
- Evidence Reference
- Policy Version
- Unsupported Capability
- Prompt Hash

### 품질 Evaluation

- Direct Extraction Precision
- Evidence Alignment
- Omission Rate
- Hallucination Rate
- Temporal Accuracy
- Entity Resolution Quality
- Provider Disagreement
- Cost·Latency

AI 평가 결과는 단일 점수로 승인하지 않고 Dimension별로 기록한다.

### Provider 비교

같은 Golden Corpus와 Task Profile을 사용한다.

- GPT
- Gemini
- Claude
- 선택된 OSS NLP 보조

Provider 선택은 품질·비용·지연·데이터 정책을 함께 비교한다.

## 7. Transformation 품질 기준

형식별 최소 지표:

- Text Coverage
- Reading Order Accuracy
- Table Structure Preservation
- Evidence Round-trip Accuracy
- Image·Caption Association
- Failure Classification Accuracy
- Processing Time·Memory

정확한 Threshold는 Golden Corpus가 준비된 뒤 Stage 8 Implementation Decision으로 고정한다.

## 8. 검색·답변 품질 기준

- Exact Lookup 성공률
- Citation Precision
- Citation Round-trip
- Canonical-only Filter
- Conflict Visibility
- Stale Projection 표시
- Answer Statement Coverage

외부 연구나 Source Exploration을 Canonical 답변처럼 표현하는 오류를 별도 평가한다.

## 9. Chaos·Recovery Test

최소 시나리오:

- Job 처리 중 Process 종료
- Outbox 저장 후 Delivery 전 종료
- Event Delivery 후 Ack 전 종료
- Provider Timeout
- Database Connection Loss
- Projection Rebuild 중 종료
- Connector Execute 응답 유실

검증 항목:

- 중복 Side Effect 없음
- History 손실 없음
- Recovery 후 상태 설명 가능
- Quarantine·Dead-letter에서 재처리 가능

## 10. Security Test

- Broken Access Control
- Cross-project Reference
- Asset URL Leakage
- Prompt Injection from Source
- Secret Exposure
- Log Injection
- Unsafe File·URL
- SSRF·Redirect
- Dependency Vulnerability
- Approval Token Forgery·Replay

보안 Test 실패는 Release 차단 조건이다.

## 11. 성능 Test

Walking Skeleton 단계에서는 절대 처리량보다 회귀 감지를 우선한다.

측정 대상:

- Intake Latency
- Transformation Time
- AI Cost·Latency
- Review Query Latency
- Canonical Commit Time
- Projection Lag
- Search Latency
- Discovery Batch Cost

독립 Service 분리는 측정 결과로만 결정한다.

## 12. CI 실행 계층

### Pull Request

- Lint·Type Check
- Unit Test
- Contract Test
- Architecture Test
- 빠른 Integration Test
- Secret·Dependency Scan

### Main Merge 후

- 전체 Integration Test
- Migration Test
- Walking Skeleton E2E
- Golden Corpus Small Set

### Nightly 또는 예약

- 실제 AI Provider Evaluation
- Full Golden Corpus
- Chaos·Recovery
- Projection Full Rebuild
- Dependency·License Scan

### Release Candidate

- 전체 E2E
- Security Negative Test
- Migration·Rollback Rehearsal
- Performance Regression
- Manual Product Acceptance

## 13. Test Data 정책

- 실제 개인 데이터는 기본 Test Fixture로 사용하지 않음
- 민감정보는 합성·익명화
- Golden Corpus의 라이선스와 배포 가능성 기록
- Provider 전송 가능 여부를 Data Classification으로 제어
- 실패 로그에도 원문 전체를 남기지 않음

## 14. Test 결과 증거

Stage Completion과 Release에는 다음을 저장한다.

- Commit SHA
- Contract Version
- Test Suite Version
- Environment
- Passed·Failed·Skipped
- Golden Corpus Version
- AI Provider·Model Version
- 비용·Latency 요약
- Known Flaky Test와 이유

## 15. Flaky Test 정책

- Flaky Test를 무조건 재실행해 통과 처리하지 않음
- 원인을 Issue로 추적
- 안전 경계 Test가 Flaky하면 Merge 차단
- 외부 Provider 불안정 Test는 기본 CI와 분리하되 결과를 숨기지 않음

## 16. Test 완료 기준

테스트 코드는 기능 코드와 같은 품질 기준을 적용한다.

- 명확한 실패 이유
- 독립 실행 가능
- 환경 정리
- 시간·Random 통제
- 외부 비용 제한
- 결과 재현성
- Contract와 ADD 요구사항에 직접 연결
