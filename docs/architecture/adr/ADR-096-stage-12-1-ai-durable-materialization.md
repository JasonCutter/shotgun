# ADR-096: Stage 12.1 AI Durable Materialization

- 상태: **Accepted**
- 날짜: 2026-07-18
- 상위 전략: [Stage 12.1 Hardening Strategy](../../engineering/stage-12-1-hardening-strategy.md)
- 관련 결정: [ADR-080 - Stage 1 Kernel Contracts and Runtime](ADR-080-stage-1-kernel-contracts-and-runtime.md), [ADR-084 - Stage 4 AI Provider, Direct Claim Candidate and Validation](ADR-084-stage-4-ai-candidate-validation.md)

## Context

현재 Stage 4 흐름은 AI Provider의 구조화 응답을 메모리에서 파싱한 뒤 Provider Call 메타데이터를 PostgreSQL에 저장하고, 그 다음 Candidate Batch와 Candidate를 별도 트랜잭션으로 저장한다.

Provider가 실제 응답을 반환한 뒤 Candidate가 저장되기 전에 프로세스가 중단되면 Provider의 정확한 출력 내용은 복구할 수 없다. 더 심각하게는 같은 `requestId`의 성공 Call 메타데이터를 발견한 재실행이 저장된 출력 없이 빈 Candidate 목록을 반환할 수 있다. 이 경우 복구 가능한 출력 손실이 빈 Batch의 정상 완료처럼 기록될 수 있다.

기존 Candidate Batch는 PostgreSQL advisory transaction lock과 unique constraint로 중복 생성 방지가 비교적 잘 되어 있다. 따라서 이 결정은 Generic Job Runtime 전체를 교체하지 않고 다음 경계만 내구화한다.

```text
AI generation request
→ immutable provider output
→ candidate materialization
```

이 결정은 AI 출력을 Canonical 지식으로 승격하지 않는다. Candidate, Validation, Review와 Canonical 경계는 그대로 유지한다.

## Decision

### 1. 복구 권위는 Generation Request, Provider Output, Candidate Materialization이다

Stage 12.1 Durability Gate의 첫 Section은 다음 세 권위 레코드를 PostgreSQL에 영속화한다.

1. `Generation Request`
2. `Provider Output`
3. `Candidate Materialization`

Generic Connector Job, Dedup, Dead Letter와 Trace 전체를 이 Section에서 영속화하지 않는다. 현재 In-memory Job Runtime은 계속 제품 전체의 durable queue가 아니다.

AI Provider Module은 Generation Request와 Provider Attempt, Provider Output을 소유한다. Candidate Generation Module은 Candidate Materialization, Candidate Batch와 Candidate를 소유한다.

### 2. 상태 모델

```text
REQUESTED
→ PROVIDER_RUNNING
   ├→ OUTPUT_MATERIALIZED
   │   ├→ COMPLETED
   │   └→ MATERIALIZATION_FAILED
   │        └→ OUTPUT_MATERIALIZED 또는 COMPLETED
   ├→ PROVIDER_FAILED
   │   └→ PROVIDER_RUNNING
   └→ OUTCOME_UNKNOWN
```

| 상태                     | 의미                                                                    | 자동 복구·호출 정책                                                                                     |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `REQUESTED`              | Request Digest와 Input Snapshot Digest가 저장됐고 Provider 호출 전이다. | CAS claim을 얻은 Worker만 Provider를 호출할 수 있다.                                                    |
| `PROVIDER_RUNNING`       | 하나의 영속 Provider Attempt가 외부 호출을 수행 중이다.                 | 정상 실행 중에는 다른 Worker가 재호출하지 않는다. stale 결과가 불명확하면 `OUTCOME_UNKNOWN`으로 보낸다. |
| `OUTPUT_MATERIALIZED`    | 정확한 Provider Output Envelope와 Digest가 불변 저장됐다.               | Provider 재호출 금지. 저장 Output으로 Candidate를 생성한다.                                             |
| `PROVIDER_FAILED`        | 유효한 Output 없이 명확한 Provider 실패가 영속 기록됐다.                | 명시적으로 retryable이고 영속 Attempt Budget이 남은 경우만 재호출할 수 있다.                            |
| `OUTCOME_UNKNOWN`        | Timeout 또는 프로세스 종료로 Provider의 실제 외부 결과를 알 수 없다.    | 자동 Provider 재호출 금지. 사용자가 명시적으로 재시도하기 전까지 중지한다.                              |
| `MATERIALIZATION_FAILED` | 유효한 Output은 보존됐지만 Candidate 생성 또는 저장에 실패했다.         | Provider 재호출 금지. 같은 Output으로 resume한다.                                                       |
| `COMPLETED`              | Materialization과 Candidate Batch가 완료됐다.                           | Terminal. 반복 요청은 기존 Batch를 반환한다.                                                            |

