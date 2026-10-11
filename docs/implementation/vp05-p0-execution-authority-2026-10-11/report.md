# VP-05 P0 — 실행 권위 정합 결과

- 기준: Canonical main `083e779ec64e3216df78eb327a5ba73b3996a21c`, ADR-173.
- 작업 브랜치: `codex/vp05-p0-execution-authority` (main에서 만든 격리 worktree).
- 판정: **P0_LOCAL_INTEGRATION_READY / CANONICAL_AND_OPERATIONS_APPROVAL_PENDING**.
- VP-05 전체: **미완료**. 제품 인수·의미 평가 신뢰성 Gate는 별도다.
- 검증 범위: fake provider, loopback fake HTTP, 격리 PostgreSQL, 실제 앱 bootstrap, 프로세스 종료·재시작·응답/commit ACK 유실.

## 1. 달성한 보장

1. `claimNext()`는 선택·lease만 수행한다. credential/권위 확인 전에는 local semantic attempt와 local budget telemetry를 증가시키지 않는다.
2. 실제 앱의 Project AI resolver 결과를 한 번 캡처한다. provider/model, configuration revision, credential ID/revision, policy identity를 고정한다. Vault에서 검증한 project/provider/credential ID/revision 및 실제 credential SHA-256가 이 context와 일치해야 한다.
3. 캡처한 credential bytes, model identity, request body/schema를 사용한다. 전역 승인 뒤 다른 credential/configuration을 읽지 않는다. credential은 일회 사용하며 사용·폐기 시 버퍼를 비운다.
4. 전역 reservation은 job/lease/semantic-attempt/execution-key/provider identity와 함께 저장된다. 전역의 일회성 execution fence를 성공적으로 얻은 뒤, 같은 claim의 local receipt와 attempt 증가를 하나의 local transaction으로 확정한다.
5. 동일 claim의 execution fence는 재사용되지 않는다. 다른 프로세스·다른 workload ledger·restore가 local receipt를 갖지 않더라도 이미 승인된 claim을 자동 반환하거나 재승인할 수 없다.
6. 알려진 저장 출력은 새 credential·global claim·provider call 없이 재생한다. 불명 결과는 자동 재호출하지 않는다. expired receipt 복구는 global authority의 가용성과 분리하여 앱 시작 시 실행한다.
7. 정상 앱은 global authority를 필수로 사용한다. Job adapter 기본값도 global-required이며, 기존 fake/replay harness의 local mode는 명시적으로 표시했다. authority가 없거나 잘못됐으면 관계 실행을 pause하고 Intake/Ask/health 경로를 유지한다.

실행 순서:

`lease (attempt 0) → immutable AI/Vault context → reserve + bind → one-use global authorization → atomic local receipt + attempt activation → same captured provider → stored output → idempotent finalization`

### 카운트의 정확한 의미

Global `claimed_count`는 완료 호출뿐 아니라 보존된 reservation을 포함한다. local attempt는 승인된 실행 receipt 활성화 시 증가한다. 실제 HTTP 송신과 두 DB의 commit을 하나의 transaction으로 만들 수 없으므로, 활성화 직후 죽으면 실제 송신이 0일 수 있어도 **불확실한 승인 시도 1회**로 보수적으로 보존한다. 이 상태를 실제 provider 호출 또는 청구 1회로 주장하지 않는다. 자동 재호출·임의 환불보다 명시적 재조정을 요구한다.

## 2. 이전 결함과 선별 재사용

main의 이전 순서는 `claimNext → local budget/attempt 증가 → resolver/credential 확인 → provider receipt → provider`였다. credential 실패나 전역 binding 실패에서 실제 호출 0인데도 시도를 소비할 수 있었다. main에는 공유 global authority binding도 없었다.

로컬 성과 `375100d2…`, `f0eb075b…`, `86296e2f755fa7e77d398cd6a167ba5def573e99`에서 global PostgreSQL authority, credential capture, lease/activation 분리, output replay, execution dispatcher를 선별했다. 전체 commit을 cherry-pick하지 않았다. [출처·파일 SHA](./reuse-provenance.json)에 기록했다.

새 보완:

