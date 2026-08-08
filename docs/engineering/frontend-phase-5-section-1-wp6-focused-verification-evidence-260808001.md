---
id: FRONTEND-PHASE-5-SECTION-1-WP6-EVIDENCE-260808001
classification: CANONICAL
status: wp6_accepted
work_item: FE-P5-S1
created_at: 2026-08-08
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
wp5_accepted_head: 3a8f892ba512f7f2c845d86dfe2639d17a6f9e51
wp5_accepted_ci_number: 639
wp6_implementation_head: cc65b2888a54b4be1c527538c6fdf1e8903942b0
wp6_implementation_ci_number: 642
wp6_correction_head: e6b98d83aaaaf938fece37d54142c36bf37aee99
wp6_correction_ci_number: 644
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/73
governing_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
implementation_request: docs/implementation/frontend-phase-5-section-1-implementation-request-260806001.md
---

# FE-P5-S1 — WP6 Focused Verification and Evidence

## 1. Authority

User authorization (2026-08-08): **FE-P5-S1 WP6 — Focused verification and evidence:
AUTHORIZED**, after WP5 was ACCEPTED by the GPT review gate (round 2, head `3a8f892ba`,
CI #639; evidence carrier `73bbafc`, CI #640). WP6 adds no new Product functionality; it
completes the focused verification and evidence the Frozen Implementation Request r1 §4 WP6
requires. WP7+, Connector Diagnostics, SSE, additional migrations, new runtime dependency and
PR Ready/Merge remain excluded.

## 2. Scope

WP6 — Focused verification and evidence (Implementation Request r1 §4 WP6), after WP5 ACCEPTED.
WP6 verifies and evidences the full `FE-P5-S1-AC-01` through `FE-P5-S1-AC-16` set against the
frozen contract, reusing the WP1..WP5 verified heads and adding only the browser-level evidence
(AC-15 keyboard/accessibility) and the deterministic performance gates (AC-16) that unit tests
cannot provide.

- Contract and adapter mapping tests — already delivered by WP1/WP3/WP5 (contract 44 + adapter
  8 in the WP5 focused suites; see Section 4).
- Migration/rebuild and revision-ordering tests — already delivered by WP2 (`db:reset` +
  `db:verify` with migration 029, `frontend-activity-postgres-parity.test.ts`, deterministic
  rebuild + revision guards in `frontend-activity-read-model-store.test.ts`).
- Cross-Project non-disclosure and deep-link security tests — already delivered by WP3/WP4
  (`frontend-activity-product-api.test.ts` project-bound tests, `frontend-activity-round3-
regression.test.ts` non-disclosure, deep-link revalidation in the Product API).
- Partial adapter failure and authoritative refresh tests — already delivered by WP3
  (`frontend-activity-adapter-ports.test.ts` partial registry, `frontend-activity-projection-
builder.test.ts`).
- Keyboard/accessibility and browser E2E — **added in WP6** (Section 5).
- Deterministic three-sample median gates for Queue and Queue-to-Detail — **added in WP6**
  (Section 6).
- AC-01 through AC-16 evidence matrix — Section 3.

Not included (preserved boundaries): WP7+, Connector Diagnostics, SSE, additional migrations,
new runtime dependency, FE-P5-S2, Ready/Merge, deployment and production verification.

## 2a. Review round 1 corrections (GPT verdict CHANGES_REQUIRED)

GPT review round 1 returned `CHANGES_REQUIRED` with one blocker and one evidence correction.
Both were corrected on head `e6b98d83` (CI #644), verified by CI (Frontend / Quality / Required
Gates all green).

| #   | Defect (verdict)                                                                                                              | Correction                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AC-16 `initial Queue display` measurement started after `page.goto` completed, so navigation→Queue latency was under-reported | `measureQueueDisplay` now references the document navigation start (`performance.timeOrigin`); the returned value is the FULL navigation → committed Queue latency (see Section 6). Queue→Detail was already correct and unchanged       |
| 2   | AC-06 matrix cited projection/descriptor tests only, not the actual Retry→new Attempt behaviour                               | AC-06 now cites the owning-Domain retry tests that prove it directly: External Action (`attemptNumber = 2`, `causationId`, attempts `[1, 2]`), Sources (`attemptCount = 2`, `causation_attempt_id`), Ask (`service.retry` new execution) |

No previously-passed head was re-run; only the new WP6 browser/performance specs and the
evidence document changed.

## 2b. Review verdict — ACCEPTED (2026-08-08)

GPT review round 2 (`Make Shotgun - 상태 업데이트 및 진행사항`) of the round-1 correction head
`e6b98d83` (CI #644) and the final evidence carrier `7c5cbbd` (CI #645) returned **ACCEPTED**
(`Status Authority: IMPLEMENTATION_ACCEPTED`). All round-1 items (AC-16 Queue measurement
reference, AC-06 owning-Domain Retry evidence) are PASS; no blocking defect remains within the
WP6 scope.

- WP1: ACCEPTED; WP2: ACCEPTED; WP3: ACCEPTED; WP4: ACCEPTED; WP5: ACCEPTED; WP6: ACCEPTED;
  FE-P5-S1 Product Work Packages: ALL ACCEPTED; FE-P5-S1 overall: GOVERNANCE CLOSURE PENDING.
- PR #73 Ready/Merge, deployment and production verification remain forbidden.
- Head notation: `wp6CorrectionHead` = `e6b98d83` (CI #644); evidence/PR carrier head =
  `7c5cbbd` (CI #645).

## 3. AC-01..AC-16 evidence matrix

Each Acceptance Criterion is linked to the concrete implementation files, verification tests
and CI evidence that cover it. Judgements are `PASS` (covered by verified tests on the WP1..WP5
heads and/or the WP6 browser/performance specs).

### AC-01 — Current-Project Sources, Ask and External Action work in one Activity Queue

- **구현**: `packages/contracts/src/frontend-activity.ts` (Queue page), `modules/frontend-
activity/src/activity-domain-read-ports.ts` (Sources/Ask/External Action read ports),
  `adapters/frontend-activity-{sources,ask,external-action}/src/index.ts` (server-derived
  domain queues).
- **테스트**: `tests/contract/frontend-activity.contract.test.ts` (queue decode),
  `tests/integration/frontend-activity-product-api.test.ts` (multi-domain queue),
  `tests/integration/frontend-activity-domain-adapters.test.ts`.
- **판정**: PASS

### AC-02 — Another Project's Activity existence, ID, count and failure information is not disclosed

- **구현**: Product API project-bound scope guard; adapters filter by `resourceProjectId`.
- **테스트**: `tests/integration/frontend-activity-product-api.test.ts` — "is project-bound
  (cross-project records never appear)"; `tests/integration/frontend-activity-round3-
regression.test.ts` — "B reads the queue: A-private submission is NOT disclosed".
- **판정**: PASS

### AC-03 — Job, Run, Domain Attempt, Transport Attempt, Stage and Event identities are distinguished

- **구현**: `ActivityRootReferenceV1`/`run`/`attempts`/`transportAttempts`/`stages`/`events`
  typed identities in the contract; projection builder preserves each identity family.
- **테스트**: `tests/contract/frontend-activity.contract.test.ts` (identity decode),
  `tests/integration/frontend-activity-projection-builder.test.ts`,
  `apps/shotgun-web/src/routes/activity-workspace.test.tsx` (separate Domain/Transport tables).
- **판정**: PASS

### AC-04 — Activity projection identity never replaces concrete Domain Resource identity

- **구현**: `ActivityRootReferenceV1.domainResourceKind/domainResourceId` + `resourceHref` keep
  the concrete Domain reference; the workspace links to the exact Domain resource.
- **테스트**: `apps/shotgun-web/src/routes/activity-workspace.test.tsx` (exact Domain resource
  deep link, "도메인 워크스페이스에서 열기").
- **판정**: PASS

### AC-05 — Queue-to-Detail navigation exposes Run, Attempt, Stage and Event lineage

- **구현**: `apps/shotgun-web/src/routes/activity-workspace.tsx` Detail section renders
  Run/Attempts/Stages/Events lineage + continuation reads.
- **테스트**: `apps/shotgun-web/src/routes/activity-workspace.test.tsx` (detail lineage),
  WP6 browser E2E (Section 5).
- **판정**: PASS

### AC-06 — Domain Retry creates a new Attempt with causation while preserving the earlier Attempt and failure

- **구현**: delegation to owning-Domain retry commands (WP5); Activity never fabricates Attempts.
- **테스트** (owning-Domain retry → new Attempt behaviour, exactly the AC-06 action):
  - External Action — `tests/integration/frontend-external-action-domain.test.ts` — "persists an
    ordered append-only attempt list with per-attempt idempotency": after
    `retryExecutionAttempt` the new attempt has `attemptNumber = 2`, holds the requested
    `causationId`, and the attempt list is `[1, 2]` (earlier Attempt preserved).
  - Sources — `tests/database/frontend-phase-2-section-1-sources-lifecycle.test.ts` — "preserves
    Attempt history through outcome-indeterminate, retry and cancellation": after
    `retryItems` the item state is `QUEUED` with `attemptCount = 2` and the new row is
    bound to the previous attempt via `causation_attempt_id`.
  - Ask — `tests/unit/frontend-ask-execution.test.ts` — "keeps outcome unknown explicit and
    requires a user retry": `service.retry(..., 'SAME_CONTEXT')` starts a new execution
    (`RUNNING`) that completes successfully (provider called again), preserving the earlier
    `OUTCOME_UNKNOWN` snapshot.
  - Activity boundary — `tests/integration/frontend-activity-domain-adapters.test.ts` +
    `tests/contract/frontend-activity.contract.test.ts` (delegation descriptors; no generic
    Activity Retry).
- **판정**: PASS

### AC-07 — Transport Retry is not presented as a new Domain Attempt

- **구현**: `transportAttempts` is a separate projection family; delegation never converts a
  Transport Retry into a Domain Attempt.
- **테스트**: `tests/contract/frontend-activity.contract.test.ts` (transportAttempts decode),
  `tests/integration/frontend-activity-projection-builder.test.ts`.
- **판정**: PASS

### AC-08 — Failure, Partial Failure, Cancel Requested, Cancelled, Outcome Unknown and User Attention are distinct

- **구현**: lifecycle-state allow-list + Attention dimension in the contract and state mapping.
- **테스트**: `tests/contract/frontend-activity.contract.test.ts` (state allow-list),
  `tests/unit/frontend-activity-domain-mapping.test.ts`,
  `apps/shotgun-web/src/routes/activity-workspace.test.tsx`.
- **판정**: PASS

### AC-09 — Projection Watermark, Lag, Stale and Adapter Unavailable states are visible

- **구현**: `ActivityProjectionMetadataV1` (freshness, lag, adapter status) rendered in
  `ProjectionMetadata`.
- **테스트**: `tests/contract/frontend-activity.contract.test.ts` (metadata),
  `apps/shotgun-web/src/routes/activity-workspace.test.tsx`.
- **판정**: PASS

### AC-10 — Failure of one adapter still returns accessible results from other adapters as a partial result

- **구현**: adapter registry preserves accessible results; `metadata.partial`.
- **테스트**: `tests/integration/frontend-activity-adapter-ports.test.ts` (partial registry),
  `tests/integration/frontend-activity-projection-builder.test.ts`.
- **판정**: PASS

### AC-11 — Refresh and polling recover from the latest authoritative Domain Snapshot

- **구현**: polling baseline + manual refresh invokes `refreshActivityProjection`; reads use the
  latest authoritative snapshot.
- **테스트**: `tests/integration/frontend-activity-product-api.test.ts`,
  `apps/shotgun-web/src/routes/activity-workspace.test.tsx` (refresh button, polling toggle).
- **판정**: PASS

### AC-12 — Deep-link access revalidates Project Scope, Capability, sensitivity and Resource access

- **구현**: Product API route guard + resource access revalidation on deep-link read.
- **테스트**: `tests/integration/frontend-activity-product-api-boundaries.test.ts`,
  `tests/integration/frontend-activity-round3-regression.test.ts`.
- **판정**: PASS

### AC-13 — Retry and Cancel are shown only when the owning Domain allows them, and the server revalidates state and authority

- **구현**: server-derived `availableActions` descriptors (WP5); owning-Domain command routes
  revalidate at execution time.
- **테스트**: `tests/integration/frontend-activity-domain-adapters.test.ts` (deny-by-default),
  `apps/shotgun-web/src/routes/activity-workspace.test.tsx`.
- **판정**: PASS

### AC-14 — Event and Failure payloads contain only approved safe fields

- **구현**: strict decoders with allow-listed event/failure fields in the contract.
- **테스트**: `tests/contract/frontend-activity.contract.test.ts` (unknown-field rejection).
- **판정**: PASS

### AC-15 — Queue, Detail and timeline are keyboard navigable and have list/table accessibility representations

- **구현**: `QueueList` button list with `aria-current`/`aria-pressed`; Detail tables with
  `aria-label`; deterministic focus to the Detail heading; live-region announcements.
- **테스트**: `apps/shotgun-web/src/routes/activity-workspace.test.tsx` (deterministic focus,
  AC-15) + **WP6 browser E2E** (Section 5).
- **판정**: PASS

### AC-16 — With deterministic fixtures, initial Queue display and Queue-to-Detail transition each have a three-sample median of at most 2,000 ms

- **구현**: polling/refresh baseline, deterministic route fixtures.
- **테스트**: **WP6 performance spec** (Section 6).
- **판정**: PASS (measured medians in Section 6)

## 4. Reused WP1..WP5 verification (no re-run of previously-passed heads)

WP6 does not re-run any previously-passed exact head. It reuses the verified evidence already
recorded on the WP1..WP5 evidence documents and CI runs:

| WP  | Evidence document                                                                      | Verified head (CI)                                    |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| WP1 | `frontend-phase-5-section-1-wp1-typed-contract-adapter-ports-evidence-260806001.md`    | contract 39 PASS                                      |
| WP2 | `frontend-phase-5-section-1-wp2-additive-read-model-persistence-evidence-260806001.md` | parity + db gates                                     |
| WP3 | `frontend-phase-5-section-1-wp3-projection-builder-product-api-evidence-260806001.md`  | 166 focused PASS                                      |
| WP4 | `frontend-phase-5-section-1-wp4-activity-workspace-evidence-260807001.md`              | 116 web PASS                                          |
| WP5 | `frontend-phase-5-section-1-wp5-domain-action-delegation-evidence-260808001.md`        | 116 web / 157 activity PASS, head `3a8f892ba` CI #639 |

WP6 adds ONLY the browser-level evidence in Sections 5 and 6 on top of those heads.

## 5. Keyboard / accessibility and browser E2E (AC-15)

Added in WP6: `tests/browser/frontend-activity-workspace.spec.ts`. The browser fixture backend
serves the real session + global shell; the route guard, CSRF token and every Activity read
(queue/detail/stages/events/refresh) are stubbed with strict-decoder-valid fixtures. The spec
verifies, at the browser level:

- axe zero-critical scan of the Activity workspace.
- Queue items are keyboard-reachable (Tab) and activatable with Enter (keyboard-only selection).
- Selecting an item moves focus to the Detail heading (deterministic focus, AC-15).
- The frozen announcement is delivered to the polite live region.
- Queue/Detail/timeline have list/table accessibility representations.

## 6. Deterministic performance gates (AC-16)

Added in WP6: `tests/browser/frontend-activity-performance.spec.ts`. With deterministic local
fake route fixtures, headless Chromium, a single worker, one warm-up navigation excluded and
three measured samples, the spec measures:

- `activity-queue-display-ms` — from the `/activity` navigation start
  (`performance.timeOrigin`) to the committed Queue list (initial Queue display).
- `activity-queue-to-detail-ms` — from the queue selection gesture to the committed Detail
  heading (Queue → Detail transition).

The Queue display reference point is the navigation itself, not `page.goto` completion:
`performance.now()` is elapsed since the document's `performance.timeOrigin`, so the value
captured when the Queue commits is the FULL navigation → committed Queue latency (document
load + client routing + Queue render included).

Time is measured inside the page (user gesture → committed state, polled with
`requestAnimationFrame`), so Playwright actionability overhead is excluded. Each metric is
reported as the median of three samples and asserted against the frozen AC-16 gate
`median ≤ 2000 ms`.

Observed on the WP6 round-1-correction verification run (headless Chromium, single worker,
local fake fixtures):

| Metric                     | Samples (ms)     | Median (ms) | Gate (ms) | Verdict |
| -------------------------- | ---------------- | ----------- | --------- | ------- |
| `activity-queue-display`   | 801 / 769 / 1577 | **801**     | ≤ 2000    | PASS    |
| `activity-queue-to-detail` | 270 / 64 / 69    | **69**      | ≤ 2000    | PASS    |

## 7. Next action

WP6 is ACCEPTED by the GPT review gate (round 2, `Status Authority: IMPLEMENTATION_ACCEPTED`,
2026-08-08). FE-P5-S1 Product Work Packages are ALL ACCEPTED; the remaining permitted action is
the governance closure record (this document + registry). WP7+ and FE-P5-S2 are NOT_STARTED and
require user authorization; Ready/Merge/Deployment remain unauthorized.
