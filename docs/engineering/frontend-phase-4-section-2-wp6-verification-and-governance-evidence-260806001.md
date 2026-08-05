---
id: FRONTEND-PHASE-4-SECTION-2-WP6-VERIFICATION-AND-GOVERNANCE-EVIDENCE
classification: EVIDENCE
status: verification_complete_complete_candidate
work_item: FE-P4-S2
governing_review: '4866886969'
created_at: '2026-08-06'
---

# FE-P4-S2 WP6 — Verification and Governance Evidence

## 1. 검증 대상

- Repository: `JasonCutter/shotgun`
- Branch: `codex/frontend-phase-4-section-2-contract-preparation`
- Pull Request: `#66` — `OPEN / DRAFT / MERGEABLE`
- WP6 시작 기준 exact head: `8a4f2aeb161467edcc5b6ad611bfb848f9e86559` (CI **#572** SUCCESS —
  WP5 승인 기록 커밋)
- WP5 검증 완료 head: 코드 `f041e52e7cc64b035e462c0e70ff1f4e527ec551` (CI **#569**), 보고서 25
  `b476a733d465df4e51d41bbe8374bdef1ea76373` (CI **#570**), 메타데이터
  `4f167adbdb9defd5ca4b050e145250d78a3ae587` (CI **#571**)
- Governing Review: `4866886969` — **WP5 APPROVED / COMPLETE, WP6 AUTHORIZED_TO_START**
- Frozen Acceptance Criteria: `FE-P4-S2-AC-01..AC-22`
- Contract Snapshot: `docs/architecture/contracts/snapshots/frontend-phase-4-section-2/
frontend-phase-4-section-2-contract-snapshot-260805001.md` (revision 1)
- Implementation Request: `docs/implementation/frontend-phase-4-section-2-implementation-request-
260805001.md` (revision 1)
- Progress Report: `docs/implementation/frontend-phase-4-section-2-implementation-progress-report-
260805001.md` (Section 32)

## 2. AC-01~AC-22 Evidence Matrix

각 AC는 구체적인 구현 파일·Symbol, 검증 테스트 파일·테스트 이름, CI 증거에 연결된다. 단순
“구현됨” 주장은 없다. 판정은 `PASS` / `BLOCKED` / `NOT_APPLICABLE`만 사용한다.

### AC-01 — `ExternalActionV1` aggregate, stable `actionId`, immutable numbered `actionRevision`, target·external revision·operation·risk·manifest·approval·project·access·policy 결속

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ExternalActionV1`,
  `decodeExternalActionV1`, cross-field Project binding/access·policy invariant);
  `modules/frontend-external-action/src/product-api.ts` (`FrontendExternalActionProductCoordinator`,
  `aggregateStatusAfter`, `FrontendExternalActionScopeV1`); `db/migrations/
028_frontend_external_action_product.sql` (`aggregates` table + `resource_project_id`/
  `effective_project_id`).
- **테스트**: `tests/contract/frontend-external-action.contract.test.ts` — ExternalActionV1
  aggregate and restricted shell 그룹(`decodes a valid aggregate…`, `rejects unknown fields
(strict object)`, `rejects a non-1.0.0 schemaVersion`, `rejects an unknown operation and an
unknown status`, `rejects a zero action revision`) + Project binding 그룹; `tests/integration/
frontend-external-action-domain.test.ts` — `runs the full governed lifecycle to VERIFIED`;
  `tests/integration/frontend-external-action-product-api.test.ts` — `runs the full governed
lifecycle and reads through the protected routes`.
- **CI**: WP5 code head `f041e52e` CI #569, WP6 new head CI (Section 7).
- **판정**: PASS

### AC-02 — `ActionCandidateV1`·`RiskDecisionV1` validated·read-only, browser never computes risk

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ActionCandidateV1`,
  `RiskDecisionV1` + strict decoders); `modules/frontend-external-action/src/product-api.ts`
  (risk-decision reuse bound to candidate semantic digest + policy context;
  `externalActionCapabilitiesForScope`); workspace는 `risk-decisions/read`를 읽기만 하고 위험을
  계산하지 않는다 (`apps/shotgun-web/src/routes/external-action-workspace.tsx`).
- **테스트**: contract — Candidate/RiskDecision decode·read-only; domain — `creates a new
candidate revision and risk decision when candidate semantics change`, `creates a new risk
decision when the policy context changes (same candidate meaning)`.
- **판정**: PASS

### AC-03 — `ActionManifestV1` revision별 immutable, `manifestDigest`가 target·parameters·evidence·payload 포함, 새 revision이 이전을 대체

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ActionManifestV1`,
  `externalActionManifestDigest`, digest 일관성 invariant); `modules/frontend-external-action/
src/product-api.ts` (`manifestDigestFor`); migration 028 (`manifests` table).
- **테스트**: contract — ActionManifestV1 digest integrity 그룹(`manifestDigest` match/mismatch,
  non-sha256, `parameterDigest`, `evidenceSetDigest`, `expiresAt`); domain — `rejects execution
when the approval no longer binds the current manifest`, `recovers re-approval: a new manifest
with a fresh approval passes preflight again`.
- **판정**: PASS

### AC-04 — Approval purpose `EXTERNAL_ACTION`, Knowledge·Directive·다른 Action에 재사용 금지

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ExternalActionApprovalV1`,
  approval purpose decode); `modules/frontend-external-action/src/product-api.ts`
  (`approvalIsActive`, `approvalStatusFor`).
- **테스트**: contract — Approval 그룹(approval purpose); domain — approval lifecycle;
  product-api — `reads the approval of an External Action through the protected approvals/read
route`.
- **판정**: PASS

### AC-05 — Approval이 manifest revision·digest, target revision·digest, external revision, policy context, expiry 결속, expired/non-active는 execution 차단

- **구현**: `packages/contracts/src/frontend-external-action.ts` (approval expiry/status
  invariant); `modules/frontend-external-action/src/product-api.ts` (`approvalIsActive`).
- **테스트**: contract — Approval/Preflight/Execution 그룹(approval expiry ordering); domain —
  `rejects execution without an ACTIVE approval`, `rejects execution when the approval no longer
binds the current manifest`.
- **판정**: PASS

### AC-06 — `PreflightV1`가 approval 이후 permission·credential·budget·policy·target state·external revision 재검증, `READY`는 time-box

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`PreflightV1`, READY 재검증
  invariant); `modules/frontend-external-action/src/product-api.ts` (`preflightIsReady`,
  `preflightRevalidationFlags`).
