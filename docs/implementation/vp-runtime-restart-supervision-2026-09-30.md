# VP-07 Runtime 재기동 감독 구현·검증

**기록일:** 2026-10-01
**상태:** 구현, 실제 격리 PostgreSQL 연결 장애·서버 재기동과 Shotgun owner Runtime의 provider 응답 불명확 Job 복구 검증 통과; 전체 Job 수렴 및 운영 복구 Gate 미완료

## 범위

기존 `npm run launch`는 application composition과 Runtime identity를 같은 Node 프로세스에서 소유했다. PostgreSQL 연결 손실 뒤 application이 fail-stop 하면 launcher까지 종료돼 사람이 바탕화면 아이콘을 다시 눌러야 했다. 이 변경은 owner launcher와 application child를 분리해, owner가 살아 있는 동안 application child를 재기동한다.

- Parent `launch-local.ts`가 기존 `runtime.json` PID/nonce identity를 단독 소유한다.
- Child는 기존 `runLaunch`를 사용한다. 환경·SPA·DB/schema·T3 recovery·application·HTTP/SPA readiness 경계를 그대로 통과해야 `ready` IPC를 보낸다.
- Parent는 `ready`를 받은 뒤 runtime phase를 `ready`로 바꾸고 브라우저를 한 번만 연다.
- Child가 startup 중 일시 DB/network 문제로 실패하거나, 준비된 뒤 예기치 않게 종료되면 parent가 identity를 `starting`으로 내리고 1, 2, 4, 8, 16, 최대 30초 간격으로 child를 재시작한다.
- 잘못된 환경, schema 불일치, 사용 중인 port, SPA build/asset 실패는 terminal 오류로 보여 주고 자동 재시작하지 않는다.
- SIGINT/SIGTERM은 child를 graceful shutdown한 뒤 parent identity를 지운다. Parent IPC가 끊기면 child는 자기 서버를 종료한다.

Supervisor는 Product DB에 쓰지 않는다. 실제 장애 시험은 guarded `shotgun_test_iso_*` 임시 DB와 로컬 TCP proxy를 사용했다. 정상 app child를 시작한 뒤 DB 연결을 끊어 PostgreSQL 유지보수 세션 단절로 child가 종료되는 것을 확인했다. 연결이 차단된 동안 새 child가 `DATABASE_UNAVAILABLE`로 시작 실패하고 bounded retry에 들어갔으며, 연결 복구 뒤 child가 다시 HTTP/SPA readiness를 통과했다. 임시 DB는 시험 후 삭제했다. 이 시험에는 사용자 Source/Job이 없었으므로 미완료 Job의 실제 worker lease/readback 수렴은 확인하지 않았다. PostgreSQL 컨테이너 자체의 재시작, OS 재부팅·owner parent crash 후 자동 기동도 검증하지 않았다.

### 2026-10-01 실제 PostgreSQL 서버 재기동

고정된 `compose.yaml` PostgreSQL 이미지와 임시 loopback 포트로 disposable container/DB를 만들었다. 앱을 실제 child process로 시작한 뒤 컨테이너를 중지·재시작했다. PostgreSQL이 끊기자 maintenance lock 유실 경로가 앱 child를 fail-stop 했고, parent supervisor가 앱을 다시 시작했다. 컨테이너 재시작 뒤 같은 host port에서 PostgreSQL readiness를 확인한 다음, 새 child가 같은 local-owner session으로 저장된 프로젝트를 `/api/v1/projects` API에서 읽고, DB 직접 조회에서도 `pg_postmaster_start_time()`이 변경되고 프로젝트 row가 그대로 있음을 검증했다. 실제 실행은 23초였고, 격리 DB/container는 finally 경로에서 제거했다.

장애 중 `pg` pool이 내보내는 idle-client `error` 이벤트가 미처리 Node.js 예외가 되지 않도록 `createPostgresPool`에 listener를 추가했다. 실제 재기동 시험에서 두 `57P01` 이벤트가 기록됐고 `Unhandled 'error' event`는 발생하지 않았다. 런타임의 유지보수 잠금 세션 유실은 기존 fail-stop 정책대로 앱 child를 종료하며, 복구는 같은 Pool의 in-place 연결 회복이 아니라 감독된 app child 교체로 이뤄진다. 이 시험은 사용자 Source나 미완료 relation/ask Job을 포함하지 않아 Job 중복·손실 및 ledger 수렴은 아직 증명하지 않는다.