- 전역 `execution_authorized_at` CAS fence: 별도 DB의 local receipt 부재를 근거로 실행 승인 claim을 잘못 반환하는 복구 가능성을 차단.
- 승인된 unused/불명 claim은 자동 해제하지 않고 `RECONCILIATION_REQUIRED`로 보존.
- refund의 authority/day 일치 검사, settlement 동일 outcome/metadata의 멱등 처리와 불일치 거부.
- 이미 receipt가 있는 job의 lease 변경 retry를 차단; 전역 설정 없이도 expired local execution을 복구.
- 실제 credential metadata와 captured execution pin의 일치 검증, model/scope/request 불변화.
- PostgreSQL URL의 target override와 같은 DB의 percent-encoded 우회 거부. 연결 5초, query/statement 10초 제한으로 authority 장애 시 앱 시작을 무기한 막지 않음.
- workload reset이 provisioned global authority를 지우지 못하도록 거부.

전역 counter의 storage/authority ID, fingerprint 정책, UTC day, atomic daily upsert는 유지했다. 새 production authority를 만들거나 선택하지 않았다.

## 3. 실패·중단·재시작 검증

| 상황                                         | provider egress | local attempt | global / 작업 상태                                                    |
| -------------------------------------------- | --------------: | ------------: | --------------------------------------------------------------------- |
| 실제 Vault credential 불일치                 |               0 |             0 | claim 0, RETRYABLE                                                    |
| 권위 설정 누락                               |               0 |             0 | claim 0, PENDING, 앱 health/검색 유지                                 |
| 실제 TCP authority 무응답                    |               0 |             0 | 연결 제한 후 pause, 앱 health/검색 유지                               |
| authority unavailable / reserve binding 실패 |               0 |             0 | claim 0, RETRYABLE                                                    |
| authoritative budget 100/100                 |               0 |             0 | backlog 유지, local budget으로 우회하지 않음                          |
| lease 후 reservation 전 crash                |               0 |             0 | 새 lease로 1회만 정상 실행                                            |
| reservation 후 global arm 전 crash           |               0 |             0 | unarmed reservation 반환 후 정상 실행 1회                             |
| global arm 후 local activation 거부          |               0 |             0 | armed RESERVED 1, RETRYABLE, 재조정 필요                              |
| global arm ACK 유실                          |               0 |             0 | armed reservation 유지; restart에서도 호출 없음                       |
| local activation 후 egress 전 crash/ACK 유실 |     0 또는 불명 |             1 | OUTCOME_UNKNOWN, 재승인·재송신 없음                                   |
| fake HTTP 응답 직후 OS process kill          |               1 |             1 | local OUTCOME_UNKNOWN, armed global RESERVED 1, 두 번 restart해도 1회 |
| egress 뒤 response persistence 실패          |               1 |             1 | OUTCOME_UNKNOWN, 재송신 없음                                          |
| response 저장 뒤 finalization 전 crash       |               1 |             1 | credential이 사라져도 저장 출력으로 완료, 총 호출 1회                 |
| 두 workload DB가 마지막 budget 1칸 경쟁      |          합계 1 |        합계 1 | global 99→100, 다른 backlog 유지                                      |
| 두 OS process가 동일 global arm 경쟁         |          승인 1 |             — | 한 process만 승인, release/replay 거부                                |
| authority UTC day rollover                   |   fake claims만 |             — | 새 authority day count 0; 이전 claim 반환은 이전 day에만 적용         |

[영속 상태 trace](./boundary-traces.json), [검증 집계 및 skip 목록](./verification.json), PostgreSQL tests에 근거한다. uniqueness는 local `(global_claim_id)`, `(job_id, semantic_attempt_id)`, authority `(authority_id, relation_job_id, semantic_attempt_id)` 및 전역 one-use UPDATE가 함께 보장한다. request digest/execution key와 provider request ID(알려진 경우)를 양쪽 receipt에 연결한다.

## 4. 실제 앱 worker 관측

`startShotgunApplication(runtime-test) → 현행 all-pairs enqueue → 실제 relation worker → Project resolver/Vault → global authority → bound local receipt → fake DeepSeek connectivity → normal VP decision receipt/relation → Ask Evidence 확장`