- **테스트**: contract — Preflight 그룹(READY revalidation + expiry); domain — `preserves
ALREADY_APPLIED from preflight and blocks execution`; parity — `enforces the preflight
transition rule in BOTH adapters (same-status exact replay, DENIED→READY only)`.
- **판정**: PASS

### AC-07 — `ExecutionV1`가 ordered append-only `ExecutionAttemptV1` list 소유, attempt별 idempotency key + correlation/causation

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ExecutionV1`,
  `ExecutionAttemptV1` + AC-07 list invariants); `modules/frontend-external-action/src/
external-action-store-port.ts` (Execution/Attempt ports); migration 028 (`attempts` table,
  `UNIQUE (execution_id, attempt_number)`).
- **테스트**: contract — nested binding and Attempt list invariants 그룹(`AC-07: rejects an
Attempt list above the cap`, `rejects non-consecutive attemptNumber`, `rejects duplicate
attemptId and duplicate idempotencyKey`, `rejects attempts across different Executions`,
  `rejects an Attempt list whose length mismatches execution.attemptCount`, `rejects an Attempt
list whose latestAttemptRef does not match the last attempt`); domain — `persists an ordered
append-only attempt list with per-attempt idempotency`; parity — `enforces ordered append-only
attempts and a unique audit sequence at the database`.
- **판정**: PASS

### AC-08 — Transport retry가 request·key·digest·attempt 보존, domain retry는 새 command+attempt, timeout/`OUTCOME_UNKNOWN` 자동 재실행 없음

- **구현**: `packages/shotgun-api-client/src/frontend-external-action-client.ts` (governed
  mutation exactly-once, 비-CSRF 실패 자동 retry 없음, 원본 identity로 resolve);
  `modules/frontend-external-action/src/product-api.ts` (`runConnectorCommand` three-phase
  two-transaction); `packages/contracts/src/frontend-external-action-failures.ts`
  (`ACTION_OUTCOME_UNKNOWN` → 503 non-retryable).
- **테스트**: client — `sends a governed mutation exactly ONCE on a general 403 and returns the
typed failure (no mutation resend)`, `does NOT auto-retry a non-CSRF mutation failure`; domain
  — `never treats an in-flight connector command as COMPLETED on replay
