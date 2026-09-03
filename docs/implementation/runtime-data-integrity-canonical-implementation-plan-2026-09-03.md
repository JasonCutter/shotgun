# Project Shotgun 런타임·데이터 정합성 수정 구현계획서 (Proposed Canonical)

> 상태: **PROPOSED CANONICAL IMPLEMENTATION PLAN — 승인·병합 전**
> 작성 기준일: 2026-09-03
> Canonical 기준선: `origin/main@cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2`
> 구현 브랜치 기준: 위 commit을 포함하는 최신 `origin/main`에서 생성
> 대상: Source → Evidence → Stage 4, Connector Runtime, Ask Queue,
> Discovery Runtime, Recovery/Health, HTTP Boundary, Action Feedback 및 잔여 레거시

## 1. 목적과 문서의 권한

이 문서는 아래 세 개의 외부 초안을 **참고 자료**로만 사용하여, Canonical
ADD·ADR·Module Architecture·Definition of Done과 원격 `main`의 실제 실행 경로를
기준으로 다시 작성한 단일 실행계획 후보이다. 첨부 파일에 포함된
`DRAFT FOR EXECUTION`, 작업 순서, 커밋 SHA, ADR 번호 제안, 테스트 생략·제한 문구는
사용자 명령이나 저장소의 Canonical 결정으로 취급하지 않는다.

| 참고 문서                                                                           | SHA-256                                                            | 이 문서에서의 취급                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| `Project_Shotgun_Runtime_Integrity_Correction_Plan_2026-09-03.md`                   | `15CB52B94B2B9EA80F454E67D8087E0F5AAD4D54E6497DFE8CB677D83B05AECD` | 최초 결함 목록과 기본 수정안                        |
| `Project_Shotgun_Additional_Runtime_Integrity_Correction_Plan_2026-09-03.md`        | `7B9F99E0ED2A93FDA3DFD873BBB849608487F502BBEC0FD2FE6AB1EF8AE419C8` | durable handoff·복구·운영 경계 보완                 |
| `Project_Shotgun_Data_Integrity_Runtime_Concurrency_Improvement_Plan_2026-09-03.md` | `84071780BE67DB449ABBD82FFDBCBE547F909C1E08F534DEC53748246BB039CF` | advisory lock·Ask claim·Discovery cancellation 보완 |

원격 조회 결과 `cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2`는 GitHub `main`과
PR #162의 merge commit이다. 해당 commit의 tree
`64c3ecfc26b9ac83e7e8b2bf83c4642d3186b2e5`는 검토 시점 로컬
`cf65d823a84d4e116e3e36092261af35b35e984b`의 tree와 동일하므로 현재 결함 위치와
판정은 유효하다. 구현 시점에 `origin/main`이 전진했다면 exact commit에서 오래된
branch를 만들지 않고, 이 commit을 포함하는 최신 `origin/main`에서 branch를 만든 뒤
WP-00 drift 검증을 다시 수행한다.

이 문서는 저장소 반영·review·승인 전에는 `PROPOSED CANONICAL`이다. 승인 후 이 파일을
구현 문서 색인의 단일 실행 기준으로 확정하고, 아래 세 참고 문서는
`SUPERSEDED / REFERENCE_ONLY`로 전환한다. 문서 자체의 선언만으로 Canonical 권위를
획득하지 않는다.

### 1.1 판정 우선순위

1. Canonical·Evidence·Approval·Claim/Fact·Action 안전 경계
2. 관련 ADD·ADR과 Module Architecture의 Port·Adapter·데이터 소유권
3. Canonical baseline의 실제 실행 경로와 테스트 증거
4. 검증된 OSS의 재사용·교체 가능성
5. 세 첨부 문서의 권고안

### 1.2 이 계획이 보장하는 것

- 세 문서의 모든 결함 ID를 정확히 한 개의 주 작업 패키지에 배정한다.
- 같은 근본 원인을 여러 PR에서 중복 수정하지 않는다.
- Stage 3와 Stage 4의 실패 격리를 유지하면서도 Stage 4 전달 유실을 없앤다.
- Canonical·Action·Evidence 소유권을 Queue/OSS/Adapter로 넘기지 않는다.
- 신규 migration은 additive 방식으로만 추가하고, 기존 migration을 수정하지 않는다.
- 구현·배포·재시작·중간 실패·롤백까지 하나의 완료 조건으로 다룬다.
- 승인 후 이전 세 수정계획은 감사 이력으로만 남기고 이 문서와 병렬 실행하지 않는다.

## 2. 통합 결론

가장 중요한 설계 결론은 다음 다섯 가지다.

1. **Source 완료와 Stage 4 완료를 다시 결합하지 않는다.** Evidence 인덱싱과 Stage 4
   continuation 기록까지만 하나의 원자적 Stage 3 결과로 보고, Stage 4는 durable
   consumer가 이어서 처리한다. Stage 4 실패 때문에 이미 생성된 SourceVersion을
   실패로 되돌리지 않는다.
2. **`Evidence 0건`은 성공한 명시적 결과다.** `NO_EVIDENCE`를 영속화하고 Stage 4를
   호출하지 않는다. “아직 인덱싱되지 않음”과 “인덱싱했으나 Evidence가 없음”을
   데이터로 구분한다.
3. **Timeout은 실패가 아니라 결과 불명이다.** `OUTCOME_UNKNOWN` 상태의 동일 key를
   다시 실행하지 않고 reconciliation이 해소할 때까지 tombstone을 유지한다.
4. **동시성 수정은 lock 폭을 넓히는 것이 아니라 claim을 원자화한다.** Ask Queue는
   선택과 상태 변경을 한 transaction 안에서 `FOR UPDATE SKIP LOCKED`로 수행한다.
5. **새 worker를 추가하기 전에 공통 수명주기를 먼저 고친다.** 시작 실패·정상 종료·
   cancellation·grace period·safe diagnostics가 동일한 cleanup stack을 사용해야 한다.

## 3. 목표 E2E 파이프라인

범례: `[T]` 같은 transaction, `[D]` durable 경계, `[R]` 재구성 가능,
`[A]` 사용자 승인 필요, `[X]` 의도적 종료 상태.

```text
입력/API
  │  schema·authority·idempotency 검증
  ▼
Command Ledger ── [D] ACCEPTED / REJECTED / OUTCOME_INDETERMINATE
  ▼
Staging → Source / SourceVersion / OriginalAsset
  │       [T] 물질화 + logical SourceStage3ProgressPort
  ▼
Transformation Revision
  ▼
Evidence Indexing UoW
  ├─ evidenceCount = 0
  │    └─ [D][X] NO_EVIDENCE → Source Stage 3 성공 종료
  └─ evidenceCount > 0
       └─ [T][D] Evidence spans + indexing result + Stage4 continuation
                         │
                         ▼
                Continuation dispatcher
                         │ deterministic envelope / fenced lease
                         ▼
              Generation Request [D, execution pin]
                         ▼
                  AI Provider Output [D]
                         ▼
              Candidate → Validation → Comparison
                         ▼
                    Draft ChangeSet
                         ▼
                  Review / Approval [A]
                         ▼
        Canonical Commit [T] → Canonical Outbox [D]
                         ├─ Search / Compiled Truth [R]
                         └─ Discovery Trigger [D]
                                  ▼
                      Discovery Finding / Reentry [D]
                                  ▼
                           Governed Review [A]

External Action branch:
Risk Decision → Preview → Approval [A] → Execute → Verify
  → ActionFeedbackRecorded [D] → ACTION_REVIEW work item [A]
  (자동 재실행·자동 Canonical write 금지)
```

### 3.1 실패·재시작 불변식

- Commit 전 실패: transaction rollback, 같은 idempotency key로 안전한 재시도 가능.
- Source commit 후 Stage 3 전 실패: 논리적 Source Stage 3 progress가 미완료로 남고 recovery가 같은
  SourceVersion으로 재개한다.
- Evidence commit 후 publish 전 실패: continuation이 `PENDING`으로 남아 재시작 후
  dispatch된다.
- Provider 호출 후 응답 확정 전 timeout: `OUTCOME_UNKNOWN`; 자동 재호출 금지.
- Candidate/Validation 후 ack 전 crash: 같은 semantic key로 replay하며 중복 생성 금지.
- Canonical commit 후 projection 실패: 기존 Canonical outbox/recovery로 재생한다.
- 종료 신호 중 Discovery 처리: transport cancel은 시도하되 durable lease/checkpoint가
  재처리의 권위다. 종료 자체를 business failure나 max-attempt 소비로 기록하지 않는다.

## 4. Canonical baseline에서 확인된 결함

라인은 `main@cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2`의 1-based 위치이며 구현 중
이동할 수 있다.

