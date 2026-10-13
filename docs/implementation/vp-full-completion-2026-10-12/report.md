# VP 전체 연속 구현 — 통합 checkpoint

작성 2026-10-13 KST. 기준 `main@aba6ff27f9620ee1a3f408f8df81e8aad21cc584`.
상태: **LOCAL_PRODUCT_FUNCTIONAL_PASS / VP_FULL_IMPLEMENTATION_IN_PROGRESS /
VP_FINAL_ACCEPTANCE_NOT_COMPLETE**.

## 구현과 실제 제품 경로

- A3의 native v6/v11·tuple/warrant·복수 해석·raw/adoption·N/A 계약과
  prospective execution accounting을 오프라인 package로 구현했다.
  supplied provenance의 구조 검사는 외부 인간/실청구의 진위 인증이 아니다.
- known stale AnswerRun failure와 동일 run QUEUED를 원자적으로 저장한다.
  최신 Source 처리 readiness 후 자동 실행하며 UNKNOWN은 재호출하지 않는다.
- URL 갱신은 기존 Source Write 도메인·owner/standing resolver·sealed staging·
  command gateway·normal submission으로 실행한다. immutable receipt 및 원본을
  유지하고 version CAS와 readback을 사용한다. HTML URL/UTF8 경계를 추가했다.
- Frontier는 local bounded posting/topK20, exact ACL partition, snapshot/config/
  policy 및 full membership digest를 기록한다. normal worker는 FRONTIER이고
  discovery는 global authority 부재/소진과 분리된 unpaid operation이다.
  지식·결정·예산 권위를 우회하지 않는다. recall은 UNVERIFIED다.
- public/internal도 final adapter eligibility를 통과해야 한다. 잘못된 image
  descriptor와 unknown backup integrity profile은 안전하게 거부한다.
- 기존 backup owner를 재사용하고 새 profile에서 VP/Sources/Ask/config/
  global execution/journal의 측정 범위를 확대했다. 역사 profile 부재는
  legacy-v1로 읽으며 동일한 범위로 복원한다.

구현 이유·OSS pin/license·제외 대안·rollback은
[선택 통합 결정](./integration-decisions.md),
[Frontier 독립 검토](./frontier-audit.md),
[보안/백업 독립 검토](./reliability-security-backup-review.md)에 기록했다.
새 production knowledge authority, 모델/SSC/v11 활성화 또는 prompt tuning은 없다.

## Actual application 및 브라우저

actual application·worker·PostgreSQL·instrumented Fake Provider 인수 **14 PASS**:
A→질문→B→A 수정→최신 질문, 과거 AnswerRun 불변/stale, Conversation/Branch/
Workspace 정합성, 프로젝트/민감도 차단, 권위 오류500, v6 claim/job/attempt,
충돌/조건 source quote 보존, 실패/부족, in-flight stale 및 pending same-run
자동 회복, HTML URL refresh와 정상 command completion/최신 citation.

별도 실제 SPA Chromium 여정도 PASS했다. 빈 SourceVersion state에서 자료3회,
질문3회, Project 선택0, Ask Source 선택0, 지식 검토/승인0이었다. 명시적
material revision intake로 A의 Source ID를 유지했고 새 인용에서 v1을 제외했다.
과거 answer/citations는 동일하며 stale=true다. filename만으로 원본을 자동
병합하는 동작을 추가하거나 입증하지 않았다. 외부 browser request0이다.
기존 HFM 전역 conversation pane 배치 계약을 적용했다.

Fake Provider의 응답·인용 기능 PASS는 실제 DeepSeek 의미 정확성 인증이 아니다.
v6/0.9와 실제 운영 worker-OFF를 유지하고 실제 AI 호출은 0이다.

## 검증 증거