(OUTCOME_INDETERMINATE)`, `preserves a FAILED retry attempt when the retry preflight is
denied`, `replays an already-completed command idempotently (same result, no
OUTCOME_INDETERMINATE)`; parity — `fails closed with OUTCOME_INDETERMINATE for an in-flight
(ACCEPTED) connector command (PG gateway)`.
- **판정**: PASS

### AC-09 — `VERIFIED`는 target state를 확인하는 `VerificationV1` 필요, Connector/HTTP success 단독으로 verified 아님

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`VerificationV1`, observed
  digest rule: `APPLIED`/`MISMATCH`는 `observedDigest` 필요, `NOT_APPLIED`는 거부);
  `modules/frontend-external-action/src/product-api.ts` (verify는 latest SUCCEEDED attempt에
  고정); workspace (`verification` section, `VERIFIED` surface).
- **테스트**: domain — `produces a VERIFICATION resource (Connector success is never verified
success)`, `pins verification to the latest SUCCEEDED attempt and rejects earlier ones`;
  contract — Verification 그룹; parity — `explicitly confirms the CURRENT verification/result
are the rollback lifecycle ones`; workspace — `refreshes the verification read and preserves
focus after a successful Verify`.
- **판정**: PASS

### AC-10 — `ResultV1`·`ActionAuditEventV1` safe read-only, raw provider payload·prompt·secret 노출 금지

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ResultV1` safe output refs,
  `ActionAuditEventV1` 12-category frozen set, raw audit payload rejection);
  migration 028 (`audit_events` append-only + immutable trigger).
- **테스트**: contract — Result/Audit 그룹(`rejects raw audit payload`, 12-category set);
  domain — `writes append-only audit events through the governed lifecycle`, `keeps audit
sequences strictly monotonic past 50 events (store-based authority)`; parity — `rejects UPDATE
and DELETE on append-only audit events at the database`.
- **판정**: PASS

### AC-11 — Cancel은 Rollback과 다른 abort, Rollback은 별도 governed command로 가용성 비가정

- **구현**: `packages/contracts/src/frontend-external-action.ts` (cancel/rollback command
  types); `modules/frontend-external-action/src/product-api.ts` (rollback PREPARE-ONLY 별도
  lifecycle); workspace (`externalActionCommandSurfaces`: canCancel/canRollback 분리, non-
  automatic).
- **테스트**: domain — `does not allow Cancel as Rollback and gates cancel by state`,
  `executes rollback through its own governed lifecycle (prepare → approve → preflight →
execute → verify)`; workspace — `sends a governed command exactly once on rapid double-click
(SUBMITTING lock)`; state — `exposes non-automatic governed surfaces only for valid states`.
- **판정**: PASS

### AC-12 — `CompensatingActionV1`는 `compensationForActionId` 참조의 독립 governed External Action, 자동 실행 금지

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`CompensatingActionV1`,
  prepare-compensation command); `modules/frontend-external-action/src/product-api.ts`
  (compensation 자동 생성·실행 없음); workspace (`PREPARE_COMPENSATION` surface, non-automatic).
