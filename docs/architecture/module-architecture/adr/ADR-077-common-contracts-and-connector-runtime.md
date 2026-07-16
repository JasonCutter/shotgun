# ADR-077 — Common Contracts and Connector Runtime

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 ADD: `../shotgun-module-architecture-add.md`

## 맥락

모듈을 레고처럼 조립하려면 구현 언어와 배포 위치보다 안정적인 연결 계약이 먼저 필요하다. 하나의 만능 함수 또는 각 모듈의 임의 API를 사용하면 결합도가 다시 높아진다.

## 결정

Shotgun Kernel은 공통 Message Envelope와 다음 Port를 제공한다.

- Command
- Event
- Query
- Asset Reference

모든 메시지는 schema version, producer module, correlation·causation ID, project·actor, Security Context, Provenance, Job·Attempt와 생성 시각을 전달한다.

Transport는 In-memory, In-process, Queue, HTTP, gRPC, Webhook 또는 MCP로 교체할 수 있으며 Domain Module은 사용 중인 Transport를 알지 않는다.

### 전달 보장과 재처리 정책

- Event와 비동기 Command의 기본 전달 보장은 `at-least-once`로 한다. Consumer는 `message_id`, `idempotency_key`와 처리 결과를 사용해 중복을 제거해야 한다.
- 전역 순서는 보장하지 않는다. 순서가 필요한 경우에만 `ordering_key` 단위의 부분 순서를 보장하고, Consumer는 `sequence`·`expected_revision`으로 역전·누락을 감지한다.
- Producer는 상태 변경과 Event 발행의 원자성이 필요한 경우 Transactional Outbox를 사용한다. Consumer는 처리 완료 기록 또는 Inbox/Dedup Store를 사용한다.
- Retry는 지수 backoff와 최대 시도 횟수를 가지며, 반복 실패는 Dead-letter/Quarantine 상태로 이동한다.
- Replay는 원본 Event를 수정하지 않고 동일 `message_id` 또는 명시적 `replay_id`와 원인 기록을 유지한다. Side effect가 있는 Consumer는 재처리 전에 idempotency와 현재 상태를 다시 검증한다.
- Event schema를 지원하지 못하거나 보존 기간이 지난 dependency가 필요한 경우 자동 추측하지 않고 `UNSUPPORTED_SCHEMA` 또는 `REPLAY_BLOCKED`로 중단한다.
- 동기 Query는 상태를 바꾸지 않는다. Timeout 뒤 결과가 불명확한 Command·Action은 자동 재호출하지 않고 `OUTCOME_UNKNOWN` 규칙을 따른다.

모듈은 다른 모듈의 DB Schema와 공급자 SDK를 직접 사용하지 않는다.

## 제외 대안

- 공유 DB를 사실상의 통합 API로 사용
- 각 모듈이 임의 REST API를 정의
- 파일 전체를 메시지에 반복 첨부
- Event와 Command를 구분하지 않는 단일 Bus

## 영향

- Contract와 schema version 관리가 핵심 개발 작업이 된다.
- Module Manifest와 Compatibility Validator가 필요하다.
- 중복 전달, 부분 순서, Retry, Dead-letter, Replay, stale version과 outcome unknown을 공통 오류 모델로 처리한다.
- 대형 파일은 Asset Reference로 전달한다.