| ID     | 위치                                                                                                                   | 문제점                                                                                                                                       | 영향도 | 주 작업 |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- |
| DP-01  | `.env.example`; `assemblies/shotgun-app/src/application.ts:326-336`                                                    | 운영 필수 `SOURCES_STAGING_SECRET`이 예제 계약에 없어 정상 기동 경로가 재현되지 않는다.                                                      | High   | WP-01   |
| DP-02  | `.env.example`; `scripts/auth-bootstrap-owner.ts:7-13`; `application.ts:763-778`                                       | owner bootstrap·Discovery 권한 해석에 필요한 계정/암호/프로젝트 변수가 문서화되지 않았다.                                                    | High   | WP-01   |
| DP-04  | `adapters/frontend-sources-write-postgres/src/product-service.ts:223-369` `submit`                                     | `COMMIT` 후 Stage 3에서 throw하면 외부 `catch`가 `ROLLBACK`을 실행해 원래 오류를 가리고 결과를 불명으로 만든다.                              | High   | WP-04   |
| EX-01  | `modules/discovery-runtime/src/worker.ts:1179-1186` `runLoop`                                                          | 예상 밖 예외를 관측 없이 삼키고 즉시 반복해 silent failure 또는 hot loop가 된다.                                                             | High   | WP-03   |
| EX-02  | `assemblies/shotgun-app/src/application.ts:339-344, 1158-1162, 1237-1262`; `server.ts:3895-3901`                       | 부분 생성 실패와 정상 종료가 서로 다른 cleanup 목록을 사용하여 worker/kernel/server 자원이 누락될 수 있다.                                   | High   | WP-03   |
| DP-03  | `packages/contracts/schemas/evidence-indexed.v1.schema.json:9`; `adapters/sources-stage3-pipeline/src/index.ts:29-101` | 계약은 최소 1건인데 repository는 0건 commit이 가능하며, 0건 완료와 미처리를 구분할 영속 결과가 없다.                                         | Medium | WP-04   |
| DE-01  | `DerivedInferenceReady` 선언·manifest                                                                                  | 실제 `DiscoveryFindingReadyV1` reentry가 있는데 구 event가 잔존하여 잘못된 경로를 암시한다.                                                  | Low    | WP-11   |
| DE-02  | `DraftChangeSetReady`, `ReviewDecisionRecorded`, `ProjectionReady` producer/manifest                                   | 생산되지만 소비자가 보이지 않는다. audit/extension terminal인지 orphan인지 명시되지 않았다.                                                  | Medium | WP-11   |
| DE-03  | `assemblies/shotgun-app/src/server.ts:3049,3170,3201`                                                                  | `/intake`, `/search`, `/ask/query` 호환 API의 사용·폐기 조건이 없다.                                                                         | Low    | WP-11   |
| DE-05  | cited-answer module 및 `/ask/query`                                                                                    | 여전히 실제 호환 경로에서 사용되므로 단순 미사용 삭제 시 회귀한다.                                                                           | Low    | WP-11   |
| DP-05  | frontend projection 구현                                                                                               | 메모리 보관이 필요하지 않은 결정적 projection과 실제 상태 저장 책임의 명칭·경계가 혼재한다.                                                  | Low    | WP-11   |
| RIC-N1 | `adapters/sources-stage3-pipeline/src/index.ts:29-101`                                                                 | Evidence commit 뒤 Stage 4 호출 실패를 결과값으로만 반환하고 호출자가 무시한다. 재시작 가능한 handoff가 없다.                                | High   | WP-04   |
| RIC-N2 | Sources route `:306-362`; product service `submit`, `retry`; `lifecycle.ts:25-50`                                      | API가 기존 submission을 발견하면 service resume 분기에 진입하지 않으며, Stage 3 실패는 item 상태와 분리되어 명시적 retry도 재개하지 못한다.  | High   | WP-04   |
| RIC-N3 | `packages/connector-runtime/src/stores.ts:21-57`; `runtime.ts:89-124`                                                  | timeout 뒤 `running` key를 삭제하지만 원래 handler는 계속 실행할 수 있어 동일 key 재호출이 중복 side effect를 만든다.                        | High   | WP-05   |
| RIC-N4 | `packages/connector-runtime/src/runtime.ts:126-145`; `packages/kernel/src/index.ts`                                    | Job/Dedup/DLQ/Ordering 기본 저장소가 메모리이며 restart 후 멱등성·순서·재생 증거가 사라진다.                                                 | High   | WP-05   |
| RIC-N5 | `assemblies/shotgun-app/src/server.ts:685-716,950-968,2147-2148,3012`                                                  | recovery 실패를 count로만 돌려주거나 무시하고, 일부 실패에도 완료로 표시하며 health는 이를 readiness에 반영하지 않는다.                      | High   | WP-08   |
| RIC-N6 | `server.ts:2783-2832,3049,3170,3201,3776,3841-3892`                                                                    | login·legacy write·entity vault·일부 action route가 raw `request.body`를 역참조한다. malformed 입력이 500 또는 부분 실행을 유발한다.         | Medium | WP-09   |
| RIC-N7 | Action module TS contract/producer와 JSON manifest                                                                     | `ActionFeedbackRecorded`가 durable governed review로 이어지거나 의도적 terminal로 판정되지 않았다.                                           | Medium | WP-10   |
| RIC-N8 | `adapters/discovery-runtime-product/src/index.ts:1040-1048`                                                            | finding semantic essence 실패를 `PARTIAL`로만 기록해 어느 finding이 왜 제외됐는지 운영자가 알 수 없다.                                       | Low    | WP-10   |
| DIC-01 | 14개 `hashtext` advisory-lock 호출부                                                                                   | 32-bit hash 충돌로 관련 없는 aggregate가 같은 lock을 잡을 수 있다. `::bigint` cast도 엔트로피를 늘리지 않는다.                               | Medium | WP-02   |
| DIC-02 | `adapters/frontend-ask-execution-postgres/src/index.ts:1710-1750` `claimQueuedForWorker`                               | 후보 SELECT와 `claimInitial`이 다른 transaction이다. 중복 실행은 재검사로 막지만 여러 worker가 같은 앞쪽 행에 몰려 처리량·공정성이 저하된다. | Medium | WP-06   |
| DIC-03 | `modules/discovery-runtime/src/worker.ts:453-501`; execution context `:22-36`                                          | stop이 polling만 중지하고 in-flight 작업을 취소하지 않으며 AbortSignal이 provider까지 전파되지 않는다. 종료가 무기한 지연될 수 있다.         | High   | WP-03   |

추가로 발견한 연결 결함은 RIC-N2에 포함한다. Sources route는 이미 존재하는
`OUTCOME_INDETERMINATE` submission을 반환만 하므로 `submit()` 내부 resume 코드가 실제
API 경로에서 도달 불가능하다. 또한 `retry()`는 rematerialization을 commit하지만
Stage 3 재개를 일관되게 수행하지 않는다. 별도 ID를 만들지 않고 RIC-N2의 동일 근본
원인으로 통합한다.

## 5. 원문 항목 추적 매트릭스

아래 표는 누락과 중복 구현을 막는 통제표다. 각 원문 ID는 **Primary WP 한 곳**에서만
코드를 변경하며, 다른 WP는 계약을 소비하거나 통합 테스트만 수행한다.

| Primary WP | 원문 ID                           | 통합 결과                                                                                             |
| ---------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| WP-01      | DP-01, DP-02                      | 환경 계약과 startup preflight로 통합                                                                  |
| WP-02      | DIC-01                            | advisory-lock key 전략 단일 변경                                                                      |
| WP-03      | EX-01, EX-02, DIC-03              | 공통 lifecycle·worker 관측·cancellation으로 통합                                                      |
| WP-04      | DP-04, DP-03, RIC-N1, RIC-N2      | Source transaction, zero Evidence, durable Stage 4 handoff, resume/recovery를 하나의 상태 모델로 통합 |
| WP-05      | RIC-N3, RIC-N4                    | Connector durable state와 outcome-unknown 멱등성으로 통합                                             |
| WP-06      | DIC-02                            | Ask multi-worker atomic claim                                                                         |
| WP-07      | 신규 통합 통제                    | critical handoff 분류 및 manifest/consumer 정책. 새 결함이 아니라 N1/N4의 rollout gate                |
| WP-08      | RIC-N5                            | recovery 상태를 health/readiness에 통합                                                               |
| WP-09      | RIC-N6                            | HTTP boundary decoder 일괄 보완                                                                       |
| WP-10      | RIC-N7, RIC-N8                    | Action reentry disposition과 safe diagnostics                                                         |
| WP-11      | DE-01, DE-02, DE-03, DE-05, DP-05 | 사용 증거 기반 레거시·projection 정리                                                                 |
| WP-12      | 신규 검증 통제                    | 종단 replay·migration·rollback·security acceptance. 각 결함의 중복 수정 없음                          |

항목 수 검산: 기본 계획 11개 + 추가 계획 8개 + 동시성 계획 3개 = **22개**.
위 매트릭스의 원문 ID도 22개이며 중복 배정은 없다.

## 6. 적용할 아키텍처 결정과 OSS 경계

### 6.1 유지할 기존 결정

- ADR-077/080: at-least-once, consumer dedup, transactional outbox,
  retry/backoff/deadletter/replay, timeout 시 `OUTCOME_UNKNOWN`.
- ADR-083/084: 동일 SourceVersion·transformer·revision 재사용, Evidence source-only,
  Candidate noncanonical, request/batch idempotency.
- ADR-096: AI output durable materialization과 exact execution pin. provider 결과 불명 시
  자동 재호출 금지.
- ADR-097: Canonical outbox/projection recovery는 기존 구현을 사용하고 별도 공통
  Canonical outbox를 만들지 않는다.
- ADR-091: Action은 approval/preflight/verify를 통과하고 feedback도 governed reentry를
  거친다. 실제 외부 connector 추가는 이번 범위가 아니다.
