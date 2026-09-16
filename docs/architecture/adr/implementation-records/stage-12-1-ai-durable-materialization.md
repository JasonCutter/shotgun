# Stage 12.1 AI Durable Materialization Implementation Record

- 상태: **COMPLETE — Implemented, Verified and Approved**
- 완료 승인일: 2026-07-21
- 관련 ADR: [ADR-096 — Stage 12.1 AI Durable Materialization](../ADR-096-stage-12-1-ai-durable-materialization.md)
- 구현 브랜치: `feat/stage12-1-ai-durable-materialization`
- `main` Merge SHA: `06ce9b48328296856fc2eb70e6ef1a4a329243b6`
- Merge 방식: fast-forward

## 1. 기록 목적과 완료 범위

이 문서는 ADR-096이 정의한 Stage 12.1 Durability Gate Section 1의 구현, 검증과 별도 완료 승인을 기록한다.

완료 범위:

- Generation Request와 bounded Provider Attempt 영속화
- 버전화된 불변 `ProviderOutputEnvelope.v1`과 Digest 저장
- 저장 Output 기반 Candidate Materialization과 Replay
- `MATERIALIZATION_FAILED` 및 기존 Batch 복구
- `OUTCOME_UNKNOWN`, Output 누락과 Digest 불일치의 fail-closed 처리
- Startup Recovery에서 저장 Output을 사용한 Candidate 복구

제외 범위:

- Generic Job·Dedup·Dead Letter Runtime 영속화
- Canonical Outbox와 Compiled Truth Projection 자동 복구
- Backup·Restore와 clean restore drill
- Claim·검색 품질 Benchmark
- 외부 Action Connector 활성화와 Stage 12.1 전체 완료

따라서 이 기록은 AI Durable Materialization Section만 `COMPLETE`로 확정하며, Durability Gate와 Stage 12.1 전체 상태는 계속 `IN_PROGRESS`다.

## 2. 구현 결과

### AI Provider 경계

- Request와 Input Snapshot을 결정적 Digest로 고정한다.
- Provider 호출 전 하나의 Worker만 CAS로 `PROVIDER_RUNNING`을 claim한다.
- 명확한 retryable 실패와 영속 Attempt Budget이 있을 때만 Provider 재호출을 허용한다.
- 정확한 출력 텍스트와 공개 가능한 메타데이터만 `ai-provider-output-v1` Envelope로 저장한다.
- 저장 Output은 append-only Trigger와 Digest 검증으로 변경을 차단한다.

### Candidate Materialization 경계

- `OUTPUT_MATERIALIZED`와 `MATERIALIZATION_FAILED`는 Provider를 호출하지 않고 저장 Output으로 resume한다.
- Candidate Batch가 이미 있으면 Candidate를 추가하지 않고 기존 Batch로 완료 상태를 복구한다.
- 동일 Output과 Materializer Version은 기존 Batch와 Candidate Revision 1을 재사용한다.
- Materialization, Batch와 Candidate 완료는 PostgreSQL Transaction과 Unique Constraint로 보호한다.

### Fail-closed 경계

- stale `PROVIDER_RUNNING`은 자동 재호출하지 않고 결과 불명 상태로 취급한다.
- `OUTCOME_UNKNOWN`, Output 누락, Digest 불일치, 지원하지 않는 Schema와 상충 Output은 자동 Provider 재호출 없이 중지한다.
- Candidate, Validation, Human Review와 Canonical 승인 경계는 변경하지 않는다.

## 3. Contract와 데이터 변경

추가·변경된 주요 Contract:

- `GenerateStructuredOutput.v1`
- `GenerateStructured.v1`
- `CandidateMaterialized.v1`
- `CandidateMaterializationFailed.v1`
- `ResumeCandidateMaterialization.v1`
- `ProviderOutputEnvelope.v1`

데이터 변경:

- Migration: `014_stage12_1_ai_durable_materialization.sql`
- `ai.provider_calls`: Request·Input Digest, durable state, accepted Output와 Attempt Budget
- `ai.provider_attempts`: running·failed·outcome unknown 상태와 lease 시각
- `ai.provider_outputs`: append-only Provider Output Envelope
- `candidate.materializations`: Output과 Materializer Version별 완료·실패 상태

AI Provider Module은 Generation Request·Attempt·Output을 소유하고 Candidate Generation Module은 Materialization·Batch·Candidate를 소유한다. OSS 내부 ID나 Schema를 공통 Contract 또는 Canonical ID로 노출하지 않는다.

## 4. OSS Integration Decision

이번 Section은 새 Runtime 의존성을 추가하지 않고 기존 검증·고정된 기반을 재사용했다.

