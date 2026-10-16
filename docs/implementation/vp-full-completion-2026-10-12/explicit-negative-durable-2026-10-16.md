# VP-05 — 명시적 관계 부재의 격리 저장·복구 연결

- 기준: Canonical `89c14c5e2fee9559e21b6b964098a11f4e8cc0e2`, 선행 로컬 `a93dd216e2d85d0f96318d549e4244eb65d4eacb`
- 승인: 두 변경안의 격리 구현·인수 계약 정비 및 후속 “기준은 절대적이지 않다 … 다음 작업 계속”
- 상태: **LOCAL ISOLATED EXECUTION / NOT PUBLISHED / PRODUCTION OFF**
- 결과 보존 계약: `vp-explicit-negative-durable-fake-v1`
- 의미 정책: `vp-relation-v6-explicit-negative-isolated-v1`; RELATED 정의와 selected probability0.9 유지

## 1. 실제 병목과 선택

첫 단계 Fake protocol은7종 출력을 구분했지만 기존 실행 repository가6종
decision만 저장·복구할 수 있었다. 부정 결과를 UNRESOLVED로 바꾸면 의미가
소실되고, 기존 decision_receipts CHECK를 느슨하게 바꾸는 것만으로는 negative의
실행·projection 계약이 완성되지 않는다. 이번에는 기존 호출 원장의 versioned
JSON output과 lease/activation/fencing을 재사용하는 최소 격리 연결을 선택했다.

기준도 보정 대상이다. 앞선0.2 평가의 N/A·분모 분리와 승인된 인수/인증 구분을
유지하면서, “현재 계약과 일치하니 문제가 없다”는 종결 논리를 사용하지 않는다.
기준의 반례·변경 이유·적용 version·과거 결과 영향·불확실성을 남긴다. 기준
변경으로 옛 결과를 재채점하거나 실제 모델의 의미 정답을 만들어내지는 않는다.

## 2. 재사용 및 영향 범위

- **AUGMENT**: Shotgun의 기존 execution repository/job store/worker/global
  budget dispatcher/transaction helper. 검토 source pin은 위 Canonical과 선행
  로컬 commit. 새 dependency/lockfile 변경 없음.
- 외부4개 후보는 [기존 검토](./evaluation-a3-implementation.md)의 exact
  commit·license·security·유지보수 판단을 재사용한다. gbrain의 실행/원장 패턴,
  lucas의 provenance, ddsyasas/OpenKnowledge의 제품 표시 패턴은 REFERENCE_ONLY.
  이7종 정책의 claim/lease/credential/global authority 계약을 제공하지 않으며
  전체 runtime/DB를 가져오지 않는다. OSS Role Matrix의 채택 상태는 그대로다.
- `VPDecisionExecutionRepositoryPort<Output>` 및 job store의 output validator를
  명시적으로 parameterize했다. 기본 인자와 기본 validator는 v6와 동일하다.
  기존 전역 counter/예약/credential 검증 알고리즘을 재설계하지 않는다.
- actual `VPRelationJobWorker`에 policy store가 검증하는 no-edge terminal 분기를
  추가했다. 일반 store는 이를 제공하지 않으며 일반 router도 이 분기를 반환하지 않는다.
- isolated store는 child test DB 및 프로젝트를 지정해야 한다. Fake router는
  exact revision/lease/권한을 확인하고 non-Fake identity를 activation 전에 거부한다.
  격리 PostgreSQL의 실제 identity와 서버 제한은 기존 test DB helper/transport가 검증한다.

## 3. 저장과 복구

1. 실제 job 선택/lease. 이 단계는 semantic attempt를 소비하지 않는다.
2. 이전 OUTPUT_STORED가 있으면 입력/record digest를 검증해 재사용한다. 새
   configuration/credential resolve 또는 global claim을 만들지 않는다.
3. 새로운 경우 resolver를 한 번 호출하고 Fake context를 고정한다. 같은 실행
   context에서 전역 reservation/binding과 local activation을 거쳐 Fake를 호출한다.
4. exact input, 정책/schema digest, raw response, disposition, usage/provider
   observation을 기존 provider-call row에 저장한다. 잘못된 JSON도 INVALID로
   보존하고 부정 정답으로 바꾸지 않는다. missing usage는0으로 추정하지 않는다.
5. 긍정 결과는 기존 decision_receipts/edge/history 경로로 완료한다. NO_RELATION,
   MODEL_ABSTAINED, WITHHELD, INVALID는 no-edge 완료하며 raw 결과는 그대로 둔다.
   job의 `ISOLATED_*` last_failure_code는 격리 outcome 표시용이다. NO_RELATION이
   provider 실패라는 뜻이 아니며 실제 의미 상태는 저장 record로 구분한다.
