# AKP-7 WP1 — Feedback, Suppression, and Ranking Foundation

> 상태: **WP1 구현 기록**
> 기준일: 2026-08-31
> Canonical base: `main@a5c4dcd999037aaadd3dcd6f80880f2b93ec4a86`

## 1. 범위

이번 Work Package는 Product API나 UI가 아닌 다음 비-Canonical 기반만 구현한다.

- 엄격한 공유 `DiscoveryFeedbackEventV1` 계약
- `EPISTEMIC`/`UTILITY` 피드백 class와 고정 V1 kind 집합의 분리
- 명시적 `SUPPRESS_EXACT`, `SUPPRESS_SIMILAR`, `SNOOZE` directive 계약
- 프로젝트·principal 범위의 feedback/suppression/ranking repository Port
- In-memory replacement adapter와 PostgreSQL adapter
- PostgreSQL migration `055_akp_7_wp1_feedback_suppression_ranking_storage.sql`
- AKP-3 deterministic ranking authority를 식별하는 immutable policy revision 계약·저장

다음은 의도적으로 변경하지 않았다.

- Product command/API, frontend client, UI, Inbox filtering
- feedback을 소비하는 runtime ranking/suppression/snooze
- epistemic correction/re-entry, Review, Canonical, Attention, Graph, Activity, Action
- implicit telemetry, ML ranking, feature store, vector store, 별도 Finding store

## 2. 계약 권위와 안전 경계

`packages/contracts/src/discovery-feedback.ts`가 V1 계약 권위다. Decoder는 unknown
field, 잘못된 enum, 잘못된 날짜·revision, `feedbackClass`/`feedbackKind` 불일치를
거부한다. actor는 기존 `Actor` (`user | service | system`) convention을 사용하고,
필요한 경우 기존 envelope convention과 같은 `principalId`를 보존한다. `reason`은
짧은 rationale만 허용하며 raw prompt나 secret field는 계약에 존재하지 않는다.

Epistemic kind는 `INCORRECT_RELATION`, `INSUFFICIENT_EVIDENCE`, `WRONG_ENTITY`,
`TEMPORAL_ERROR`, `MISLEADING_PATTERN`, `MISIDENTIFIED_CONFLICT`로 고정했다.
Utility kind는 `USEFUL`, `NOT_RELEVANT`, `ALREADY_KNOWN`, `TOO_FREQUENT`, `SNOOZE`,
`SUPPRESS_EXACT`, `SUPPRESS_SIMILAR`로 고정했다. 어떤 feedback도 Finding, Evidence,
Fact, Claim, Canonical을 수정하지 않는다.

Suppression은 system fingerprint dedupe와 별도 원장이다. Exact directive만
`EXACT_FINGERPRINT`와 fingerprint/fingerprint version을 가지며, similar directive는
명시적 versioned `SEMANTIC_FAMILY` matcher만 가진다. Similarity를 raw repository
search로 추론하지 않는다. Snooze는 `NONE` matcher와 필수 expiry를 가지며, 만료된
directive도 append-only history에서 삭제되지 않는다. 이후 Product enforcement에서
mandatory Conflict/Safety/Policy visibility 예외를 적용할 수 있도록 이 저장소는
suppression을 deletion이나 epistemic invalidation으로 표현하지 않는다.

## 3. Ranking 권위

AKP-3가 소유한 `DISCOVERY_RANKING_POLICY_VERSION_V1`을 `packages/contracts`로
이동해 단일 상수·타입 권위로 만들고, `modules/discovery-quality-gate`는 이를
re-export한다. 기존 `rankAcceptedDiscoveryCandidatesV1` 계산과 결과는 변경하지
않았다. 기존 일곱 dimension은 그대로 유지한다.

`DiscoveryRankingPolicyRevisionV1`은 stable policy id, revision, `GLOBAL` scope,
algorithm version, inspectable rules/weights, creator, creation/effective time을
보존한다. 현재 AKP-3 정책은 server-global이므로 사용자·프로젝트별 customization을
발명하지 않았다. Ranking score는 presentation/discovery priority이며 truth
probability/confidence가 아니다. WP1은 utility adjustment slot을 소비하지 않는다.

## 4. 저장소와 교체 경계

Shotgun이 새로 소유하는 테이블은 다음과 같다.

- `discovery.feedback_events`: Finding project/id/revision, actor/principal,
  class/kind, optional reason/scope, chronological append-only history
- `discovery.suppression_directives`: exact/similar/snooze shape, matcher/fingerprint
  version, source Finding revision, scope, actor/principal, expiry/review
- `discovery.ranking_policy_revisions`: server-global immutable ranking policy history

Feedback와 suppression은 `(project_id, id)` unique identity와 immutable trigger를
사용한다. Source Finding revision은 기존 `discovery.findings` composite identity에
FK로 묶어 보존하며 Finding 삭제를 통해 history를 우회하지 못한다. PostgreSQL Port의
모든 feedback/suppression read에는 project가 명시되고, suppression lookup은 principal
및 Finding/fingerprint/matcher version으로 제한된다. Similar lookup은 호출자가
선택한 versioned matcher 후보만 반환하며 유사도를 계산하지 않는다. Global ranking
policy read도 project context를 필수로 받고, 존재하지 않는 project에는 결과를
반환하지 않는다.

