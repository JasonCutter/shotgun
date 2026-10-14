# Exact Canonical owner — 정상 Fake 흐름과 재기동 검증

- Record: `VP-CANONICAL-OWNER-NORMAL-FAKE-20261014`
- Product subject: main `85e3a88a3be010c047fe32d6b917bcef70635837`, tree `678640b5b7aae147f32edd736440475461292f37`
- Result: **ISOLATED_OWNER_NORMAL_FAKE_RESTART_PASS**. 운영 설치 및 VP 최종 인수 완료 아님
- Authority: [전체 연속 실행 지시](./execution-directive.md), ADR-167/172/173의 기존 실행·원장·보안 경계
- 운영 변경 / 실제 AI 호출 / 동결 재채점: **0 / 0 / 0**

## 1. 기존 검증과 새로 닫은 간극

기존 [distribution proof](./reliability-application-distribution-proof.md)는 synthetic origin/main에서 실제 recovery application의 런처 및 별도 normal-worker HTTP 여정을 검증했다. PR #386 이후 fresh GitHub clone의 exact main에서 같은 두 경로를 각각 실행한 증거도 재사용했다. 그러나 **한 actual owner entry 아래에서 normal application이 A/B/A 수정본과 질문을 처리한 후 같은 DB를 유지한 채 재시작**하는 조합은 아직 입증하지 않았다.

이번에는 fresh clone의 변경하지 않은 `scripts/launch-local.ts`를 실행했다. 기존 Canonical preflight → SPA build → schema verify → T3 startup recovery → normal `runtime-development` assembly → 정상 Source/Ask/relation worker를 통과했다. `runLaunch`, supervisor, application factory를 가짜 함수로 대체하지 않았다.

단, 런처 root의 **untracked test fixture 두 개**를 사용하고 각 실제 앱 자식에서 DeepSeek adapter method를 기존 Fake adapter로 메모리 교체했다. 따라서 이를 injection 없는 운영 실행이나 운영 설치본으로 부르지 않는다. 이전 standalone journey의 untracked Vitest entry도 clone에 보존돼 있지만 이번 owner 실행에는 사용하지 않았다.

## 2. 격리와 실제 입력 경로

- Fresh own clone: `C:/dev/artifacts/vp-full-completion-2026-10-12/canonical-pr386-85e3a88-exact-install`. 실행 전/각 owner 시작/실행 후 HEAD, branch main, remote main 및 tracked/index clean 검사.
- Own PostgreSQL container: `e2904dccdfe5ada0d224efbea46486ab185242258cb54efaf7eda5457910dd2e`, volume `1a55beb0c18fc5f6fa948b6c3fa46a2e1fbee984f841d67506311a9e2c6cd21d`. 기존 guarded Docker PG bridge의 container/volume/role/port/namespace 검사를 재사용.
- 새 `shotgun_test_iso_*` 제품 DB와 별도 authority DB만 migration 138까지 생성. Workload의 `authority_store`는 0행이며 fallback으로 쓰지 않았다. 운영 authority가 아니다.
- OS/PATH/npm/Git/test의 명시적 env 목록과 exact 합성 app 값만 자식에게 전달. `.env/.env.test` 없음, host AI key 없음, 전역 환경 변수 변경 없음. Vault와 enabled standing policy는 새 test DB의 합성 credential 전용이며 운영 Vault/policy와 별개다.
- Preload는 actual launcher runtime child에서 adapter 생성 전에 Fake method와 loopback-only fetch를 설치한다. Npm build/db verify 자식에는 Fake module patch를 적용하지 않는다. 합성 key 일치, exact source SHA, 서로 다른 isolated DB, Fake call cap 18을 fail closed로 검사한다.
- HTTP driver는 실제 loopback socket으로 session/bootstrap, staging, submission, Ask, historical GET을 호출한다. Fastify.inject 또는 수동 worker claim을 사용하지 않았다. 기존 owner membership을 서버가 자동 선택했으며 explicit active-project POST는 **0회**다.
- 앱은 정상 profile이며 이미지 격리 capability를 주입하지 않았다. 이미지 runtime OFF를 유지한다.

## 3. 실제 관측 결과 — run2