6. 결과 저장 전 불확실성은 기존 RUNNING/OUTCOME_UNKNOWN fence를 유지한다.
   저장 후 failure는 기존 output을 읽어 finalization만 수행한다. commit ACK
   유실은 idempotent readback/finalization으로 처리하고 provider를 다시 호출하지 않는다.

negative의 지속 식별자는 기존 provider call_id/job_id/global_claim_id/
semantic_attempt_id와 record digest다. UNRESOLVED라는 거짓 decision receipt나
별도 negative 권위를 생성하지 않는다. 이 record는 모델 선언이며 Fact가 아니다.

## 4. 초기 실패와 보정

최초 DB 실행은1 PASS/15 FAIL이었다. 반복 synthetic 원문이 content_hash unique
제약에 충돌했고, 새 테스트 일부의 fixture 준비가 기본5초 동작 제한 안에
포함됐다. Docker PG transport에서 fixture 준비가 약6초 이상 걸리는 것을 확인했다.
원문 fixture의 식별 정보를 분리하고 준비를 beforeEach hook으로 옮겼다. 테스트
동작은 표준5초를 유지하며 assertion 삭제·skip·생산 timeout 변경은 없다.
이후16/16 PASS했다. 초기 실패 로그와 이력을 보존한다.

새 contract mock의 status literal이 string으로 추론되어 첫 typecheck가 실패한
것도 보존한다. mock에 literal type을 명시하며 생산 validator를 완화하지 않는다.
추가 crash/concurrency cases 및 최종 static/release 결과는 아래에 확정 기록한다.

기존 P0 boundary12건도 같은 Docker 연결 준비가5초 안에 들어가 timeout이 났다.
준비를 beforeEach로, 두 번째 workload DB 생성·폐기를 suite lifecycle로 이동했다.
기존12건의 assertion·표준5초 동작 제한을 유지한 재실행은12/12 PASS다. 실제
프로세스 강제 종료2건 및 기존 정상 app bootstrap4건도 PASS다.

정상 app regression이 과거 `main-worker-trace.json` 경로를 직접 쓰는 기존 결함도
확인했다. 이번 실행의 새 trace를 별도 폴더에 보존하고 기존 tracked 기록은 이전
commit의 exact 내용으로 복원했다. 이후 test는 명시 trace output 또는 temp만
사용하도록 고쳤고 AUTHORIZED 경로를 다시 실행해 원래 기록이 바뀌지 않음을
확인했다. 운영 이력이나 동결 결과를 새 테스트 증거로 덮어쓰지 않는다.

TS6는 새 코드의 좌표/함수를 정확히 감지하여 처음 실패했다. 기존6개 함수는
file/class/method/ownership/classification/reachability가 같은 것을 대조해 current
v8 좌표만 옮겼다. 새 finalizer는 **TEST_ONLY_OR_DEAD**로 기록하며 실제 앱 도달
가능성을 주장하지 않는다. 최초 추론된 fixture receiver는 정적 검증에서
unqualified로 거부됐다. 직접 생성한 scoped store를 호출하는 기존 거부 assertion을
연결해 resolver를 통과했다. validator 규칙은 바꾸지 않았다.

표준 감사의 초기53건 중48 PASS/5 FAIL은 새 함수1개로 인한 현재 집계 기대값
차이였다. 현재 candidate144→145, boundary130→131 및 legacy 방식으로 **현재
소스**를 읽은 TEST_ONLY13→14를 반영했다. 옛 v2의100/13 등 역사 수치는 그대로다.
새 함수가 정상 앱에 연결되지 않았다는 명시적 assertion을 추가한다. 과거v2~v7,
원래 test identity·negative assertion·timeout·worker 설정은 유지한다.

새 회귀 trace도 focused 실행과 full 실행이 같은 파일명을 재사용하지 않도록
실행별 UUID 하위 경로로 분리했다. 초기 full 로그와 focused 로그는 보존한다.
새 출력 경로에서 full19건을 다시 실행해 **19/19 PASS**와 실행별 raw trace를
확정했다. 해당 UUID trace와 모든 실행 로그를 별도 evidence index로 보존한다.

## 5. 보장 범위와 잔여 제품 작업