- ADR-123/125/138/139/149: Ask outcome recovery, non-ready projection 계약,
  durable Discovery lease/recovery, `DiscoveryFindingReadyV1` reentry,
  deterministic finding fingerprint를 유지한다.

### 6.2 추가 ADR가 필요한 경계

WP-00에서 번호를 예약한 뒤 아래 두 결정만 ADR 또는 기존 ADR addendum으로 고정한다.
첨부 문서의 ADR 번호 제안을 그대로 사용하지 않는다.

1. **Evidence indexing result와 Stage 4 continuation 소유권**: Evidence producer가 자기
   transaction에 producer outbox를 기록하고, Connector/dispatcher는 전달만 책임진다.
2. **ActionFeedbackRecorded disposition**: 권고안은 최소 `ACTION_REVIEW` work item 생성
   consumer다. 자동 Canonical write와 자동 재실행은 금지한다. 이를 연기한다면 manifest와
   topology에 `DEFER` 및 활성화 조건을 명시해야 하며 orphan event로 방치할 수 없다.

### 6.3 OSS Integration Decision

| 후보                | 고정 정보                                       | Decision       | 사용 범위                                                           | 제외 범위                           |
| ------------------- | ----------------------------------------------- | -------------- | ------------------------------------------------------------------- | ----------------------------------- |
| PostgreSQL          | 16.14                                           | ADOPT          | transaction, advisory lock, `SKIP LOCKED`, durable outbox/job/dedup | Shotgun 의미·ID·상태 소유권 위임    |
| `garrytan/gbrain`   | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT | REFERENCE_ONLY | job/recovery/discovery test 패턴 재검토                             | 전체 runtime·DB 모델 채택           |
| pg-boss             | 12.26.0                                         | DEFER          | WP-00 contract-fit 재검토 후 필요한 경우 replacement benchmark      | Canonical/Evidence/Action 의미 소유 |
| Graphile Worker     | 0.17.3                                          | DEFER          | WP-00 contract-fit 재검토 후 필요한 경우 claim/retry benchmark      | 전체 workflow 승격                  |
| Redis/NATS/Temporal | 기존 DEFER 유지                                 | DEFER          | PostgreSQL 기준의 한계가 측정될 때만 재평가                         | 이번 수정의 선행 의존성             |

WP-05는 범용 durable worker 필요성이 발생한 작업이므로 기존 `DEFER`의 재평가 조건이
충족됐다. 구현 전에 `stage-1-oss-integration-review.md`,
`stage-12-1-durability-recovery-oss-review.md`, Open-source Role Matrix를 출발점으로
native PostgreSQL, pg-boss, Graphile Worker와 gbrain Minion pattern을 먼저 재검토한다.

1. 모든 후보에 대해 Port 적합성, transaction/outbox 결합, restart dedup, lock recovery,
   dead-letter/replay, timeout unknown, license/security/maintenance와 replacement 비용을
   서면 contract-fit gate로 비교한다.
2. Canonical·Evidence·Approval·Action 경계를 위반하거나 Port로 격리할 수 없는 후보는
   `REJECT` 또는 재평가 조건이 있는 `DEFER`로 판정하고 benchmark를 생략할 수 있다.
3. 서면 gate를 통과했지만 우열이 불명확한 후보만 같은 corpus로 prototype/benchmark한다.
4. native PostgreSQL을 직접 구현하면 관련 OSS를 재사용할 수 없는 근거, 교체 가능한 Port,
   Contract/Replacement Test와 rollback을 결정 기록에 남긴다.
5. `ADOPT`, `EXTRACT`, `AUGMENT`로 바뀌면 정확한 version/commit과 lockfile을 고정한다.

`CONDITIONAL_DEFER` 같은 별도 상태는 만들지 않는다. 후보별 Decision은 반드시
`ADOPT`, `EXTRACT`, `AUGMENT`, `REFERENCE_ONLY`, `DEFER`, `REJECT`,
`NO_RELEVANT_OSS` 중 하나다.

## 7. 최적화된 실행 순서

### 7.1 의존성 그래프

```text
WP-00 기준선·ADR·OSS·결함 재현
  ├─ WP-01 환경 계약
  └─ WP-02 64-bit advisory lock
          │
          ▼
WP-03 lifecycle·shutdown·Discovery cancellation
  ├─────────────┬────────────────┐
  ▼             ▼                ▼
WP-04 Source/   WP-05 Connector  WP-06 Ask atomic claim
Evidence        durable runtime
  └─────────────┴────────┬───────┘
                         ▼
              WP-07 critical handoff rollout
                         ▼
                 WP-08 recovery health
                         ▼
                 WP-09 HTTP validation
                         ▼
            WP-10 Action reentry·diagnostics
                         ▼
              WP-11 legacy/disposition cleanup
                         ▼
                 WP-12 E2E acceptance
```

WP-04, WP-05, WP-06은 WP-02·WP-03 병합 후 서로 다른 파일군에서 병렬 개발할 수 있다.
다만 최종 merge는 **WP-04 → WP-05 → WP-06** 순서로 하여 가장 큰 데이터 유실 위험을
먼저 닫고, 각 merge 후 exact-HEAD 회귀를 확인한다. `application.ts`와 `server.ts`를
건드리는 WP-03, WP-08, WP-09는 충돌을 피하도록 직렬화한다.

### 7.2 릴리스 단위

| 순서 | 패키지 | 왜 이 순서인가                                                | 배포 가능 조건                       |
| ---: | ------ | ------------------------------------------------------------- | ------------------------------------ |
|    0 | WP-00  | 최신 Canonical main과 상태·소유권·OSS 결정을 먼저 고정        | 기준선/ADR/최소 재현 증거 확정       |
|    1 | WP-01  | 모든 이후 test와 worker 기동의 환경 전제                      | preflight 및 env test 통과           |
|    2 | WP-02  | Source·Ask 수정 전에 공통 lock key를 안정화                   | 11개 호출부와 static guard 통과      |
|    3 | WP-03  | 새 dispatcher/recovery worker가 사용할 공통 종료 계약 제공    | 실패·종료 주입 test 통과             |
|    4 | WP-04  | 실제 Evidence→Stage 4 유실과 Source recovery를 가장 먼저 차단 | migration/backfill/replay 통과       |
|    5 | WP-05  | 일반 Connector 중복 side effect와 restart 유실 차단           | timeout/restart/replacement 통과     |
|    6 | WP-06  | 독립적 처리량·공정성 문제 해결                                | 2-worker 경쟁 test 통과              |
|    7 | WP-07  | durable primitive를 실제 critical edge에 선택적으로 배치      | handoff matrix 무분류 0개            |
|    8 | WP-08  | 앞 단계의 recovery 상태를 운영 readiness에 노출               | degraded/readiness test 통과         |
|    9 | WP-09  | `server.ts` lifecycle 변경 후 요청 경계 일괄 정리             | malformed-input matrix 통과          |
|   10 | WP-10  | 안전 경계가 갖춰진 뒤 Action feedback와 diagnostics 연결      | approval negative/safe-log test 통과 |
|   11 | WP-11  | 실제 사용 telemetry·trace로 삭제/유지를 확정                  | inventory disposition 100%           |
|   12 | WP-12  | 배포 전 crash/replay/backup/rollback 종단 검증                | 모든 DoD Gate 통과                   |

## 8. 상세 작업 패키지

## WP-00. Canonical 기준선·결정·재현 증거 고정

### 변경 내용

1. `git fetch` 후 `origin/main`이
   `cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2`를 포함하는지 확인한다. 검토 시점의
   `origin/main`은 해당 exact commit이다. 이후 전진했다면 최신 descendant에서 fresh
   implementation branch를 만들고 이 문서의 파일·라인·migration drift를 재검증한다.
2. Node/npm/PostgreSQL 버전과 migration 최고 번호를 기록한다. 검토 시점 최고 migration은
   `061_stage4_project_ai_execution_identity.sql`이며 신규 번호는 실제 rebase/merge 시점의
   `next available`로만 배정한다.
3. 22개 결함 각각에 대해 기존 실패 증거, 정적 계약 증거, 기존 regression test 중 하나를
   우선 재사용한다. 새 reproduction test는 수정 전 실패를 증명하는 데 필요한 경우에만
   추가한다. 실제 provider나 실제 외부 action은 사용하지 않는다.
4. 위 6.2에서 새 architecture authority가 필요한 항목만 ADR/addendum로 고정하고,
   event/continuation/state 이름과 소유권을 구현 전에 확정한다.
5. 모든 생산·소비 edge를 WP-07 handoff matrix 초안에 배치한다.
6. WP-05 구현 전에 6.3의 OSS contract-fit gate를 수행하고 **검토한 모든 후보**에 허용된
   Integration Decision을 기록한다. benchmark는 서면 gate를 통과하고 우열이 불명확한
   후보에만 수행한다.
7. Source Stage 3 진행 상태는 기존 submission/item/intake-attempt와 migration 035의
   recovery authority로 표현 가능한지 먼저 매핑한다. 표현할 수 없는 per-SourceVersion
   execution position, lease/fence, `NO_EVIDENCE`, `RECONCILIATION_REQUIRED`만 최소
   additive persistence 후보로 남긴다.

### 종료 기준

