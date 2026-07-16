# Stage 1 — Kernel, Contracts and Connector Runtime

## 완료 상태

**COMPLETE**

두 개의 독립 모듈을 Manifest로 등록하고, 아래 수직 흐름을 두 Transport에서 같은
Contract Test로 검증했다.

```text
PingCommand
→ stage1.ping
→ PongEvent
→ stage1.pong
→ GetPongResult Query
→ QueryResult
```

## 실행 방법

```powershell
npm ci
npm run check
npm run dev
```

실제 API 확인:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/demo/ping `
  -ContentType 'application/json' `
  -Body '{"requestId":"demo-1","message":"hello"}'
```

응답에는 `pong:hello` 결과와 Command·Event·Query의 Trace가 포함된다.

## 구현 구조

```text
packages/
  contracts/          Message Envelope, Asset Reference, Schema Registry, 오류 모델
  module-sdk/         Manifest, Handler, Capability, Registry
  connector-runtime/ 중복 제거, 부분 순서, Retry, Dead-letter, Replay
  job-runtime/        Job과 Attempt
  policy/             Security Context 기본 거부
  observability/      Payload를 제외한 Trace 기록
  kernel/             각 Package 조립
modules/
  ping/               PingCommand Handler
  pong/               PongEvent Consumer와 Query Provider
adapters/
  transport-in-memory/
  transport-in-process/
```

## 고정된 Contract

| Contract         | Version | 역할                                |
| ---------------- | ------: | ----------------------------------- |
| Message Envelope | `1.0.0` | 공통 실행·보안·추적 Context 전달    |
| Asset Reference  | `1.0.0` | 불변 Asset Version 참조             |
| PingCommand      | `1.0.0` | 상태 변경 요청 Command              |
| PongEvent        | `1.0.0` | at-least-once 전달 Event            |
| GetPongResult    | `1.0.0` | 상태를 변경하지 않는 Query와 Result |

Breaking Change는 기존 `1.x`를 수정하지 않고 새 Major Version으로 추가한다.

## 완료 기준과 증거

| 완료 기준                               | 자동 검증                          |
| --------------------------------------- | ---------------------------------- |
| 두 Module을 Manifest로 자동 연결        | Manifest·Health·Contract Test      |
| 호환되지 않는 Version은 시작 전에 차단  | Module Registry Unit Test          |
| Command 중복 Side Effect는 한 번만 실행 | Connector Contract Test            |
| Event 중복 전달은 Consumer별로 안전     | Connector Contract Test            |
| Security Context 누락 시 기본 거부      | Connector Contract Test            |
| Command부터 Query까지 동일 Trace 유지   | Connector Contract Test            |
| Job·Attempt·Provenance Context 전달     | Connector Contract Test            |
| 두 Transport가 동일 계약을 만족         | In-memory·In-process Contract Test |
| 부분 순서 누락 탐지                     | Reliability Integration Test       |
| Retry·Dead-letter·Replay                | Reliability Integration Test       |
| Timeout 결과 미확정 및 자동 재실행 금지 | Reliability Integration Test       |
| Message Envelope·Asset Reference 검증   | Contracts Unit Test                |
| Package 의존 방향 준수                  | Architecture Test                  |

## 보안과 데이터

- Handler 실행 전에 Actor, Project, Access Scope, Sensitivity를 검사한다.
- 필수 Security Context가 없으면 실행하지 않고 기본 거부한다.
- Trace에는 Payload와 Secret을 기록하지 않고 메시지 식별 정보와 실행 결과만 기록한다.
- 테스트 Module에는 Canonical Write 또는 외부 Action 실행 권한이 없다.
- Stage 1은 제품 데이터용 PostgreSQL Schema를 추가하지 않는다.

## 알려진 제한

- Dedup, Job, Trace, Dead-letter Store는 현재 프로세스 메모리에만 저장된다.
- 프로세스 재시작 뒤에도 보존되는 Inbox·Transactional Outbox는 Stage 6에서 추가한다.
- 전역 순서는 제공하지 않고 `orderingKey`별 연속 `sequence`만 검사한다.
- Queue·HTTP·gRPC Transport는 아직 구현하지 않았다.
- JavaScript Promise는 강제 취소할 수 없어 Timeout 결과를 `OUTCOME_UNKNOWN`으로 표시하고
  자동 재실행하지 않는다.

이 제한은 Stage 1의 경계를 명확히 하며, 다음 Stage의 제품 기능과 Kernel 기반 기능이
섞이는 것을 방지한다.

## Migration과 Rollback

Stage 1에는 Database Migration이 없다. Rollback은 Stage 1 코드와 Contract 등록을
제거하는 방식이다. 이미 Consumer가 `1.0.0`을 사용한 뒤에는 기존 Contract를 덮어쓰지
않고 새 Major Version을 병행한다.