### 2026-10-01 실제 VP owner Runtime의 불명확 결과 복구

`tests/database/vp-relation-priority.database.test.ts`의 isolated PostgreSQL 장애 주입은 test harness가 띄운 실제 VP relation Worker child process를 local HTTP provider stub의 성공 응답 직후 종료했다. lease가 만료된 같은 Source pair를 대상으로 `startShotgunApplication`의 정상 `runtime-test` application composition을 새로 시작했다. 앱 `/health`가 200을 반환했고, owner composition의 VP relation worker가 provider-call과 Job을 `OUTCOME_UNKNOWN`으로 수렴했다. local HTTP stub은 첫 요청만 받았고 재시도 요청은 없었다. Projection replay는 queue settled / incomplete, unknown Job 1건으로 일치했다. 호출 결과를 Shotgun이 저장하기 전에 프로세스가 종료된 경우에는 결과를 복원할 수 없으므로, provider를 다시 호출하는 대신 미해결 상태를 보존하는 것이 의도한 안전 동작이다.

이 시험은 synthetic local HTTP response, disposable PostgreSQL database, fresh owner `startShotgunApplication` 구성을 사용했으며 실제 DeepSeek 청구는 발생시키지 않았다. 설치된 application/launcher 프로세스 자체를 종료한 시험은 아니다. DB 서버 중단과 provider 요청이 겹치는 경우, 실제 provider 청구 대사, 설치 launcher 강제 종료와 Windows 재부팅은 이 시험으로 입증되지 않는다.

검증 명령: `VP_RUNTIME_POSTGRES_CONTAINER_RESTART=1 npx vitest run tests/integration/vp-runtime-postgres-server-restart.live.test.ts --reporter=verbose` (Windows PowerShell 환경 변수 방식으로 실행), 1 test passed.

### 2026-10-02 PostgreSQL outage 중 Provider 응답 복구

VP relation Job의 Worker child가 pinned PostgreSQL 16 컨테이너 및 격리
`shotgun_test` DB를 사용했다. Worker가 Job과 Provider call을 `RUNNING`으로
기록하고 local HTTP Provider에 요청한 뒤 PostgreSQL 컨테이너를 중지했다.
컨테이너가 중지된 상태에서 Worker가 `EQUIVALENT` 결정 JSON HTTP 200 응답을
수신했음을 IPC로 확인했다. DB 연결이 복구되지 않은 동안 출력 저장 시도는
실패했고, Worker child를 종료했다. PostgreSQL을 같은 고정 loopback 포트에서
다시 시작해 결과 출력이 아직 `NULL`, Job/Provider call이 여전히 `RUNNING`인
것을 읽었다. 테스트는 lease 만료 시각을 과거로 당겨 2분 만료 대기를
축약했다. 이어 새 `startShotgunApplication` owner composition이 `/health`
200을 반환하고 relation worker가 두 원장 행을 모두 `OUTCOME_UNKNOWN`으로
수렴하는 것을 확인했다. 응답 저장이나 재호출 없이 Provider HTTP 응답은
한 번뿐이었고, replay는 queue settled/incomplete와 unknown Job 1건을
보고했으며 Relation은 기록되지 않았다.

실행 명령: Windows PowerShell에서
`$env:VP_RELATION_POSTGRES_OUTAGE_TEST='1'; node --env-file-if-exists=.env --env-file-if-exists=.env.test node_modules/vitest/vitest.mjs run tests/database/vp-relation-priority.database.test.ts -t "keeps a data-bearing provider result" --maxWorkers=1 --fileParallelism=false --testTimeout=300000 --hookTimeout=300000 --reporter=verbose`.
집중 시험은 1/1 통과했다. 기본 PostgreSQL relation suite는 10개 통과,
2개 조건부 시험 건너뜀으로 끝났다. 조건부 중 이 outage 시험은 별도 실행해
1/1 통과했다.

OSS 경계는 `compose.yaml`의 pinned
`pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`
이미지(PostgreSQL 16.15, pgvector 0.8.6)와 Shotgun 소유
`VPRelationJobStorePort`를 그대로 사용한다. `oss-source-registry.json`은 이
digest 및 `REL_16_15`의 `pg_trgm` source commit으로 갱신했다. 관계 원장·Provider call 의미는
Shotgun 소유다. Integration decision은 기존 PostgreSQL `ADOPT`/`AUGMENT`
결정에 포함되며 추가 OSS runtime, package, schema, production behavior는
없다. 시험 rollback은 helper와 gated test 제거다.

