# VP-07 Runtime 재기동 감독 구현·검증

**기록일:** 2026-10-01
**상태:** 구현, 실제 격리 PostgreSQL 연결 장애와 PostgreSQL 서버 재기동 검증 통과; Job 데이터 수렴 및 운영 복구 Gate 미완료

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

검증 명령: `VP_RUNTIME_POSTGRES_CONTAINER_RESTART=1 npx vitest run tests/integration/vp-runtime-postgres-server-restart.live.test.ts --reporter=verbose` (Windows PowerShell 환경 변수 방식으로 실행), 1 test passed.

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

1. 기존 Source/미완료 Job이 있는 동안 장애를 만들어 중복·손실 없음, Job 자동 수렴, 답변 인용·projection watermark를 확인한다.
2. 실제 환경에서 database backup→clean restore, cutover, rollback 연습을 완료한다.
3. owner launcher가 강제 종료된 상황 및 Windows 재부팅 후 아이콘 시작 정책을 검증한다. 이 구현은 owner가 살아 있을 때의 child 복구만 보장한다.

항목 1~4가 통과하거나 사용자와 명시적으로 범위를 재결정하기 전까지 VP-07과 VP 전체는 미완료다.
