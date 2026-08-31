# AKP-7 WP4 — Epistemic Feedback Re-entry

> 상태: 구현 기록 (Draft PR 범위)
> 기준일: 2026-09-01
> Canonical base: `main@06fe75fb2175fb37748d456a3d8c4af910a41101`
> Branch: `codex/akp-7-wp4-epistemic-feedback-reentry`

## 1. 구현 범위와 경계

WP2가 기록한 서버 소유 `DiscoveryFeedbackEventV1` 중 EPISTEMIC feedback을 기존
`DERIVED_DISCOVERY` re-entry/validation lane으로 전달한다. 구현한 범위는 다음과 같다.

- 여섯 EPISTEMIC kind의 durable trigger 생성 및 bounded worker 소비
- feedback event와 trigger의 동일 transaction 기록
- pre-WP4 EPISTEMIC feedback의 bounded, idempotent reconciliation
- exact `projectId`/`feedbackId`/`findingId`/`findingRevision` identity 보존
- 기존 Finding lifecycle, approved-resource resolver, freshness authority/evaluator,
  validation intake, Review materialization bridge 재사용
- correction manifest/candidate의 feedback lineage와 bounded challenge context 보존
- retryable, ineligible, blocked terminal disposition의 durable 기록

다음은 명시적으로 제외했다.

- feedback/UI, Activity·Attention·Graph UX, Review UI, audit/security UI
- 새 Finding·Feedback·Review·Canonical·Fact·Claim 저장소
- feedback의 Source Evidence 변환, Canonical 직접 변경, 자동 승인/Action 실행
- ranking/weight/semantic suppression 변경, ML·embedding·learned feedback weight
- 새 queue/outbox/runtime dependency, deployment, WP5, AKP-8

## 2. Kind과 validation focus

| EPISTEMIC feedback kind  | 고정 V1 validation focus  |
| ------------------------ | ------------------------- |
| `INCORRECT_RELATION`     | `RELATION_CORRECTNESS`    |
| `INSUFFICIENT_EVIDENCE`  | `EVIDENCE_SUFFICIENCY`    |
| `WRONG_ENTITY`           | `ENTITY_IDENTITY`         |
| `TEMPORAL_ERROR`         | `TEMPORAL_VALIDITY`       |
| `MISLEADING_PATTERN`     | `PATTERN_VALIDITY`        |
| `MISIDENTIFIED_CONFLICT` | `CONFLICT_CLASSIFICATION` |

`USEFUL`, `NOT_RELEVANT`, `ALREADY_KNOWN`, `TOO_FREQUENT`, `SNOOZE`,
`SUPPRESS_EXACT`, `SUPPRESS_SIMILAR`는 trigger를 만들지 않는다. WP3 ranking/suppression
행동에는 영향을 주지 않는다.

## 3. Durable trigger architecture

기존 `canonical.outbox`는 `CanonicalCommitted`와 Canonical commit FK에 고정되어 있어
feedback을 기록하면 Canonical 소유권과 outbox contract를 위반한다. 따라서 새 queue나
두 번째 outbox를 만들지 않고, WP2 feedback transaction 안에
`discovery.epistemic_reentry_triggers` durable hand-off ledger row를 함께 기록한다.
이 row는 processing/disposition state만 소유하고 validation·Finding·Review 의미는
소유하지 않는다. 재시도 polling은 기존 durable worker 경계를 사용한다.

`DiscoveryFeedbackProductCoordinator`는 EPISTEMIC event를 최소 payload
(`schemaVersion`, `feedbackId`, `projectId`, `findingId`, `findingRevision`,
`feedbackClass`, `feedbackKind`, `occurredAt`)로 변환하고, raw reason을 trigger에
복사하지 않는다. PostgreSQL에서는 `DiscoveryFeedbackRepositoryPort.transaction`
안에서 feedback insert, trigger insert, optional suppression insert, Command Ledger
completion을 같은 PoolClient로 실행한다. trigger에는 feedback/finding composite FK와
project-scoped unique constraint가 있다.

## 4. Identity와 reconciliation

`discovery-epistemic-reentry-identity:v1` identity는 다음 정규화 tuple을
`semanticStableJson`으로 직렬화한 SHA-256이다.

`projectId + feedbackId + findingId + findingRevision`

동일 key는 trigger, correction manifest, candidate, retry 및 Review bridge에서 재사용한다.
기존 finding의 revision 3이 나중에 생겨도 feedback revision 2를 조회하거나 수정하지
않으며, trigger와 feedback/finding FK가 exact revision을 고정한다. mismatch는
`IDENTITY_MISMATCH`로 명시적으로 종료한다.

worker `runOnce(limit)`는 최대 100건의 EPISTEMIC feedback만 읽어 누락 trigger를
삽입하고, pending/retryable trigger를 bounded polling한다. unique
`(project_id, feedback_id)`와 identity 검증으로 command replay, reconciliation replay,
duplicate delivery, worker retry가 한 logical intake로 수렴한다.

## 5. Non-Evidence challenge context