| Gate                          | 관측 결과                                                                         | 정확한 한계                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 전체 unit/contract            | 255 files, 2,217 PASS                                                             | 추가 accounting8 및 URL checkpoint 보정 unit17은 후속 focused PASS; exact-head CI가 최종 통합 결과               |
| Frontend                      | 50 files, 395 PASS; build 및 root/web typecheck PASS                              | build의 기존 large chunk 경고 유지; 설치본/Windows reboot 인증 아님                                              |
| A3/accounting                 | 24+8=32 PASS                                                                      | synthetic only; 새 Gold0, 실제 billing/latency N/A                                                               |
| Frontier                      | unit5 + PG7 PASS                                                                  | same-process independent connections와 OS process 검증을 혼동하지 않음; semantic recall 미인증                   |
| Global execution              | boundary12 + OS crash2 + authority10 PASS                                         | fake-only isolated PG. 예산/credential/one-use/UNKNOWN/ACK/UTC/cross-workload/process                            |
| Sources recovery              | PG4 PASS                                                                          | 동일 version·자동 완료·불명 결과 readback·중복 방지                                                              |
| URL refresh                   | 최초 PG5 PASS; reset/ACK 보정 후 focused unit17 PASS                              | 최신6-case PG 재실행은 Docker daemon offline으로 setup 전 실패; assertion 실패로 보고하지 않음                   |
| Source erasure/Ask            | isolated PG 각각1 PASS                                                            | 기존 privileged fence/owner 계약을 재사용                                                                        |
| Media                         | support-negative14 + descriptor9 + 기존 Golden/TS1/pipeline37 PASS                | 불지원 경계와 fake geometry/format fidelity. audio/video 활성화 미완료                                           |
| Security/backup               | focused49 PASS                                                                    | 데이터/권한/인용·profile 구조; 실모델 전반 injection rate 미인증                                                 |
| TS6                           | standard45 PASS; frozen hashes/현재143 candidates·129 owners 및 audited relations | 이후 formatter로 derived JSON byte drift 발견, 재생성/최종 repro 확인 필요; validator/timeout/옛 v2-v7 변경 없음 |
| Architecture/docs/OSS/secrets | Architecture PASS; docs PASS; OSS73 decisions/45 baselines PASS; secret scan PASS | exact-head CI와 신규 코드 review 필요                                                                            |

원본 로그·초기 실패·환경 보정·SHA는
`C:/dev/artifacts/vp-full-completion-2026-10-12`에 보존한다.
Git 파일에는 fixture가 아닌 실 source/secret/billing 원문을 추가하지 않는다.
신규 gate 결과는 [Master Plan](./master-execution-plan.md)에 후속 상태로 기록한다.

2026-10-13 후속 확인: TS6 derived v8을 원래 generator로 재생성한 뒤
byte-reproducibility PASS했다. prescribed standard lint는 오류0/기존 warning2,
checkpoint root typecheck·lint·docs·Architecture PASS다. A3/accounting/new
checkpoint/discovery focused48 tests도 PASS했다. 임의로 늘린 lint 범위의
미변경 example `console` 오류를 standard gate 회귀로 처리하거나 원본을
바꾸지 않았다.

새 URL checkpoint 보정은 수집 성공 뒤 STAGED journal ACK 오류를 acquisition
retry로 바꾸지 않는다. durable STAGED가 있으면 같은 receipt를 재사용하고,
uncertain storage/staging은 UNKNOWN으로 보존한다. known network failure만
기존 최대3 retry를 사용하고 terminal MIME/encoding rejection은 반복하지 않는다.
이는 provider·prompt·semantic gate 변경이 아니다.

2026-10-13 후속 관측에서 Docker 연결이 외부적으로 복구됐고 protected
container 두 개는 exited였다. 상위 에이전트는 자신이 생성한 isolated container의
exact ID·volume·network를 대조한 뒤 해당 container만 시작했다. URL refresh의
최종 PostgreSQL 6개는 PASS했다. 신규 실제 application regression은 same-run
자동 복구와 URL refresh 2개 PASS, A/B/revision case의 즉시 relation binding
조회는 0건으로 FAIL했다. 정상 relation dispatcher의 60초 cadence보다 먼저
조회한 문제를 해결하기 위해 실제 durable binding을 기다리는 한정된 observer를
추가했다. 기존 assertion·production cadence·기존 test timeout은 유지하며,
최종 observer의 해당 case 재검증 PASS(119.4초)를 확인했다. 앞서 통과한
다른2 cases는 name filter에서 제외했으며 source에서는 모두 CI 실행 대상이다.
전체3개를 함께 실행한 remote exact-head CI는 별도로 확인한다. 최초 실패 로그는
삭제하지 않는다.