| 후보                         | 공식 소스와 Pin                                                                                                                        | License            | 결정             | 포함·제외 경계                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------- |
| PostgreSQL                   | https://github.com/postgres/postgres · `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | PostgreSQL, 검증됨 | `ADOPT`          | Transaction·Unique·CAS·append-only 저장에 사용. Domain은 Repository Port 뒤에 유지한다.                  |
| Google Gen AI JavaScript SDK | https://github.com/googleapis/js-genai · `@google/genai@2.12.0`                                                                        | Apache-2.0, 검증됨 | `ADOPT` 유지     | 기존 Gemini Adapter만 사용하며 SDK Raw Response·Secret·숨은 필드는 저장하지 않는다.                      |
| Ajv                          | https://github.com/ajv-validator/ajv · `8.20.0`                                                                                        | MIT, 검증됨        | `ADOPT` 유지     | 버전화된 Schema의 최종 검증에 사용하고 원격 비신뢰 Schema는 로드하지 않는다.                             |
| garrytan/gbrain              | https://github.com/garrytan/gbrain · `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`                                                        | MIT, 검증됨        | `REFERENCE_ONLY` | retry·idempotency·lock·migration/recovery 패턴만 재검토했다. Runtime·DB·Provider 설정은 포함하지 않는다. |
| pg-boss                      | https://github.com/timgit/pg-boss · `12.26.0`                                                                                          | MIT, 검증됨        | `DEFER`          | 이번 범위는 하나의 AI 복구 상태기계이며 범용 Job Schema·Worker Lifecycle을 도입하지 않는다.              |
| Graphile Worker              | https://github.com/graphile/worker · `0.17.3`                                                                                          | MIT, 검증됨        | `DEFER`          | 독립 Worker·Cron·운영 Queue가 필요할 때 재평가한다.                                                      |
| Temporal TypeScript SDK      | https://github.com/temporalio/sdk-typescript · `v1.20.3` / `ae823d7f9dd513f3b90aeba8c66854c59c39a359`                                  | MIT, 검증됨        | `DEFER`          | timer·multi-day wait·saga 요구가 없어 Server·Worker·Namespace를 도입하지 않는다.                         |

License·Security·Maintenance 근거는 `oss-source-registry.json`, Stage 4·6 OSS Integration Review와 Open-source Role Matrix의 기존 검증 기준을 재사용했다. 새 Package나 Fork가 없으므로 Lockfile과 Open-source Role Matrix 변경은 필요하지 않았다.

직접 구현 근거는 Provider Output·Candidate·Canonical 소유권이 Shotgun Contract에 속하고, 범용 Workflow Runtime을 도입하면 이번 복구 경계보다 큰 Schema·Worker·운영 표면이 생긴다는 점이다. Repository와 Provider Port를 유지하므로 향후 범용 Worker 또는 Workflow Adapter로 교체할 수 있다.

## 5. 검증 결과

완료 SHA에서 다음 검증을 통과했다.

| 검증                                                          | 결과                  |
| ------------------------------------------------------------- | --------------------- |
| `npm run lint`                                                | PASS                  |
| `npm run format:check`                                        | PASS                  |
| `npm run typecheck`                                           | PASS                  |
| `npm run test:architecture`                                   | PASS                  |
| `npm run db:migrate`                                          | PASS                  |
| `npm run db:verify`                                           | PASS                  |
| `tests/contract/ai-candidate-validation.contract.test.ts`     | `12 passed, 0 failed` |
| `tests/database/stage-4-postgres.test.ts`                     | `1 passed, 0 failed`  |
| `tests/database/stage12-1-ai-durable-materialization.test.ts` | `6 passed, 0 failed`  |
| `git diff --check`                                            | PASS                  |

PostgreSQL 검증은 ADR-096의 다섯 필수 시나리오와 실제 `MATERIALIZATION_FAILED` 복구 회귀를 포함한다.

- 정상·반복 전달에서 Provider 1회, Candidate 중복 0
- Output 저장 뒤 Candidate 누락 복구에서 Provider 재호출 0
- 기존 Batch 복구에서 새 Candidate 0, 최종 `COMPLETED`
- 명확한 Provider 실패의 Attempt와 무출력 상태 보존
- Output 누락·형식 오류·Digest 불일치에서 fail closed
- 실패 Materialization의 ID·Batch 재사용과 최종 succeeded 상태

Merge SHA에 연결된 GitHub Actions 실행 기록은 없다. 위 결과는 동일 SHA의 로컬 PostgreSQL 검증이며, `main`, `origin/main`과 구현 브랜치가 모두 완료 SHA와 일치함을 확인했다.

