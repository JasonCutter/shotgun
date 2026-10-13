# VP-05 Candidate Frontier·완료·비용 계측 독립 감사

- Record: `VP05-FULL-FRONTIER-AUDIT-20261012`
- Canonical subject: `main@aba6ff27f9620ee1a3f408f8df81e8aad21cc584`
- Local reuse source: `vampire-vp/shotgun@1a36c7b55562783372dbc73c3188b9d797737c7e`
- Scope: static code/contract review. DB/provider/app 실행·기존 모델 output 읽기/재채점·Gold-B-7 개봉·stash 복원 **없음**
- Verdict: **CONCRETE FUNCTIONAL FRONTIER GAP / SELECTIVE REUSE WITH CORRECTIONS REQUIRED**. 평가 기준이 미검증이라는 이유로 기능 구현 전체를 중단하지 않으며, 현재 코드를 Frontier 완료라고 보고하지도 않음

## 1. Canonical에서 실제 동작하는 경계

| 위치                                                      | 관측한 현재 동작                                                                                                                          | 정확한 의미 / 부족                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `modules/vp-knowledge-ledger/src/index.ts:120`            | 매 dispatch `enqueueCurrentPairs(policyRevision, 1)` 후 `claimNext`                                                                       | 현재 SQL ranking의 미등록 쌍을 한 개씩 job으로 만든다. generation 완료 identity/membership 없음                   |
| `adapters/vp-knowledge-postgres/src/relation-jobs.ts:192` | 동일 project·동일 access-scope 배열·동일 sensitivity의 current assertions self-join, lexical similarity/cross-source/newness 순으로 LIMIT | pruning이 아닌 순서 결정이다. current bounded Frontier snapshot·generation digest·terminal generation 상태가 없다 |
| 같은 파일 `claimNext:340` / `claim:402`                   | select/lease는 attempt를 소비하지 않음. global bound claim 뒤 provider-call row와 local attempt 활성화                                    | P0 실행 경계는 유지해야 한다. Frontier 변경을 이유로 accepted boundary를 되돌리면 안 됨                           |
| `assemblies/shotgun-app/src/application.ts:1572`          | 실제 application relation worker v6, choice probability 0.9, persistent global execution dispatcher                                       | preserved local v11 활성화가 아님. 품질/모델 선택 변경은 이 frontier 보완의 필수 요소가 아님                      |
| `scripts/vp-projection-replay.ts:449`                     | `relationQueueComplete = pending=0 && failed=0 && unknown=0`                                                                              | 이미 생성된 job만 검사한다. 아직 다음 tick에 enqueue될 쌍이나 현재 후보 탐색 완료를 증명하지 못함                 |
| global budget Adapter `status:539`                        | persistent authority의 UTC day·store ID·authority ID·claimed count·limit                                                                  | 정규 app의 실행/예산 권위. workload-local CURRENT_DATE counter를 전역 limit으로 보고하면 안 됨                    |

`globalAuthorityRequired=true`에서 enqueue의 local budget 조건은 bypass된다. global budget pause 중에도 worker tick이 enqueue를 먼저 수행하면 새 job이 늘 수 있다. 이는 전역 provider 호출 상한 우회라는 증거가 아니다. **후보 membership이 미정인 채 매 tick 생성하는 구조의 backlog/수렴 문제**다. 현재 worker-OFF 운영 후보를 실제 처리한 것은 없다.

과거 tracker의 151 assertion/11,324 이론 쌍과 11,319 미등록이라는 값은 당시 역사 관측이다. 이번 DB를 조회한 숫자가 아니며, 이론적 모든 미생성 쌍을 필수 backlog로 다시 정의하지 않는다. 최신 ADR-173의 모집단은 고정된 bounded CandidateFrontier다. 다만 Canonical에 그 기능이 실제 구현됐다고 주장할 수는 없다.

## 2. 필요한 최소 기능

