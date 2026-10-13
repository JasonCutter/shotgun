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

### PR384 독립 검토·첫 CI의 후속 보정

첫 게시 head `0c0729c8fa6bc6302c43cc2b6c31408c33812f16`의 CI
`38333081667`은 Frontend SUCCESS, Quality/Required Gates FAILURE였다.
Database는688 PASS·18 FAIL·2 기존 SKIP이며 실패 원본을 보존한다. 독립 검토는
[실행/T3 보정](./review-execution-correction.md)과
[평가 구조 보정](./review-measurement-correction.md)에 기록했다.

새 journal과 기존 T3 owner/status/schema fingerprint·active preview·SQL purge
계약을 맞췄다. INSERT/UPDATE용 기존 fence를 DELETE에 연결하지 않으며 runtime
DELETE 권한을 추가하지 않는다. 불명 refresh는 직접 purge에서도 거부하고,
known terminal journal은 승인 executor로 실제 삭제/readback한다. 실제 store의
ACQUIRING→OUTCOME_UNKNOWN 경로도 module 계약과 일치시켰다.

평가 provenance는 필수 boolean 이견 상태와 닫힌 unique scope 배열을 요구한다.
누락/문자열/중복/잘못된 역할을 Gold 또는 Frontier 적격 증거로 세지 않는다.
순수 구조 검사는 인간 의미 검증이나 invoice 인증으로 승격되지 않는다.

기존 exported backup helper의 unversioned 기본값은 legacy-v1로 보존했다.
새 backup 생성은 vp-execution-v2를 명시적으로 선택한다. 원래 T3 restore
preflight test를 변경하지 않고 재검증해, 오래된 epoch의 backup을 target 변경
전에 거부하는지 확인했다. Backup unit14+실제 PostgreSQL preflight1 PASS다.
T3 owner unit6+fresh PostgreSQL 음성/양성5, 평가 unit32 PASS다.
후속 root typecheck/docs·TS6 byte reproducibility PASS이며 기존129 owners와
분류·좌표가 동일해 이번 review에서는 TS6 artifact diff를 추가하지 않았다.
기존 schema/ledger/migration/register의 fixture 기대값은 exact 새 테이블/상태
계약과 역사 baseline 보존을 함께 검증한다. 보정 head의 전체 CI는 별도로 확인한다.

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

## 2026-10-13 후속 checkpoint — Canonical 및 격리 설치·media 준비

앞선 checkpoint의 승인 대기·Docker offline·CI 미확인 항목은 당시 이력이다.
후속 관측으로 확인한 아래 범위만 갱신하며 원본 실패와 보호 증거를 유지한다.

### PR384 Canonical 완료