- **테스트**: contract — Compensation 그룹; workspace — `sends the command-common reason draft
to every governed command`(compensation 사유 포함); state — non-automatic surfaces.
- **판정**: PASS

### AC-13 — Credential은 server-owned, masked view + typed capability만 browser 도달

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ExternalActionCredentialViewV1`,
  `maskCredential`); `modules/frontend-external-action/src/product-api.ts` (`credentialViewFrom`,
  `CREDENTIAL_MANAGE_SCOPES`); migration 028 (`credentials` table).
- **테스트**: contract — `decodes a masked credential view without raw secrets` (AC-13/AC-14
  그룹).
- **판정**: PASS

### AC-14 — Project-scoped execution budget server-owned, preflight 재검증, 고갈 시 fail closed

- **구현**: `packages/contracts/src/frontend-external-action.ts` (`ExternalActionBudgetViewV1`);
  `modules/frontend-external-action/src/product-api.ts` (`budgetViewFrom`, `BUDGET_READ_SCOPES`);
  migration 028 (`budgets` table).
- **테스트**: contract — `decodes a budget view and enforces softLimit <= hardLimit`; domain —
  `fails closed when the project execution budget is exhausted`; parity — `reserves the project
budget atomically under concurrency (single remaining execution)`, `lets the LAST execution
consume the final budget slot through the coordinator, then fails closed`, `produces an
identical last-slot budget view in both adapters (AC-21 parity)`.
- **판정**: PASS

### AC-15 — manifest·target·protected payload·credential·budget·external revision 변경 시 재승인, stale execution 차단

- **구현**: `modules/frontend-external-action/src/product-api.ts` (`targetRefsEqual`,
  `preflightRevalidationFlags`, 재승인 흐름); `packages/contracts/src/
frontend-external-action-failures.ts` (`EXTERNAL_ACTION_STALE` 등).
- **테스트**: domain — `rejects execution when the approval no longer binds the current
manifest`, `recovers re-approval: a new manifest with a fresh approval passes preflight again`,
  `rejects execution reusing a preflight from another action`, `fails closed with
EXTERNAL_ACTION_STALE when a governed command overlaps an in-flight connector execute (Phase-3
pinning)`, `rejects a second execute while the first connector call is in flight (no parallel
execution, Review 4861433397)`.
- **판정**: PASS

### AC-16 — `OUTCOME_UNKNOWN`은 원본 command identity로 resolve, 새 key 자동 제출 금지

- **구현**: `packages/shotgun-api-client/src/frontend-external-action-client.ts`
  (`resolveExternalActionOutcome` — 원본 `clientRequestId`+`idempotencyKey`+`semanticDigest`,
  GET `command-outcomes/by-client-request/:clientRequestId`); workspace (`resolveOutcome`,
  resolve-only button, 재실행 버튼 없음); `modules/frontend-external-action/src/product-api.ts`
  (resolve-by-original-identity).
- **테스트**: client — `resolves an OUTCOME_UNKNOWN command by the original identity through
the GET endpoint`, `resolves an OUTCOME_UNKNOWN command only when BOTH original clientRequestId
and originalIdempotencyKey match`; workspace — `recovers an OUTCOME_UNKNOWN command by the
original identity and adjudicates the result`(재실행 버튼 부재 포함), `keeps an OUTCOME_UNKNOWN
recoverable when resolve returns continued OUTCOME_UNKNOWN`, `returns to a recoverable
OUTCOME_UNKNOWN (original identity) when the resolve read fails`, `keeps the recovery lock
during the COMPLETED refresh so no governed command is submitted`; state — `enters
OUTCOME_UNKNOWN and recovers by the original command identity`, `freezes the OUTCOME_UNKNOWN
announcement to the original-identity recovery wording`; domain — `resolves a completed command
outcome through the original identity`, `preserves a started attempt when the connector throws
(OUTCOME_UNKNOWN, never lost)`.
- **판정**: PASS

### AC-17 — Hidden/access-restricted action은 protected payload·identity 누출 없는 restricted shell

- **구현**: `packages/contracts/src/frontend-external-action.ts` (access-restricted shell
  discrimination, `ACCESS_RESTRICTED`/`HIDDEN`); `modules/frontend-external-action/src/