현재 문제는 `pending=0`과 `candidate discovery complete`를 구별할 durable identity가 없다는 것이다. 다음은 provider 의미 정책 변경 없이 필요한 기능이다.

1. project + **배열 순서를 보존하는** persistent security partition + current assertion/Evidence/SourceVersion snapshot + generator revision/config digest + active relation policy의 current Frontier를 식별한다.
2. bounded candidate membership를 완료 전에 고정하고, 각 pair를 기존 동일 input/policy의 결정 또는 durable job과 연결한다. discovery와 provider egress를 분리해 예산 소진 시에도 membership/backlog가 사라지지 않게 한다.
3. 완료는 **현재 identity의 generation complete + 모든 current membership의 disposition + pending/running/failed/UNKNOWN 0**을 확인한다. COMPLETED UNRESOLVED는 실행의 종결이며 정확한 의미 관계가 발견됐다는 뜻이 아니다.
4. SourceKnowledge READY는 처리된 SourceVersion/Evidence watermark에서 판단한다. 관계 농축의 미완료·예산 pause 때문에 직접 Evidence 질문을 막지 않는다.
5. 전역 budget state와 local attempt 통계를 별도로 노출한다. UTC authoritative count를 workload별 CURRENT_DATE counter로 대체하지 않는다.

이 기능 확인은 fake/isolated PostgreSQL membership·replay·restart·SourceVersion replacement·scope partition·budget pause contract로 가능하다. 후보 pruning recall, 의미 품질과 실청구 비용은 별도 독립 검증 모집단 및 실제 provenance가 있어야 측정된다. 합성 기능 PASS를 100% critical/≥99% overall semantic recall로 보고하지 않는다.

## 3. 보존 로컬 구현의 재사용 가치와 차단 결함

로컬의 `candidate-frontier.ts`, Frontier header/membership 설계, digest와 contract fixture는 위 최소 기능의 출발점이다. **전체 commit 또는 relation-jobs.ts를 그대로 가져올 수 없다.** 다음은 읽은 코드에서 직접 확인한 문제다. 이 감사에서 코드 수정이나 재실험은 하지 않았다.