## 6. Migration, Rollback과 Replacement

- Migration 014는 기존 Table에 nullable 또는 기본값 Column을 추가하고 새 Output·Materialization Table과 제약을 추가한다.
- 이전 Runtime은 추가 Schema를 사용하지 않아, 긴급 Application Rollback 시 Schema와 영속 Output을 보존한 채 이전 Runtime으로 되돌릴 수 있다.
- 물리적 Down Migration은 제공하지 않는다. Provider Output과 Candidate 복구 근거를 삭제하는 자동 Rollback은 Evidence 보존 원칙에 어긋난다.
- 물리적 Schema 제거가 반드시 필요하면 먼저 Database Snapshot을 보존하고 새 레코드가 참조되지 않음을 확인한 별도 승인 Migration으로 수행한다.
- PostgreSQL Adapter는 Repository Port 뒤에 있으며 In-memory Adapter와 공통 Contract를 유지한다. 범용 Worker 도입 시 AI Provider와 Candidate Contract를 바꾸지 않고 복구 실행부만 교체한다.

## 7. 알려진 제한과 후속 Contract

- Provider 외부 성공과 첫 Output Commit 사이의 결과 불명 구간은 남는다. Provider가 Idempotency API를 제공하지 않으면 외부 비용의 exactly-once를 보장하지 않는다.
- Generic Job·Dedup·Dead Letter는 계속 In-memory다.
- Canonical Outbox·Compiled Truth Projection 자동 복구와 Backup·Restore는 Durability Gate 후속 Section이다.
- Claim·검색 Quality와 Reuse and Operations Gate는 완료되지 않았다.
- 실제 외부 Action Connector와 외부 네트워크 공개는 계속 금지한다.
- 후속 Section에 전달하는 Contract Version은 `ProviderOutputEnvelope.v1`과 `stage12-1-v1` Materializer다.

## 8. 승인과 변경 이력

- 구현과 검증은 feature 브랜치에서 완료했다.
- `06ce9b48328296856fc2eb70e6ef1a4a329243b6`을 `main`에 fast-forward 병합하고 `origin/main`에 푸시했다.
- 병합 뒤 별도 사용자 승인을 받아 2026-07-21에 Durability Gate Section 1을 `COMPLETE`로 확정했다.
- 이 승인은 Stage 12.1 전체 완료, Release Readiness 또는 후속 Section 자동 착수를 승인하지 않는다.

## 9. Post-approval convergence correction (pending GPT review)

2026-09-16에 `main`의 기준 SHA `4ed5db7616432b6b75e121e5243b8eca220bd5ad`에서
`codex/ai-durable-materialization-convergence` 보정 브랜치를 만들었다. 라이브
Durable Materialization Recovery는 추가 실행하지 않았고, 기존 라이브 DB도 이
보정 작업으로 변경하지 않았다.

### 결함과 경계 보정

기존 `candidate-generation.materialize()`는 candidate 구성, PostgreSQL
`repository.saveBatch()`의 authoritative commit, `CandidateGenerated`
(`DURABLE_JOB` + `REQUIRED_ACK`)와 `CandidateMaterialized` 발행을 하나의
`try/catch`로 감싸고 있었다. `saveBatch()`가 Batch·Candidate·Materialization을
완료한 뒤 Validation required acknowledgement가 실패하면 같은 catch가
`failMaterialization()`과 `CandidateMaterializationFailed`를 발행해 Provider call을
실패 상태로 되돌리는 모순이 발생했다. Startup Resume은 저장 Output을 재사용해도
같은 경계를 반복하므로 상태가 수렴하지 않았다.

보정은 pre-commit 단계에만 `failMaterialization()` 및
`CandidateMaterializationFailed`를 허용한다. `saveBatch()` 성공 후에는
`CandidateMaterialized`를 먼저 발행하고 `CandidateGenerated`를 이어서 발행한다.
따라서 정식 순서는 `persistence commit → CandidateMaterialized →
CandidateGenerated → Validation/Comparison handoffs`이며, downstream 실패는
각자의 durable handoff에서 관찰하고 이미 완료된 Materialization을 소급 변경하지
않는다. `CandidateGenerated`와 Validation/Comparison의 required acknowledgement,
idempotency, immutable Output, uniqueness와 attempt budget은 그대로 유지한다.

Recovery가 Resume 예외를 받는 경우에는 동일 project/request/call/output identity와
`COMPLETED`/`succeeded` 상태를 Provider Repository에서 다시 확인할 때만 성공으로
계수한다. 재조회가 실패하거나 exact convergence가 아니면 기존 fail-closed 결과를
유지한다.