`CANDIDATE_MATERIALIZING` 상태는 추가하지 않는다. Candidate 저장은 짧은 PostgreSQL 트랜잭션과 unique constraint로 보호하며, 별도 상태가 복구 행동을 바꾸지 않기 때문이다.

### 3. Provider Output은 안전한 불변 Normalized Envelope로 저장한다

전체 Provider SDK 객체나 HTTP 응답을 저장하지 않는다. Candidate 재생성에 필요한 정확한 출력 텍스트와 공개 가능한 메타데이터만 다음과 같은 버전화된 불변 Envelope로 저장한다.

```text
ProviderOutputEnvelope.v1
- outputId
- projectId
- providerCallId
- providerAttemptId
- provider
- adapterVersion
- model
- modelVersion
- providerResponseId (optional)
- exactOutputText
- contentDigest
- requestDigest
- inputSnapshotDigest
- schemaName
- schemaVersion
- promptVersion
- policyVersion
- dataPolicyVersion
- finishReason (available only)
- tokenUsage
- cost
- receivedAt
```

`exactOutputText`는 Provider가 Candidate extraction 결과로 반환한 정확한 텍스트다. `contentDigest`는 이 텍스트와 Envelope의 버전화된 필수 필드를 결정적으로 직렬화하여 계산한다.

저장하지 않는 값:

- API Key와 Authorization Header
- 전체 HTTP Header
- Provider SDK의 전체 Raw Response 객체
- 숨겨진 reasoning 또는 chain-of-thought
- Provider 내부 디버그 필드
- Secret이 포함될 수 있는 원 오류 문자열

Provider Output은 Candidate나 Canonical Fact가 아니다. Candidate를 재생할 수 있는 비Canonical 생성 근거이며, 원 Source와 Evidence의 Project, Access Scope, Sensitivity를 상속한다.

### 4. Request와 Input Snapshot을 Digest로 고정한다

`inputSnapshotDigest`는 최소한 다음을 결정적 순서로 포함한다.

- Project ID
- SourceVersion ID
- Transformation Revision ID
- 정렬된 Evidence ID와 각 `exactHash`
- Access Scope
- Sensitivity
- Data Classification
- Task Profile
- Schema Name과 Version
- Prompt Version
- Policy Version

`requestDigest`는 Task Profile, Schema, Prompt·Policy Version과 `inputSnapshotDigest`로 계산한다.

동일 Project와 Request Digest는 하나의 Generation Request를 재사용한다. Evidence, SourceVersion, Prompt, Policy 또는 Materializer 의미가 달라지면 동일 Replay가 아니라 별도 Generation이다.

### 5. Retry, Resume와 Replay를 구분한다

#### Retry

실패한 외부 또는 내부 작업을 다시 시도한다.

Provider 재호출은 다음을 모두 만족할 때만 허용한다.

- 유효한 저장 Output이 없다.
- 이전 Provider Attempt의 명확한 실패가 영속 기록됐다.
- 오류가 명시적으로 retryable이다.
- 영속 Attempt Budget이 남아 있다.
- CAS claim을 획득했다.

`OUTCOME_UNKNOWN`, Output Digest 불일치 또는 Output 손상에서는 자동 Provider 재호출을 금지한다.

#### Resume

마지막 영속 상태에서 계속한다.