이 시험은 DeepSeek 실 API 호출·청구가 아니라 synthetic local HTTP 응답이며,
2분 lease 만료 대기와 설치된 Windows launcher/아이콘 재기동을 생략한다.
따라서 장애 중 응답 저장 실패 뒤 원장 수렴의 한 경로를 닫았고, VP-07 전체는
아직 완료되지 않았다. 설치 프로세스 강제 종료·Windows 재부팅, 배포
cutover/rollback, 실청구 대사와 UI 복구 상태는 남아 있다.

## OSS 결정

| 대상                         | 검토 결과                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js `child_process.fork` | 기존 로컬 Node runtime의 표준 API를 사용한다. 설치 package·lockfile 변경이 없으며 Shotgun parent가 유일한 identity owner다. 로컬 검증 런타임은 `v24.15.0`, MIT다.                                                                     |
| PM2                          | `v7.0.4`, commit `cd6b1b4c592117212d7349d6932288613f336c15`, AGPL-3.0을 검토하고 제외했다. 별도 daemon/process identity authority를 추가하고 Windows startup hook에 추가 package가 필요하다. Production dependency로 설치하지 않았다. |
| gbrain Minion                | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT의 Job retry·lease recovery 패턴만 참고한다. Desktop application process를 소유·감독하는 기능은 이 문제의 대안이 아니다.                                                               |

세부 source, integration decision, 보안·교체·rollback 기록은 [ADR-167](../architecture/adr/ADR-167-canonical-desktop-launcher-repository-and-runtime-identity.md#2026-09-30--vp-07-supervised-application-restart), [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md#11-vp-07-로컬-runtime-재기동), [OSS Source Registry](./oss-source-registry.json)에 고정했다. Node API 공식 문서: [Child processes](https://nodejs.org/api/child_process.html). PM2 검토 자료: [공식 저장소](https://github.com/Unitech/pm2), [v7.0.4 commit](https://github.com/Unitech/pm2/commit/cd6b1b4c592117212d7349d6932288613f336c15), [Windows startup hook](https://doc.pm2.io/en/runtime/guide/startup-hook/).

## 검증 결과

- Supervisor unit state machine: transient DB startup retry, 1→2초 backoff, ready/start phase 전환, terminal schema 오류 즉시 중단, 브라우저 1회 실행, ready 후 crash/recovery를 확인했다.
- 실제 Node child process IPC 통합: 자식이 DB 장애를 보고하며 종료한 다음 새 child가 readiness를 보내고, parent shutdown 메시지에서 종료하는 것을 확인했다.
- 실제 app + 격리 PostgreSQL 장애 주입: active DB session 단절→app child fail-stop→DB offline 중 startup 실패·retry→연결 복원→app readiness 재확인을 통과했다. 별도 MCP/browser full product flow는 실행하지 않았고, 데이터 원장 수렴은 이 시험 범위 밖이다.
- 기존 launcher contract/repository suite: canonical identity 포함 29 tests와 launch core 22 tests 통과.
- ESLint: 변경 런처와 검증 파일 통과.
- 전체 TypeScript 검사: 이 변경 파일에서 오류가 없으나 저장소 전체는 기존 미완성 `tests/contract/ts7-cross-section-acceptance.contract.test.ts`의 없는 export/오래된 타입 및 기존 VP general-AI test의 타입 불일치로 실패했다. 이는 이번 런처 코드와 무관하게 확인된 기존 blocker다.

## VP-07에 남은 검증

1. Provider 응답 불명확 Job 및 PostgreSQL outage와 겹친 data-bearing Provider 응답의 owner Runtime 재시작 수렴과 중복 요청 방지는 통과했다. 실제 Provider 청구 대사, 사용자 답변 인용·projection watermark의 outage 뒤 동작은 추가 확인한다.
2. 실제 환경에서 database backup→clean restore, cutover, rollback 연습을 완료한다.
3. owner launcher가 강제 종료된 상황 및 Windows 재부팅 후 아이콘 시작 정책을 검증한다. 이 구현은 owner가 살아 있을 때의 child 복구만 보장한다.

항목 1~4가 통과하거나 사용자와 명시적으로 범위를 재결정하기 전까지 VP-07과 VP 전체는 미완료다.