| 항목                                                     | 결과                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 실제 HTTP requests                                       | 47                                                                                          |
| 자료 처리                                                | A v1, B v1, A v2의 submission 3개; 서로 다른 자료 2개                                       |
| 질문                                                     | 3개, 같은 AnswerRun의 정상 worker 완료를 대기                                               |
| 개별 지식 review/approval, project 선택, Ask Source 선택 | 0 / 0 / 0                                                                                   |
| Fake structured calls                                    | extraction 3, answer 3, relation 1; 총 7                                                    |
| 실제 provider / billing                                  | 0 / 미측정                                                                                  |
| Owner / runtime child generations                        | 2 / 3                                                                                       |
| Global relation claim / unresolved reservation           | 1 / 0                                                                                       |
| Child 재시작 후 identity                                 | owner PID·nonce·SHA·ready identity 동일                                                     |
| Owner 사망 후 다시 invocation                            | 새 owner PID/nonce, 같은 exact main                                                         |
| 완료된 provider 호출 반복                                | 0; 모든 Fake call은 첫 runtime child에서만 발생                                             |
| Historical AnswerRun                                     | 원문·citation·capability 동일, A v1 답변 stale=true                                         |
| Current AnswerRun                                        | A v2와 B 인용, A v1 제외, stale=false                                                       |
| 저장 데이터 비교                                         | AnswerRun, statement, citation, Ask attempt, relation receipt의 전체 row snapshot 비교 PASS |
| 종료/정리                                                | owned owner/child 모두 종료, 두 격리 DB 삭제, runtime.json 제거, cleanupErrors=[]           |

Source 수정은 기존 명시적 material identity인 source ID를 유지하는 API로 수행했다. 이 검증은 다른 Source를 Ask context로 수동 선택하거나 질문의 Source 목록을 지정한 것이 아니다. 파일명만으로 수정 identity를 추정하는 새 정책도 도입하지 않았다.

Observed authority store ID: `139b6ef7-3573-44c2-ba6e-e146ffe90f1f`; authority ID: `1983e355-ebdb-454a-abdc-f788221f76fb`; 합성 credential fingerprint: `0a6c3162c5bf2a0521bf693d986d1b4bce69a17f76854caa7818e5bf44057732`.

기존 relation call row와 전역 claim의 job/semantic attempt/execution key/provider identity를 실제 SQL로 대조했다. Claim은 execution fence가 있는 PROVIDER_SUCCEEDED이며 local receipt와 1:1이다. 비교 snapshot digest는 `aaf23e1957a24d30df8d35807ba70773ddff9f9301bbe39b091b76ec9be783e5`다. **원본 SQL rows는 DB 정리 후 별도로 보존하지 않았다.** 독립적으로 다시 조회 가능한 보존 DB가 아니라 fixture의 equality assertions, digest, 결과와 trace를 증거로 제공한다. Claim/job/attempt의 개별 UUID를 결과 JSON에 새로 복원해 적지 않는다.

## 4. 종료 주입 및 증거의 한계

1. 모든 질문과 relation job이 terminal인 뒤 owned runtime child의 명령행·부모 PID를 Windows CIM으로 검증하고 그 PID만 종료했다. 실제 supervisor가 새 child를 시작했다. 완료된 rows와 Fake calls는 바뀌지 않았다.
2. 테스트가 spawn한 owner handle을 abrupt kill했다. Child의 IPC disconnect에 따른 종료를 확인한 뒤 driver가 기존 실제 owner entry를 다시 invocation했다. 기존 dead identity 정리와 새 nonce 획득을 확인했다.
3. 마지막 종료는 test IPC가 `process.emit('SIGTERM')`을 호출해 **기존 signal handler 코드**를 실행했다. Windows가 실제 OS signal을 전달한 시험 또는 Windows reboot가 아니다.

Parent owner를 driver가 다시 실행한 것은 parent 자체의 자동 부활 증거가 아니다. Desktop shortcut, OS startup/scheduler, Windows reboot, 운영 worker cutover, 실제 production authority의 전환과 복구는 별도 미완료다. 이번 종료 주입은 completed 작업 이후이며 in-flight UNKNOWN/ACK 손실 coverage를 이 결과로 대체하지 않는다. 해당 상황은 기존 P0/worker/PG 및 supervisor Gates의 좁은 증거로 재사용한다.