- `OUTPUT_MATERIALIZED`: 저장 Output으로 Candidate 생성
- `MATERIALIZATION_FAILED`: 같은 저장 Output으로 Materialization 재시도
- Candidate Batch가 이미 존재: Candidate를 추가하지 않고 Materialization 완료만 복구

Resume에서는 Provider를 다시 호출하지 않는다.

#### Replay

저장된 불변 Output을 동일한 Input Snapshot, Schema, Policy와 Materializer Version으로 다시 처리한다.

정확한 Replay는 기존 Candidate Batch와 Candidate Revision 1을 반환한다. 동일 Output Replay마다 새 Candidate Revision을 만들지 않는다.

다른 Provider Output, Prompt·Policy, Evidence Snapshot 또는 Materializer 의미를 사용하는 작업은 Replay가 아니라 별도 Regeneration이다. 새 Candidate Revision 정책은 이 ADR의 범위가 아니다.

### 6. Idempotency와 동시성

최소 관계는 다음과 같다.

```text
Input Snapshot
  1 → 1 Generation Request per generation policy revision
Generation Request
  1 → N bounded Provider Attempts
Provider Attempt
  1 → 0..1 Provider Output
Generation Request
  1 → 0..1 accepted Provider Output
Provider Output
  1 → 0..1 Candidate Materialization per materializer version
Candidate Materialization
  1 → 1 Candidate Batch
```

필수 제약:

- `UNIQUE(project_id, request_digest)`
- `UNIQUE(provider_call_id, attempt_number)`
- `UNIQUE(provider_attempt_id)` for Provider Output
- Generation Request당 accepted Output 최대 1개
- Provider Output와 Materializer Version당 Materialization 최대 1개
- 기존 `candidate.batches(project_id, idempotency_key)` unique 유지

Provider 호출 전 CAS로 하나의 Worker만 `PROVIDER_RUNNING`을 claim한다. Candidate Materialization은 Materialization 완료 레코드, Batch와 Candidate를 하나의 PostgreSQL 트랜잭션으로 저장하거나 기존 Batch를 읽어 완료 상태를 복구한다.

외부 Distributed Lock 또는 Workflow Engine은 도입하지 않는다.

### 7. Startup Recovery 범위

서버 시작 시 제한된 복구 스캔 또는 내부 Resume Command는 다음 상태만 자동 처리한다.

- `OUTPUT_MATERIALIZED`이며 완료 Materialization이 없는 경우
- `MATERIALIZATION_FAILED`이며 Output과 Digest가 유효한 경우
- Candidate Batch가 이미 존재하지만 Materialization 완료 표시가 없는 경우

다음 상태는 자동 Provider 재호출하지 않는다.

- stale `PROVIDER_RUNNING`
- `OUTCOME_UNKNOWN`
- Output 누락
- Output 또는 Input Snapshot Digest 불일치
- 지원하지 않는 Schema Version
- 상충하는 accepted Output

이 경우 fail closed하고 명시적 운영 또는 사용자 재시도를 요구한다.

### 8. 보관 정책

MVP에서는 연결된 Candidate Batch 또는 Candidate가 존재하는 동안 Provider Output을 보관한다. 고정 기간 삭제와 정리 Worker는 별도 운영 결정으로 연기한다.

### 9. 최소 검증 Gate

이 Section은 다음 다섯 시나리오만 필수 검증한다.

1. 정상 흐름과 반복 전달: Provider 1회, Output 저장, Candidate 완료, 중복 Candidate 없음
2. Output은 있으나 Candidate가 없음: 재시작 후 Provider 호출 없이 Candidate 생성
3. Candidate Batch는 있으나 Materialization 완료가 없음: 재시작 후 기존 Batch로 완료 복구, Candidate 추가 없음
4. Provider가 Output 저장 전 명확히 실패: 실패 Attempt 저장, Output과 Candidate 없음
5. Output 누락·형식 오류·Digest 불일치: fail closed, Candidate 없음, 자동 Provider 재호출 없음

같은 규칙을 Unit, Integration과 Database 계층에서 반복하지 않는다. PostgreSQL Transaction, Unique, CAS와 Restart 동작이 필요한 계약만 PostgreSQL Integration Test로 증명한다.