- implementation branch가 기준 commit 또는 이를 포함하는 최신 `origin/main` descendant다.
- 각 결함에 기존 증거 또는 필요한 최소 reproduction evidence가 있다.
- state transition, owner, idempotency key, replay source, terminal state가 승인됐다.
- Source Stage 3 논리 상태와 실제 durable authority의 매핑표가 있고 중복 authority가 없다.
- 모든 관련 OSS 후보에 허용된 Integration Decision과 직접 구현 근거가 기록됐다.
- benchmark를 생략한 후보는 서면 gate 탈락 근거 또는 기존 증거 재사용 근거가 있다.

## WP-01. 환경 계약과 startup preflight

### 수정 대상

- `.env.example`
- `assemblies/shotgun-app/src/application.ts`
- `scripts/auth-bootstrap-owner.ts`
- 관련 launch/bootstrap tests와 운영 문서

### 구현

1. `.env.example`에 다음을 실제 소비 위치·필수 조건과 함께 추가한다.
   - `SOURCES_STAGING_SECRET`: production 최소 32자, rotation 시 기존 staging asset
     처리 정책 명시.
   - `SHOTGUN_BOOTSTRAP_ACCOUNT_ID`
   - `SHOTGUN_BOOTSTRAP_PASSWORD`
   - `SHOTGUN_BOOTSTRAP_PROJECT_ID`
2. 문자열 존재 여부만 보지 말고 UUID/길이/조합 제약을 한 곳의 env decoder에서
   검증한다.
3. bootstrap 전용 변수는 일반 runtime에서 반드시 필요한지 구분한다. account ID가
   Discovery security scope에 사용된다면 bootstrap 변수에 암묵적으로 결합하지 말고
   명시적 runtime owner/account 설정으로 이름과 책임을 분리한다.
4. 오류 메시지에는 secret 값이 절대 포함되지 않게 하고, 시작 전 한 번에 누락 목록을
   보고한다.

### 검증

- production/development/test 환경별 missing/short/malformed/valid table test.
- bootstrap script와 application이 같은 decoder를 소비하는 contract test.
- `.env.example` 키와 실제 `process.env` 소비 목록의 정적 drift test.

### 롤백

코드 rollback은 가능하나 새 secret으로 생성한 staging 자료가 있으면 이전 secret으로
되돌리기 전에 key rotation/복호화 호환성을 확인한다. 값을 Git에 저장하지 않는다.

## WP-02. PostgreSQL advisory lock 64-bit 표준화

### 수정 대상

현재 확인된 모든 호출부:

- `adapters/postgres-stage11/src/index.ts:69`
- `adapters/postgres/src/index.ts:309`
- `adapters/postgres-stage4/src/index.ts:736`
- `adapters/postgres-stage3/src/index.ts:150`
- `adapters/frontend-sources-write-postgres/src/product-service.ts:251`
- `adapters/frontend-sources-write-postgres/src/lifecycle.ts:203`
- `adapters/frontend-sources-write-postgres/src/index.ts:130,216,291`
- `adapters/frontend-external-action-postgres/src/index.ts:207,788`
- `adapters/frontend-knowledge-draft-postgres/src/index.ts:135,375,395`

### 구현

1. 단일 text key overload를
   `pg_advisory_xact_lock(hashtextextended($1, 0))`로 통일한다.
2. literal prefix 연결도 application에서 완전한 key string을 만들거나 SQL에서 만든 뒤
   `hashtextextended(..., 0)`에 넣는다. 기존 aggregate namespace는 바꾸지 않는다.
3. `hashtext($1)::bigint`는 32-bit 결과를 cast할 뿐이므로 모두 제거한다.
4. helper 추출은 Port가 아니라 PostgreSQL adapter 내부 utility로 제한한다.
5. repository 전체에 `pg_advisory_*lock(hashtext(`가 다시 들어오지 못하도록
   architecture/static test를 추가한다.

### 검증

- 동일 key는 직렬화되고 다른 key는 독립 진행하는 2-session database test.
- transaction 종료 시 lock 해제, rollback 시 해제 test.
- 14개 legacy 호출부 변경, 모든 lock namespace snapshot, 금지 pattern 정적 검색 결과 0건.

### 배포·롤백

schema migration은 없다. rolling deployment 중 구/신 binary가 서로 다른 lock ID를
사용하므로 **혼합 버전을 허용하지 않는다**. worker drain → 전체 binary 교체 → worker
resume 순서로 배포한다. rollback도 같은 방식으로 drain 후 일괄 수행한다.

## WP-03. 공통 lifecycle, Discovery 관측과 cancellation

### 수정 대상

- `assemblies/shotgun-app/src/application.ts`
- `assemblies/shotgun-app/src/server.ts`
- `modules/discovery-runtime/src/worker.ts`
- `adapters/discovery-runtime-product/src/index.ts`
- Discovery execution/generation/router/provider Port와 adapters

### 구현

1. `AsyncCleanupStack` 또는 동등한 application-owned primitive를 도입한다.
   resource가 생성되는 즉시 LIFO disposer를 등록하고, disposer는 멱등적이어야 한다.
2. startup 실패와 정상 `onClose`가 정확히 같은 stack을 실행하게 한다. 등록 대상은
   Fastify/server, kernel, DB pool, Sources runtime, Ask worker, Discovery scheduler,
   Discovery execution, Discovery reentry, Canonical recovery, 이후 continuation worker다.
3. disposer 실패는 다음 disposer를 막지 않고 safe aggregate error로 수집한다.
4. Discovery worker가 claim별 `AbortController`를 만들고 signal을
   execution context → product execution → AI generation → router → provider까지 전달한다.
   이미 signal을 받는 contract는 재사용하고 중복 cancellation API를 만들지 않는다.
5. `stop({ graceMs })`는 신규 claim 중지 → 모든 in-flight abort → grace 대기 → 남은
   claim의 lease를 만료/반납 가능한 상태로 남김 순서로 동작한다.
6. shutdown cancellation은 business failure, retry attempt, max-attempt를 소비하지 않는다.
   provider가 cancel을 무시할 수 있으므로 lease/fencing이 최종 권위다.
7. `runLoop`의 unexpected exception에는 bounded exponential backoff와 observer hook을
   적용한다. raw payload·prompt·protected field 없이 code, stage, attempt, correlation ID만
   기록한다.

### 검증

- 생성 단계별 fault injection 후 disposer 호출 순서·정확히 한 번 실행 검증.
- SIGTERM/close 중 idle, poll, claimed, provider-running 각 상태 test.
- cancel-aware provider와 cancel-ignoring provider 양쪽에서 duplicate completion 없음.
- unexpected loop exception에서 hot loop가 생기지 않고 readiness가 degraded됨.
- resource handle leak 및 테스트 종료 hang 없음.

### 롤백

새 cleanup stack은 기능 flag 없이 교체하되, Discovery cancellation 전파는 rollout flag로
분리할 수 있다. rollback 시 durable lease가 남아 다음 worker가 회수할 수 있어야 하며
수동으로 job을 실패 처리하지 않는다.

## WP-04. Source/Evidence transaction과 durable Stage 4 continuation

### 8.4.1 데이터 소유권

- Source module: Source, SourceVersion, OriginalAsset, submission, materialization 진행.
- Transformation module: revision과 transformer identity.
- Evidence module: EvidenceSpan, indexing result, Evidence producer continuation.
- Stage 4/AI modules: Generation Request, provider materialization, Candidate/Validation.
- Connector Runtime: envelope 전달·dedup·ack; Evidence나 Candidate 의미를 소유하지 않음.

### 8.4.2 additive schema와 기존 Source recovery authority 재사용

rebase 후 신규 migration은 module 소유권을 유지하면서 additive하게만 추가한다.

1. `evidence.indexing_results`
   - `project_id`, `source_id`, `source_version_id`, `revision_id`
   - `status`: `INDEXED | NO_EVIDENCE`
   - `evidence_count`, `reused_count`, `evidence_set_digest`
   - transformer/contract version, security scope digest, timestamps
   - unique semantic identity
2. `evidence.stage4_continuations`
   - semantic key와 immutable Evidence snapshot/reference
   - `PENDING | RUNNING | RETRYABLE_FAILED | TERMINAL_FAILED | OUTCOME_UNKNOWN | COMPLETED`
   - attempt, `next_attempt_at`, lease owner/token/expiry, fencing token
   - generation-request/execution-pin reference, safe failure code
   - `evidence_count > 0` check와 semantic unique constraint
3. `SourceStage3ProgressPort`는 논리적 상태 권위다.
   - 논리 상태는 submission item/SourceVersion별
     `MATERIALIZED | STAGE3_RUNNING | STAGE3_COMPLETED | NO_EVIDENCE |
STAGE3_RETRYABLE | RECONCILIATION_REQUIRED`다.
   - 기존 `source_product` submission/item/intake-attempt와 migration 035로 표현 가능한
     상태는 기존 adapter가 제공하고 새 table에 복제하지 않는다.
   - per-SourceVersion execution position, lease/fence 또는 zero-result 구분처럼 기존
     schema로 안전하게 표현할 수 없는 정보가 증명된 경우에만 최소 additive column/table을
     추가한다.
   - `source_product.pipeline_progress`는 확정 table명이 아니라 조건부 candidate다.
   - Source schema는 Evidence table을 직접 조회해 상태 authority를 이중화하지 않고,
     Stage 3 Port의 durable outcome을 소비한다.

`EvidenceIndexedV1` 외부 event의 `items.minItems=1`은 유지한다. 0건일 때 event를
발행하지 않고 내부 `NO_EVIDENCE` outcome을 반환하므로 기존 consumer contract를
불필요하게 약화하지 않는다.