### Integration·Regression evidence

새 OSS·Package·Migration·Lockfile 변경은 없다. 기존 PostgreSQL `ADOPT` pin,
Ajv `ADOPT` pin과 gbrain `REFERENCE_ONLY`의 retry/idempotency/recovery 패턴을
재사용하고, 새 권한·scheduler·queue·Provider recall을 추가하지 않았다.

보정 브랜치에서 다음 focused 검증을 통과했다.

- `npm run typecheck`
- AI Durable Materialization recovery convergence unit tests: `2 passed`
- `tests/contract/ai-candidate-validation.contract.test.ts`: `14 passed`
- `tests/database/stage12-1-ai-durable-materialization.test.ts`: `9 passed`
- targeted ESLint와 Prettier check
- PostgreSQL test DB에서 required-ack-after-commit, CandidateMaterialized 선행
  ordering, contradictory Provider failure 재기동 복구를 검증했다. Provider 호출은
  재실행되지 않았고 Batch·Candidate ID 및 Revision은 유지됐다.

전체 exact-head CI/Quality/Frontend/Required Gates와 GPT 최종 승인은 아직
보류 중이다. 이 보정은 `main`에 병합하지 않았으며, live recovery는 GPT가 정확한
head를 검토·승인한 뒤에만 재개한다.

## 10. Durable Resume OUTCOME_UNKNOWN reconciliation correction (pending GPT review)

2026-09-16에 `main@b7c052d8aaf3efa468047a42bfa4cfaf65d85ff5`에서
`codex/ai-durable-resume-reconciliation` 전용 보정 브랜치를 만들었다. 라이브
DB와 런타임은 변경하지 않았고, 앞선 PR #328의 materialization boundary 보정은
그대로 유지한다.

### 확인된 원인과 보정 경계

라이브 read-only audit에서 현재 accepted Output에 대한
`CandidateMaterialized` dedup은 존재하지 않았지만, 정확한
`ResumeCandidateMaterialization` semantic delivery는
`OUTCOME_UNKNOWN` tombstone으로 남아 있었다. 해당 record의 job도
`outcome-unknown`이며 safe error는 dead-letter를 semantic identity에 바인딩할 수
없었다는 내용이었다. 따라서 recovery runner는 Candidate handler 재진입 전에
Connector Runtime에서 중단되었고, Provider는 `MATERIALIZATION_FAILED`인 반면
Candidate materialization은 이미 `COMPLETED`인 상태가 지속됐다.

Recovery는 이제 각 recoverable record에 대해 정확한 Resume command를 한 번만
구성하고 같은 command object와 semantic key를 모든 단계에서 재사용한다.

1. 첫 `sendCommand()`가 정상 완료하면 즉시 `resumed += 1`이다.
2. 예외 후 기존 AI Provider Repository에서 project/request/call/accepted output
   identity를 다시 확인한다.
3. exact Provider state가 `COMPLETED`/`succeeded`이면 기존 command-specific
   `reconcileCommandOutcome()`으로 void command의 명시적 JSON `null` 결과를
   `COMPLETED`로 정식 확정하고 재전송하지 않는다.
4. Provider가 exact identity이지만 아직 수렴하지 않았고 예외가
   `OUTCOME_UNKNOWN`이면 `RETRYABLE_DEPENDENCY` safe failure로 같은 command를
   기존 Connector Runtime authority를 통해 `FAILED`로 reconciliation한다.
5. reconciliation 반환값이 실제 `FAILED`임을 확인한 경우에만 같은 Resume을
   정확히 한 번 재전송한다. 두 번째 전송도 예외이면 Provider state를 한 번
   재조회하고 exact `COMPLETED`/`succeeded`일 때만 성공으로 계수한다.

reconcile가 record를 반환하지 않거나 `FAILED`가 아니거나 예외를 내면 fail-closed
하며 재전송하지 않는다. 새로운 dedup authority·queue·epoch·Product API·직접 SQL
수정은 추가하지 않는다. downstream `CandidateGenerated`/Validation handoff와
durable dedup/dead-letter semantics도 변경하지 않는다.

### Regression evidence

- Unit recovery regressions: 8 passed. OUTCOME_UNKNOWN + non-converged provider,
  reconciliation unavailable/non-FAILED/throws, already-converged provider,
  bounded second attempt non-convergence와 기존 convergence/fail-closed 경계를
  포함한다.
