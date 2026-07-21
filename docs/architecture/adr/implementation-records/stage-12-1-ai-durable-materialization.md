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