### 8.4.3 transaction 재구성

현재 `submit()`의 긴 transaction을 다음으로 분리한다.

1. **Materialization transaction**: Source/Version/Asset와 논리적 Source Stage 3 progress
   `MATERIALIZED`를 기존 또는 조건부 신규 authority에 commit.
2. **Stage 3 UoW**:
   - `SourceStage3ProgressPort`를 통해 progress를 fenced `STAGE3_RUNNING`으로 claim.
   - transform save/reuse.
   - Evidence span upsert + indexing result 저장.
   - Evidence가 있으면 같은 transaction에서 continuation `PENDING` insert.
   - Evidence가 없으면 `NO_EVIDENCE` 저장, continuation 생성 안 함.
3. **Source finalization transaction**: Stage 3 UoW의 durable outcome을 받아
   `SourceStage3ProgressPort`에서 `STAGE3_COMPLETED` 또는 `NO_EVIDENCE`로 finalize하고
   submission을 완료한다.
4. **Stage 4 dispatcher**: 별도 worker가 continuation을 `SKIP LOCKED`로 claim하여
   deterministic `EvidenceIndexed` envelope를 전달한다. Stage 4의 성공/실패는 Source
   materialization 상태를 되돌리지 않는다.

어떤 `catch`도 자신이 시작한 active transaction만 rollback한다. `COMMIT` 이후 실행은
transaction callback 밖에 두어 post-commit 오류를 rollback 오류로 가리지 않는다.

### 8.4.4 재개·복구

1. Sources API에서 existing submission을 발견해도 상태가
   `OUTCOME_INDETERMINATE`/미완료이면 `resumeSubmission()`을 명시적으로 호출한다.
2. `retry()`는 이미 materialized된 item을 재-staging하지 않는다. 논리적 Source Stage 3
   progress를 통해 같은 SourceVersion의 Stage 3만 재개한다.
3. startup + periodic recovery는 Port를 통해 expired lease와 incomplete progress를 조회한다.
   시간 경과만으로 새 SourceVersion이나 provider call을 만들지 않는다.
4. `RECONCILIATION_REQUIRED`는 Source/Evidence/AI durable state를 조회한 뒤에만
   retryable/completed/unknown으로 전이한다.
5. command ledger의 accepted command를 durable resource 생성 후 단순 rejected로
   덮지 않는다. 결과가 확정되지 않으면 `OUTCOME_INDETERMINATE`를 반환한다.
6. continuation은 Evidence/security/policy identity를 고정한다. provider/config/
   credential binding은 첫 provider 호출 전에 ADR-096 Generation Request에 immutable하게
   pin하고, provider attempt가 존재하면 현재 설정으로 재해석하지 않는다.

### 8.4.5 backfill과 historical safety

- 기존 EvidenceSpan이 있고 indexing result identity를 결정적으로 재구성할 수 있는
  revision은 digest를 계산하여 `INDEXED` 결과를 생성할 수 있다.
- 기존 span이 없다는 이유만으로 `NO_EVIDENCE`라고 추론하지 않는다. materialized
  SourceVersion인데 authoritative result가 없으면 `RECONCILIATION_REQUIRED`다.
- **Historical Evidence의 존재 자체는 Stage 4 실행 권한이 아니다.** 자동 continuation은
  다음 중 하나가 증명된 경우에만 enqueue한다.
  1. 기존 durable Stage 4 intent/attempt가 있고 복구 대상인 경우.
  2. 기존 Stage 4 failed/indeterminate 실행과 정확히 연결되는 경우.
  3. migration/cutover 이후 새 pipeline이 생성한 continuation인 경우.
- Evidence는 있지만 과거 Stage 4 실행 의도가 증명되지 않는 revision은 새 provider
  호출을 자동 생성하지 않는다. `RECONCILIATION_REQUIRED` 또는 historical completed로
  남기고 provider call은 0회다.
- provider 결과가 이미 `OUTCOME_UNKNOWN`이면 continuation을 발행하지 않고 기존
  Generation Request reconciliation에 연결한다.
- backfill은 현재 Standing AI/provider 설정으로 과거 데이터를 새 Product execution으로
  조용히 재해석하지 않는다.

### 8.4.6 검증

- crash point: materialization commit 전/후, Evidence commit 전/후, dispatch 전/후,
  handler 성공 후 ack 전.
- 동일 submission/source/revision replay에서 행·event·provider request 중복 0.
- Evidence 0건은 Source 성공, `NO_EVIDENCE` 1행, Stage 4 호출 0회.
- Stage 4 terminal/retryable 실패에도 SourceVersion과 Stage 3 결과가 유지됨.
- API submit/resume/retry와 startup recovery가 같은 transition table을 통과함.
- project deletion, backup/restore, tenant/security scope negative test.
- historical Evidence만 존재하고 실행 intent가 없는 경우 provider call 0회.

## WP-05. Connector Runtime 영속화와 outcome-unknown 멱등성

### Port와 상태

`packages/connector-runtime`에 infrastructure-neutral async Port를 정의한다.

- `DedupStorePort`: atomic begin/read/complete/fail/markOutcomeUnknown/reconcile.
- `JobRuntimePort`: full semantic identity 기반 enqueue/claim/renew/complete/retry/terminal/cancel/find.
- `DeadLetterStorePort`: full identity와 safe envelope reference, failure code,
  actor/project/security scope replay authorization.
- `OrderingStorePort`: full scope별 pre-handler ordering reservation, sequence/fence,
  fenced commit/release/checkpoint.

상태 최소 집합은 `IN_PROGRESS | OUTCOME_UNKNOWN | COMPLETED | FAILED`이며, 같은 key와
같은 request fingerprint만 재조회할 수 있다. 같은 key에 다른 fingerprint면
`CONFLICT`로 fail closed한다.

### PostgreSQL adapter

1. 새 `adapters/connector-runtime-postgres`를 Port 뒤에 구현한다.
2. unique semantic key, request fingerprint, lease/fence, result reference, safe error,
   retention을 저장한다.
3. Job retry는 `retryable`과 `next_attempt_at`를 영속화해 process restart 후에도
   backoff를 잃지 않는다. payload를 무조건 DLQ에 복사하지 않는다. protected data는 승인된 encrypted replay
   payload 또는 canonical resource reference+digest로 저장한다.
4. Kernel/assembly production wiring은 PostgreSQL adapter를 명시적으로 주입한다.
   InMemory adapter는 unit test와 명시적 ephemeral assembly에만 남긴다.
5. Canonical outbox와 Evidence outbox를 하나의 새 global outbox로 합치지 않는다.
   각 producer의 transactional outbox를 Connector가 전달한다.

### timeout 수정

- `Promise.race` timeout 시 handler가 멈췄다고 가정하지 않는다.
- dedup record를 삭제하지 않고 `OUTCOME_UNKNOWN` tombstone으로 원자 전이한다.
- 동일 key 재요청은 원 handler를 호출하지 않고 unresolved outcome을 반환한다.
- cancellation signal은 전달할 수 있지만 신뢰성의 근거는 durable state와 reconciliation이다.
- reconciliation만 `OUTCOME_UNKNOWN`을 `COMPLETED`, `FAILED`, 수동 재시도 가능 상태로
  바꿀 수 있다.
- DLQ replay는 원본 project/security scope, actor, reason, route, fingerprint를
  검증·기록하며 `OUTCOME_UNKNOWN`은 reconciliation 전 거부한다.

### 검증

- timeout 직후 동일 key 2개 동시 요청에서 handler 총 호출 1회.
- timeout 후 원 handler가 늦게 완료되는 경우 result fencing 검증.
- process restart 뒤 completed/in-progress/unknown dedup 유지.
- project/security scope별 ordering key 선점 fence, 다른 scope 병렬성, restart-safe
  retry/backoff, lease recovery, DLQ replay authorization.
- InMemory↔PostgreSQL adapter replacement contract test.
- pg-boss/Graphile Worker를 채택했다면 package 교체 test와 pinned-version 검증.

### migration·rollout

새 table은 additive하다. 기존 in-memory 완료 이력은 신뢰성 있게 backfill할 수 없으므로
배포 전 기존 worker를 drain하고 새 durable adapter 활성 시점 이후의 요청부터 authority를
전환한다. unresolved durable row가 있으면 in-memory로 rollback하지 않는다. worker를
중지하고 forward-fix하거나 reconciliation 후 rollback한다.

## WP-06. Ask Queue 원자적 multi-worker claim

### 구현

1. `claimQueuedForWorker(capacity)`가 transaction을 시작한다.
2. Canonical schema인 `frontend_ask.answer_runs`의 initial `QUEUED` rows를 FIFO로
   선택하고 같은 transaction에서 lock/claim한다.
3. 현재 table에 없는 `next_attempt_at`을 이 수정의 전제로 추가하지 않는다. 이 WP는
   initial selection/claim atomicity만 해결하고 새 retry scheduler를 만들지 않는다.
4. 기본 query 의미는 다음과 같다.

```sql
SELECT answer_run_id
FROM frontend_ask.answer_runs
WHERE state = 'QUEUED'
ORDER BY created_at, answer_run_id
FOR UPDATE SKIP LOCKED
LIMIT $1;
```

