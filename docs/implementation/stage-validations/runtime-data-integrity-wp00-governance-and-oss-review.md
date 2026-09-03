# Runtime/Data Integrity WP-00 Governance Review

> 상태: **WP-00 REVIEWABLE — 구현 코드 변경 전**
> 검토일: 2026-09-03
> 기준 저장소: `JasonCutter/shotgun`
> 기준선: `cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2`
> 대상 브랜치: `codex/runtime-data-integrity-wp00-governance`

이 문서는 Issue #163의 WP-00 범위를 실행하기 위한 거버넌스 증거다. 제품 코드,
기존 migration, 외부 provider 호출, 외부 Action connector는 변경하거나 활성화하지
않는다. 통합계획서는 `PROPOSED CANONICAL` 상태이며, 이 검토와 PR merge 전에는
Canonical 권위를 주장하지 않는다.

## 1. 기준선·작업 경로 검증

| 항목                | 검증 결과                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| 원격 `main`         | `cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2`                                                       |
| 원격 WP-00 branch   | `cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2`                                                       |
| branch 차이         | 0 commits / 0 changed files at kickoff                                                           |
| WP-00 checkout      | 별도 worktree `C:\dev\shotgun-wp00`                                                              |
| Node/npm            | Node `v24.15.0`, npm `11.12.1` (engine contract `>=24` / `>=11`)                                 |
| Database baseline   | `pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b` |
| 최고 migration      | `061_stage4_project_ai_execution_identity.sql`; historical migration immutable                   |
| 원래 dirty worktree | 루트 `C:\dev\shotgun`의 README·계획서·사용자 파일을 보존하고 전환하지 않음                       |

`origin/main`은 fetch 후 다시 확인한다. main이 기준선보다 전진하면 이 검토를
무효화하고 최신 descendant에서 22개 위치·계획 drift를 재검산한다.

## 1.1 Artifact revision provenance

| artifact                                    | SHA-256                                                            | 처리                                             |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| GPT가 먼저 승인한 계획서 artifact           | `4a42189887b04978bca48338c6bf2f2ac5f0352c15c4c11b74246b7ea0016a4f` | provenance 비교의 부모                           |
| 의미 보정이 반영된 WP-00 candidate revision | `82776c6ae50a9277c92f3fdd97e6118cec505288525ef4fd1d71060918e4b68a` | 제한된 diff 검토를 통과한 중간 후보              |
| 공백 정규화 후 최종 WP-00 commit candidate  | `6124bd5320df0c807c6deb032e7f68b107d8fd9d2fb84d51598f0dbc0996674f` | 동일 의미의 formatting-only successor; 사용 대상 |

두 SHA가 다르다는 사실을 숨기지 않고 `git diff --no-index`로 한 번의 제한된
provenance 검토를 수행했다(236 additions / 256 deletions; Markdown 재배열·정규화
포함). 의미 있는 변경은 승인된 여섯 보정 범위에 한정된다.

1. 허용된 OSS Decision 집합과 WP-05 구현 전 pg-boss/Graphile 재평가 Gate
2. `PROPOSED CANONICAL` 권위·활성화 및 최신 `origin/main` drift 규칙
3. 논리적 `SourceStage3ProgressPort`와 조건부 최소 persistence
4. `RecoveryStatus`의 execution/outcome/freshness/readiness 분리
5. exact-SHA aggregate 검증, DB/Frontend E2E/backup/fault 증거와 정당한 rerun 정책
6. rollback-safe PR 경계와 pause → reconcile → forward-fix 절차

나머지는 표현·라인 참조·Markdown Prettier 정규화와 증거 링크 보강이다. 이후
`82776...`에서 `6124...`로의 추가 delta는 Markdown hard-break trailing space만
제거한 formatting-only 변경이다. 새 Product
capability, 새 Canonical authority, 외부 worker dependency를 계획서가 활성화하지
않는다. 따라서 candidate revision은 기존 artifact를 조용히 덮어쓴 것이 아니라,
여섯 보정을 적용한 WP-00 후보로 승인 가능한 provenance를 갖는다.

## 2. 22개 결함 재대조

아래 표의 `Evidence`는 현재 코드에서 결함을 확인할 수 있는 정적 계약·실행 경로
증거다. 각 ID는 통합계획서의 한 개 Primary WP에만 배정한다. WP-00에서는 재현에
필요한 범위 외 제품 테스트를 추가하지 않는다.