product-api.ts` (restricted shell Detail); workspace (`snapshotRestricted`/`detailRestricted`
  restricted shell, `role="status"`, protected child read 미발행).
- **테스트**: contract — `AC-17: decodes an access-restricted shell without protected identity`,
  `AC-17: rejects an access-restricted shell that leaks protected identity`, `AC-17: requires
protected identity when the aggregate is not restricted`; domain — `returns only a restricted
shell from Detail when the scope changed`, `never returns an Approval payload for an
access-restricted (Hidden) action`; workspace — `shows the access-loss restricted shell and
never issues protected child reads`.
- **판정**: PASS

### AC-18 — Home·Command Palette에서 고위험 Action 직접 실행 금지, governance workspace로 이동

- **구현**: `adapters/frontend-product-read-in-memory/src/index.ts` (shell navigation
  `external-action` 항목, Home primary action `govern-external-action` navigate-only);
  `packages/contracts/src/frontend-section3.ts` (route id/href `external-action`/`/external-action`,
  `PrimaryActionViewId`에 `govern-external-action`).
- **테스트**: `tests/contract/frontend-shell-navigation.contract.test.ts` — `exposes the
external-action Command Palette navigation entry when a Project is ready`, `marks the
external-action entry temporarily unavailable without a Project`, `Home primary action
navigates to the governance workspace and never executes (AC-18)`.
- **판정**: PASS

### AC-19 — Workspace 접근성: keyboard matrix, frozen announcements, non-color cue, 200% zoom, reduced motion, axe zero-critical

- **구현**: `apps/shotgun-web/src/routes/external-action-workspace.tsx` (`aria-live="polite"`
  visually-hidden live region, `role="status"` restricted shell, `tabIndex={-1}` focusable
  headings, `aria-pressed`/`aria-current`/`aria-labelledby`/`aria-label`, frozen
  `EXTERNAL_ACTION_ANNOUNCEMENTS`, `externalActionAggregateCue` non-color text cue);
  `apps/shotgun-web/src/styles/application.css` (`:focus-visible` outline, `.visually-hidden`).
- **테스트 (WP6 신규 browser 증거)**: `tests/browser/frontend-external-action-workspace.spec.ts`
  5 tests — `renders the queue, detail and governed surfaces with frozen announcements (AC-19)`,
  `supports keyboard-only selection and restores deep-link focus (AC-19)`, `has zero axe critical
violations (AC-19)`, `stays usable at 200% zoom (AC-19)`, `renders under prefers-reduced-motion
(AC-19)`. 기존 unit 증거: state `freezes the OUTCOME_UNKNOWN announcement…`, workspace
  focus-preservation/announcement 테스트, route-contract deep-link parse 테스트.
- **판정**: PASS (WP6에서 browser 수준 증거 추가)

### AC-20 — Negative proof: Connector/HTTP success 단독 verified 금지, Cancel이 Rollback 아님, timeout 후 자동 retry 없음

- **구현**: client (governed mutation exactly-once, 자동 retry 없음); `modules/
frontend-external-action/src/product-api.ts` (verify 별도, cancel≠rollback,
  `OUTCOME_UNKNOWN` 자동 재실행 없음).
- **테스트**: client — `sends a governed mutation exactly ONCE on a general 403 and returns the
typed failure (no mutation resend)`, `does NOT auto-retry a non-CSRF mutation failure`; domain
  — `produces a VERIFICATION resource (Connector success is never verified success)`, `does not