| 발견                                                | 원본 위치 / 근거                                                                                                                                   | 선택 통합 시 필요한 보정                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope 배열의 의미를 바꾸는 partition key            | local `relation-jobs.ts:1059`는 `[...accessScope].sort().join(',')`로 묶는다. 현재 SQL pair join은 array `=`이며 순서를 보존한다                   | 실제 배열 bytes/length와 sensitivity를 canonical JSON으로 key화. 순서가 다른 배열을 임의 합치지 않음. separator 포함 scope collision도 제거                    |
| partition snapshot과 project status snapshot 불일치 | ensure는 group별 `computeAssertionSnapshotDigest(group.assertions)`; `getRelationEnrichmentStatus:1516`는 모든 project assertions로 한 digest 생성 | 현재 partition별 exact identity를 계산·조회한 뒤 안전하게 aggregate. 다중 scope/sensitivity regression 필요                                                    |
| 현재 generator identity 필터 누락과 중복 counts     | status lookup은 project/snapshot/policy만 사용하고 generator revision/config를 제외. 여러 header/membership의 같은 job을 count(*)                  | exact current identity 집합만 사용하고 candidate/job의 유일성을 명시. 과거 revision을 현재 backlog로 합산하지 않음                                             |
| 전역 예산과 local status 불일치                     | local status `1631`은 workload `vp.relation_call_budget WHERE budget_day=CURRENT_DATE`를 max100과 비교                                             | Canonical persistent global status를 명시적으로 공급. authority unavailable은 PAUSED/UNKNOWN으로 표시하고 local fallback 금지                                  |
| 지식 원장 우회 exact fallback                       | local `1278–1309`에서 receipt가 없으면 job store가 `decision_receipts/relations`를 직접 INSERT. 이 분기에는 project epoch/history append가 없음    | 기존 Ledger exact authority를 재사용. missing receipt일 때 새 관계를 쓰려면 Ledger의 epoch/history/idempotency 계약 안에서 수행. job-store 독립 지식 쓰기 금지 |
| stale job retirement 경로 손실                      | 기존 enqueue 안의 SUPERSEDED update가 FRONTIER 경로로 교체되면 그 update가 더는 실행되지 않음. ensure 경로에는 동일 retirement 없음                | current assertion replacement 시 미실행 old job을 명시적으로 retire. 활성 provider outcome/claim은 별도 accepted P0 reconciliation 경계를 유지                 |
| empty Frontier의 비영속 completion                  | assertion 0이면 random frontier ID와 COMPLETED를 반환하지만 header를 저장하지 않음. status는 state 부재를 incomplete로 봄                          | empty membership도 일관된 durable state 또는 명시적인 empty current status 계약으로 처리. `assertions>0`만으로 SourceKnowledge READY를 판단하지 않음           |
| scan 실패를 FAILED로 표시할 경로 부족               | ensure는 한 transaction에서 DISCOVERING→COMPLETED. SQL 오류는 rollback하며 별도 durable FAILED write/return 없음                                   | 실제 failure를 완료/빈 성공으로 위장하지 않음. minimal failure/readback 표현과 재진입 disposition 필요                                                         |
| config digest와 알고리즘 동작의 대응 부족           | `CandidateGeneratorConfig.passes/textNormalization`은 digest에 들어가지만 score/generation은 이 필드를 분기로 적용하지 않음                        | 지원하는 exact config만 허용하거나 필드의 실제 적용을 구현. 실행하지 않는 pass를 identity로 광고하지 않음                                                      |
| Top-K가 CPU scan까지 줄이지 않음                    | local `candidate-frontier.ts:419–439`는 각 assertion에 모든 다른 assertion을 score한 뒤 sort/topK. 저장 membership만 bounded                       | n(n−1) scoring 및 per-assertion sorting 비용을 명시. high-scale candidate scan 성능을 검증하지 않고 `O(nK)` 전체 실행이라고 보고하지 않음                      |
| migration 번호 충돌                                 | local `129_vp_candidate_frontier.sql` vs Canonical `129_vp_global_relation_budget_authority.sql` + `130_vp_relation_egress_activation_binding.sql` | 이미 accepted 129/130 bytes를 덮어쓰지 않음. 현재 migration chain 뒤의 별도 번호와 isolated upgrade/restore test로 연결                                        |
| worker의 silent legacy fallback                     | local worker는 FRONTIER default지만 optional method가 없으면 legacy enqueue로 fallback                                                             | 정상 app은 required Frontier Port를 검사해 fail closed. 기존 legacy/fake tests의 호환 경로는 명시적 replay/test composition으로 유지                           |

Local candidate scoring은 exact text, formula/number anchors, cross-source bonus, trigram/keyword를 합산한다. topK20은 frozen 개발 선택이지 independently verified recall을 증명하는 숫자가 아니다. 단일 pg_trgm threshold로 교차언어 관계가 탈락한 과거 synthetic 관측도 자동으로 이 generator의 의미 recall을 인증하지 않는다.

Snapshot은 transaction 밖에서 읽은 뒤 advisory lock을 잡는다. SourceVersion/permission replacement와 교차할 수 있으므로 currentness recheck·snapshot 취득과 전환의 fencing·lease/result publish authority가 함께 필요하다. old persistent assertions FK가 유효하다는 사실만으로 current SourceVersion임을 증명할 수 없다.

## 4. 안전한 선택 통합 순서와 재사용 판단