| ID     | 현재 코드 증거                                                                                                         | 판정                                                           | Primary WP |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| DP-01  | `.env.example`; `assemblies/shotgun-app/src/application.ts:326-336`                                                    | 운영 필수 staging secret 계약 누락                             | WP-01      |
| DP-02  | `.env.example`; `scripts/auth-bootstrap-owner.ts:7-13`; `application.ts:763-778`                                       | owner bootstrap 입력 계약 누락                                 | WP-01      |
| DP-04  | `adapters/frontend-sources-write-postgres/src/product-service.ts:223-369`                                              | commit 후 Stage 3 예외에 rollback이 재시도·원인 상태를 가림    | WP-04      |
| EX-01  | `modules/discovery-runtime/src/worker.ts:1179-1186`                                                                    | 예외 관측 없는 반복으로 silent failure/hot loop 가능           | WP-03      |
| EX-02  | `assemblies/shotgun-app/src/application.ts:339-344,1158-1162,1237-1262`; `server.ts:3895-3901`                         | 생성 실패·정상 종료 cleanup 소유 목록 불일치                   | WP-03      |
| DP-03  | `packages/contracts/schemas/evidence-indexed.v1.schema.json:9`; `adapters/sources-stage3-pipeline/src/index.ts:29-101` | `minItems=1` 계약과 0건 commit 경로 불일치                     | WP-04      |
| DE-01  | `DerivedInferenceReady` 선언·manifest                                                                                  | 실제 `DiscoveryFindingReadyV1` 경로와 오래된 event가 충돌      | WP-11      |
| DE-02  | `DraftChangeSetReady`, `ReviewDecisionRecorded`, `ProjectionReady` producer/manifest                                   | 소비자 또는 명시적 terminal disposition 부재                   | WP-11      |
| DE-03  | `assemblies/shotgun-app/src/server.ts:3049,3170,3201`                                                                  | legacy route의 사용·폐기 조건 부재                             | WP-11      |
| DE-05  | cited-answer module 및 `/ask/query`                                                                                    | 호환 경로에서 실제 사용 중인 모듈                              | WP-11      |
| DP-05  | frontend projection 구현                                                                                               | projection 계산과 상태 저장 책임의 경계 혼재                   | WP-11      |
| RIC-N1 | `adapters/sources-stage3-pipeline/src/index.ts:29-101`                                                                 | Evidence 후 Stage 4 호출 실패가 durable handoff 없이 반환됨    | WP-04      |
| RIC-N2 | Sources route `:306-362`; `product-service.ts` submit/retry; `lifecycle.ts:25-50`                                      | 기존 submission이 resume branch를 건너뜀                       | WP-04      |
| RIC-N3 | `packages/connector-runtime/src/stores.ts:21-57`; `runtime.ts:89-124`                                                  | timeout 후 running key 삭제로 동일 side effect 재호출 가능     | WP-05      |
| RIC-N4 | `packages/connector-runtime/src/runtime.ts:126-145`; `packages/kernel/src/index.ts`                                    | Job/Dedup/DLQ/Ordering이 process memory에만 존재               | WP-05      |
| RIC-N5 | `assemblies/shotgun-app/src/server.ts:685-716,950-968,2147-2148,3012`                                                  | recovery failure가 readiness·완료 상태에 완전 반영되지 않음    | WP-08      |
| RIC-N6 | `server.ts:2783-2832,3049,3170,3201,3776,3841-3892`                                                                    | raw request body 역참조로 malformed input crash 위험           | WP-09      |
| RIC-N7 | Action module TS contract/producer 및 JSON manifest                                                                    | `ActionFeedbackRecorded`의 governed reentry 또는 terminal 없음 | WP-10      |
| RIC-N8 | `adapters/discovery-runtime-product/src/index.ts:1040-1048`                                                            | finding essence 실패 원인이 PARTIAL 하나로 뭉개짐              | WP-10      |
| DIC-01 | 14개 `hashtext` advisory-lock 호출부                                                                                   | 32-bit hash 충돌로 unrelated aggregate가 직렬화됨              | WP-02      |
| DIC-02 | `adapters/frontend-ask-execution-postgres/src/index.ts:1710-1750`                                                      | 후보 SELECT와 claim이 다른 transaction                         | WP-06      |
| DIC-03 | `modules/discovery-runtime/src/worker.ts:453-501`; execution context `:22-36`                                          | stop이 in-flight AbortSignal/provider까지 전파되지 않음        | WP-03      |

재대조 결과: **22/22 assigned, 22/22 unique, duplicate primary assignment 0**.
DE-05는 삭제 대상이 아니라 사용 증거를 확보한 뒤 disposition할 항목이며, RIC-N2의
resume 누락과 DP-04/DP-03의 상태 문제를 별도 결함으로 중복 생성하지 않는다.