allow Cancel as Rollback and gates cancel by state`, `never treats an in-flight connector
command as COMPLETED on replay (OUTCOME_INDETERMINATE)`; workspace — OUTCOME_UNKNOWN 복구
  테스트의 재실행 버튼 부재 단언.
- **판정**: PASS

### AC-21 — In-memory/PostgreSQL parity + migration 028 apply/rollback

- **구현**: `adapters/frontend-external-action-in-memory/src/index.ts`,
  `adapters/frontend-external-action-postgres/src/index.ts`, `db/migrations/
028_frontend_external_action_product.sql` (bounded additive, 15 tables).
- **테스트**: `tests/database/frontend-external-action-postgres-parity.test.ts` 17 tests —
  `matches in-memory output for the full governed lifecycle`, `matches in-memory output for the
rollback lifecycle to ROLLED_BACK`, `enforces ordered append-only attempts and a unique audit
sequence at the database`, 동시성 그룹(row lock, atomic budget, advisory lock), `applies 028,
rolls it back to the pre-028 fingerprint, and re-applies cleanly`, `rejects UPDATE and DELETE
on append-only audit events at the database`.
- **판정**: PASS

### AC-22 — Exact-head Quality·Frontend·Required Gates 통과

- **CI 증거**: WP5 code head `f041e52e` CI **#569** (`31027053940`) SUCCESS; report 25
  `b476a73` CI **#570** (`31027465566`) SUCCESS; metadata `4f167ad` CI **#571** (`31027793480`)
  SUCCESS; WP5 승인 기록 `8a4f2aeb` CI **#572** (`31041479089`) SUCCESS.
- **WP6 신규 head**: Section 7에서 자동 CI 기록.
- **판정**: PASS (새 exact head의 자동 CI 성공으로 확정)

## 3. 접근성 검증 결과 (AC-19)

WP6는 `tests/browser/frontend-external-action-workspace.spec.ts` 5개 browser 테스트를 추가하여
AC-19가 요구하는 browser 수준 증거를 확보했다. (기존 unit 증거로 충분한 항목에는 중복 테스트를
추가하지 않았다.)

- **Axe zero-critical**: 전체 workspace(큐·상세·child section·governed surface)를 대상으로
  `@axe-core/playwright` 스캔 → `impact === 'critical'` 위반 **0건**.
- **Keyboard-only**: Tab으로 큐 항목에 도달(30회 이내) 후 Enter로 선택 → 상세·거버넌스 명령
  렌더링 확인. 마우스 미사용.
- **Focus 보존**: deep-link `?action=action-1&focus=manifest-heading` 복원 시
  `document.activeElement.id === 'manifest-heading'` 확인 (contract §10.5).
- **Frozen Announcement**: `aria-live="polite"` live region에
  `EXTERNAL_ACTION_ANNOUNCEMENTS.DETAIL_READY`(『외부 액션 상세가 로드되었습니다.』) 전달 확인.
  전체 frozen 문자열은 unit 테스트가 고정.
- **Non-color cue**: `externalActionAggregateCue`의 텍스트 큐(`완료` for VERIFIED)와 raw
  status 텍스트(`VERIFIED`)가 모두 DOM에 존재 — 색상 단독으로 상태를 전달하지 않음.
- **200% zoom**: CDP `pageScaleFactor: 2`에서 문서 수평 overflow 없음, primary content
  (상세 heading, 거버넌스 명령, 롤백 버튼) 유지.
- **Reduced motion**: `prefers-reduced-motion: reduce`에서 workspace가 에러 없이 렌더링되고
  필수 상태 텍스트(큐·상태) 유지.

## 4. Keyboard·Focus·Announcement 검증 결과

- Keyboard-only 선택과 deep-link focus 복원은 Section 3에서 증명.
- Cancel 후 focus 보존, Verify 후 `verification-heading` focus, `SUBMITTING` lock 중 명령
  표면 잠금은 WP5 unit 테스트가 증명:
  - workspace `refreshes the verification read and preserves focus after a successful Verify`,
    `restores selection from a deep link and preserves focus`, `keeps the recovery lock during