- PostgreSQL Stage 12.1 suite: 10 passed. 실제
  `connector.dedup_records`, `connector.jobs`, `connector.job_attempts`에 exact
  Resume identity와 OUTCOME_UNKNOWN 상태를 만들고 production
  `reconcileCommandOutcome()`을 통해 retry eligibility를 회복했다. handler는
  한 번만 재진입했고 current-output `CandidateMaterialized`가 정상 처리됐다.
- PostgreSQL 결과: Provider call/attempt/output 각 `1` 유지, Provider는
  `COMPLETED`/`succeeded`, Candidate materialization은 `COMPLETED`, 기존 Batch와
  Candidate ID/revision 유지, recoverable set `0`, recovery result
  `{ attempted: 1, resumed: 1, failed: 0 }`.
- Migrations: **NONE**. Provider behavior: **NO**. Live DB touched:
  **NO**. Live recovery performed: **NO**.

이 보정은 GPT의 exact-head review와 전체 CI 확인 전까지 병합하지 않는다.

## 11. Second `OUTCOME_UNKNOWN` final reconciliation correction (pending GPT review)

2026-09-16에 `main@e7b773c52b44b8a93cddf1a101942a140ced4da`에서
`codex/ai-durable-resume-final-reconciliation` 전용 보정 브랜치를 만들었다.
GPT가 승인한 운영 검증에서 Provider와 Materialization은 수렴했지만, 두 번째
Resume 전송이 handler 이후 `OUTCOME_UNKNOWN`으로 끝날 때
`connector.dedup_records`의 exact Resume tombstone이 `OUTCOME_UNKNOWN`으로
남는 결함을 확인했다. Provider는 `COMPLETED`/`succeeded`, Materialization은
동일 ID의 `COMPLETED`, recoverable set은 `0`, health/readiness는
`HEALTHY`/`READY`였으며, Provider recall·SQL repair·추가 recovery는 수행하지
않았다.

### 보정 범위와 권위 경계

두 번째 `sendCommand()`가 예외를 내면 기존 exact Provider identity를 먼저
재조회한다. 수렴하지 않았으면 기존 fail-closed 결과를 유지한다. 수렴했고
예외가 `OUTCOME_UNKNOWN`이면 같은 command object와 semantic identity로
기존 `reconcileCommandOutcome(command, { result: null })`을 호출하고, 반환된
authoritative dedup state가 `COMPLETED`일 때만 `resumed`로 계수한다. 반환값이
없거나 `COMPLETED`가 아니거나 예외가 발생하면 `failed`로 남기며 세 번째
Resume은 절대 전송하지 않는다.

이 수정은 ADR-155의 권위 분리를 유지한다. `connector.dedup_records`만 최종
semantic outcome을 소유하고, `connector.jobs`의 `outcome-unknown`은 해당
실행의 이력·처리 중단 상태로 남을 수 있다. Historical job을 재작성하거나
새 Job reconciliation authority를 추가하지 않는다. Provider recall, Candidate
재생성, Batch·Candidate 수정, migration과 직접 SQL 수정도 없다.

### OSS·교체·Rollback 결정

새 OSS나 Package를 추가하지 않는다. 기존 PostgreSQL `ADOPT` pin과 Connector
Port/Adapter Contract, `Ajv` `ADOPT` pin 및 gbrain `REFERENCE_ONLY`의
retry/idempotency/recovery 패턴을 재사용한다. 이번 변경은 Shotgun이 소유한
semantic dedup authority와 Provider exact-identity 경계를 보완하는 Assembly
runner 보정이므로 범용 OSS Runtime을 도입하는 것은 범위를 넓히고 권위 경계를
흐린다. 기존 Connector Runtime Adapter는 그대로 교체 가능하며, application
commit revert로 rollback할 수 있고 Schema down migration은 필요하지 않다.

### Regression evidence (pending exact-head verification)

- Unit: 첫 `OUTCOME_UNKNOWN` → `FAILED` reconcile → 동일 Resume 1회 재전송 →
  handler 이후 두 번째 `OUTCOME_UNKNOWN` → `{ result: null }` reconcile 경로와
  undefined·non-`COMPLETED`·throw fail-closed 변형을 검증한다.
- PostgreSQL: 실제 `connector.dedup_records`, `connector.jobs`,
  `connector.job_attempts`에서 handler 이후 acknowledgement ambiguity를
  재현해 dedup은 `COMPLETED`, historical job은 `outcome-unknown`으로 허용되는
  상태를 검증한다. Provider call/attempt/output, Batch, Candidate ID/revision,
  Materialization ID와 recoverable count 불변도 확인한다.
- Exact-head CI, Quality, Frontend, Required Gates는 GPT review 이후 실행하며,
  그 전까지 이 보정은 병합하지 않는다.
