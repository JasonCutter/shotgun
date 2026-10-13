# VP 전체 완료 Master Execution Plan

> **IN_PROGRESS — NOT_IMPLEMENTATION_COMPLETE / NOT_FINAL_ACCEPTANCE_COMPLETE**
>
> 사용자 실행 지시 2026-10-12, Canonical base `aba6ff27f9620ee1a3f408f8df81e8aad21cc584`. 개발 branch `codex/vp-full-completion`. `VP-01`–`VP-11` ID와 `VP-0`–`VP-4` 계약은 유지한다.

## 1. 실행 권한과 이전 STOP의 관계

사용자의 전체 연속 구현 지시를 현재 작업의 승인 근거로 적용한다. A3 이후의 계약 구체화·구현, VP-03~11 잔여 개발, VP-06/07 안전한 개발·격리 장애 검증의 착수를 허용한다. 기존 문서의 해당 작업 STOP은 당시 이력이며 이번 범위에서 대체된다. 각 Section 종료마다 승인/다음 지시를 요구하지 않고 독립 작업을 이어간다.

Core Canonical·SourceVersion/Evidence·Ledger·보안/민감도·egress·복구/멱등성·global budget authority는 유지한다. 별도 merge 승인은 유지하며 운영 원본을 테스트하지 않는다. Gold-B-7·72/432/B12 원본·B 잔여24·기존 stash/중단 draft는 보존한다. 신규 평가 구현은 기존 중단 초안을 자동 복원/채택하는 것이 아니다.

실 DeepSeek는 기존 인가된 credential·유효한 egress/비용 정책·전역 예산 범위·격리 workload가 모두 확보된 경우만 최소 실행한다. 환경 변수의 key 존재는 실행 승인이나 authority 일치의 증거가 아니다. 실청구/외부 독립 의미 검증·Git merge·실제 설치 인수에 외부 의존성이 있으면 해당 Gate를 미검증으로 남기되 다른 구현을 계속한다.

## 2. 전체 순서와 현황

| ID    | 현재 재사용 성과                                                        | 남은 구현/검증                                                                  | 이번 작업 상태                                 |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| VP-01 | Ledger 단일 Ask 권위·활성 version/snapshot                              | 변경된 경로 회귀만 수행                                                         | 기존 PASS 재사용                               |
| VP-02 | 증분/replay/full rebuild 및 버전 이력                                   | 후속 수정의 일관성 회귀                                                         | 기존 PASS 재사용                               |
| VP-03 | 실제 application/PostgreSQL/Fake13 인수; Historical Freshness Canonical | 설치 가능한 격리 A→질문→B→수정본 여정, 현재 credential/정책 내 최소 live 인수   | 준비 중                                        |
| VP-04 | 다중 형식 변환/locator·source fidelity·Fake/live 기존 좁은 증거         | 형식 지원/미지원·숫자/조건/표/수식·독립 의미 품질과 오류 한계                   | 구현/자료 범위 조사 중; 인증 Gold 미확보       |
| VP-05 | A1/A2 Canonical, 실행 권위 PR381·432/B12 역사 자료                      | A3 reference/metrics 구현·Frontier recall·cost/calibration/billing 및 제품 영향 | 순수 평가 package 구현 중; 새 Gold 0           |
| VP-06 | ACK loss·one-use claim/attempt·UNKNOWN·crash tests                      | stale fail→retry crash/readiness 공백, opt-in 격리 outage/restart/중복 검증     | 최소 보정 중                                   |
| VP-07 | supervisor·backup/restore·P0 rehearsal/guarded maintenance              | 설치 실행/자동 복구·격리 복원/rollback·최종 운영 조건                           | 기존 구현 대조/검증 준비                       |
| VP-08 | 성공 URL 수집 TTL/Ask freshness 표시, 활성 file 10MiB                   | 자동 URL refresh·실패 receipt/최신성 표시·형식별 scope                          | durable refresh 보완 중                        |
| VP-09 | 사용자 승인/Project/Source 선택 없는 경로·권한/민감도·injection tests   | 실제 waiting/recovery 상태, citation/egress 종단 음성 검증                      | 기존 경계 유지하며 제품 회귀 준비              |
| VP-10 | Module/OSS registry와 Stage0~12 검사                                    | 신규 adapter별 reuse/contract/replacement/migration/rollback와 전체 판정        | 변경 package별 기록 중                         |
| VP-11 | Canonical launcher와 과거 좁은 설치 증거                                | clean install/desktop identity, 최종 Canonical 코드·필수 Gate·실제품 인수       | 기능/통합 완료 후 수행; merge/외부 의존성 별도 |