- **AUGMENT existing local Shotgun code**: pure normalization/feature scoring/digest를 기준으로 config와 identity 부합을 보정하고, header/membership 개념을 현재 P0 relation job adapter에 추가한다. 새로운 provider·runtime·database authority는 도입하지 않는다.
- migration은 현재 Canonical chain 뒤에 별도 적용한다. accepted 129/130, immutable old evidence, actual v6/.9/router 및 persistent global authority의 의미는 보존한다.
- old source의 local budget/worker binding/response policy를 가져오지 않는다. **현재 execution-bound resolver/dispatcher/claim/job/semantic-attempt/credential/fence** 경계를 그대로 이용한다.
- deterministic exact knowledge는 existing Ledger receipt/history authority로 만족시킨다. Frontier orchestrator는 knowledge authority의 대체물이 아니다.
- replay/제품 status는 current bounded membership의 완료와 source readiness를 분리한다. 후보가 미선정된 이론적 쌍은 진단 universe이며 필수 호출로 자동 승격하지 않는다.
- 초기 기능 검증은 current app composition + fake provider + isolated PostgreSQL에서 한다. 실제 AI/운영 candidate 처리 또는 pruning threshold 조정은 이번 정적 감사의 일부가 아니다.

기존 OSS Role Matrix의 PostgreSQL transaction/locking·gbrain orchestration REFERENCE_ONLY·lucas exact-Evidence 경계를 재사용한다. 로컬 계획의 Splink/Dedupe 블로킹은 REFERENCE_ONLY이며 외부 Python/DuckDB/Spark 런타임을 복사할 이유가 없다. 그 계획의 pin/license 표시는 역사 검토 기록이고 현재 package import 검증을 자동 면제하지 않는다. 실제 선택 통합 시 기존 Source Registry와 적용 코드 범위의 계약/보안/복구 검증을 기록한다.

## 5. 비용 계측의 현재 강점과 정확한 부족

현재 global claims는 UTC authority/budget day/workload/job/attempt/provider identity·response ID·reported tokens·failure state를 가진다. local provider-call row는 request/execution identity·activation·stored decision/UNKNOWN fence를 가진다. `completeDecision` receipt에도 model/input/output tokens가 있다. 이는 accepted P0의 유효한 재사용 성과다.

그러나 receipt token 합계만으로 비용을 재면 withheld/schema failure/provider failure/UNKNOWN 호출을 놓친다. 모든 authorized egress 및 재시도·reservation-release·UNKNOWN을 포함한 global claim provenance를 기준으로 response의 reported usage를 연결해야 한다. **reported usage ≠ 실제 청구 대사**이며 missing tokens/billing line은 미확인으로 남긴다. queue generation duration, current frontier generation duration, semantic egress latency p50/p95, 각 workload의 task count, response/schema/adoption disposition, source/case 단위 반복을 구분해야 한다.

정적 코드는 이런 권위적 provenance를 제공할 일부 기반이 있지만 제품에서 current Frontier generation/backlog/예산 pause를 일관되게 노출하거나 real billing을 대사한 증거는 이 감사에서 얻지 않았다. 이전 tracker의 시간·tokens·estimated-price는 해당 역사 scope 그대로 유지한다. 이번 모델 성능·실청구 수치는 계산하지 않았다.

## 6. A3 provenance validator의 오용 위험

`packages/vp-relation-evaluation/src/validation.ts`의 `externalVerificationErrors`는 method/locator/digest/subject/scope/date/expertise/independence/disagreement 필드를 검사한다. 함수가 실제 인간을 관찰하거나 문서 진위·전문성·독립성을 확인하는 것은 아니다. `EXTERNALLY_VERIFIED`는 **A1 운영자가 확인한 외부 증거를 기술하는 supplied assertion**이다.