## 3. OSS contract-fit 및 Decision

WP-05의 durable worker trigger가 활성화됐으므로 아래 후보를 구현 전에 서면으로
재검토했다. Decision은 저장소 허용 집합만 사용한다. 이 표는 채택 승인이나 lockfile
추가가 아니다.

| 후보 / 공식 위치                                                                   | 검토 pin·license / maintenance snapshot                                                                                                                                 | Decision                      | Contract-fit 및 범위                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Shotgun PostgreSQL + transactional outbox (`https://www.postgresql.org/`) | PostgreSQL 16 compose image digest `ccc6e83d...`; PostgreSQL License; repository migrations 001–061                                                                     | `ADOPT` (existing foundation) | Shotgun-owned transaction, row lock, outbox, dedup, replay identity를 유지한다. Canonical/Evidence/Action 의미나 ID를 DB 도구에 넘기지 않는다.                                                                                                                                                                          |
| `timgit/pg-boss` (`https://github.com/timgit/pg-boss`)                             | npm `12.28.1`, tag `12.28.1` SHA `78089bbd51cce5e70282f6e5f9a9d937856ab414`, MIT, Node `>=22.12`; repository active; latest release observed `12.29.0`은 discovery-only | `DEFER`                       | PostgreSQL-backed queue·retry는 부분 적합하지만 자체 job metadata/claim lifecycle을 Shotgun Source/Connector 상태와 다시 묶어야 한다. 현재 기존 authority로 요구를 표현할 수 있어 중복 저장소를 만들지 않는다. activation 시 Port 뒤 Adapter, exact pin, replacement test, pause/reconcile/forward-fix가 선행 조건이다. |
| `graphile/worker` (`https://github.com/graphile/worker`)                           | npm `0.17.3`, tag `v0.17.3` SHA `195491c6c4ebf58420ab9d1c8291df0334184063`, MIT, Node `>=14`; active repository                                                         | `DEFER`                       | PostgreSQL claim/retry는 부분 적합하지만 worker schema와 task identity를 Shotgun-owned state와 동기화해야 한다. general queue need와 measured limit이 확인될 때만 Adapter/benchmark를 연다.                                                                                                                             |
| Temporal TypeScript SDK (`https://github.com/temporalio/sdk-typescript`)           | `v1.20.3` SHA `ae823d7f9dd513f3b90aeba8c66854c59c39a359`, MIT; SDK active, server/control plane required                                                                | `DEFER`                       | multi-day timer·saga·workflow service 요구가 없어 외부 durable control plane을 추가하지 않는다. Shotgun Action/Approval 의미를 workflow engine에 위임하지 않는다.                                                                                                                                                       |
| NATS JetStream (`https://github.com/nats-io/nats-server`)                          | repository HEAD `6cb77b9f30d3ad1e3486fe7f075701cecdc49920`, Apache-2.0; active                                                                                          | `DEFER`                       | 외부 broker와 별도 delivery/ordering/replay 운영이 필요하고 PostgreSQL outbox bridge가 추가된다. 다중 서비스·throughput evidence 전에는 도입하지 않는다.                                                                                                                                                                |
| Redis Streams (`https://github.com/redis/redis`)                                   | repository HEAD `ceadaab2be6770d6c5faab1e0b4f57f0d5130cc4`, API license `NOASSERTION`; active                                                                           | `DEFER`                       | license/security gate가 확정되지 않았고 외부 broker authority가 추가된다. 불명확한 license는 채택 근거가 될 수 없으며, 현재 범위에서는 benchmark하지 않는다.                                                                                                                                                            |
| `garrytan/gbrain` recovery/minion patterns (`https://github.com/garrytan/gbrain`)  | commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                                                                                                                  | `REFERENCE_ONLY`              | Job/recovery/idempotency test 패턴만 참고한다. gbrain runtime/DB/ID를 Shotgun Canonical 또는 worker authority로 채택하지 않는다.                                                                                                                                                                                        |

`pg-boss`, Graphile Worker, Temporal, NATS, Redis는 모두 지금 `DEFER`다. 이는 “조건부
defer”라는 새 상태가 아니며, 재평가 조건(측정된 throughput/recovery 한계, 다중
서비스 또는 장기 workflow 요구, license/security 통과)을 이 문서에 고정한 명시적
결정이다. Native PostgreSQL을 유지하는 직접 구현은 기존 foundation을 재사용하는
범위이며, WP-05 구현 PR에서 다음을 반드시 추가한다.