## 3. 병렬 작업과 파일 소유

- 상위 에이전트: baseline 보호, Master Plan, 격리 DB/Asset/authority/Fake test 운영, application/bootstrap 연결, 비용/egress/최종 통합·증거 관리.
- evaluation_a3: 새 offline relation-evaluation package/contract/unit tests와 A3 문서. 현재 v6 6종·로컬 v11 7종, raw/adopted·warrant 미평가·N/A·UNKNOWN·Frontier 정의. 생산 정책과 과거 score 변경 없음.
- freshness_formats: 기존 URL/staging/submission Port 재사용, 새 refresh coordinator/store/adapter, migration131 예약, source/Ask freshness query의 최신 실패 상태 반영. runtime wiring은 상위 에이전트.
- reliability_acceptance: 기존 bounded stale retry를 중복 구현하지 않고, known stale 실패의 원자 requeue와 readiness 재검증, 이력·attempt 상한·UNKNOWN 보존. Ask PostgreSQL의 fail/queue 경로만 소유하고 freshness query와 구분.

## 4. 확인된 실제 공백과 최소 보완

1. Source/Ask URL freshness는 성공 provenance만 읽어 실패 후에도 CURRENT가 될 수 있다. 자동 재수집 job·실패 상태·같은 source의 changed-content 새 SourceVersion 연결을 기존 staging/submission/idempotency 경계 안에서 보완한다.
2. Ask에는 이미 bounded stale retry가 있지만 fail commit과 retry 사이 crash/일시 장애가 FAILED run을 영구 방치할 수 있다. 기존 fail transaction에서 known-stale attempt 이력을 보존하고 같은 run을 atomically QUEUED로 되돌려 일반 readiness/fresh-context 경로를 사용한다. UNKNOWN은 재호출하지 않는다.
3. v6에는 witness가 없어 enum 성공을 근거 정확도로 계산할 수 없다. 평가 package는 kind-only diagnostic과 독립 warrant/evidence가 확인된 tuple certification을 분리한다. 0분모 N/A, 미평가/coverage·invalid·runtime·abstention·raw/adopted 안정성을 명시한다.

## 5. 검증/재사용 기준

PR381/382/383의 exact-head/post-merge CI, actual application Fake13, source fidelity·format·retry/replay/backup 기존 증거를 재사용한다. 전체 Gate를 기계적으로 다시 실행하거나 좁은 PASS를 전체 인증으로 확대하지 않는다. 신규 공백에는 smoke·계약·보안/복구 테스트를 붙이고 실제 runtime을 연결한 뒤 전체 통합 Gate를 수행한다.

기존 PostgreSQL/Jev-defer/DeepSeek Port·Python format adapters 및 OSS registry를 우선 재사용한다. gbrain/lucas/ddsyasas/OpenKnowledge의 기존 pin·license·role/제외 경계를 출발점으로 한다. 새로운 code 통합은 Module/Port 뒤의 정확 pin·security·maintenance·Contract/Replacement 검증을 요구한다. 새 runtime/DB를 Kernel 또는 Ledger 권위로 채택하지 않는다.

## 6. 완료 조건과 외부 의존성

IMPLEMENTATION_COMPLETE는 필수 기능의 연결·실행 가능성 및 남은 결함/미검증 분류다. VP_FINAL_ACCEPTANCE_COMPLETE는 승인된 의미 reference, 실제 provider 비용/청구·보안·복구·지원 형식·제품/설치 인수·Canonical 반영 등 사용자 지시의 모든 필수 Gate와 blocker 부재가 필요하다. 둘을 혼동하거나 COMPLETE_WITH_LIMITS로 우회하지 않는다.

외부 의미 검증 증거·실청구 provenance·정책/credential 권한·merge/운영 release와 같이 에이전트가 만들 수 없는 것은 별도 blocker로 남긴다. 사용자에게 개별 지식/정답/reviewer 지정 작업을 요구하지 않는다. 독립 작업이 남으면 계속 진행한다.

## 7. 기록