HTTP flow는 browser 화면의 클릭/visual UX 시험이 아니다. Fake confidence/RELATED 선택, 정상 invocation, stored SourceVersion 연결과 source scope를 실제 AI 의미 정답·청구 대사·calibration 또는 신규 Gold로 인증하지 않는다. V6·0.9와 Ledger/Evidence/SourceVersion 및 기존 의미 policy bytes는 변경하지 않았다.

## 5. 실패 이력과 보정

Run1은 실제 main owner의 build/schema/app startup까지 성공했지만, fixture가 `/health.status`를 `READY`로 잘못 기대해 최초 health assertion에서 FAIL했다. 실제 `packages/kernel/src/index.ts`의 `Kernel.health()` 계약은 `ok/starting`이며 launcher identity는 `ready/starting`이다. Run1의 Fake calls는 **0**, owned children 종료와 격리 DB 삭제는 성공했다.

보정은 fixture의 expected literal과 설명에 한정한다. Assertion을 삭제하거나 arbitrary status를 허용하지 않았다. Production health/launcher 코드는 변경하지 않았다. Run1 raw log/result 및 당시 driver/runner source를 보존했으며 PASS로 재명명하지 않는다. Run2는 새 test DB 및 별도 result/log에 기록했다.

실행 전 typecheck에서 발견한 `ForkOptions.windowsHide`의 부정확한 타입 사용과 ESLint `no-unsafe-finally`도 test fixture에서 보정했다. Environment whitelist, IPC disconnect, owned process identity 및 실패 readback을 independent Sol 검토 후 보완했다. 최초 reviewer의 수동 project 선택 제안은 기존 deterministic owner membership 계약을 확인하고 제외했고, 실제 run2에서 자동 선택을 검증했다.

## 6. 재사용·검증·보존

새 launcher/supervisor/installer나 운영 프레임워크를 만들지 않았다. ADR-167의 기존 NO_RELEVANT_OSS/PM2 REJECT/gbrain REFERENCE_ONLY 경계를 재사용한다. Node built-in process/HTTP/filesystem, 기존 Git/npm, existing isolated PG helper, Vault/configuration/standing services와 Fake adapter를 verification fixture에서 사용했다. Npm/package/lockfile/runtime dependency 및 OSS Role Matrix의 채택 상태 변경은 없다. 새 migration도 없다.

Exact executed fixture SHA-256:

- Driver: `82bbe086bac141abab0559a64aa38a5a754b9ed79edfd217b58fd1dff77eb3d5`.
- Preload: `259f2e9bf9b177976348e2a191bb3fe73bb45bc0760cdc7491bb7a832e7d7805`.

Root typecheck, focused fixture ESLint와 Prettier가 통과했다. 기존 main CI38525754140과 prior launcher55, 정상 제품/권한/WAITING/UNKNOWN 검증은 변경하지 않은 product bytes의 증거로 재사용한다. 이번 run2 실제 owner proof는 별도 로컬 증거이며 main CI에서 실행된 것으로 표시하지 않는다. 관련 문서/manifest의 검증 결과는 게시 증거에서 구분한다.

보존 확인: 보호 파일 79개, 다른 worktree 13개 HEAD/status, configuration bytes, stash 동일. 두 보호 운영 컨테이너는 기존 ID/mount로 exited다. Gold-B-7과 동결72/432/B12/B 잔여24는 hash-only 보존 확인 외 읽기/재실행을 하지 않았다. 전체 host quiescence를 주장하지 않는다.

[증거 manifest](./canonical-owner-fake-manifest.json)는 result/trace/log/source copy 및 보존 proof의 exact 외부 위치와 bytes/digest를 기록한다. 새 fixture 두 개와 보고서는 merge 전 local candidate이며 기존 main의 source identity와 혼동하지 않는다. Rollback은 verification fixture/기록을 제외하는 것으로 충분하고, 운영 schema·데이터·정책의 rollback은 필요 없다.

**현재 상태: VP_FULL_IMPLEMENTATION_IN_PROGRESS / VP_FINAL_ACCEPTANCE_NOT_COMPLETE.** 이 정상 owner Fake gap은 닫혔지만 외부 Reference의 Shotgun 의미 검증, 실제 AI/비용/규모/Frontier/calibration, 허가된 operating install/reboot와 최종 release 인수 조건은 남는다.