5. 선택된 각 row를 같은 transaction에서 execution pin 해석·attempt insert·`RUNNING`
   update한다. 한 row의 pin/validation 실패가 batch 전체를 rollback하지 않도록 row별
   savepoint 또는 1-row claim loop를 사용한다.
6. resolver가 pool을 재진입하는 현재 구조를 그대로 둔 채 장시간 row lock을 잡지 않는다.
   transaction-aware read 경로 또는 짧은 fenced `CLAIMING` 단계 중 더 작은 설계를
   prototype으로 비교하고, 외부 network/provider 호출은 claim transaction 안에서 금지한다.
7. provider 호출은 transaction 밖에서만 시작한다.
8. 기존 `claimLocked`를 상태 전이의 단일 권위로 재사용하되 autocommit SELECT → 별도
   transaction 구조는 제거한다.
9. queue index는 실제 column과 query plan을 `EXPLAIN`으로 확인한 뒤 필요한 경우에만
   additive migration에 추가한다. 새 retry scheduler/`next_attempt_at`은 별도 증거와
   architecture decision 없이는 범위에 포함하지 않는다.

### 검증

- 64 queued / worker 2개 / 각 capacity 32: 합계 64, 교집합 0.
- 10 queued / worker 2개 / 각 capacity 32: unique 합계 10.
- FIFO, 서로 다른 project/security scope, cancellation/retry, lease recovery.
- 첫 row pin failure에도 뒤 row 처리 가능.
- 두 실제 PostgreSQL connection/process를 사용하는 focused integration test와 query plan 확인.
- execution identity resolver 지연/실패 시 lock duration과 뒤 row 진행을 검증.
- 기존 retry/lease semantics는 변경하지 않는다.

### 롤백

추가 index가 backward compatible하면 남겨도 된다. claim query rollback은 가능하지만
rolling mixed version에서 공정성을 보장하지 않으므로 worker drain 후 일괄 교체한다.

## WP-07. Critical handoff 분류와 선택적 rollout

모든 event를 무조건 `required`로 만드는 것은 금지한다. 각 edge에 아래 중 하나를
반드시 지정하고 manifest, runtime policy, test가 같은 값을 사용하게 한다.

| Edge                                   | 목표 분류                           | 근거/구현                                                 |
| -------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| OriginalAssetStored → Transformation   | DURABLE_OUTBOX 또는 RECONSTRUCTABLE | SourceVersion에서 재구성 가능 여부를 contract test로 확정 |
| DocumentTransformed → Evidence         | DURABLE_OUTBOX 또는 RECONSTRUCTABLE | revision identity로 안전 재생                             |
| Evidence → Stage 4                     | DURABLE_OUTBOX                      | WP-04 Evidence-owned continuation                         |
| CandidateGenerated → Validation        | REQUIRED_ACK + DURABLE_JOB          | Candidate identity와 AI durable record                    |
| CandidateValidated → Comparison        | REQUIRED_ACK                        | 승인 전 critical path                                     |
| ComparisonCompleted → ChangeSet        | REQUIRED_ACK                        | Draft 생성 유실 금지                                      |
| ChangeSetApproved → Canonical          | TRANSACTIONAL/REQUIRED_ACK          | approval와 canonical write 경계                           |
| CanonicalCommitted → Search projection | CANONICAL_OUTBOX + RECONSTRUCTABLE  | 기존 ADR-097 사용                                         |
| CanonicalCommitted → Discovery trigger | CANONICAL_OUTBOX + REQUIRED_ACK     | 현재 required consumer 유지                               |
| DiscoveryFindingReadyV1 → Reentry      | DURABLE_JOB + REQUIRED_ACK          | 기존 discovery-reentry 사용                               |
| ActionExecution → Feedback             | DURABLE_OUTBOX                      | WP-10 ACTION_REVIEW consumer                              |
| UI notification/telemetry              | INTENTIONAL_BEST_EFFORT             | business state와 분리                                     |
| 명시적 audit/extension event           | INTENTIONAL_TERMINAL                | owner·retention·관측 조건 필수                            |

분류 집합은 `TRANSACTIONAL`, `DURABLE_OUTBOX`, `DURABLE_JOB`, `RECONSTRUCTABLE`,
`REQUIRED_ACK`, `INTENTIONAL_BEST_EFFORT`, `INTENTIONAL_TERMINAL`이다. 하나의 edge는
전달 방식과 실패 의미를 표현하기 위해 복수 태그를 가질 수 있다.

### 종료 기준

- producer manifest event 전수에 consumer 또는 intentional disposition이 있다.
- critical edge마다 crash-after-commit/before-ack replay test가 있다.
- optional consumer 실패가 critical success를 뒤집지 않고, required consumer 실패는
  durable retry 또는 명시적 unresolved 상태가 된다.

## WP-08. Recovery 관측과 health/readiness

### 구현

1. 모든 recovery runner는 실행 여부, 복구 결과, freshness를 분리한 공통 결과를 반환한다.
   - `executionStatus`: `COMPLETED | FAILED_TO_RUN`
   - `outcome`: `HEALTHY | DEGRADED | FAILED`
   - `freshness`: `CURRENT | STALE`
   - runner ID, 시작/완료 시각, scanned/succeeded/retryable/terminal/unknown counts
   - last successful run, next scheduled run, safe error codes
2. runner가 끝까지 실행됐지만 일부 project/item 복구가 실패하면
   `executionStatus=COMPLETED`, `outcome=DEGRADED` 또는 정책상 `FAILED`로 기록한다.
   실행 완료와 복구 결과를 같은 enum에 섞지 않는다.
3. item별 catch는 observer와 durable status를 반드시 갱신한다. raw exception을 응답에
   노출하지 않는다.
4. startup recovery 결과를 버리지 않고 application recovery registry에 저장한다.
5. application readiness는 recovery outcome과 freshness를 별도 축으로 소비한다.
   - liveness: process/event loop가 살아 있음.
   - readiness: `READY | DEGRADED | NOT_READY` 정책 상태.
   - degraded details: 인증된 운영자에게 safe aggregate만 제공.
6. DB 연결, 필수 worker, migration compatibility, Sources progress, Evidence continuation,
   Connector unknown/DLQ, Ask leases, Discovery leases, AI materialization,
   Canonical recovery를 registry에 연결한다.

### 검증

- executionStatus/outcome/freshness/readinessImpact 조합 table test.
- runner는 완료했지만 일부 project가 실패한 경우 `COMPLETED + DEGRADED` 동시 표현.
- critical recovery 실패 시 liveness는 살아 있어도 readiness가 degraded/non-ready가 되는 정책 test.
- project ID, prompt, source text, credential, stack trace가 public health에 없음.
- alert threshold와 runbook link가 상태 코드에 매핑됨.

## WP-09. HTTP schema validation 완결

### 범위

우선순위는 auth login → action write → entity vault → retained legacy writes → 나머지
security-sensitive writes다. 이미 decoder를 쓰는 typed frontend external-action product
routes는 다시 구현하지 않는다.

### 구현

1. Zod/기존 contract decoder를 route entry에서 실행하고 service에는 typed input만
   전달한다.
2. `request.body` 직접 역참조를 제거한다.
3. malformed JSON/body/schema는 일관된 400, 인증 실패는 401, 권한 실패는 403,
   semantic conflict는 409로 매핑한다.
4. account/project/actor/security scope는 body가 아니라 인증된 server context를 권위로
   사용한다.
5. unknown field 정책과 최대 문자열/배열/asset size를 명시한다.
6. validation 실패는 command ledger·DB·provider·action side effect를 만들지 않는다.

### 검증

- missing/null/wrong type/oversized/unknown field/malformed UUID/prototype-pollution 형태.
- unauthorized cross-project payload negative test.
- 모든 malformed case에서 500=0, DB write=0, connector call=0.
- OpenAPI/JSON Schema와 runtime decoder drift test.

## WP-10. Action feedback reentry와 Discovery safe diagnostics

### Action feedback

권고 구현은 `ActionFeedbackRecorded`를 소비해 durable `ACTION_REVIEW` work item을
정확히 한 번 생성하는 최소 adapter다.

- idempotency key: action execution/verification/feedback semantic identity.
- 저장 정보: canonical/action resource reference, outcome classification, safe evidence
  reference, review status. raw credential/response 전체 복사 금지.
- 권한: Review/Activity module의 기존 Port를 통해 생성.
- 금지: 자동 Fact 승격, 자동 Canonical write, 자동 action 재실행.
- 실제 외부 action connector는 계속 제외한다.

ADR에서 DEFER를 선택한다면 producer/manifest/UI가 활성 reentry를 약속하지 않도록
정정하고, activation condition과 terminal audit owner를 기록한다.

### Discovery diagnostics

`semanticEssenceForFinding` 실패마다 다음 safe diagnostic을 남긴다.

- finding fingerprint 또는 비가역 digest
- project-scoped correlation ID
- stage (`SEMANTIC_ESSENCE`), safe reason code, attempt, timestamp
- resulting completion (`PARTIAL`)과 제외 count

prompt, 원문, provider raw output, protected Evidence, credential, stack trace는 저장·노출하지
않는다. 실패는 전체 run을 무조건 실패시키지 않지만 health/activity에서 누적 비율을
관측할 수 있어야 한다.

### 검증

- feedback duplicate/replay/restart에서 work item 1개.
- 미승인 feedback이 Canonical/action execute Port를 호출하지 않는 negative test.
- diagnostic redaction snapshot과 project isolation test.