| 관측 항목                   | 값                                                                        |
| --------------------------- | ------------------------------------------------------------------------- |
| 활성 relation revision      | `vp-deepseek-relation-v6-evidence-context`                                |
| confidence gate             | `0.9`                                                                     |
| 실제 v6 instruction SHA-256 | `e84485451ff0aefe441cb30ee778df21fb2a4d666e4ef06c412230a262a013dd`        |
| request digest              | `sha256:69b37f4f0b193b50b7c5fa3ce6afc03e6a159ed0ec98fbf8c9aeffea7b01bc74` |
| store ID (격리 테스트)      | `a3408ee7-2c0a-483b-b2ca-3b2c66c6405a`                                    |
| authority ID (격리 테스트)  | `e3ae9be4-9993-4986-b165-3207c83b6ffc`                                    |
| global claim ID             | `1556fc90-8641-4090-873b-2df7e4ac69ac`                                    |
| job ID                      | `62d38724-4121-4b4e-a79e-558759ab4ceb`                                    |
| semantic attempt ID         | `f4b4a55d-1d17-4e71-a97c-c3128bd756c9`                                    |
| local provider call ID      | `335b5182-b36d-4115-9fa7-c31194746627`                                    |
| decision ID                 | `83d29d63-34ea-4ea4-bd22-d44deffafe28`                                    |
| fake response ID            | `vp05-audit-fake-response`                                                |

fixture는 Source/Evidence/assertion을 직접 seed하며 해당 독립 extraction refresh worker를 일시 mock하고 Ask generation worker를 끈다. **관계 worker/bootstrap/credential resolver/Vault/global store/VP persistence는 실제 경로**다. 의미 품질 또는 설치된 운영 제품의 최종 인수 증거가 아니다. [원본 trace](./main-worker-trace.json)를 따른다.

v11 synthetic job은 PENDING/attempt 0으로 남았다. main의 활성 정책은 이전과 이후 모두 **v6**다. v11 활성화·7-choice taxonomy·direct-claim-v12·Candidate Frontier·SSC/B 구현은 통합하지 않았다.

## 5. 의미·자료·이력 보존

- [13개 파일/부분의 동일성 증명](./semantic-preservation.json): v6 instruction, six-choice schema, validation/router/0.9 gate, 기존 resolver behavior, VP Ledger, Ask Evidence search, candidate refresh, server, DeepSeek connectivity 및 lockfile 보존.
- main의 `direct-claim-v10` 경로 유지. 로컬 v11/direct-claim-v12 성과는 원래 worktree에 보존.
- local semantic digest `996ad83ba1fd74e8b50c07ed0811adbe8a4e7e6a1b801c893c251929615bf463`는 **원래 로컬 계보의 기록**이다. 이를 서로 다른 main-compatible branch의 semantic identity로 붙이지 않는다.
- 기존 VP 원장·SourceVersion·Evidence·Ask·권한·Claim/Fact 경계 유지. nullable binding migration은 historical receipt/counter/outcome을 재판정·재계산하지 않는다. migration 전후 동일한 historical UNKNOWN receipt를 격리 DB에서 확인했다.
- source HEAD `1a36c7b55562783372dbc73c3188b9d797737c7e`, stash 6개, 동결 corpus/candidate/72-pair·432-task/B screen/Gold artifacts 등 **서로 다른 32개 보호 파일의 SHA가 전부 동일**: [이전](./preservation-before.json), [이후](./preservation-after.json).
- Canonical main HEAD `083e779…`와 원래 source worktree는 clean. Gold-B-7은 열지 않았고 VP-06/중단 실험을 시작하지 않았다. 기존 A/B heartbeat는 PAUSED다.
- live provider 호출 0, 운영 DB 쓰기 0, authority replacement 0, push/PR/merge 0.

실행 구현 검토 seal: `aab939746f6a7281a2b01a79a39dc520cc23424becbf7b43cd133131f90edb80`. [정의와 전체 파일 digest](./execution-identity.json)는 runtime policy-binding bytes를 포함하는 `application.ts`도 포함한다. 정책 선택이 바뀌면 이 seal도 바뀐다. 이것은 이번 local code review의 검증 identity이며 새 production semantic authority 채택이 아니다.

의미 보존 seal: `0424c2be7a26c52a3af987ba58ffa71b0e37f9064c8eeb12eb7613212453c417`. 형식은 sorted-key canonical JSON의 SHA-256이며 각 source component는 LF 정규화 후 hash한다.

## 6. 검증 결과와 한계

