# AKP-7 WP2 — Feedback Product Commands and State

> 상태: 구현 기록 (Draft PR 범위)
> 기준일: 2026-08-31
> Canonical base: `main@745d107969cbc6cc0448dcfbcd7f8513fb55ae3e`

## 1. 범위

WP1의 `DiscoveryFeedbackRepositoryPort`와 기존 `FrontendCommandGatewayPort`를
Discovery Product API 뒤에 연결했다.

- `frontend.discovery.feedback.v1` Product command
- principal-scoped exact Finding feedback/suppression state read
- strict browser intent decoder와 strict state response decoder
- server-derived Project, principal, actor, IDs, time, Finding fingerprint/version,
  matcher identity, access/policy revision
- USEFUL/NOT_RELEVANT/ALREADY_KNOWN/TOO_FREQUENT의 feedback-only 저장
- epistemic feedback의 feedback-only 저장
- 명시적 SUPPRESS_EXACT/SUPPRESS_SIMILAR/SNOOZE의 feedback + 별도 directive 저장
- completed replay, semantic idempotency, `OUTCOME_UNKNOWN`, principal isolation

다음은 WP2에서 제외했다.

- feedback에 의한 ranking/visibility/filter/weight 변경
- epistemic validation/re-entry, Review, Evidence, Fact, Claim, Canonical 변경
- semantic matching/vector query와 similar suppression enforcement
- Dismiss 의미 변경 또는 Dismiss와 feedback 결합
- UI/React/command palette/Activity/Attention/Graph/Review 변경
- WP3 consumption, WP4 epistemic re-entry, WP5 feedback UX

## 2. Authority와 계약

브라우저는 `schemaVersion`, `clientRequestId`, `idempotencyKey`, exact Finding
identity, frozen class/kind, optional short `reason`, optional `scope`, SNOOZE의
미래 `snoozeUntil`만 보낸다. 알 수 없는 필드와 class/kind mismatch는 acceptance
전에 거부한다. Project/principal/actor/fingerprint/matcher/createdAt/feedbackId/
suppressionId/ranking/policy/Review/Canonical 필드는 브라우저 계약에 없다.

Route는 기존 authenticated Discovery scope로 active Project와 membership을
확정한 뒤 exact Finding revision을 기존 Product read authority로 재검증한다.
불가시 존재 여부를 노출하지 않고 `NOT_FOUND`로 종료한다. exact directive의
fingerprint/version은 authoritative Finding에서만 읽고, similar directive는
`semantic-family:v1`이라는 server-owned matcher identity만 저장하며 matching을
수행하지 않는다. SNOOZE는 `NONE` matcher와 미래 expiry만 저장한다.

## 3. Persistence, transaction, replay

WP1의 feedback/suppression 테이블과 adapter만 재사용했다. 새 migration과 runtime
dependency는 없다. `DiscoveryFeedbackRepositoryPort.transaction`을 최소 확장해
PostgreSQL PoolClient 안에서 feedback, optional directive, 같은 transaction의
Command Ledger completion을 묶는다. In-memory adapter도 실패 시 두 append를
rollback한다. 완료 전 transaction 실패는 `REJECTED`, commit/acknowledgement가
불확실하면 `OUTCOME_UNKNOWN`이며 중복 replay를 시도하지 않는다.

Feedback와 directive ID는 accepted command ID에서 결정적으로 파생된다. 따라서
동일 principal + clientRequestId/idempotencyKey + semantic command identity의
replay는 같은 outcome과 durable record를 재사용하며 두 번째 event/directive를
append하지 않는다. `COMPLETED`는 두 required Product record가 모두 존재하는
경우에만 반환된다.

State read는 Project + principal + exact Finding revision으로 제한하고 시간 만료
후에도 suppression history를 보존한다. State read는 suppression/ranking을 적용하지
않고 다른 principal의 history를 반환하지 않는다.

## 4. OSS Integration Decision

| 후보                  | 검토 pin / license                                                                                                   | Decision                            | WP2 경계와 근거                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL            | `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` / PostgreSQL License | `ADOPT` (기존 foundation)           | WP1의 Shotgun-owned append-only tables와 기존 transaction adapter만 사용한다. 새 ORM/runtime은 도입하지 않는다.    |
| Ajv                   | `8.20.0` / MIT                                                                                                       | `ADOPT` (기존 contracts foundation) | 기존 validator foundation을 유지하고, WP2의 cross-field browser intent 규칙은 Shotgun Product contract로 보완한다. |
| garrytan/gbrain       | commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                                                              | `REFERENCE_ONLY`                    | idempotency/history/locking 패턴만 참고했다. Runtime, DB schema, Brain identity는 도입하지 않는다.                 |
| lucasastorian/llmwiki | commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0                                                       | `REFERENCE_ONLY`                    | 변환/Evidence 부품이라 Product feedback command/state 역할이 없고 추출하지 않는다.                                 |
| ddsyasas/llm-wiki     | commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                                                              | `REFERENCE_ONLY`                    | action-oriented UX 패턴만 기록된 범위에서 참고했다. WP2는 UI를 변경하지 않는다.                                    |
| Inkeep OpenKnowledge  | commit `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later                                                 | `REFERENCE_ONLY`                    | 검토/cockpit 표현 패턴만 참고하고 GPL runtime, DB, Yjs, Canonical은 제외한다.                                      |
| Transactional Outbox  | 기존 Role Matrix pin                                                                                                 | `DEFER`                             | WP2는 feedback/directive와 Command Ledger transaction만 필요하며 delivery/outbox side effect가 없다.               |

후보들은 정확한 frozen feedback 계약과 Shotgun의 Canonical/Evidence/Approval
경계를 제공하지 않으므로 직접 Product orchestration을 작성했다. 교체 시 기존
`DiscoveryFeedbackRepositoryPort`, `FrontendCommandGatewayPort`, strict contract
및 focused security/replay/atomicity tests를 유지하고 adapter만 교체한다.

## 5. Verification

- Contract: WP2 strict intent/state decoder, unknown authority field, class mismatch,
  invalid SNOOZE expiry, suppression intent
- Unit: all ordinary/epistemic paths, exact/similar/snooze construction, completed
  replay, atomic rollback, `OUTCOME_UNKNOWN`
- Integration: authenticated Product route, server fingerprint, replay, malformed
  authority rejection, cross-project non-disclosure, state reload
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run test:architecture`: PASS
- Migration: NONE
- Runtime dependency: NONE
