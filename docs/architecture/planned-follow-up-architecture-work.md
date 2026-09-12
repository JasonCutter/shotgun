# Planned Follow-up Architecture Work

- 상태: `PLANNED / DEFERRED`
- 기록일: 2026-07-29
- 분류: 확정된 기술부채가 아닌 계획된 후속 Architecture Work
- 현재 차단 여부: ADR-119 및 Phase 1 Section 3 진행을 차단하지 않음

## 1. 기록 목적

현재 Shotgun의 지원 범위를 과장하지 않으면서, 실제 제품 요구가 발생하기 전에 별도 아키텍처 검토가 필요한 후속 작업과 착수 Trigger를 명시한다.

이 문서의 항목은 구현 승인이나 기술 선택 확정을 의미하지 않는다. Trigger가 충족되면 기존 결정을 조용히 변경하지 않고 별도 Section 검토와 ADR을 통해 범위, 제품 선택, Migration, Rollback 및 검증 기준을 확정한다.

## 2. Durable Knowledge Processing

### 현재 상태

- 현재 Intake 종단 흐름은 HTTP 요청 안에서 저장, 변환 결과, Evidence, Candidate 및 Review 조회까지 기다리는 동기 처리 경로를 포함한다.
- Job·Attempt Runtime은 존재하지만 범용 제품 작업을 재시작 후 복구하는 영속 Queue로 확정된 상태가 아니다.
- Canonical Outbox와 Projection Recovery는 영속 전달·복구 경계이며, 대용량 Import용 범용 작업 Queue와 동일하게 취급하지 않는다.

### 착수 Trigger

다음 중 하나를 제품 범위로 채택하기 전에 이 작업을 착수한다.

- 대용량 PDF·Office 문서 처리
- 여러 파일의 동시 Import
- GitHub Issue, Email 또는 외부 Source의 대량 Import
- HTTP 요청 제한을 초과할 수 있는 장시간 변환·AI 처리
- Application 재시작 후 진행 중 작업의 자동 복구
- 사용자에게 Job 진행률, 취소, 재시도 또는 실패 복구를 제공해야 하는 경우

### 향후 필수 계약

- `202 Accepted`와 안정적인 `jobId`
- Durable Job과 JobAttempt
- Idempotency Key와 중복 실행 방지
- Lease·Heartbeat·Stale Claim Recovery
- Retry Policy·Backoff·Dead Letter
- 진행률과 상태 조회
- Cancellation 의미와 안전한 중단 지점
- Restart Recovery
- Project·Actor·Access Scope 보존
- 단계별 Provenance와 Audit
- 완료 후 Frontend Query 갱신 신호

### 미확정 기술 선택

다음 후보는 후속 OSS 평가와 부하·복구 검증 전까지 확정하지 않는다.

- PostgreSQL Job Table + `SKIP LOCKED`
- pg-boss
- Graphile Worker
- BullMQ + Redis
- RabbitMQ
- Polling, SSE 또는 WebSocket 기반 Frontend 통지

## 3. Hybrid Semantic Retrieval Validation

### 현재 상태

- Stage 7 검색은 PostgreSQL FTS와 `pg_trgm`, Projection Watermark, Canonical-only 검색 및 Evidence Citation을 제공한다.
- 자연어 동의어·표현 변화에 대한 Recall 한계가 확인돼 있다.
- `pgvector`는 누락된 필수 구성요소로 간주하지 않으며, 의미 검색 Benchmark가 필요성을 입증할 때까지 보류한 기존 결정을 유지한다.

### 착수 Trigger

다음 중 하나가 성립할 때 검증을 착수한다.

- FTS·Trigram Golden Query Recall이 승인된 목표를 충족하지 못함
- 동의어·표현이 다른 과거 지식 검색을 제품 요구사항으로 채택함
- 시간 조건과 의미 조건을 결합한 자연어 질의를 지원해야 함
- 지식 규모 증가로 기존 Ranking의 검색 품질이 허용 범위 아래로 하락함
- RAG가 관련 Canonical Chunk를 의미 기반으로 선별해야 하는 제품 기능을 도입함

### 검증 범위

- 한국어·영어·혼합 질의 Golden Corpus
- Exact, typo, synonym, paraphrase 및 temporal query
- FTS 단독, Vector 단독, Hybrid Ranking 비교
- Recall, Precision, Hit Rate, MRR, nDCG 및 Citation Coverage
- Project·Access Scope·Sensitivity Filter의 선적용 또는 동등한 안전성
- Embedding Model·Version·Dimension·Chunker Version의 Provenance
- Canonical Revision 변경 시 재임베딩과 Projection Rebuild
- Stale·Degraded 상태의 답변 차단
- 비용, 지연시간, 저장 크기와 재구축 시간

### 미확정 기술 선택

- `pgvector` 도입 여부
- Embedding Provider와 Model
- Chunk 단위와 Overlap
- Vector Index 종류와 Parameter
- Lexical·Vector 점수 결합 방식
- Reranker 도입 여부

## 4. 현재 비범위와 표현 제한

- ADR-119 Frontend State/Cache Ownership 구현에는 위 두 작업을 포함하지 않는다.
- Phase 1 Section 3의 현재 기능 범위에도 포함하지 않는다.
- 현재 Shotgun을 대용량 비동기 Import 완료 상태로 표시하지 않는다.
- 현재 검색을 Vector RAG 또는 Hybrid Semantic Retrieval 완료 상태로 표시하지 않는다.
- Structured Output, Canonical Revision·History 및 기존 Citation 검증을 이 후속 작업과 중복 구현하지 않는다.

## 5. 승격 규칙

Trigger가 충족되면 각 항목을 독립 설계 쟁점으로 다룬다.

1. 현재 성능·실패 증거와 제품 요구를 수집한다.
2. 관련 OSS를 `ADOPT`, `EXTRACT`, `AUGMENT`, `REFERENCE_ONLY`, `DEFER`, `REJECT` 중 하나로 평가한다.
3. 데이터 소유권, Contract, Failure State, Security, Migration 및 Rollback을 ADR로 확정한다.
4. Golden·Contract·Integration·Database·Recovery Test의 완료 기준을 승인한다.
5. 사용자 승인 전 결과를 Canonical 완료 상태로 표시하지 않는다.