| 검증                                                           | 결과                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| 전체 unit                                                      | 1360 PASS                                                     |
| 전체 contract                                                  | 775 PASS                                                      |
| 전체 integration                                               | 516 PASS, 6 live/opt-in SKIP                                  |
| 관련 PostgreSQL, recovery, runtime, migration (중복 실행 제거) | 44 PASS, 2 opt-in SKIP                                        |
| 기존 제품 브라우저 여정                                        | 1 PASS: A 투입→A 수정→B 투입→Ask 최신 인용·다른 프로젝트 거부 |
| typecheck                                                      | PASS                                                          |
| 전체 lint                                                      | 오류 0; 기존 authentication 미사용 disable warning 2개        |
| architecture, docs validation, format, diff check              | 최종 검증 기록 참조                                           |

skip은 live DeepSeek 4건, opt-in 기존 VP runtime recovery 2건 및 기존 database backup/outage opt-in 2건이다. 이번 작업은 이를 실행했다고 주장하지 않는다. 새 global one-use/proc-kill/ACK-loss/PostgreSQL bootstrap 검증은 모두 실행했다.

초기 검증에서 old lease-count 가정과 fixture의 중복 asset hash/queue 선택, 테스트 fingerprint 충돌, crash probe의 종료 cleanup 대기가 드러났다. 새 소비 경계에 맞춘 계약과 격리 fixture로 수정했다. cleanup guard 수정 후 OS crash test가 통과했고, 첫 probe의 남은 **자기 소유 DB 2개만 binding/namespace를 확인하여 폐기**했다. 기존 test DB는 건드리지 않았다. 실패 기록과 cleanup receipt는 `C:/dev/artifacts/vp05-p0-*`에 남겼다.

## 7. OSS Integration Decision