| 잠재 오용                                                                              | 금지 / 필요한 대응                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 모든 필드가 채워졌으므로 사람 검증 완료라고 주장                                       | 구조 적격과 실제 외부 verification을 분리. AI는 이 필드를 자기 판단만으로 작성해 certification Gold를 만들 수 없음                                       |
| `referenceCertification/externallyVerifiedReferences` count를 자동 인간 승인 수로 읽음 | count는 supplied provenance 조건을 만족한 artifact 수다. 실제 external evidence 확인 기록과 감사 scope를 함께 제시; 그 증거가 없으면 실제 Gold count는 0 |
| AI가 WARRANT matches를 작성해 full tuple TP로 보고                                     | `ASSESSED`에도 독립 external record/subject digest 대응이 필요하며 실제 의미 검증은 validator 밖의 A1 책임. native v6 warrant 미관측은 N/A/coverage      |
| 공개 dataset 명성과 label을 scope 대응 없이 Gold로 import                              | input·taxonomy·warrant·direction·language·critical obligation의 exact 검증 범위가 대응해야 함. SNLI/FEVER 조사만으로 자동 대응 아님                      |
| synthetic verification fixture를 실제 receipt로 저장                                   | fixture는 synthetic unit-only. 자연어 label·reference 승인 evidence 생성이 아니며 certification lane에 합산 금지                                         |

A3 보고서와 계약에는 이 한계를 명시했다. 코드 API는 verification의 진위를 proof하지 않으며 새로운 reviewer DB/승인 서비스로 해결하려 하지 않는다. 후속 실제 certification report는 원래 검증 provenance와 에이전트의 확인 범위를 함께 제출해야 한다. 현재 독립 검증된 새 reference **0**, certified semantic quality **N/A**다.

## 7. 검증과 보존

검증 방법은 위 source 함수·SQL·accepted ADR/DoD/tracker·현재 global Adapter를 대조한 정적 독립 감사다. 새로운 provider/DB/Frontier test 실행은 하지 않았다. 새로운 schema/runtime 변경도 이 감사에서 하지 않았다. 운영 5,362 후보 처리·Gold-B-7·B 잔여24·432/B12 결과 재채점·stash 복원·push/PR/merge는 수행하지 않았다.

읽은 로컬 재사용 파일의 SHA-256:

| 파일                                                       | SHA-256                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `adapters/vp-knowledge-postgres/src/candidate-frontier.ts` | `966014c82ac603d9c41dd5772e13c392430b6ddce08288b01a009a41e3929de0` |
| `adapters/vp-knowledge-postgres/src/relation-jobs.ts`      | `25a7845bf211349f982d89251548cdb4e99c9141390f7e320aa82164399ca007` |
| `db/migrations/129_vp_candidate_frontier.sql`              | `c36aa99070ab4b829bf79d81cf11c1bed1304580d19553b5937367c329791ecd` |

이번 소유 diff는 이 감사 문서 하나다. 현재 parallel implementation과 과거 read-only reuse source를 구분하며 local source의 code/evidence bytes를 수정하지 않았다. 후속 기능 구현은 위 식별된 보정 범위와 isolated 계약 증거에 근거해 진행할 수 있지만, 그 성공만으로 독립 Gold·규모 품질·실청구 Gate가 완료되는 것은 아니다.

## 8. 후속 Canonical-compatible 구현의 독립 검토 및 최소 보정

위 1–7절은 선행 정적 감사 이력이다. 이후 full-completion 지시 안에서 상위 에이전트가 새로운 `candidate-frontier.ts/frontier-store.ts`, 별도 migration132, 명시적 normal worker FRONTIER 및 current replay status를 구현했다. 보존 로컬 migration129/전체 store를 가져오지 않았으며 v6·0.9·accepted global execution binding과 Ledger 쓰기 경계를 유지했다.

독립 검토에서 **membership count만 맞으면 완료로 보고하는 결함**을 확인해 최소 보정했다. 실제 bound job의 ordered left/right/rank를 재구성하고 stored membership digest·정규 쌍 순서·연속 rank·policy·count를 함께 검사한다. cached ensure의 early return에도 같은 검사를 적용한다. count가 그대로인 rank·digest·foreign-policy job binding 변조는 generation/executionComplete=false이며 ensure는 명시적 integrity 오류로 중단한다. 잘못된 membership를 자동 보정하거나 provider 작업을 실행하지 않는다.