## WP-11. 레거시·orphan event·projection 정리

삭제부터 하지 않고 `rg` static trace + runtime contract test + compatibility telemetry로
각 항목을 다음 중 하나로 판정한다: `KEEP_ACTIVE`, `DEPRECATE`, `REMOVE`,
`INTENTIONAL_TERMINAL`, `REFERENCE_ONLY`.

1. `DerivedInferenceReady`: 실제 DiscoveryFindingReadyV1 reentry가 대체했음을 확인하고
   producer/consumer가 0이면 deprecate → 한 release 후 제거한다.
2. `DraftChangeSetReady`, `ReviewDecisionRecorded`, `ProjectionReady`: audit/extension point면
   `INTENTIONAL_TERMINAL` owner와 retention을 manifest에 기록한다. critical consumer가
   필요하면 WP-07 policy로 연결한다.
3. `/intake`, `/search`, `/ask/query`: 호출 telemetry와 지원 계약을 확인한다. cited-answer가
   `/ask/query`에서 사용 중이므로 함께 제거하지 않는다. replacement, sunset header,
   두 release 호환 기간, rollback route를 정의한 뒤 삭제한다.
4. projection: 입력만으로 재생성되는 stateless 구현은
   `Deterministic*Projection`으로 명명한다. 실제 persistent read model이 필요하면 owner,
   rebuild/checkpoint/consistency SLA를 별도 Port로 둔다.
5. ADR-125의 non-ready `items: []` 계약, document-review, Stage 12 adapters,
   cited-answer, ping/pong은 사용 증거 없이 삭제하지 않는다.

### 검증

- module manifest producer/consumer/disposition lint.
- public export와 route usage snapshot.
- deprecated route parity 및 sunset telemetry.
- projection rebuild/restart contract.

## WP-12. 종단 검증·배포·완료 판정

### 12.1 필수 test 층

WP-12는 앞선 WP의 동일 exact-SHA PASS 증거를 기계적으로 반복하는 단계가 아니다.
기존 증거를 집계하고 아직 검증되지 않은 종단 crash/replay/migration/rollback 시나리오를
보충한다. 단, 최종 exact SHA에 필요한 Gate가 실제로 실행됐다는 증거는 모두 있어야 한다.

| 층                 | 검증 내용                                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| Unit               | state transition, decoder, backoff, key/fingerprint, redaction               |
| Contract           | Port/Adapter replacement, event schema, lifecycle, cancellation              |
| Database           | unique/check/foreign key, transaction rollback, advisory lock, `SKIP LOCKED` |
| Integration        | 2 process workers, restart, crash/ack window, recovery/readiness             |
| Replay/Idempotency | Source, continuation, Connector, Ask, Action feedback 전 경로                |
| Golden Corpus      | transform/Evidence count·digest·source map 불변                              |
| Security Negative  | tenant scope, approval bypass, malformed input, secret leakage               |
| Migration/Rollback | backfill, mixed-version 차단, backup/restore, project deletion               |
| E2E                | Input → Canonical 및 Discovery/Action feedback reentry                       |
| Architecture       | module dependency, manifest topology, banned SQL pattern                     |

### 12.2 exact-SHA 실행 정책

1. 각 PR 개발 중에는 변경 범위의 focused unit/contract/database/integration test를 먼저
   실행한다.
2. 최종 exact SHA에서는 `npm run check`를 실행한다. 이 aggregate가 제공하는 lint,
   format, typecheck, unit, contract, integration, architecture, documentation,
   Stage 12 package, secret, OSS Gate 증거를 재사용한다.
3. `npm run check`에 포함되지 않는 다음 Gate는 별도 증거가 필수다.
   - `npm run test:database` 또는 같은 exact SHA의 CI `Quality` database-test PASS.
   - `npm run frontend:test:e2e` 또는 같은 exact SHA의 CI `Frontend` PASS. 변경 영향이
     없더라도 최종 Required Gates가 성공했음을 기록한다.
   - `npm run backup:drill`과 migration/backfill/restore/rollback rehearsal.
   - 2-connection Ask 경쟁, crash/ack-window, timeout-late-completion과 같은 WP-specific
     fault-injection Gate.
4. GitHub `Required Gates`가 같은 exact SHA의 `Quality`와 `Frontend`를 모두 통과했는지
   확인한다. 로컬 PASS와 다른 SHA의 CI PASS를 합쳐 완료 판정하지 않는다.
5. 같은 SHA의 유효한 PASS 증거는 중복 실행하지 않는다. 다만 infrastructure failure,
   flaky-test 진단 또는 증거 손실 때문에 재실행할 수 있으며 사유와 결과를 기록한다.
   실패 후 코드를 바꾸면 새 SHA에서 영향을 받는 Gate와 최종 Required Gates를 다시 실행한다.
6. 저장소 script 명칭이 변경되면 당시 `package.json`의 동등 명령으로 치환하고 실제 명령,
   exact SHA, exit code, 핵심 결과를 완료 증거에 남긴다.

실 provider/action은 호출하지 않고 deterministic fake와 fault-injection adapter를 사용한다.

### 12.3 완료 수치

- 재시작 후 orphan Source Stage 3 progress/continuation: 0건 또는 모두 명시적 terminal/unknown.
- 동일 semantic key의 중복 SourceVersion/Candidate/provider call/action side effect: 0.
- Connector timeout 동일 key handler 호출: 1회.
- Ask 64/2×32 및 10/2×32 test: 교집합 0, 누락 0.
- Evidence 0건 corpus: Source 성공, Stage 4 호출 0.
- public malformed request의 500과 side effect: 0.
- 종료 grace test에서 설정된 상한 안에 close 완료.
- producer event의 무분류 consumer/disposition: 0.
- recovery 실패가 readiness/activity에서 누락되는 경우: 0.

## 9. 목표 코드 형태

아래 코드는 구현 방향을 고정하기 위한 예시이며 아직 적용된 소스가 아니다. 실제 이름은
WP-00의 ADR/contract 승인 후 확정한다.

### 9.1 transaction 경계

```ts
interface SourceStage3ProgressPort {
  claim(input: Stage3ProgressClaim): Promise<Stage3ProgressLease>;
  finalize(input: Stage3ProgressFinalization): Promise<void>;
  findRecoverable(input: Stage3RecoveryQuery): Promise<readonly Stage3RecoveryItem[]>;
}

const materialized = await withTransaction(pool, async (tx) => {
  return sourceMaterializer.materialize(tx, command);
});

const stage3 = await stage3Pipeline.run({
  sourceVersion: materialized.sourceVersion,
  idempotencyKey: command.idempotencyKey,
});

await withTransaction(pool, (tx) => sourceProgress.finalize(tx, materialized.id, stage3));
```

`withTransaction` 내부만 rollback하고 callback 반환 뒤에는 `COMMIT`이 끝난 상태다.
`SourceStage3ProgressPort`는 논리적 contract이며 새 table을 전제하지 않는다. WP-00의
authority mapping 결과에 따라 기존 submission/item/attempt adapter 또는 최소 additive
persistence adapter를 사용한다.

### 9.2 Evidence indexing UoW

```ts
type EvidenceIndexingOutcome =
  | { status: 'NO_EVIDENCE'; resultId: string; evidenceCount: 0 }
  | {
      status: 'CONTINUATION_PENDING';
      resultId: string;
      continuationId: string;
      evidenceCount: number;
      evidenceSetDigest: string;
    };

interface EvidenceIndexingUnitOfWorkPort {
  indexAndEnqueue(input: EvidenceIndexingInput): Promise<EvidenceIndexingOutcome>;
}
```

span, result, continuation은 같은 PostgreSQL transaction에서 commit한다.

### 9.3 Connector dedup

```ts
type DedupState = 'IN_PROGRESS' | 'OUTCOME_UNKNOWN' | 'COMPLETED' | 'FAILED';

interface DedupStorePort {
  begin(
    input: DedupBegin,
  ): Promise<
    | { kind: 'ACQUIRED'; fence: bigint }
    | { kind: 'EXISTING'; state: DedupState; resultRef?: string }
    | { kind: 'CONFLICT' }
  >;
  markOutcomeUnknown(key: string, fence: bigint, code: string): Promise<void>;
  complete(key: string, fence: bigint, resultRef: string): Promise<void>;
  reconcile(input: DedupReconciliation): Promise<void>;
}
```

timeout `finally`에서 key를 삭제하는 API는 제공하지 않는다.

### 9.4 Discovery execution context

```ts
interface DiscoveryExecutionContext {
  runId: string;
  claimId: string;
  fence: bigint;
  signal: AbortSignal;
  reportDiagnostic(input: SafeDiagnostic): void;
}
```

### 9.5 recovery health

```ts
interface RecoveryStatus {
  runnerId: string;
  executionStatus: 'COMPLETED' | 'FAILED_TO_RUN';
  outcome: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  freshness: 'CURRENT' | 'STALE';
  readinessImpact: 'NONE' | 'DEGRADED' | 'NOT_READY';
  lastSuccessAt?: string;
  retryableCount: number;
  terminalCount: number;
  outcomeUnknownCount: number;
  safeCodes: string[];
}
```

## 10. Migration·배포·rollback runbook

### 10.1 additive migration 묶음