Port는 `appendFeedback`, `listFeedbackForFinding`, `appendSuppression`,
`listRelevantSuppression`, `insertRankingPolicyRevision`,
`listRankingPolicyRevisions`, `resolveEffectiveRankingPolicy`를 제공한다. Domain은
Port만 의존하고 In-memory adapter와 PostgreSQL adapter는 교체 가능하다. 새 외부
runtime, ORM, vector store, telemetry warehouse는 추가하지 않았다.

Migration rollback은 새 세 테이블과 인덱스·trigger를 dependent WP가 없는 환경에서
제거하는 별도 운영 절차로 제한한다. 정상 운영에서는 project deletion/retention
policy가 유일한 대량 제거 경로이며, 기존 Finding lifecycle transition은 이 history를
수정하지 않는다. Migration 055는 054 preflight 후 적용된다.

## 5. OSS Integration Decision

이번 WP에서 검토한 후보와 경계는 다음과 같다. 모든 직접 구현은 후보가 정확한
feedback/suppression 계약과 Shotgun의 Canonical·Evidence·Approval 경계를 제공하지
않는다는 근거에 따른다.

| 후보                      | 공식 URL 및 검토 pin                                                                                                                   | Decision                  | WP1 경계·근거                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL                | https://github.com/postgres/postgres / `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | `ADOPT` (기존 foundation) | PostgreSQL license verified; Shotgun-owned SQL persistence와 immutable trigger만 사용. Domain은 Port 뒤에 둔다.                                        |
| Ajv JSON Schema validator | https://github.com/ajv-validator/ajv / `8.20.0`                                                                                        | `ADOPT` (기존 foundation) | 기존 `SchemaRegistry`의 strict validation 기반을 유지하되 새 dependency/runtime은 추가하지 않고 V1 semantic cross-field decoder를 Shotgun 계약에 둔다. |
| garrytan/gbrain           | https://github.com/garrytan/gbrain / `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                                                  | `REFERENCE_ONLY`          | append/idempotency/history 패턴만 참고. 전체 runtime·DB·타입은 Canonical 또는 feedback store로 가져오지 않는다.                                        |
| lucasastorian/llmwiki     | https://github.com/lucasastorian/llmwiki / `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0                                     | `REFERENCE_ONLY`          | 변환·Evidence 부품 후보로는 검증됐지만 feedback/suppression/ranking persistence 역할이 없어 추출하지 않는다.                                           |
| ddsyasas/llm-wiki         | https://github.com/ddsyasas/llm-wiki / `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                                                | `REFERENCE_ONLY`          | Action-oriented UX만 참고. WP1 Product/UI 범위 밖이고 backend/SQLite는 도입하지 않는다.                                                                |
| Inkeep OpenKnowledge      | https://github.com/inkeep/open-knowledge / `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later                               | `REFERENCE_ONLY`          | review/cockpit presentation 패턴만 참고. GPL runtime·DB·Yjs/Canonical은 포함하지 않는다.                                                               |
| Event Sourcing pattern    | 기존 Role Matrix 4.18                                                                                                                  | `REFERENCE_ONLY`          | append-only 역사 표현만 참고하고, 별도 event runtime을 채택하지 않는다.                                                                                |
| Transactional Outbox      | 기존 Role Matrix 4.18                                                                                                                  | `DEFER`                   | WP1에는 outbox delivery가 없다. 이후 re-entry event가 승인되면 기존 PostgreSQL Outbox 경계를 재평가한다.                                               |

각 후보의 license, security, maintenance, replacement baseline은
`docs/implementation/oss-source-registry.json` 및
`docs/architecture/module-architecture/open-source-role-matrix.md`의 기존 검증을
따랐다. 새 채택 후보의 lockfile/runtime dependency는 없다.

## 6. 검증 및 한계

- Contract: 4 tests — 6개 epistemic kind, 7개 utility kind, mismatch/unknown field,
  exact/similar/snooze shape, ranking revision semantics
- In-memory repository: 3 tests — append-only/project isolation, explicit matcher와
  snooze expiry, immutable/effective policy history
- Database: `tests/database/akp-7-wp1-feedback-suppression-ranking.database.test.ts`
  3 tests 작성. 현재 실행 환경에 `TEST_DATABASE_URL`이 없어 안전하게 skip되었으며,
  PostgreSQL round-trip 증거는 해당 환경변수 구성 후 실행해야 한다.
- `npm run typecheck`: PASS
- 기존 AKP-3 ranking focused tests: 계약 relocation 후 실행 대상이며 결과를 보고에
  기록한다.

WP1은 storage foundation까지만 완료 범위로 취급한다. 다음 WP에서 이 계약을
Product command나 ranking consumption에 연결하기 전까지 실제 suppression filtering,
utility adjustment, epistemic re-entry, mandatory visibility enforcement는 활성화되지
않는다.