이 작업은 실제 worker와 PostgreSQL 실행 저장·복구의 격리 proof다. 정상
`startShotgunApplication`이 새 정책을 선택하는 통합 proof가 아니다. 일반 앱의
v6 instruction/schema/default gate와 bootstrap은 유지한다. 그 경로의 기존 P0
runtime test는 회귀로 재사용하며 새 정책의 정상 앱 proof로 재명명하지 않는다.

기존 `decision_receipts` CHECK와 `current_relations`는 그대로다. 따라서 새
negative가 과거 positive를 대체하는 현재 지식 projection, 일반 Ask/UI에 negative를
노출하는 정책, 운영 이관은 **미구현·미검증**이다. 이 경계가 필요하면 기존
Ledger의 history/projection 안에서 별도의 최소 설계·migration 검토가 필요하다.
호출 원장의 JSON을 두 번째 지식 원장으로 바로 사용하지 않는다.

Fake tuple은 프로토콜 분기용이며 자연어 의미 정답이 아니다. 현재 certified Gold0,
실제 모델 품질/calibration N/A를 유지한다. 새 AI 실호출·과거72/432/B12 재채점,
Gold-B-7 개봉·B 잔여24·운영 앱/worker·운영 DB/authority/configuration 변경은 없다.

Migration: **없음**. Rollback은 opt-in router/store/terminal 분기와 generic codec
지원의 revert다. 기존 v6 저장형식은 그대로이며 신규 isolated record를 v6로
강제 변환하지 않는다. test child DB는 helper로 폐기하고 운영 이력을 이관하지 않는다.
교체 codec/adapter도 Fake 제한·exact input·raw 보존·negative/기권/보류·UNKNOWN·
재호출 방지·기본 v6 거부의 contract를 통과해야 한다.

## 6. 최종 검증

확인된 검증:

- 관련 unit/contract **114/114 PASS**(unit93, contract21).
- 신규 격리 PostgreSQL **19/19 PASS**. explicit negative/기권/보류/INVALID,
  pre-egress4종, output 저장 전/후 crash, stranded reservation, activation ACK
  유실, completion ACK 유실, concurrent workers, normal-v6 codec 거부를 포함한다.
- 기존 P0 boundary **12/12**, process crash **2/2**, actual v6 app runtime
  **4/4 PASS**. 추가 output 경로 proof1건과 직접 receiver proof1건 PASS는 중복
  보완 검증이며 새 의미 사례나 추가 독립 품질 표본으로 세지 않는다.
- 추가 focused 실행에서 각각 나머지3/18건은 test-name filter로 실행되지 않았다.
  소스 skip을 추가하지 않았으며 full run의 해당4/19건은 모두 실행·통과했다.
- Root typecheck·ESLint·문서/ADR/Canonical 검증 PASS. 최종 TS6 표준 감사와
  release 모두 PASS. 표준 명령의 **4 files / 54 tests PASS / 0 FAIL / 0 SKIP**다.
  기존53건에 normal-app 미연결 검사1건을 더했다. v8 재생성과 source inventory
  대조가 통과했고 validator·역사v2~v7는 변경하지 않았다.
- 일반 v6 instruction/schema adapter, 정상 app bootstrap, 전역 counter 구현
  bytes가 Canonical과 동일하다. generic화한 execution-boundary의 TypeScript
  emit JS도 Canonical과 같다. 반면 worker와 persistence 기반 코드는 바뀌었으므로
  과거 전체 semantic digest를 그대로 새 구현 identity라고 주장하지 않는다.
- 보호79파일·다른13worktree HEAD/status·configuration·stash는 동일하고 운영
  PostgreSQL2개는 exited다. 기존 historical worker trace도 Git 원문과 같다.
  격리 test DB만 생성·폐기했으며 생산 migration/DB 변경·실제 provider 호출0이다.

실제 v6 app의 UNAVAILABLE_AUTHORITY case는 private PG transport가 blackhole
포트를 거부하여 fail-closed를 관측했다. 서버 outage에 실제로 접속한 proof로
과장하지 않는다. 새 policy의 crash cases는 주로 경계 예외/재인스턴스 simulation이며,
실제 OS process kill2건은 기존 v6/P0 경로의 회귀 proof다. 범위를 섞지 않는다.

격리 실행 저장·복구 연결과 기준 보완은 로컬 완료다. normal app/Ask의 negative
knowledge projection·운영 적용·실모델 의미 품질 또는 VP 전체 최종 인수 완료는
이 결과로 선언하지 않는다. 게시/merge는 별도 승인 상태를 따른다.

증거 폴더:
`C:/dev/artifacts/vp-full-completion-2026-10-12/explicit-negative-durable-20261016/`.