| 순서 | 논리 migration                | 내용                                                       |
| ---: | ----------------------------- | ---------------------------------------------------------- |
|    A | Evidence result/continuation  | indexing result, continuation, lease/fence/index           |
|    B | 조건부 Source authority delta | 기존 schema로 표현 불가능하다고 증명된 Stage 3 상태만 추가 |
|    C | Connector durability          | dedup/job/DLQ/ordering/reconciliation                      |
|    D | Ask claim index               | 검증된 partial/composite queue index                       |
|    E | Action review                 | ADR 승인 시 feedback dedup/work-item linkage               |

실제 번호는 merge 직전 migration registry에서 배정한다. 기존 001~061 파일을 수정하지
않는다.

### 10.2 안전한 배포 순서

1. backup 생성 및 restore rehearsal 성공 확인.
2. 기존 worker pause/drain. 진행 중 provider/action outcome을 분류.
3. additive schema migration 적용.
4. backfill dry-run: 예상 count, ambiguous count, digest sample만 출력.
5. backfill 실행. ambiguous는 `RECONCILIATION_REQUIRED`, 절대 성공으로 추정하지 않음.
6. 새 binary 배포. 아직 dispatcher/consumer는 pause 상태.
7. read/contract/health smoke test.
8. Source/Evidence continuation worker를 제한된 batch로 활성화.
9. Connector durable adapter와 topology policy를 canary project에서 활성화.
10. Ask/Discovery/recovery worker 순차 활성화.
11. backlog, duplicate conflict, outcome unknown, lease age, DLQ, readiness를 관측.
12. 안정화 후 legacy disposition 변경 활성화.

### 10.3 rollback 기준

- **Migration만 적용, worker 미활성**: binary rollback 가능. 새 table은 보존한다.
- **새 durable work 생성 후**: 구 binary로 즉시 회귀하지 않는다. worker pause 후
  unresolved work를 reconcile하고 forward-fix를 우선한다.
- **advisory lock 변경**: 혼합 버전 금지, 전체 drain 후 일괄 rollback.
- **Ask claim 변경**: worker drain 후 rollback. additive index는 유지 가능.
- **route validation**: compatibility regression이 확인되면 route별 flag rollback 가능하나
  auth/authority 검증을 비활성화하지 않는다.
- active durable data를 삭제하는 down migration은 제공하지 않는다.

## 11. 관측·운영 지표와 runbook

최소 지표:

- `SourceStage3ProgressPort`가 제공하는 논리 상태별 수, oldest incomplete age,
  reconciliation count. 실제 저장소가 기존 table인지 신규 delta인지 노출하지 않는다.
- Evidence indexing result/continuation 상태별 수, lease age, attempts, no-evidence rate.
- Connector dedup unknown age, conflict, DLQ, replay count, ordering lag.
- Ask queued/running age, claim contention, skip-locked throughput, lease recovery.
- Discovery in-flight, cancellation latency, loop error/backoff, partial reason counts.
- AI Generation Request outcome unknown/materialization failure.
- Canonical outbox/recovery lag.
- recovery runner last success/failed/unknown counts와 readiness 영향.

각 alert는 “조회 → authority 확인 → 자동 재시도 가능 여부 → 수동 reconciliation →
escalation” 순서의 runbook을 가진다. 대시보드와 로그에는 원문, prompt, provider raw
output, secret, credential, 보호된 Evidence를 포함하지 않는다.

## 12. PR 분할과 충돌 통제

PR은 authority, migration, deployment와 rollback 경계를 기준으로 나눈다. 독립적인 Primary
WP의 근본 원인을 같은 commit에 섞지 않고, 최종 acceptance PR에는 제품 동작 변경을
넣지 않는다.

|  PR | Primary WP | 범위                                                             | 독립 rollback 이유                   |
| --: | ---------- | ---------------------------------------------------------------- | ------------------------------------ |
|   1 | WP-00      | Canonical baseline, ADR/addendum, OSS decision, 최소 재현 증거   | 문서·결정 Gate                       |
|   2 | WP-01      | env contract와 startup preflight                                 | secret/config rollback               |
|   3 | WP-02      | advisory lock와 static guard                                     | drain이 필요한 일괄 binary rollback  |
|   4 | WP-03      | cleanup stack, Discovery cancellation/observer                   | lifecycle rollout                    |
|  5A | WP-04      | Evidence schema, 조건부 Source authority delta, backfill dry-run | additive migration과 데이터 backfill |
|  5B | WP-04      | Source transaction/resume/recovery와 continuation dispatcher     | worker activation/forward-fix 경계   |
|  6A | WP-05      | Connector Ports와 PostgreSQL adapter                             | adapter wiring 전환                  |
|  6B | WP-05      | timeout unknown, reconciliation, restart/replacement tests       | side-effect reliability 경계         |
|   7 | WP-06      | Ask atomic claim                                                 | Ask worker drain/rollback            |
|   8 | WP-07      | critical handoff topology와 manifest policy                      | edge별 rollout                       |
|   9 | WP-08      | recovery registry와 health/readiness                             | 운영 readiness 경계                  |
|  10 | WP-09      | HTTP decoder inventory와 route 적용                              | route별 compatibility rollback       |
|  11 | WP-10      | Action feedback reentry와 Discovery diagnostics                  | approval/diagnostic policy 경계      |
|  12 | WP-11      | legacy disposition/deprecation                                   | release compatibility 경계           |
|  13 | WP-12      | exact-SHA 증거 집계와 누락 종단 검증만 수행                      | 동작 변경 없는 acceptance            |

5A/5B 또는 6A/6B는 diff가 작고 동일 rollback runbook으로 실제 검증될 때만 하나의 PR로
합칠 수 있다. 반대로 migration이나 security review가 독립적이면 더 나눈다. WP-07~WP-10은
서로 다른 authority와 rollback 경계를 가지므로 하나의 “Runtime Closure” PR로 묶지 않는다.

모든 PR description에는 관련 WP/원문 ID, 포함·제외 범위, ADD/ADR, 검토한 OSS와 후보별
Decision, schema/contract version, focused test와 exact-SHA Gate 증거,
migration/rollback, 알려진 제한을 기록한다.

## 13. 명시적 제외 범위

이번 계획은 다음을 구현하지 않는다.

- 실제 외부 시스템에 side effect를 발생시키는 production Action connector
- AKP v2 또는 신규 지식 의미론
- Yjs 도입
- Redis/NATS/Temporal 기반 전체 runtime 교체
- gbrain 전체 runtime/DB를 Shotgun Kernel/Canonical로 승격
- Windows desktop distribution
- cloud disaster recovery 전체 체계
- 관련 없는 대규모 server refactor 또는 UI redesign

단, 위 항목을 제외한다는 이유로 현재 event를 silent orphan으로 두지는 않는다.
필요하면 명시적 `DEFER`/`INTENTIONAL_TERMINAL` 상태와 재평가 조건을 남긴다.

### 13.1 이전 세 수정계획서의 상태

이 문서가 저장소 review와 승인을 통과하기 전에는 이전 세 문서를 참고 자료로만 유지한다.
승인·병합 후에는 아래 문서를 `SUPERSEDED / REFERENCE_ONLY`로 표시하고 독립 실행하지
않는다.

- `Project_Shotgun_Runtime_Integrity_Correction_Plan_2026-09-03.md`
- `Project_Shotgun_Additional_Runtime_Integrity_Correction_Plan_2026-09-03.md`
- `Project_Shotgun_Data_Integrity_Runtime_Concurrency_Improvement_Plan_2026-09-03.md`

결함 ID와 감사 근거는 이력으로 유지한다. 이후 변경은 이 문서의 amendment/history에
남기며 superseded 계획을 조용히 다시 활성화하지 않는다.

## 14. 최종 Definition of Done

이 계획은 코드가 merge되었다는 이유만으로 완료되지 않는다. 다음 모두를 충족해야 한다.

- **Module Gate**: Port/Adapter 경계, 데이터 소유권, module contract test 통과.
- **Flow Gate**: 입력부터 Canonical 및 reentry까지 crash/replay 시나리오 통과.
- **Product Gate**: 정상·빈 결과·재시도·오류·접근성 있는 운영 상태 제공.
- **Architecture Gate**: Canonical/Evidence/Approval/Action 경계와 ADR 일치.
- **OSS Integration Gate**: 관련 후보를 선검토하고 모든 후보별 허용된 Integration
  Decision을 기록한다. 채택 후보는 version/commit/license/security를 고정하고, 직접
  구현은 재사용 불가 근거·교체 Port·Contract/Replacement Test를 기록한다.
- **Security Gate**: tenant/authority/approval negative test와 secret scan 통과.
- **Durability Gate**: restart dedup, timeout unknown, lease recovery, DLQ/replay 통과.
- **Migration Gate**: production-like backup→migrate→backfill→restore/rollback rehearsal 통과.
- **Documentation Gate**: event topology, runbook, env, schema/contract version 갱신.

완료 보고에는 구현 범위·제외 범위, **검토한 모든 OSS 후보와 후보별 Decision**,
채택 후보의 고정 version/commit/license, 직접 구현 범위의 OSS 재사용 불가 근거,
통과한 focused test와 최종 exact-SHA aggregate/CI 증거, migration/rollback 증거,
알려진 제한, 다음 단계로 전달할 contract version을 포함한다. 필요한 정보가 하나라도
없으면 `COMPLETE`로 보고하지 않는다.