| 후보 / 고정 기준                                                                                                     | 결정 / 범위                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [node-postgres](https://github.com/brianc/node-postgres), 기존 lock `pg 8.22.0`, MIT                                 | 기존 ADOPT adapter를 AUGMENT. 새 dependency 없음                                                       |
| [PostgreSQL](https://github.com/postgres/postgres), 저장소 고정 pg16 image, 관측 16.15                               | 기존 ADOPT authority/job storage 재사용; 새로운 counter runtime 없음                                   |
| [garrytan/gbrain](https://github.com/garrytan/gbrain), 기존 검증 pin `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT | REFERENCE_ONLY Job/lease/idempotency; 전체 runtime/DB/ID는 반입하지 않음                               |
| lucas / ddsyasas / OpenKnowledge                                                                                     | 기존 역할 유지. 변환·UX 후보로 이번 credential/authority transaction 보완에 해당 코드 재사용 범위 없음 |

검토 출발점은 Canonical Module ADD·OSS Role Matrix·roadmap/evaluation plan/DoD의 기존 검증이다. 새 조사·채택으로 승인된 4개 reference를 재평가하지 않았다. Shotgun의 credential/global claim/local receipt 의미는 직접 소유하며 해당 상위 권한 계약을 대체할 OSS runtime을 반입하지 않는다. 교체 경계는 `GlobalRelationBudgetPort`, `AIProviderExecutionResolverPort`, `VPDecisionExecutionRepositoryPort`다. fake Port와 PostgreSQL implementation, 두 독립 runtime context 및 runtime DB role 계약을 검증했다.

최종 SQL review에는 `supabase-postgres-best-practices`의 lock ordering, partial indexes, least privilege 규칙을 적용했다. claim/usage와 job/call의 lock ordering을 검토했고 partial unique indexes를 재사용했다. `shotgun_runtime`의 실제 reserve/authorize/settle 성공과 policy DELETE 거부를 확인했다. 성능 개선 배율을 추정하지 않았다. Role Matrix에 이 제한된 결정과 rollback/교체 조건을 추가했다.

## 8. 통합·운영 전환 조건

**로컬 검토·후속 fake 제품 인수 준비는 완료. Canonical 게시 및 운영 적용은 승인 대기.**

1. 승인된 head에 대한 별도 push/PR/merge 검토가 필요하다. main은 이번 작업에서 갱신하지 않았다.
2. 운영에서는 기존 dedicated store `eac263d9-b96c-4a6f-aa95-ef0be89d01e0`, authority `5773b389-e122-4003-9505-2cf361c07ecc` 및 실제 credential fingerprint를 확인한다. 이번 테스트의 UUID로 대체하지 않는다. 실제 운영 store에 연결·변경하지 않았다.
3. 모든 old/live-capable relation runner를 정지한 상태에서 기존 RESERVED와 historical lease/UNKNOWN/FAILED를 조사한다. STOP 실험은 재개하지 않는다. mixed-version rollout을 승인하지 않는다.
4. 기존 authority에는 [별도 upgrade](../../../db/authority-migrations/001_relation_execution_fence.sql)를 승인 후 적용한다. old-schema RESERVED가 있으면 이 SQL 자체가 거부한다. store/policy/counter를 초기화하지 않는다. authority schema/config 변경은 운영 승인 범위다.
5. workload에는 main-compatible migration 129/130을 적용한다. source lineage migration 130/132/133/134와 번호를 그대로 혼합하지 않는다. 이미 local VP schema가 적용된 DB에 이 main migration을 바로 적용하는 절차는 승인하지 않았다.
6. 동일 authority URL/store/authority/limit 100을 모든 정상 worker에 구성하고 non-secret ID 및 fingerprint를 대사한다. metadata/credential 불일치와 authority 부재는 pause다. startup에서 권위가 unavailable였으면 정상 구성/복구 뒤 앱을 재시작한다.
7. armed UNKNOWN/receipt 없는 reservation은 자동 해제하지 않는다. 모든 관련 worker 중지, 원래 workload·restore ledger·provider provenance의 동일 binding 확인 후 **별도 승인된 reconciliation**으로만 disposition을 정한다. 확인 불가이면 counted/UNKNOWN을 유지한다. 과거 잘못 증가한 local count도 임의로 줄이지 않는다.
8. schema 적용 후 code rollback은 relation egress를 먼저 pause하고 additive columns/receipts/global usage를 보존하는 방식이다. 이전 unguarded worker를 재가동하거나 authority를 reset하지 않는다. adapter 교체도 같은 negative/recovery/cross-process 계약을 만족해야 한다.

## 9. 후속 우선순위

### Canonical PR 검증 보완

PR #381의 첫 CI는 P0 변경으로 이동한 transaction method 좌표가 current TS6 v8 inventory에 반영되지 않아 실패했다. [좌표 감사](./ts6-coordinate-audit.md)로 현행 inventory와 직접 recovery evidence를 갱신했다. 동결 TS6 history, 판정 validator, CI worker 수와 timeout은 유지했다.

두 번째 CI에서는 이 gate와 전체 일반 테스트가 통과했으나 PostgreSQL storage inventory에서 새 `vp_global_budget` schema가 기존 T3 분류표에 없어 실패했다. [소유권 분류표](../t3-storage-classification-register.md)에 보존 전용 네 테이블을 등록하고 정확한 table 수를 203에서 207로 갱신했다. JSON·JSONB·bytea column은 168개로 동일하다. Project reset owner를 추가하거나 전역 예산 삭제를 허용하지 않았다. 기존 provisioned authority reset 거부 검증을 유지한다.

이 보완은 소유권 문서·검증 기준을 additive migration에 맞춘 것이며 실행·의미 정책 bytes를 바꾸지 않는다. 최종 head, 필수 CI 및 원본/stash 보존 확인은 PR 게시 receipt로 별도 기록한다. Merge와 운영 적용은 승인되지 않았다.

이후 CI에서 같은 목록을 검사하는 unit test의 이전 30 schema/203 table 단언도 확인하여 31/207로 갱신하고 네 전역 권위 table의 정확한 목록을 추가 검증했다. 중복·누락 검사와 168 content-column 단언은 유지했다. 이 실패와 수정 이력도 최종 receipt에 포함한다.

P0 변경 검토·승인 → 운영 전환 조건 확인 → 현행 의미 정책으로 VP 제품 인수 → 정답 신뢰성·복수 해석·분모를 분리한 의미 평가. v11 활성화·새 구조 채택·Gold-B-7·VP-06은 별도 결정이다. 실행 안전 통과만으로 relation 의미 품질·SSC 우수성 또는 전체 VP-05 완료를 주장하지 않는다.

**본 실행은 P0 결과 보고 후 종료한다.**