과잉 검증으로 다음을 추가하지 않는다.

- 모든 상태 쌍의 전수 테스트
- 모든 Process Kill 시점 조합
- 대형 동시성 행렬
- Private Function 호출 순서 테스트
- Outbox, Projection, Backup·Restore 또는 검색 품질 테스트

실제 결함이 발견된 경우에만 그 결함의 재발 방지 테스트를 추가한다.

## Alternatives Considered

| 대안                                       | 장점                           | 배제 이유                                                                 |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------- |
| Provider SDK의 전체 Raw Response 저장      | 부가 메타데이터가 많다.        | SDK 결합, 개인정보·숨은 필드·Secret 저장 위험이 크고 Replay에 불필요하다. |
| 파싱된 Candidate 목록만 저장               | 저장 크기가 작다.              | 정확한 Provider Output과 Parser·Schema 검증 근거를 잃는다.                |
| Timeout 뒤 자동 Provider 재호출            | 자동 복구가 빠르다.            | 외부 결과가 이미 성공했을 수 있어 중복 비용과 결과를 만들 수 있다.        |
| Replay마다 새 Candidate Revision 생성      | 실행 이력이 눈에 보인다.       | 동일 Output으로 불필요한 후보와 검토 혼란을 만든다.                       |
| Generic Job Runtime 전체 영속화            | 모든 Module의 복구를 통합한다. | 이번 결함보다 범위가 크고 ADR-080의 경계를 별도로 재검토해야 한다.        |
| 외부 Workflow Engine·Distributed Lock 도입 | 복잡한 Workflow를 지원한다.    | 현재 PostgreSQL CAS와 Unique Constraint로 필요한 안전성을 달성할 수 있다. |

## Consequences

- Provider 응답과 Candidate 저장 사이의 복구 가능한 출력 손실 구간을 닫는다.
- 이미 저장된 Output이 있으면 Provider를 다시 호출하지 않고 Candidate를 생성할 수 있다.
- 동일 Output의 반복 Resume·Replay는 기존 Batch와 Revision 1을 재사용한다.
- 외부 Provider 호출과 첫 DB Commit 사이의 극히 짧은 결과 불명 구간은 남는다. Provider가 Idempotency API를 제공하지 않으면 외부 비용의 exactly-once는 보장하지 않는다.
- Generic Job·Dedup·Dead Letter는 계속 In-memory이며 제품 전체가 durable하다고 표현하지 않는다.
- Candidate, Validation, Human Review와 Canonical 승인 경계는 변경되지 않는다.
- Canonical Outbox, Compiled Truth Projection, Backup·Restore, Quality Benchmark와 Stage 13은 후속 Section으로 유지한다.

## Implementation Gate

이 ADR의 구현은 별도 브랜치에서 진행한다. 다음 조건이 모두 통과하기 전에는 Durability Gate Section 1을 완료로 표시하지 않는다.

- 버전화된 Provider Output Envelope와 Digest가 불변 저장됨
- 저장 Output 기반 Resume가 Provider 재호출 없이 성공함
- 동일 Output Replay가 기존 Batch와 Revision 1을 반환함
- `OUTCOME_UNKNOWN`과 Digest 불일치에서 자동 Provider 재호출이 없음
- 필수 PostgreSQL 검증 5건 통과
- 기존 Stage 4 Candidate·Validation 핵심 회귀 검증 통과

### Implementation Status — COMPLETE (2026-07-21)

- `main` Merge SHA: `06ce9b48328296856fc2eb70e6ef1a4a329243b6`
- Merge 방식: fast-forward
- 완료 승인: 구현 병합 뒤 별도 사용자 승인 완료
- 상세 근거: [Stage 12.1 AI Durable Materialization Implementation Record](implementation-records/stage-12-1-ai-durable-materialization.md)

위 완료 표기는 이 ADR이 정의한 Durability Gate Section 1에만 적용한다. Canonical Outbox·Compiled Truth Projection 자동 복구, Backup·Restore, Quality, Reuse and Operations와 Stage 12.1 전체 상태는 계속 `IN_PROGRESS`다.