feedback reason/kind는 `EvidenceSpan`, `SourceVersion`, Fact, Claim, Canonical mutation이
되지 않는다. correction manifest/candidate/review lineage에 필요할 때만
`reasonKind = NON_EVIDENCE_USER_CHALLENGE`, feedback identity, fixed focus version,
bounded optional reason으로 보존한다. 이 값은 validation authority가 검증할 입력의
맥락일 뿐 truth score나 새로운 evidence가 아니다.

## 6. Lifecycle, freshness, validation, Review

- `NEW`: 기존 lifecycle authority로 합법적인 `NEW → VALIDATING`만 수행한다.
- `VALIDATING`: 중복 transition 없이 기존 validation intake에 idempotently 연결한다.
- `REVIEW_READY`/`REENTERED`: backward transition이나 기존 Review decision/resource
  변경을 하지 않는다.
- `DISMISSED`/`SUPPRESSED`: epistemic signal을 삭제하지 않지만 lifecycle을 불법으로
  reopen하지 않는다.
- `RESOLVED`/`STALE`/`SUPERSEDED`: `INELIGIBLE`을 durable하게 기록하고 reopen하지
  않는다.

approved resource resolver와 기존 `DiscoveryReentryFreshnessAuthorityPort`,
`DiscoveryReentryFreshnessEvaluatorPort`를 사용한다. Canonical/Discovery base,
approved resource revision, Evidence/derivation lineage, access/sensitivity 또는 exact
Finding revision이 stale/invalid이면 새 result를 조작하지 않고 governed disposition으로
종료한다.

EPISTEMIC feedback은 validation 성공 전에는 Review resource를 만들지 않는다. 성공한
correction intake만 기존 Review materialization bridge가 처리하며, WP4가 Review를
승인하거나 거부하지 않는다. 기존 access scope와 sensitivity를 widening/downgrade하지
않으며 모든 조회·FK는 project-bound다.

## 7. OSS Integration Decision

| 후보                                 | 검토 pin / license                                                                                                   | Decision                  | 적용 경계                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL                           | `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` / PostgreSQL License | `ADOPT`                   | 기존 transaction, migration, project/Finding/feedback/re-entry 저장소만 사용 |
| Ajv                                  | `8.20.0` / MIT                                                                                                       | `ADOPT` (기존 foundation) | 기존 contract validation foundation 재사용                                   |
| `garrytan/gbrain`                    | commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                                                              | `REFERENCE_ONLY`          | durable job/history/locking 패턴만 참고; Runtime/DB identity 제외            |
| `lucasastorian/llmwiki`              | commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0                                                       | `NO_RELEVANT_OSS`         | 변환/Evidence 중심으로 WP4 correction runtime과 맞지 않아 추출하지 않음      |
| `ddsyasas/llm-wiki`                  | commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                                                              | `REFERENCE_ONLY`          | action-oriented UX만 참고; backend/runtime 제외                              |
| Inkeep OpenKnowledge                 | commit `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later                                                 | `REFERENCE_ONLY`          | 검토/lineage 표현 패턴만 참고; GPL runtime/Yjs/Canonical 제외                |
| Temporal/NATS/Redis/pg-boss/Graphile | 검토된 후보, production pin 없음                                                                                     | `DEFER`                   | 기존 PostgreSQL durable hand-off와 새 runtime을 중복하지 않음                |

검토한 후보는 `docs/architecture/module-architecture/open-source-role-matrix.md`와
기존 OSS 평가 자료를 출발점으로 삼았다. 새 runtime dependency나 lockfile 변경은 없다.
Adapter 교체 시 contracts, persistence port, focused Contract/Security/Replacement test와
동일 identity를 유지한다.

## 8. Migration, backup, rollback

`db/migrations/057_akp_7_wp4_epistemic_feedback_reentry.sql`은 기존 re-entry manifest에
optional `feedback_id`와 correction purpose/identity를 additive하게 확장하고,
`discovery.epistemic_reentry_triggers`를 생성한다. `scripts/database.ts`의 required table,
`scripts/backup-restore.ts`의 migration/integrity 목록에도 반영했다.

Migration은 056 preflight 후 적용되며, rollback은 해당 branch/배포 migration 정책에
따라 057 적용 전 backup을 복원하는 방식으로 수행한다. 적용 후에는 기존
`DERIVED_PROVENANCE_VALIDATION` identity와 manifest/candidate/consumption 경계를
보존한다. 새 trigger는 non-Canonical, project-bound, backup/restore 대상이고
`ON DELETE RESTRICT`로 project/feedback/Finding lifecycle의 조기 삭제를 막는다.

## 9. Verification

- Focused Contract/Unit: `16 passed`
- DB test: `tests/database/akp-7-wp4-epistemic-feedback-reentry.database.test.ts` 추가
  (원자적 transaction, reconciliation, exact revision, disposition, project isolation);
  로컬 `TEST_DATABASE_URL` 미설정으로 `NOT_RUN` — PR CI Database gate에서 실행
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `git diff --check`: PASS
- `npm run test:architecture`: PASS
- `npm run docs:validate`: PASS
- `npm run oss:verify`: PASS

WP5가 소유하는 UI/audit/security presentation과 deployment는 시작하지 않았다. 최종
완료 보고에는 모든 로컬 gate와 automatic exact-head PR CI 결과를 갱신한다.