## 복원·재시작

새 owned container에서 existing pg_dump/pg_restore 경로로 실제 backup/restore를
수행했다. **측정 대상134 tables, 12 original Assets, 137 contracts,
migration132**를 정확히 대조했다. 이는 전체 DB의 모든 table에 대한 readback
인증이 아니다. raw dump는 전체 DB이지만 integrity profile의 범위는 명시적
subset이다. Vault ciphertext 보존은 외부 master key 복구의 증거가 아니다.

같은 owned Postgres를 KILL한 뒤 기존 연결 상실·재시작·134 measured tables
동일성을 확인했다. 복원본 recovery-profile app에서 과거 answer GET의
SUCCEEDED·stale=true·원문/citation 불변을 확인했고 AI worker는 비활성이다.
최초 runtime-test profile 관측을 recovery-profile 관측과 구분해 보존한다.
운영 product/authority DB를 복원·시작하거나 worker를 실행하지 않았다.

2026-10-13 재개 시 Docker daemon이 offline이었다. protected container 상태는
현재 재관측 불가이므로 unchanged로 추정하지 않는다. daemon 시작이 기존
자동 재시작 경로에 미치는 영향이 확인되지 않아 해당 조작을 수행하지 않았다.
격리 PG 후속 verification은 원격 CI 또는 검증된 isolated runtime 대상으로 한다.

## 보존

- 79 protected file bytes 동일, 다른13 worktree HEAD/status 동일,
  운영 configuration bytes 및 stash 목록 동일을 2026-10-13 다시 확인했다.
- 운영 C:/dev/shotgun 및 69개 VP 로컬 계보를 변경하지 않았다.
- v11 의미 정책·72/432/B12·B 잔여24·Gold-B-7과 중단 stash를 보존했다.
  재채점/이관/Gold 개봉0, 실제 AI 호출0이다.
- TS6의 현재 coordinate/evidence/derived v8만 audited source delta에 대응한다.
  역사 v2-v7 hash manifest 및 validator/resolver/timeout은 동일하다.

## 실제 잔여 조건

독립 offline pack/install/import 검증1 PASS로 새 평가 package의 공개 export 및
transitive compiled imports를 fresh consumer에서 확인했다. npm config/cache는
격리하고 lifecycle script·registry 호출은 비활성이다. 전체 저장소·운영 env·동결
자료를 tarball에 넣지 않았다. 이는 실제 Shotgun desktop 설치/재부팅 인증이
아니며 그 경계는 [패키지·런처 proof](./reliability-package-launcher-proof.md)에
기록했다.

1. 현재 code diff의 exact-head CI/독립 검토 및 별도 Canonical merge 승인.
2. 외부 적격 native reference/warrant provenance·대표성·critical recall/
   calibration. AI 합의/높은 confidence/조건부 분모0을 인증으로 사용하지 않음.
3. 인가된 isolated real-provider workload의 credential/standing/egress와
   동일 persistent global authority readiness. 현재 authority는 조회하지 않았다.
   실제 provider usage/adapter latency/invoice provenance·청구 대사 미확보.
4. image의 인가된 의미 provider; audio/video의 timecode/frame·alignment 및
   검증된 capability. unsupported rejection을 해당 기능 완료로 취급하지 않음.
5. 별도 authority backup/reconciliation·external Vault master 복구·운영
   migration/cutover와 최종 Canonical installed desktop identity/Windows restart.

사용자에게 개별 Reference reviewer/approver 또는 지식 검토를 요청하지 않는다.
남은 권한/외부 검증 자료는 하나의 제한된 승인·증거 요청으로 정리하고,
그 전에 가능한 코드·CI·격리 검증을 수행한다. 이 checkpoint로 전체 VP
COMPLETE 또는 COMPLETE_WITH_LIMITS를 선언하지 않는다.
