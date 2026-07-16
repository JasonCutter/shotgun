# ADR-080 — Stage 1 Kernel, Contracts and Connector Runtime

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 기준:
  [`ADR-077 Common Contracts and Connector Runtime`](../module-architecture/adr/ADR-077-common-contracts-and-connector-runtime.md)

## 배경

Shotgun Module이 서로의 구현 코드나 Transport 방식에 직접 의존하면 Module을 독립적으로
교체하거나 분리하기 어렵다. Stage 1은 제품 기능을 추가하기 전에 Module 사이의 공통 계약,
실행 경계, 보안 기본값, 재시도와 중복 처리 규칙을 작동하는 코드와 테스트로 고정해야 한다.

## 결정

Stage 1은 다음 경계를 채택한다.

- 공통 Message Envelope와 Payload Contract를 Semantic Version과 JSON Schema로 관리한다.
- 대용량 파일은 Payload에 직접 넣지 않고 Version이 고정된 Asset Reference로 전달한다.
- Module은 Manifest, Contract, Handler, Capability만 제공한다.
- Assembly는 Module 구현을 서로 직접 연결하지 않고 Module Registry와 Connector Runtime으로
  조립한다.
- Module Registry는 Handler 초기화 전에 Runtime·Contract·Capability 호환성을 검사한다.
- Connector Runtime은 Command·Event·Query 전달, Security 검사, 중복 제거, 부분 순서,
  Retry, Dead-letter, Replay, Job·Attempt와 Trace Context 전달을 담당한다.
- In-memory와 In-process Transport는 같은 `MessageTransport` Port를 구현한다.
- Event와 비동기 Command는 `at-least-once` 전달을 전제로 Consumer별 Idempotency Key로
  중복을 제거한다.

## 전달 규칙

| 항목        | Stage 1 결정                                                |
| ----------- | ----------------------------------------------------------- |
| Command     | 단일 Handler, Idempotency Key 필수                          |
| Event       | 여러 Consumer, Consumer별 중복 제거                         |
| Query       | 상태 변경 금지, 단일 Provider                               |
| 부분 순서   | `orderingKey`별 `sequence`가 1부터 연속이어야 함            |
| Retry       | Retryable 오류만 지수 Backoff, 기본 최대 3 Attempt          |
| Timeout     | 결과를 `OUTCOME_UNKNOWN`으로 표시하고 자동 재실행 금지      |
| Dead-letter | 최종 실패 메시지, 오류, Job 정보를 격리 보관                |
| Replay      | 원본 Envelope를 보존하고 Replay 이력을 별도로 추가          |
| 보안        | 필수 Context가 없거나 Scope가 부족하면 Handler 실행 전 거부 |
| 추적        | correlation·causation·trace·job·provenance Context 전달     |

## 결과

- Domain Module은 Transport 구현과 다른 Module 코드에 직접 의존하지 않는다.
- 동일 Module을 In-memory와 In-process 환경에서 같은 Contract Test로 검증할 수 있다.
- 추후 Queue·HTTP Adapter는 `MessageTransport` 구현을 추가하는 방식으로 확장할 수 있다.
- 호환되지 않는 Contract와 Runtime은 Module 초기화 전에 차단된다.
- 현재 저장소는 실제 영속 Inbox·Outbox 대신 In-memory Dedup·Dead-letter를 사용한다.

## 제외 범위

- Persistent Inbox와 Transactional Outbox
- 외부 Queue, HTTP, gRPC Transport
- 제품 Domain Schema와 Canonical Write
- 외부 Action 실행

위 항목은 Stage 1 완료 조건이 아니며 각각 후속 Stage에서 다룬다.

## 되돌리기와 Contract 변경

Stage 1은 제품 데이터 Schema를 추가하지 않으므로 PostgreSQL Migration Rollback이 필요하지
않다. 코드와 Contract Version `1.0.0`을 되돌릴 수 있지만, `1.x`가 배포된 뒤 Breaking
Change가 필요하면 기존 계약을 수정하지 않고 `2.0.0`을 추가해 병행한다.
