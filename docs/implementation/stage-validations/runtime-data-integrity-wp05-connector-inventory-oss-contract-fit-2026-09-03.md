# Runtime Data Integrity WP-05 — Connector Runtime Inventory and OSS Contract-Fit Review

> 상태: **GPT 검토 대기 — 구현 전 필수 산출물**  
> 작성일: 2026-09-03  
> 대상 Issue: [#175](https://github.com/JasonCutter/shotgun/issues/175)  
> 검토 기준선: `main@48dac5e0e6c963531033e27b5d48d7dfb883f89b`  
> 대상 범위: `RIC-N3`, `RIC-N4`, WP-05만

## 1. 권한과 검토 범위

이 문서는 GPT가 작성한 Issue #175와 저장소의
`docs/implementation/runtime-data-integrity-canonical-implementation-plan-2026-09-03.md`
를 실행 기준으로 삼는다. 사용자가 제공한 과거 수정계획서나 이 문서의 제안 문구가
그 자체로 Canonical 권한을 갖지는 않는다. WP-06 이후의 작업, 기존 Canonical·Evidence·
Action 저장소 재설계, 외부 Queue 도입은 이 문서에서 승인하지 않는다.

Issue #175가 요구한 첫 산출물은 (1) 현재 Connector Runtime의 실제 경로·Port·상태·
작업·dedup·DLQ·ordering·timeout·lifecycle·recovery·migration·side effect call-site
인벤토리와 (2) PostgreSQL, pg-boss, Graphile Worker, gbrain Minion의 계약 적합성
검토다. 이 문서는 두 산출물을 합치되, 서로 다른 원인을 중복 배정하지 않도록 작성했다.

## 2. 기준선과 현행 E2E 흐름

### 2.1 기준선 스냅샷

| 항목                  | 확인 결과                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Git 기준선            | `48dac5e0e6c963531033e27b5d48d7dfb883f89b` (WP-04 merge 이후)                                                                            |
| Node/npm              | 저장소 `package.json`의 Node `>=24`, npm `>=11`                                                                                          |
| PostgreSQL            | 기존 registry 기준 `16.14` Docker digest `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` |
| PostgreSQL client     | 기존 `pg` 의존성(현재 lockfile resolved `8.22.0`) 재사용; 새 Queue 패키지 미설치                                                         |
| Migration runner      | `scripts/database.ts:39-115`, 파일명 사전순·transaction 적용·`runtime.schema_migrations` 기록                                            |
| 마지막 migration      | `063_runtime_data_integrity_wp04_recovery_invariants.sql`                                                                                |
| 기본 Connector 저장소 | `InMemoryJobRuntime`, `InMemoryDedupStore`, `InMemoryOrderingStore`, `InMemoryDeadLetterStore`                                           |
| Production wiring     | `assemblies/shotgun-app/src/server.ts:2098-2121`에서 `new ShotgunKernel(transport)`; Connector 영속 옵션 주입 없음                       |
| 현재 branch 변경      | 이 WP-05 worktree에는 본 문서 작성 전 source/schema 변경 없음                                                                            |

### 2.2 현행 흐름

```text
HTTP / application caller
  └─ createCommand/createQuery/createChildEvent
       └─ ConnectorRuntime.sendCommand/query/publishEvent
            ├─ validateEnvelope + SchemaRegistry input validation
            ├─ ModuleRegistry route lookup + security authorization
            ├─ InMemoryDedupStore.runOnce
            │    └─ InMemoryJobRuntime.run (attempt/retry/backoff)
            │         ├─ InMemoryOrderingStore.assertNext
            │         ├─ MessageTransport.execute
            │         │    └─ handler.handle (side effect / child publish/query)
            │         └─ ordering.commit → dedup completed result
            ├─ failure → InMemoryDeadLetterStore.add
            └─ query result / event consumer delivery / command delivery 반환
```

실제 주요 진입점은 다음과 같다.

| 흐름                        | 위치                                                  | 확인된 연결                                                          |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| Command·Event·Query runtime | `packages/connector-runtime/src/runtime.ts:148-268`   | 입력 검증 → route → 실행 또는 결과 반환                              |
| 동일 key dedup              | `runtime.ts:313-370`, `stores.ts:21-69`               | consumer·kind·messageType와 idempotency key로 묶음                   |
| Job/attempt/retry           | `packages/job-runtime/src/index.ts:40-133`            | 메모리 Map, retryable 오류에 최대 3회 지수 backoff                   |
| Partial ordering            | `stores.ts:71-109`                                    | consumer + orderingKey별 마지막 sequence 메모리 보관                 |
| DLQ/replay                  | `runtime.ts:270-311,481-508`, `stores.ts:111-164`     | envelope·safe error·job을 메모리 보관 후 route 재실행                |
| Stage 3 → Stage 4 handoff   | `assemblies/shotgun-app/src/application.ts:1199-1240` | `EvidenceIndexed` publish; consumer dead-letter를 호출자 오류로 변환 |
| HTTP command/query callers  | `assemblies/shotgun-app/src/server.ts:3055-3910`      | Sources, knowledge, review, action, entity-vault 등 다수             |

### 2.3 목표 WP-05 경계

```text
same Port calls
  └─ ConnectorRuntime
       ├─ schema/security validation (변경 없음)
       ├─ Durable Dedup/Job/Ordering/DLQ adapter (PostgreSQL)
       │    ├─ semantic key + fingerprint unique
       │    ├─ atomic claim + lease + fencing token
       │    ├─ queued/running/retryable/terminal/dead-letter/unknown 기록
       │    └─ completed/failed/unknown 결과와 safe reference 보존
       └─ handler 호출
            ├─ success를 durable 상태에 기록한 뒤 ack
            ├─ ack-loss/timeout은 OUTCOME_UNKNOWN tombstone
            └─ unknown은 reconciliation 전 자동 재호출 금지
```

PostgreSQL은 저장·locking substrate일 뿐이다. Canonical, Evidence, Approval, Action,
Source, Claim/Fact 의미와 ID는 계속 Shotgun이 소유한다. Canonical Outbox와 Evidence
continuation outbox를 Connector 전역 outbox로 합치지 않는다.

## 3. 현행 런타임·Port·상태 인벤토리

### 3.1 저장소별 책임과 결함

| 구성요소    | 파일/함수                                                                      | 현재 권위와 상태                                                             | 재시작 시 결과                                                 | WP-05 판정                                    |
| ----------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| Dedup       | `stores.ts:21-57` `InMemoryDedupStore.runOnce`                                 | `completed Map`과 `running Map<Promise>`; 동일 fingerprint만 duplicate       | Map이 사라져 완료·진행·충돌 이력이 모두 유실                   | PostgreSQL `DedupStorePort`로 교체            |
| Job/Attempt | `job-runtime/src/index.ts:40-124` `InMemoryJobRuntime.run`                     | `running/succeeded/failed/outcome-unknown`, attempt 배열, retryable만 재시도 | 작업/attempt/다음 시각/lease 유실; 다른 process와 공유 불가    | `JobRuntimePort` + durable job authority      |
| Ordering    | `stores.ts:71-109`                                                             | consumer + key별 마지막 sequence                                             | 마지막 sequence 유실; 재시작 후 stale/duplicate 순서 판정 불가 | `OrderingStorePort` checkpoint/fence          |
| DLQ         | `stores.ts:111-164`                                                            | open/resolved, envelope, safe error, replay 배열                             | DLQ와 replay authorization/evidence 유실                       | `DeadLetterStorePort` safe reference 중심     |
| Trace/Audit | `runtime.ts:127-145` 및 observability                                          | 메모리 trace/audit; business authority 아님                                  | 운영 추적 유실; WP-05에서는 durable business state와 혼동 금지 | 기존 Port 유지, 별도 persistence는 WP-08 이후 |
| Transport   | `packages/connector-runtime/src/types.ts:10-12`, in-memory/in-process adapters | `execute(operation)`만 제공; 취소 신뢰성은 보장하지 않음                     | handler가 살아 있으면 transport timeout 이후 계속 실행 가능    | cancellation은 보조, durable state가 권위     |

### 3.2 Port 부재와 현재 호출 계약

현재 `ConnectorRuntime`은 `InMemory*` 구체 타입을 직접 생성·보관한다
(`runtime.ts:41-48,126-145`). `JobRuntimePort`, `DedupStorePort`, `OrderingStorePort`,
`DeadLetterStorePort`라는 infrastructure-neutral 계약은 아직 export되지 않았다.
`ShotgunKernel`도 `packages/kernel/src/index.ts:4-12`에서 transport만 받아 Connector를
만들므로 Production assembly가 durable adapter를 주입할 수 없다.

따라서 1차 Port 변경은 다음 최소 표면만 추가한다.

- Dedup: `begin/read/complete/fail/markOutcomeUnknown/reconcile`
- Job: `enqueue/claim/renew/complete/retry/terminal/cancel/find`
- DLQ: safe envelope reference·failure·replay authorization 및 replay 결과
- Ordering: ordering key별 sequence, fence, checkpoint

기존 InMemory 구현은 이 계약의 test adapter로 남기되 기본 Production authority로
남기지 않는다. Port 결과에 OSS 내부 type, schema, DB id를 노출하지 않는다.

## 4. 결함 목록 (WP-05 고유 원인)

| 위치                                                                          | 문제점                                                                                                                                                                                                               |     영향도 | 소유 WP                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------: | ------------------------------------------------- |
| `packages/connector-runtime/src/stores.ts:21-57` `InMemoryDedupStore.runOnce` | timeout으로 호출자가 `OUTCOME_UNKNOWN`을 받은 뒤에도 내부 Promise의 `finally`가 `running` key를 삭제한다. 늦게 완료한 handler의 결과도 durable하게 남지 않아 동일 semantic key가 새 handler 호출로 재진입할 수 있다. |   **High** | WP-05                                             |
| `packages/connector-runtime/src/runtime.ts:89-124` `withTimeout`              | `Promise.race`는 경쟁 Promise를 취소하지 않는다. timeout은 unknown을 던지지만 원 handler의 side effect 완료·실패를 기록하거나 fence하지 않는다.                                                                      |   **High** | WP-05                                             |
| `packages/connector-runtime/src/runtime.ts:126-145` `ConnectorRuntime` 생성자 | Job, dedup, ordering, DLQ의 기본 권위가 process memory다. process restart, 두 worker, crash-before-ack에서 idempotency·order·replay 증거가 사라진다.                                                                 |   **High** | WP-05                                             |
| `packages/kernel/src/index.ts:4-12` `ShotgunKernel`                           | durable Connector/Job adapter를 주입할 Port가 없어 Production이 InMemory 기본값을 벗어날 수 없다.                                                                                                                    |   **High** | WP-05                                             |
| `assemblies/shotgun-app/src/server.ts:2098-2121` `createApplicationCore`      | Kernel shutdown은 cleanup stack에 등록되어 있으나 Connector의 persistent worker/lease recovery lifecycle은 존재하지 않는다. 새 adapter는 bounded startup/stop/renew loop를 같은 stack에 추가해야 한다.               | **Medium** | WP-05 (lifecycle 계약), WP-03/08과 중복 구현 금지 |

다음 항목은 이 WP-05에서 수정하지 않는다. `RIC-N1/RIC-N2`는 WP-04에서 완료됐고,
Ask atomic claim은 `DIC-02/WP-06`, recovery readiness는 `RIC-N5/WP-08`, HTTP body
validation은 `RIC-N6/WP-09`, Action feedback은 `RIC-N7/WP-10`의 단일 소유다.

## 5. Side-effect 및 lifecycle call-site 인벤토리

### 5.1 실제 Connector 호출자

| 호출 위치                                             | 호출                                   | side-effect/결과                            | WP-05 보호 방식                                                                      |
| ----------------------------------------------------- | -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `assemblies/shotgun-app/src/application.ts:1201-1225` | `publishEvent(EvidenceIndexed)`        | Stage 4 continuation 소비자에 handoff       | durable event dedup + unknown; Evidence/Stage4 의미는 WP-04 유지                     |
| `server.ts:3055-3130`                                 | intake/original asset commands·queries | Source/asset persistence                    | command semantic key와 fingerprint 저장; 기존 repository transaction은 변경하지 않음 |
| `server.ts:3170-3375`                                 | transformation/evidence/ask 조회·명령  | transformation/evidence read/write          | handler 성공 후 durable complete, failure/DLQ safe envelope                          |
| `server.ts:3411-3650`                                 | review, knowledge, compiled truth      | review/canonical/projection transitions     | approval/canonical ownership 유지; Connector는 delivery authority만 보강             |
| `server.ts:3734-3910`                                 | discovery, action, entity-vault        | durable discovery/action state              | action 자동 재실행 금지; unknown은 manual reconciliation                             |
| `runtime.ts:428-467`                                  | handler `context.publish/query`        | child event/query 및 parent acknowledgement | required child failure만 parent outcome에 반영; child dedup은 별도 consumer key      |

### 5.2 lifecycle 현재 상태

- Registry startup/shutdown은 `server.ts:2120-2121`의 `kernel.start()` 및 cleanup stack을
  통해 연결된다.
- Canonical projection, discovery scheduler/execution/reentry worker는
  `server.ts:2156-2195`에서 시작·정리된다.
- Connector 자체에는 recovery loop, lease renewal, stale claim sweep, persistent pool
  close가 없다.
- 새 adapter는 시작 시 migration compatibility를 확인하고, stop 시 polling/renew/claim
  loop를 bounded grace 안에 정리하며, 종료 중 business retry 횟수를 소비하지 않아야 한다.

## 6. OSS 계약 적합성 검토

검토는 Issue #175가 지정한 후보 범위와 Canonical/Stage-6의 역사적 비교 기준을
사용했다. pg-boss와 Graphile Worker를 설치하거나 schema를 실행하지 않았으며, 도입
필요성 판단을 위해 공식 release, repository, license 문서와 현재 Shotgun registry를
대조했다.

| 후보            | 공식 URL / 고정 기준                                                                                                                                                                                                                                                                                           | Port 적합성                                                                                                 | tx/outbox                                                                                                   | restart dedup·lock recovery                                                                                   | DLQ/replay                                                                                                 | timeout unknown                                                                                          | license·보안·유지보수                                                                                                                 | 결정                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| PostgreSQL      | [postgres/postgres](https://github.com/postgres/postgres), repo baseline `16.14` image digest; [PostgreSQL 16 SELECT/locking](https://www.postgresql.org/docs/16/sql-select.html)                                                                                                                              | 기존 `pg`와 repository adapter 뒤에 직접 맞음                                                               | 기존 migration runner와 transaction, `FOR UPDATE SKIP LOCKED`, advisory/row lock 사용 가능                  | unique key·lease·fence·checkpoint를 Shotgun schema로 소유 가능                                                | safe reference와 replay authorization을 Shotgun이 정의                                                     | application tombstone으로 정확히 보존 가능                                                               | PostgreSQL License; 기존 SBOM·image pin 재사용; major/patch 변경은 registry 검토                                                      | **ADOPT (substrate/adapter only)** |
| pg-boss         | Canonical/Stage-6 baseline [12.26.0](https://github.com/timgit/pg-boss/releases/tag/12.26.0), tag commit `31a4cf0093b0df73d077782689b738bcd0292021`; current registry-reviewed pin `12.28.1 @ 78089bbd51cce5e70282f6e5f9a9d937856ab414`; [MIT license](https://github.com/timgit/pg-boss/blob/12.26.0/LICENSE) | generic queue API는 Job Port 뒤에 둘 수 있으나 package schema·job ID·worker lifecycle이 Shotgun 의미와 겹침 | 자체 schema/migration과 enqueue/claim을 제공하지만 Canonical/Evidence transaction 의미를 직접 소유하지 않음 | idempotency, retry, lease/fetch는 유용하나 Shotgun fingerprint/unknown/fence semantics를 그대로 보장하지 않음 | dead-letter/retry 기능은 있으나 Shotgun replay authorization·safe payload 계약으로 변환 필요               | timeout/late completion을 Shotgun `OUTCOME_UNKNOWN`으로 보존하려면 별도 ledger 필요                      | MIT; 두 버전 모두 비교/registry 증거일 뿐 production `latest` 또는 upgrade 승인 아님; DB 오류 관측·schema migration 운영 surface 추가 | **DEFER**                          |
| Graphile Worker | [release v0.17.3](https://github.com/graphile/worker/releases/tag/v0.17.3), tag commit `195491c6c4ebf58420ab9d1c8291df0334184063`, [repository](https://github.com/graphile/worker)                                                                                                                            | task runner API를 Job Port 뒤에 둘 수 있으나 task identifier/worker pool이 Connector semantic key와 다름    | package-owned `graphile_worker` schema와 migration/worker pool; 기존 Shotgun transaction authority와 중복   | claim/retry/cron은 강점이나 fingerprint conflict, fence result, unknown tombstone은 추가 adapter 필요         | failed jobs/cleanup은 존재하나 governed replay와 protected envelope reference는 Shotgun이 별도 소유해야 함 | timeout/worker shutdown 결과를 그대로 unknown authority로 사용할 수 없음                                 | MIT; active repository지만 task loader·worker 운영 surface와 별도 schema가 증가                                                       | **DEFER**                          |
| gbrain Minion   | [garrytan/gbrain](https://github.com/garrytan/gbrain), pinned commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, [MIT license](https://github.com/garrytan/gbrain)                                                                                                                                             | Minion queue를 그대로 Port로 노출하면 gbrain BrainEngine/DB schema와 결합                                   | `minion_jobs`/inbox와 gbrain migration에 결합; Shotgun Canonical/Connector transaction 경계와 불일치        | idempotency, retry/backoff, worker lock/stalled recovery 패턴은 높은 참고 가치                                | queue recovery 패턴은 참고 가능하지만 Shotgun safe envelope/replay approval은 별도                         | two-phase pending→done와 timeout 패턴은 참고하되 provider/action unknown을 자동 재실행하지 않도록 재정의 | MIT; pinned commit만 참고하고 runtime/provider/config/DB는 반입하지 않음; upstream issue/maintenance 변동은 자동 반영 금지            | **REFERENCE_ONLY**                 |

### 6.1 적합성 결론과 registry 불일치

1. PostgreSQL은 이미 Shotgun의 저장소·migration·transaction 표면에 존재하고, 새
   package-owned queue authority를 만들지 않으면서 필요한 durable primitive를 제공한다.
   따라서 PostgreSQL adapter를 `ADOPT`한다.
2. pg-boss는 Canonical/Stage-6의 역사적 `12.26.0` 비교 기준과 현재 registry의
   `12.28.1` 검토 pin을 모두 보존한다. 이는 버전 drift 신호이지 자동 downgrade,
   upgrade, adoption 승인으로 해석하지 않는다. pg-boss를 이번 WP-05에 설치하지 않고
   `DEFER`하며, 향후 채택 검토 시 당시 registry/upstream에서 한 버전·한 commit·
   lockfile을 다시 승인한다.
3. Graphile Worker는 동일 이유로 `DEFER`한다. 현재 WP-05는 일반 cron/task runner가
   아니라 Connector의 Shotgun-owned outcome ledger가 목표다.
4. gbrain Minion은 기존 ADR·registry와 일관되게 `REFERENCE_ONLY`다. Minion의
   lock/retry/recovery 설계 항목만 acceptance criteria로 재사용한다.
5. 후보 간 기능 차이가 현재 Port 경계를 바꿀 정도로 모호하지 않으므로 benchmark나
   신규 OSS schema PoC를 추가하지 않는다. 나중에 독립 worker·scheduled job·대규모
   backlog가 실제 요구로 승인될 때만 JobRuntime adapter PoC를 시작한다.

## 7. 승인할 구현 경계 (코드 변경 전 제안)

### 7.1 Additive schema와 상태 모델

현재 migration 063 뒤에 **새 ordered additive migration**을 추가한다. 기존 migration은
수정하지 않는다. 제안 테이블은 다음 의미만 저장한다.

- `connector.dedup_records`: `(consumer_id, semantic_key)` unique, request fingerprint,
  state, result reference/digest, safe error, timestamps, retention
- `connector.jobs` 및 `connector.job_attempts`: queued/running/retryable/terminal/
  dead-letter/unknown에 필요한 attempt, next-at, lease owner/token, fencing token,
  ack/result reference
- `connector.dead_letters` 및 `connector.replays`: safe envelope reference, failure
  code, authorization actor/scope, replay reason/result
- `connector.ordering_checkpoints`: consumer + ordering key별 sequence와 fence

실제 이름·column은 Port 계약과 migration preflight 후 확정한다. protected raw payload는
무조건 저장하지 않고 승인된 encrypted replay payload 또는 canonical resource
reference+digest만 저장한다. project/tenant/security scope를 모든 unique/read/claim
조건에 포함한다.

### 7.2 처리 불변식

- 같은 semantic key + 같은 fingerprint만 동일 결과를 조회한다. fingerprint가 다르면
  `CONFLICT`로 fail closed한다.
- claim은 한 transaction에서 lease와 fencing token을 원자적으로 획득한다. stale
  worker의 complete/fail/renew는 fence mismatch로 무효화한다.
- handler success를 기록한 뒤 ack한다. success 기록 전 crash는 retryable로 남기고,
  ack/commit 결과가 불명확하면 `OUTCOME_UNKNOWN`으로 남긴다.
- timeout은 `Promise.race`의 예외일 뿐 handler cancellation의 증거가 아니다. dedup
  row를 삭제하지 않고 unknown tombstone을 만들며, 동일 key는 handler를 다시 호출하지
  않는다.
- unknown → completed/failed/manual-retryable 전이는 reconciliation만 수행한다.
  시간 경과나 단순 process restart로 provider/action을 재호출하지 않는다.
- ordering commit은 handler 성공과 같은 durable fence 경계 뒤에만 수행한다.
- DLQ replay는 명시적 authorization과 동일 route/fingerprint 검증 후 수행하고, unknown
  semantic key에는 자동 replay를 허용하지 않는다.

### 7.3 Production wiring과 lifecycle

- `ConnectorRuntime`과 `ShotgunKernel` 생성자는 infrastructure-neutral Port 묶음을
  선택적으로 주입받고, 기본값은 test용 InMemory로 제한한다.
- `createApplicationCore`의 production PostgreSQL 조립부가 새 adapter를 명시적으로
  주입한다. recovery/test harness는 의도적으로 InMemory 또는 fake adapter를 명시한다.
- persistent claim/recovery/renew loop는 기존 `AsyncCleanupStack`에 등록한다. start
  실패 시 이미 열린 pool/loop를 정리하고, shutdown은 bounded grace를 지키며 running
  handler를 business failure로 재기록하지 않는다.
- Canonical Outbox, Evidence continuation, Discovery/Ask durable state는 각각의 기존
  owner/Port를 유지한다. Connector migration이 그들의 상태를 backfill하거나 global
  queue로 흡수하지 않는다.

## 8. 구현 순서와 중복 방지

| 순서 | 작업                                                       | 산출물                                                   | 중복 방지 경계                                          |
| ---: | ---------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
|    0 | 이 inventory/OSS gate를 GPT가 검토                         | 본 문서와 승인 comment                                   | 승인 전 source/schema 변경 금지                         |
|    1 | Connector Port와 domain-neutral state/result contract 정의 | `packages/connector-runtime` Port/types                  | 기존 module/Canonical Port 재정의 금지                  |
|    2 | additive migration 및 PostgreSQL adapter 구현              | `adapters/connector-runtime-postgres`, ordered migration | pg-boss/Graphile schema 반입 금지                       |
|    3 | Dedup·Job·Ordering·DLQ를 runtime에 주입                    | `runtime.ts`, `kernel/src/index.ts`                      | handler·module business logic 변경 금지                 |
|    4 | timeout/ack-loss/unknown reconciliation 구현               | durable tombstone와 recovery API                         | RIC-N5 readiness는 WP-08에서만 변경                     |
|    5 | production wiring/lifecycle                                | `server.ts`/application cleanup                          | WP-03 worker shutdown 구현과 contract 공유, 재작성 금지 |
|    6 | focused contract/database/integration/replacement test     | WP-05 test evidence                                      | 기존 WP-04 tests 복제 금지                              |
|    7 | migration/rollback rehearsal 및 exact-head CI              | 기록·runbook·PR                                          | unresolved durable row에서 memory rollback 금지         |

## 9. 검증 매트릭스

### 9.1 필수 시나리오

- restart-safe dedup: completed, running, retryable, DLQ, unknown row가 process restart
  뒤에도 동일 fingerprint 결과와 상태를 유지한다.
- two-worker/fence: 두 PostgreSQL connection이 같은 key를 claim해도 handler 1회,
  stale owner의 complete/renew 0회 성공이다.
- retry/backoff: retryable failure만 policy 범위에서 재시도하고, terminal/unknown은
  자동 재시도하지 않는다.
- DLQ/replay: safe envelope reference와 authorization이 없으면 replay를 거부하고,
  승인된 replay는 동일 semantic key에 중복 side effect를 만들지 않는다.
- timeout/ack-loss: handler가 늦게 완료해도 unknown row가 사라지지 않고 replacement
  handler 호출이 0회다. 결과가 오면 fencing 규칙으로 reconcile한다.
- crash-after-success-before-ack: durable success가 있으면 재시작 후 duplicate
  delivery로 반환한다.
- ordering: 같은 key는 FIFO/strict sequence, 다른 key는 병렬, lease recovery 후
  checkpoint가 역행하지 않는다.
- project/tenant/security: cross-project key 조회·DLQ read·replay가 모두 거부된다.
- lifecycle: startup failure/normal shutdown/cancellation에서 loop·pool·timer·lease
  renewal orphan이 0건이다.

### 9.2 Gate 명령과 증거

구현 후 exact SHA에서 최소 다음을 실행한다.

```text
npm run lint
npm run typecheck
npx vitest run tests/contract/connector.contract.test.ts <WP-05 focused contract tests>
npx vitest run <WP-05 focused database/integration tests> --maxWorkers=1
npm run docs:validate -- all
npm run oss:verify
npm run secret:scan
```

PostgreSQL 실제 2-connection fault injection, migration apply/reset/verify, backup/restore
및 replacement contract 증거를 별도로 남긴다. 실 provider/action은 호출하지 않고
deterministic fake와 fault-injection adapter를 사용한다.

## 10. Migration·rollout·rollback

1. migration은 additive로 적용하고 preflight에서 기존 runtime schema와 migration
   version을 확인한다.
2. 기존 InMemory worker를 먼저 drain하고, 새 durable adapter가 정상 claim/reconcile
   하는지 canary에서 확인한 뒤 신규 요청의 authority를 전환한다.
3. 과거 InMemory completed/running Map은 신뢰성 있게 backfill할 수 없다. 따라서
   backfill을 하지 않고 cutover 시점과 제한을 운영 기록에 남긴다.
4. rollout 중 durable row가 하나라도 unresolved이면 InMemory로 되돌리지 않는다.
   worker를 중지하고 durable row를 reconciliation/forward-fix한 뒤 adapter를 교체한다.
5. rollback은 (a) migration이 적용됐지만 adapter가 활성화되지 않은 경우의 code
   rollback, (b) durable adapter 활성 후의 forward-fix/reconcile을 구분한다. `DROP TABLE`
   또는 data-destructive rollback은 허용하지 않는다.
6. backup/restore는 connector schema와 safe reference digest를 포함해 검증하며,
   protected payload/credential/raw provider response를 일반 backup manifest나 로그에
   노출하지 않는다.

## 11. GPT에 검토 요청할 결정사항

다음 결론이 Issue #175의 의도와 일치하는지 확인을 요청한다.

- PostgreSQL 16.14 기존 기반을 `ADOPT`하고, 새 Shotgun-owned Port/adapter/schema로
  RIC-N3/RIC-N4를 해결한다.
- pg-boss(Canonical/Stage-6 historical baseline 12.26.0; current registry-reviewed
  pin 12.28.1)와 Graphile Worker 0.17.3은 기능 참고 후 `DEFER`하며 이번 WP-05에
  설치·schema·worker를 추가하지 않는다.
- gbrain Minion pinned commit은 `REFERENCE_ONLY`로 lock/retry/recovery acceptance
  criteria만 재사용한다.
- 위 최소 Port 경계가 확인되면, GPT의 별도 승인 대기 없이 WP-05 구현으로 연속 진행한다.
  반대로 Port 경계를 바꾸거나 OSS queue authority를 도입해야 한다면 즉시 중단하고
  새 계약 검토를 요청한다.