상태 읽기는 project active/status와 reset READY를 확인한다. 미등록/비활성/reset-fenced project를 빈 current READY로 반환하지 않는다. inactive project의 current header가 남아 있어도 Frontier claim 경로에서 실행하지 않는다. exported status helper는 PoolClient 및 explicit REPEATABLE READ/SERIALIZABLE snapshot을 요구하며, 실제 wrapper/replay는 이미 이 snapshot을 사용한다. assertions·header·membership·job counts를 서로 다른 pooled transaction의 시각으로 합쳐 완료라고 표시하지 않는다. 새로운 transaction owner는 추가하지 않았다.

상위 에이전트는 global authority가 없을 때도 **unpaid discovery**가 진행되도록 별도의 single-flight discovery timer를 application 구성에 추가했다. timer는 ensure만 호출하며 claim/provider/credential fallback을 하지 않는다. 실제 app/worker 운영 기동을 수행했다는 증거가 아니며 외부 egress는 계속 별도 global binding에 제한된다.

새 generator revision은 `vp-candidate-gen-v2-bounded-postings`다. config는 topK20/maxFeatures64/maxPosting128/maxPool128/neighborWindow8/maxAssertions50,000을 명시하고 실제 동작에 적용한다. scope 배열 순서·project·sensitivity 파티션을 유지한다. claim text, Evidence, SourceVersion과 security metadata의 current snapshot에 결합한다. 전체 N² scoring을 사용하는 보존 local v1과 같다고 주장하지 않는다. capped postings/UUID neighbor ordering/feature·pool 제한은 의미상 관련 쌍을 놓칠 수 있으므로 **semantic pruning recall은 UNVERIFIED**다. 독립 verified-positive membership가 없으면 A3 Frontier recall은 N/A이며 100% critical/≥99% overall 요구를 충족했다고 보고하지 않는다.

### 독립 검증 결과

| 검증                                                                                                                                 | 결과 / 정확한 범위                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sanitized `vitest run tests/database/vp-candidate-frontier.database.test.ts tests/unit/vp-candidate-frontier.test.ts --maxWorkers=1` | **PG 7 PASS + unit 5 PASS = 12 PASS**. 실제 독립 test PostgreSQL만 사용, provider calls 0                                                |
| Header/membership integrity                                                                                                          | same-count rank/digest와 foreign-policy binding 변조 거부; 원본 isolated fixture만 finally에서 복구                                      |
| Current/empty/retired state                                                                                                          | durable empty identity 재사용, new assertion snapshot invalidation, UNKNOWN 미완료, inactive/unknown project unavailable                 |
| Idempotency scope                                                                                                                    | 두 independent PG connections 및 새 store instance의 재진입 확인. 같은 OS process이며 별도 OS process kill/restart proof라고 부르지 않음 |
| Attempt/egress                                                                                                                       | discovery의 attempt_count 0 및 provider-call row 0. global authority DB를 연결하거나 예산을 초기화하지 않음                              |
| Snapshot                                                                                                                             | direct helper의 default READ COMMITTED 호출 거부. wrapper/replay의 RR 사용 유지                                                          |
| Owned Frontier ESLint / format                                                                                                       | **PASS**                                                                                                                                 |
| 전체 root typecheck 관측                                                                                                             | Frontier 오류 **0**. 병행 backup-restore test의 readonly-array 타입 오류 1건을 상위 에이전트에 전달; 전체 Gate는 최종 통합 기록에서 판정 |

이번 독립 보정은 Frontier store·inactive claim 조건·focused PG tests·이 문서에 한정한다. migration/알고리즘을 다시 설계하거나 과거 frozen output을 새 scorer로 읽지 않았다. 기존 72/432/B12, Gold-B-7, stash, 운영 authority·Vault·DB, v11/.9·정책·AI 실행 금지 경계를 보존하며 추가 commit/push/PR/merge를 수행하지 않았다.