- 승인된 exact head: `27ff952398869b7ba956b01c39db709ed2a43b6a`.
- Exact-head CI: `38335693426`, Quality·Frontend·Required Gates SUCCESS.
- Canonical merge: `e3abc1163918809a0dbb88f4a5f7841d60c47b8a`.
- 승인 head/병합 tree: `85c36572bc75dfe520e6711a7d6b14b33c9d1c46`, 동일.
- [Post-merge main CI](https://github.com/JasonCutter/shotgun/actions/runs/38339274706):
  Quality·Frontend·Required Gates SUCCESS.

[PR384](https://github.com/JasonCutter/shotgun/pull/384)는 별도 사용자 merge
승인에 따라 완료됐다. 후속 media/설치 검증의 local diff는 새
`codex/vp-media-completion` branch에서 위 merge를 기준으로 작성하며, PR384
exact diff나 승인 tree에 포함된 것처럼 보고하지 않는다. 운영 checkout/설정을
갱신하거나 운영 앱을 시작한 결과가 아니다.

### Fresh application 및 Python 실행

실제 source allowlist를 fresh 설치한 후 기존 launcher/preflight/supervisor와
full recovery assembly로 owner/child 종료·재시작, 새 nonce·identity/readiness,
DB/asset marker 보존을 검증했다. 같은 fresh installation에서 실제 normal
application/worker 및 Fake Provider로 A→질문→B→A revision→질문을 실행했다.
Outer rehearsal1 PASS(406.77초), nested normal journey1 PASS(122.80초),
53 HTTP requests·자료3회·질문3회, Fake extraction3/answer3/relation1이다.
실제 relation v6의 claim/attempt와 최신 A/B 인용·과거 답변 불변/stale를 확인했다.
기존 launcher 회귀55 PASS를 별도 실행했다.

이 설치 source base는 위 e3 merge지만 local runtime 변경을 포함한다.
858 runtime files·441 lockfile entries의 manifest digest는
`fc6e7074b2aa42d87283d57bb4c10d95da23c355690d0382761ec4203ee79212`,
synthetic main은 `52f45b6bcdee053e033435b15b33cc0ba3b0a543`, archive digest는
`b0766018e7aed5d2ff4fb144c978dbcba6d642f26ba6bfe4379c85f1980c5f75`다.
최종 Canonical 또는 운영 desktop 설치의 identity로 혼동하지 않는다.

독립 후속으로 owned fresh Python venv에 기존17 exact dependency pins를
설치했다. 기존 unchanged adapter/worker로 HTML/PDF/DOCX/CSV/XLSX/PPTX
6개 fixture의 marker·locator·SourceVersion/hash·원본 bytes 보존이 PASS했다.
host Python3.14를 seed로 사용했으며 global Python/PATH/configuration은
변경하지 않았다. 전체 의미 품질·standalone interpreter 설치를 인증하지 않는다.
실행 방법과 exact artifacts는 [설치 proof](./reliability-application-distribution-proof.md),
[Python proof](./fresh-python-converter-proof.md)에 있다.

Original fresh installation은 cleanup됐고 보존된 copied directory는
SOURCE_EVIDENCE_ONLY다. Computed workspace junction 제거/재생성은 자동 승인
검토에서 "blocked by policy"로 거부됐고 수행·재시도하지 않았다. 성공한 proof는
원래 fresh installation에서 실행됐으며 dangling copied links를 실행 증거로
사용하지 않는다.

### Media의 구현된 준비 범위 및 한계

- [Alignment v1](./media-alignment-foundation.md): 42 unit+3 contract PASS,
  기존 Stage3 8 PASS. 정확한 source/version/hash·time/frame/Unicode mapping을
  검사하되 generated transcript/description은 UNVERIFIED/DECLARED다.
- [Offline producer](./media-frame-offline-proof.md): FFmpeg9.0.2 exact pin,
  upstream commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`, GPLv3 supplier
  build를 격리 실행했다. 신규32+기존59=91 PASS. 실제 VFR PTS
  `[0,100,400,900]` ms 중 selected `[0,1,3]`과 exact PNG hashes를 보존했고
  synthetic WAV duration1250ms를 확인했다. **Audio는 전사하지 않았다.**
- [Native image transport](./native-image-transport-preparation.md): 기존
  deepseek-flash가 image 입력을 지원한다는 공식 문서를 확인해 새 모델이 반드시
  필요하다는 선행 추론을 보정했다. 별도 prepared inline 경로는 새21+기존19
  Fake HTTP tests PASS다. 기존 text payload·v6/.9·active catalog는 그대로다.
- [Prepared chain](./media-analysis-preparation.md): original bytes→decoded
  selected frames→native Fake HTTP→generated alignment를 연결했다.
  23 contracts+3 integrations PASS이며 이 중 real pinned decoder1개는 이
  host에서 실행됐다. 해당 runtime 없는 host에서는 그1개만 SKIP이며 portable
  2개는 실행한다. Identity/callable substitution은 consumption/호출 전에 거부한다.

이 media 경로는 inactive다. Process-local one-use는 restart-safe durable
claim/attempt 보장이 아니며, unsampled scenes·speech·speaker·전체 의미는
검증되지 않았다. Native support나 decoded frame hash가 권한·AI 의미 정확성·
청구 또는 원문 Evidence 권위를 인증하지 않는다. Production FFmpeg DEFER,
현재 제품 media support-negative 계약과 기존 Evidence/Ledger authority를 유지한다.

### 현재 잔여 조건

PR384의 Canonical CI/merge blocker는 해결됐다. Fresh JavaScript/Python 및
actual normal Fake path로 설치 검증 범위는 확대됐지만, 최종 Canonical installed
owner/desktop/reboot·운영 전환 승인은 별도다. 기존 persistent execution/budget
권위와 media durable provenance·활성 제품 intake/preview/Ask 연결, 원문과 생성
내용의 분리, 대표 content fidelity가 아직 필요하다. Audio ASR 또는 whole-video
support를 구현됐다고 계산하지 않는다.

외부 독립 의미 reference/warrant, Frontier recall/calibration, 인가된 isolated
실호출 정책/credential/global authority readiness, usage/latency/invoice 대사,
외부 Vault master 및 authority 복구 조건도 남아 있다. 새 Gold0·실제 AI 호출0,
동결 원본/Gold-B-7/중단 실험과 운영 worker-OFF를 유지한다.
**VP_FULL_IMPLEMENTATION_IN_PROGRESS / VP_FINAL_ACCEPTANCE_NOT_COMPLETE**를
유지하며 가능한 독립 구현·검증을 계속한다.

### 같은 날의 독립 안전 검토 후 보정

기존 inactive 이미지 설명 seam이 Lucas text 변환을 통해 `source` origin을
상속하는 잠재 결함을 보정했다. Adapter `1.13.0`은 root까지 모두 `annotation`을
사용하고 기존 Evidence source-only 경계와 positive-count 성공 계약을 유지한다.
원문 bytes/BBox/생성문은 보존되며, 위조한 성공 알림도 실제 Candidate module에서
provider attempt/Candidate 생성 전에 거부된다. 기존 형식·보안 회귀와 합쳐
74 PASS다. [수정 근거](./image-description-origin-safety.md)에 캐시 identity·
과거 revision 보존·초기 잘못된 테스트 기대와 rollback을 기록했다.

Prepared executor의 실제 private field 테스트를 추가해 원래 인스턴스 호출을
확인했다. Native image의 이전 nested base64 regex는 허용된 10 MiB 입력에서
V8 RangeError를 발생시켰다. 선형 검사로 바꾸되 canonical round-trip/hash/
padding/기존 크기 상한을 유지했다. 10 MiB 성공과 초과·잘못된 padding의
호출 전 거부를 포함해 native26+기존19 PASS, 관련 alignment/prepared suite와
합쳐116 PASS다. 최초 실패 로그도 보존한다.

전체 unit/contract의 로컬 동시 실행은2354 PASS/4 timeout(기존 Stage8 표준5초)
이었다. 동일 제한의 해당 파일과 관련6개 scoped suite는74 PASS다. Timeout이나
assertion을 완화하지 않았다. 이 관측만으로 전체 suite PASS를 주장하지 않으며
새 게시 head의 정식 CI를 별도로 확인한다. Full lint는0 errors/기존2 warnings,
TS6·architecture·OSS·secret·문서 Gate PASS다. 사용자 원본 directive를 보존하기
위해 비표준 추가 문서 format 검사에서 나온 그 원본의 기존 style 경고를
수정하지 않았다. 표준 repository format Gate와 새 작성 문서는 따로 검사한다.