the COMPLETED refresh so no governed command is submitted`.
- Announcement(큐 준비, 액션 선택, 상세 로드, 취소·롤백·보상 요청, 복구, 검증, 거부,
  OUTCOME_UNKNOWN)는 `EXTERNAL_ACTION_ANNOUNCEMENTS`로 고정되어 있고 unit 테스트가 문자열을
  고정한다 (state `freezes the OUTCOME_UNKNOWN announcement to the original-identity recovery
wording`).

## 5. Non-color Cue·Zoom·Reduced Motion·Axe 결과

- Section 3 참조. `externalActionAggregateCue`는 상태별 한글 텍스트 큐(`완료`, `차단`,
  `진행 중`, `보상 필요`, `롤백 가능`, `실행 준비`, `대기`)를 반환하며, `aria-label="상태: …"`로
  raw 상태도 함께 노출한다. 색상만으로 구분하는 의존은 없다.

## 6. 안전 경계·복구 경계 최종 검증

### 6.1 Connector Success와 Verified Success 분리 (AC-09/AC-20)

- Connector/HTTP 성공만으로 `VERIFIED`가 되지 않는다. `VerificationV1`이 target state
  (`APPLIED`/`NOT_APPLIED`/`MISMATCH`)와 `observedDigest`를 확인해야 `VERIFIED`가 된다.
- 증거: domain `produces a VERIFICATION resource (Connector success is never verified success)`,
  `pins verification to the latest SUCCEEDED attempt and rejects earlier ones`; contract
  Verification observed-digest 규칙; parity `explicitly confirms the CURRENT verification/result
are the rollback lifecycle ones`.

### 6.2 Cancel·Rollback·Compensation 분리 (AC-11/AC-12)

- Cancel은 중단 요청(외부 상태 되돌림 없음), Rollback은 별도 governed command
  (prepare→approve→preflight→execute→verify), Compensating Action은 `compensationForActionId`
  참조의 독립 governed External Action이며 자동 생성·실행되지 않는다.
- 증거: domain `does not allow Cancel as Rollback and gates cancel by state`,
  `executes rollback through its own governed lifecycle…`; workspace Cancel/`롤백`/
  `보상 액션 준비` 분리 surface + 취소 공지 『(외부 상태는 되돌려지지 않습니다)』; state
  `exposes non-automatic governed surfaces only for valid states`.

### 6.3 `OUTCOME_UNKNOWN` 무재실행 (AC-16/AC-20)

- 원본 `clientRequestId`+`idempotencyKey`+`semanticDigest`로만 결과를 조회한다. 원본 명령 자동
  재실행, 새 Identity 재시도, 자동 Retry Surface, 불명확 상태에서 새 External Mutation은 모두
  금지된다.
- 증거: client GET resolve-by-original-identity 2건; workspace OUTCOME_UNKNOWN 복구 3건
  (COMPLETED/REJECTED/계속 OUTCOME_UNKNOWN/Resolve 실패 각각 fail-closed 처리, 재실행 버튼
  부재); state OUTCOME_UNKNOWN 2건; domain resolve 2건; parity OUTCOME_INDETERMINATE 1건.

### 6.4 Resource Identity·Revision 경계 (ADR-119)

- Project·access revision·policy revision·action revision·external revision이 Query·Cache
  Identity에 반영된다: `externalActionResourceQueryKey`(scope + action + actionId +
  actionRevision + externalRevision + operation), `externalActionSnapshotQueryKey`(전용 bootstrap
  key), `externalActionDisabledQueryKey`.
- 빈 external revision을 가진 정상 Resource Key는 생성되지 않는다: queries `externalActionDetailQueryOptions`
  (revision-bound key, 비면 disabled key); workspace 테스트 `never creates an empty-external-