- 각 후보를 재사용하지 않은 이유와 PostgreSQL이 Shotgun authority에 더 잘 맞는 근거
- `DurableWorkPort`/Adapter 교체 Contract Test와 동일 corpus replay test
- queue/job metadata migration 및 pause → reconcile → forward-fix 절차
- 신규 persistence가 기존 submission/item/intake-attempt/outbox authority와 중복되지
  않는다는 schema·ownership 검사

## 4. SourceStage3ProgressPort authority 결정

`SourceStage3ProgressPort`는 논리적 Port이며 확정 테이블 이름이 아니다. WP-00 결정은
다음과 같다.

| 논리 상태                                                | 우선 authority                                                                                         | additive persistence 허용 조건                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| submission/item identity, accepted policy, retry attempt | `source_product.intake_submissions`, `intake_submission_items`, `intake_attempts` (migrations 020/035) | 기존 unique key와 attempt transition으로 표현할 수 없다는 재현 증거가 있어야 함                                        |
| Stage 3 outcome / Evidence count                         | 기존 Source/Evidence repository와 producer transaction                                                 | zero evidence, outcome-indeterminate, continuation pending을 구분할 필드가 기존 contract로 부족하다는 증거가 있어야 함 |
| replay key / lease / fencing                             | 기존 durable outbox·attempt authority                                                                  | process-memory key만 남거나 restart 후 동일 side effect를 막을 수 없다는 경우에만 최소 additive                        |
| `NO_EVIDENCE`, `RECONCILIATION_REQUIRED`                 | Source Stage 3 contract의 명시적 outcome                                                               | 상태를 임의로 `SUCCEEDED`로 합치지 않으며, 새 table은 증명 후에만 설계                                                 |

따라서 `source_product.pipeline_progress`는 WP-00에서 생성하지 않는다. migration
035의 `PARTIAL → OUTCOME_INDETERMINATE`와 기존 retry attempt 규칙을 먼저 재사용하고,
표현 불가능한 per-SourceVersion 실행 위치가 확인될 때만 최소 schema를 별도 ADR로
제안한다. Stage 4 실패가 Stage 3 성공을 뒤집지 않는 경계는 유지한다.

## 5. WP-00 focused validation 및 결과물

실행한 검증:

| 명령                                                                                                                                                                                                                                                      | 결과                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `git rev-parse HEAD` / `git rev-parse origin/main` / `git merge-base HEAD origin/main`                                                                                                                                                                    | 세 값 모두 `cfbfb3bd80bbadec60c3a0819153e63dae4c1eb2` |
| 22-ID trace matrix 검사                                                                                                                                                                                                                                   | `assigned=22`, `unique=22`, `duplicate-groups=0`      |
| `npx prettier --check docs/implementation/runtime-data-integrity-canonical-implementation-plan-2026-09-03.md docs/implementation/stage-validations/runtime-data-integrity-wp00-governance-and-oss-review.md docs/implementation/oss-source-registry.json` | PASS                                                  |
| `git diff --check`                                                                                                                                                                                                                                        | PASS                                                  |
| `npm run docs:validate`                                                                                                                                                                                                                                   | PASS                                                  |

WP-00에서 `npm run check`, Database test, Frontend E2E, `backup:drill`을 성공했다고
주장하지 않는다. 이 aggregate 증거는 제품 코드가 변경된 각 후속 WP의 exact head에서
재실행한다. WP-01 진행 전에는 이 문서와 통합계획서의 review, PR CI, merge SHA,
post-merge `main` CI, Canonical 승격을 확인해야 한다.

`docs/implementation/README.md`는 기준본의 기존 표 formatting을 재작성하지 않고
새 계획 링크 한 줄만 추가했다. 따라서 README 전체에 별도 Prettier rewrite를 적용하지
않았으며, staged diff에서 pointer가 한 줄인지 확인했다. 저장소 `npm run format:check`
대상과 `docs:validate`는 모두 PASS했다.

## 6. WP-01 승인 증거와 다음 단계

WP-01로 넘어가기 위한 최소 증거는 다음이다.

1. WP-00 PR의 exact head SHA와 변경 파일 목록
2. 22/22 재대조 및 중복 0
3. 모든 OSS 후보의 허용 Decision과 contract-fit 근거
4. SourceStage3ProgressPort authority 결정 및 additive 조건
5. 문서 직접 Prettier·docs validation·해당 Architecture/OSS gate PASS
6. PR 자동 CI PASS, merge 후 main CI PASS, README 단일 기준본 확인

위 증거가 충족되기 전에는 WP-01 Environment Contract나 어떠한 제품 수정도 이
브랜치에 추가하지 않는다. 충족 후 새 canonical main에서 WP-01을 별도 PR로 시작한다.