작업별 source/commit·변경·명령·PASS/FAIL/NOT_RUN·보존·rollback·미결과 다음 명령을 같은 directory에 기록한다. 보호 snapshot과 격리 실행 raw artifacts는 `C:/dev/artifacts/vp-full-completion-2026-10-12`에 checksum/access/reference manifest로 보존하고 material 결과는 Git 문서에 요약한다. 자동 검증 결과를 인간 Gold 승인으로 기록하지 않는다.

## 8. 2026-10-13 연결·검증 현황

[통합 보고](./report.md)를 현재 checkpoint로 사용한다. 이전 표의 준비/진행 상태는 시작 당시 기록이다.

| ID       | 완료한 이번 범위                                                                                                                         | 필수 잔여 상태                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| VP-01/02 | 기존 Ledger/버전/Ask 계약 재사용; 과거 답변 불변·현재/과거 분리·업데이트 인용 회귀                                                       | 최종 release/전체 Gate의 범위와 구분                                                                             |
| VP-03    | 실제 SPA+application+workers+PG/Fake, 빈 material state에서 A/B/수정본·3질문 PASS; Project/Ask Source 선택·지식승인0                     | 실제 DeepSeek/설치본/승인 정책 인수 미실행                                                                       |
| VP-04    | 기존 Stage8/TS1/locator/활성 형식 Golden과 원본 bytes 보존; 이미지 잘못된 descriptor 안전 거부                                           | 의미 품질/독립 reference/대규모 대표성 UNVERIFIED                                                                |
| VP-05    | A3와 실행·usage/latency/invoice accounting; bounded current Frontier·membership integrity·명시적 completion 연결                         | 신규 pruning recall/calibration/실청구·실 latency N/A; Gold0                                                     |
| VP-06    | known stale 원자 requeue·동일 run readiness·UNKNOWN 제외; process kill/ACK/global binding/cross-process 회귀                             | 새 URL checkpoint ACK 경계 보정의 PG 재검증은 로컬 Docker daemon unavailable; remote CI 대상                     |
| VP-07    | 기존 supervisor; owned isolated PG KILL/restart; backup/restore measured134 tables·12Assets·137contracts PASS; recovery profile readback | 별도 authority 운영 복구/외부 Vault master/Windows reboot/운영 cutover 미실행                                    |
| VP-08    | durable URL refresh·실패 freshness·정상 gateway·version CAS·HTML URL·UTF8·최신 인용 연결                                                 | image provider 미인가/미구성; audio/video selector·alignment/capability 미구현; 지원 제외를 완료로 간주하지 않음 |
| VP-09    | all-sensitivity eligibility final guard; preflight/citation/프로젝트 격리·실패/대기 UI 검증                                              | 일반적인 실모델 injection 방어율은 미인증                                                                        |
| VP-10    | 기존 OSS 재사용·Architecture import correction·additive131/132·T3 ownership·TS6 current143/129                                           | Canonical 통합 후 exact-head Gate와 migration/운영 승인 필요                                                     |
| VP-11    | frontend build/typecheck·실 SPA 인수·복원본 제품 읽기·보존 manifest                                                                      | Canonical merge·최종 installed identity·실모델/청구·배포 승인 미충족                                             |

현재 전체 구현/최종 인수 완료를 선언하지 않는다. 남은 외부 권위·provenance·merge/release 조건과 media contract 공백은 별도 상태로 유지한다. 검증 가능한 독립 코드 작업을 PR/CI 결과에 따라 계속 보정한다.

### 2026-10-13 게시 직전 후속 검증

소유한 격리 PostgreSQL에서 최종 URL checkpoint suite6 PASS 및 실제 앱3개
회귀를 scoped runs로 검증했다. 첫 relation-binding 즉시 조회 실패는 정상60초
dispatcher cadence를 기다리는75초 bounded observer로 보정한 뒤 실제 claim/
semantic-attempt 기록까지 PASS했다. source의3개 cases는 모두 CI 실행 대상이며,
최초 실패도 보존한다. production cadence·assertion·기존 timeout 변경은 없다.
새 평가 package의 독립 offline pack/install/import1 PASS, existing launcher
증거 재사용 및 실제 desktop/reboot 미검증 범위는
[패키지·런처 proof](./reliability-package-launcher-proof.md)에 기록한다.
최종 root typecheck·standard formatting·TS6 release·secret scan PASS다.
Draft 게시 뒤 동일 exact head의 정식 CI와 독립 검토를 확인하며 merge는 별도 승인이다.