revision resource key while a queue selection awaits the snapshot`, `uses a dedicated snapshot
bootstrap key and never an empty external revision in resource keys`.
- URL의 Execution ID는 권위 있는 Execution Read가 동일성을 확인하기 전까지 명령 Identity로
  사용되지 않는다: workspace `executionValidated`/`executionUnverified` fail-closed + submitCommand
  내부 차단 (Review 4866654696); 테스트 `locks every governed command synchronously when a
deep-link resource is mismatched`, `fails closed while the deep-link execution id is still
unverified (execution read pending)`, `never uses an unverified deep-link execution id when the
execution read 404s`.

## 7. WP6 신규·재사용 증거와 CI

### 신규 추가 (최소 범위, AC-19 browser 증거만)

- `tests/browser/frontend-external-action-workspace.spec.ts` — 5 tests (axe, keyboard, focus,
  announcements, non-color, 200% zoom, reduced-motion).

### 재사용한 기존 증거 (중복 테스트 미생성)

- contract 93 tests, domain 27 tests, product-api 4 tests, client 10 tests, parity 17 tests,
  shell-navigation 3 tests, workspace-state 8 tests, route-contract 5 tests, workspace 23 tests.
- 합계 195 tests가 AC-01~AC-22를 커버한다.

### WP6 자동 CI (새 커밋 push)

- WP6 evidence head: `a89fd4888571293bb0bfffa2392c37ce6bd6751a` — CI **#573** /
  `31045703248`: Quality, Frontend, Required Gates **SUCCESS** (Frontend 2m40s, Quality 2m59s,
  Required Gates 3s).
- CI **#569 / #570 / #571 / #572**는 재실행하지 않았다.

## 8. 제외 범위

- WP1~WP5 Product 기능 재설계 없음.
- Backend·Domain 계약 변경 없음. Stage 11 테이블 재작성 없음. 새 Migration 없음.
  Migration 028 변경 없음.
- 새 Runtime Dependency·Lockfile 변경 없음. Real Production Connector 연결 없음.
  실제 외부 대상 Mutation 없음.
- FE-P5, Deployment, Production Verification, PR Ready 전환, PR Merge, Issue #65 종료,
  Governance Closure 없음.
- 동일 exact head에서 이미 PASS한 테스트 재실행 없음. CI #569·#570·#571 재실행 없음.

## 9. 미결사항

- 없음 (BLOCKED AC 없음). browser 성능 baseline artifact는 WP6 범위를 벗어나므로
  (`frontend-phase-4-section-2` performance 폴더 없음) 미생성. AC-19의 bounded queue(≤50)와
  bounded attempts는 contract 테스트(`rejects a queue page size above the cap`,
  `AC-07: rejects an Attempt list above the cap`, `rejects oversized server responses`)와
  클라이언트 `pageSize: 50`로 이미 증명됨.

## 10. 최종 WP6 판정 후보

AC-01~AC-22 모두 구체적 증거에 매핑되었고 `BLOCKED` AC가 없다. 접근성 필수 항목, Keyboard·
Focus·Announcement, Non-color Cue·200% Zoom·Reduced Motion·Axe, Restricted/Hidden/Safe Masking,
Connector vs Verified 분리, Cancel·Rollback·Compensation 분리, `OUTCOME_UNKNOWN` 무재실행,
Query Identity·Revision 경계가 모두 검증되었다.

```
WP6: COMPLETE_CANDIDATE
FE-P4-S2 Product: COMPLETE_CANDIDATE
PR #66: OPEN / DRAFT
Ready / Merge: NOT_AUTHORIZED
```

Codex는 `WP6 APPROVED`, `FE-P4-S2 COMPLETE`, `Ready`, `Merge`를 선언하거나 실행하지 않는다.
WP6 완료 승인은 별도 Review 이후 결정된다.
