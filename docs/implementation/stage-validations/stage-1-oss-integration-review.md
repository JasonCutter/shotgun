# Stage 1 OSS Integration Review

- 재검증일: 2026-07-16
- 대상: Kernel, Contracts and Connector Runtime
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 1: COMPLETE**

현재 Stage 1은 두 개의 교체 가능한 Transport에서 Module Contract를 검증하는
단일 프로세스 MVP다. 외부 Queue나 영속 Job 시스템을 억지로 넣지 않고, 관련 OSS를 검토한
뒤 현재 구현의 역할과 후속 교체 조건을 명시했다.

제한은 기존과 같다. Dedup, Job, Dead-letter, Trace는 아직 메모리 기반이며 영속 Inbox와
Transactional Outbox는 후속 Stage 범위다.

## 후보별 결정

| 후보                 | 결정             | 이유                                                                          |
| -------------------- | ---------------- | ----------------------------------------------------------------------------- |
| Ajv                  | `ADOPT`          | strict JSON Schema 검증을 이미 `SchemaRegistry` 뒤에서 사용                   |
| gbrain Minion        | `REFERENCE_ONLY` | 기능은 우수하지만 gbrain `BrainEngine`, migration, PostgreSQL worker와 결합됨 |
| CloudEvents          | `REFERENCE_ONLY` | Envelope 상호운용 개념은 참고하되 Shotgun 보안·provenance 필드는 유지         |
| OpenAPI              | `DEFER`          | 아직 공개 HTTP API 호환성을 약속할 단계가 아님                                |
| AsyncAPI             | `DEFER`          | 외부 Broker와 Event Transport가 없음                                          |
| PostgreSQL Job Table | `DEFER`          | Stage 6 영속 Inbox·Outbox와 함께 원자성을 설계해야 함                         |
| OpenTelemetry        | `DEFER`          | 단일 프로세스 Trace Contract는 현재 구현으로 검증됨                           |
| Temporal             | `DEFER`          | 장기 Workflow, timer, saga 요구가 없음                                        |
| NATS JetStream       | `DEFER`          | 독립 Worker와 Event retention 요구가 없음                                     |
| Redis Streams        | `DEFER`          | exact version/license와 운영상 이점이 확정되지 않음                           |

## gbrain Minion 상세 판단

검토한 고정 commit은 `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`다.

Minion은 다음 기능을 실제 코드로 가진다.

- PostgreSQL `minion_jobs` 테이블
- idempotency key와 unique index
- retry와 backoff
- timeout과 dead 상태
- worker lock, lock 갱신, stalled recovery
- parent/child Job과 동시 실행 제어

다만 `MinionQueue`는 gbrain `BrainEngine`, gbrain schema migration, Bun 중심 실행 환경과
연결되어 있다. Shotgun의 현재 `JobRuntime`은 제품용 내구성 Queue가 아니라 Connector
Contract Test에 Job과 Attempt 문맥을 제공하는 작은 메모리 참조 어댑터다.

따라서 지금 Minion 전체를 가져오면 Stage 1의 단순한 Runtime에 gbrain DB와 worker
수명주기까지 함께 들어온다. 이는 현재 필요한 범위보다 크다.

결정은 다음과 같다.

1. 현재 메모리 Job Runtime은 제품용 Queue가 아님을 명시한다.
2. Minion의 idempotency, attempt, backoff, lock recovery 항목을 영속 Job 평가 기준으로
   재사용한다.
3. Stage 6의 Inbox·Outbox·persistent Job 시작 전에 `EXTRACT`, `AUGMENT`, 별도 PostgreSQL
   Job 구현을 다시 비교한다.
4. gbrain DB를 Shotgun의 Canonical 저장소로 사용하지 않는다.

## Contract 검증

- In-memory와 In-process Transport가 같은 Connector Contract Test를 통과한다.
- 중복 Command와 at-least-once Event의 side effect는 한 번만 실행된다.
- Security Context가 없으면 Handler 실행 전에 거부된다.
- retry, partial ordering, dead-letter, replay, timeout의 실패 의미를 Integration Test로
  고정한다.
- Contract payload는 Ajv가 Handler 실행 전에 검증한다.
- Architecture Test가 Module의 Transport와 Adapter 직접 의존을 차단한다.

## 교체와 Rollback

- 외부 Queue는 `MessageTransport` 또는 향후 `JobRuntimePort` Adapter로 추가한다.
- gbrain Minion을 시험할 경우 Shotgun Envelope와 Job Contract를 변환하는 Adapter PoC부터
  만든다.
- PoC 제거 시 현재 In-memory Runtime으로 즉시 돌아갈 수 있어야 한다.
- 영속 Runtime은 restart dedup, lock recovery, dead-letter, replay, timeout,
  Transactional Outbox Contract를 모두 통과하기 전에는 기본값이 될 수 없다.

## Gate 체크

- [x] gbrain Minion 고정 commit 검토
- [x] 직접 구현 Job Runtime의 제한과 존재 이유 기록
- [x] JSON Schema validator exact version 고정
- [x] OpenAPI, AsyncAPI, CloudEvents 결정
- [x] PostgreSQL Job Table, Temporal, NATS, Redis 결정
- [x] OpenTelemetry 결정
- [x] 두 Transport의 동일 Contract Test
- [x] 후속 영속 Runtime 재평가 시점 기록

## 최종 실행 증거

| 검사                            | 결과                                |
| ------------------------------- | ----------------------------------- |
| Unit Test                       | 16 passed                           |
| Connector·Storage Contract Test | 28 passed                           |
| Reliability Integration Test    | 10 passed                           |
| Architecture Test               | PASS                                |
| Secret Scan                     | PASS                                |
| OSS Gate                        | 17개 결정, 6개 필수 Reference, PASS |
