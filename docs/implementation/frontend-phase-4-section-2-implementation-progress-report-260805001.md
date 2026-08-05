# FE-P4-S2 Product Implementation — Governance Approval Report and Kickoff

- Record ID: `frontend-phase-4-section-2-implementation-progress-report-260805001`
- Date: 2026-08-05 (report 1 — governance approval recorded; implementation kickoff)
- Repository: `JasonCutter/shotgun`
- Work item: `FE-P4-S2` — External Action Governance and Execution
- Branch: `codex/frontend-phase-4-section-2-contract-preparation`
- Draft PR: [#66](https://github.com/JasonCutter/shotgun/pull/66)
- Tracking issue: [#65](https://github.com/JasonCutter/shotgun/issues/65)

## 1. User authorization (2026-08-05)

The user approved the FE-P4-S2 contract preparation result and authorized Product implementation:

1. **ADR-129 ACCEPTED** — External Action Product Resource, Attempt, Credential, Budget and
   Compensation Boundary.
2. **Contract Snapshot revision 1 APPROVED / FROZEN** — `FE-P4-S2-AC-01` .. `FE-P4-S2-AC-22`
   frozen and binding.
3. **Implementation Request revision 1 AUTHORIZED** (WP1–WP6).
4. **FE-P4-S2 Product implementation AUTHORIZED**.
5. **Migration 028 AUTHORIZED** (`028_frontend_external_action_product.sql`) — bounded additive
   within FE-P4-S2 scope; Stage 11 tables are not rewritten.

Authorization timestamp: `2026-08-05T03:50:22+09:00`.

## 2. Governance records updated (commit 5303634d5)

- ADR-129: `docs/architecture/adr/ADR-129-...boundary.md` — `PROPOSED` → `ACCEPTED` (accepted at,
  accepted by USER, product implementation AUTHORIZED).
- Contract Snapshot r1: `docs/architecture/contracts/snapshots/frontend-phase-4-section-2/...contract-snapshot-260805001.md`
  — `PROPOSED_PENDING_USER_REVIEW` → `APPROVED_FROZEN`; approved_by/at; AC section frozen;
  "Blocked until ADR-129" note removed (no blocked AC); authorization boundary AUTHORIZED.
- Implementation Request r1: `docs/implementation/frontend-phase-4-section-2-implementation-request-260805001.md`
  — `PROPOSED` → `AUTHORIZED`; authorized_by/at; request status and authorization sections updated.
- Contract Preparation Record: `docs/implementation/frontend-phase-4-section-2-contract-preparation-record-260805001.md`
  — `PREPARATION_COMPLETE_PENDING_USER_REVIEW` → `APPROVED_FOR_PRODUCT_IMPLEMENTATION`;
  approved_at; AC frozen; ADR ACCEPTED; Migration AUTHORIZED.
- Preparation Verification: `docs/engineering/frontend-phase-4-section-2-contract-preparation-verification-260805001.md`
  — revision 2, result APPROVED; ADR/migration/snapshot status updated.
- Evidence Registry (`docs/engineering/evidence-registry.json`): FE-P4-S2 records updated —
  ADR-129 `ACCEPTED`, Contract Snapshot `APPROVED_FROZEN` (AC FROZEN_BINDING_NOT_RUN),
  Implementation Request `AUTHORIZED` (new record), Preparation Verification
  `CONTRACT_PREPARATION_APPROVED` (revision 2, adr `NEW_ADR_REQUIRED_ACCEPTED`, migration
  `MIGRATION_REQUIRED_AUTHORIZED`).
- Issue #65 and PR #66 bodies synced to the authorized state.

## 3. Focused validation

- `npm run docs:adr-index` — PASS (1–129).
- `npm run docs:validate` — PASS.
- `npm run docs:completion-invariants` — PASS.
- `npm run docs:frontend-projections:check` — PASS.
- Automatic CI on the governance-approval commit `5303634d5` — run **#512** (`30940707874`):
  Quality, Frontend, Required Gates **SUCCESS**.

## 4. Implementation plan (WP1–WP6 per the Implementation Request)

- **WP1** — `packages/contracts/src/frontend-external-action.ts`: exhaustive V1 aggregate,
  candidate, risk decision, manifest, approval, preflight, execution, attempt, verification,
  result, audit, compensating action and rollback contracts; strict decoders (schemaVersion
  '1.0.0', unknown-field rejection); cross-field invariants; typed failure registration; contract
  tests by operation.
- **WP2** — `modules/frontend-external-action`: Product domain over the Stage 11 engine via a
  structural port; manifest revisions, purpose-specific approval, preflight revalidation,
  execution/attempt lifecycle, verification, cancel, rollback, compensating-action entry points;
  in-memory adapters; existing Frontend Command Ledger.
- **WP3** — `028_frontend_external_action_product.sql` (bounded additive): execution attempts,
  compensating actions, product binding columns; append-only/immutable constraints; PostgreSQL
  parity; no Stage 11 rewrite.
- **WP4** — Protected Product API under `/product-api/frontend/external-action/*` and
  `FrontendExternalActionClient` (strict decoding, CSRF, 403 refresh, AbortSignal, no mutation
  auto-retry).
- **WP5** — External Action Governance Workspace and browser recovery state (ADR-119 draft state
  machine, scope-safe query keys, focus restoration, safe masking, access-loss restricted shells,
  `OUTCOME_UNKNOWN` recovery without re-execute).
- **WP6** — contract/integration/database/security/E2E/accessibility/performance evidence;
  negative matrix (no secret leak, no auto-retry, no Cancel-as-Rollback, no HTTP-success
  verification).

## 5. Contract invariants being implemented (frozen)

- Browser never asserts Actor, Project, Capability, Policy, Credential or Budget authority.
- External Action Approval is `EXTERNAL_ACTION`-purpose only; never reused with Knowledge or
  Directive approvals.
- Connector/HTTP success alone never creates `VERIFIED`; target-state verification is required.
- `OUTCOME_UNKNOWN` resolves by original command identity; no automatic re-execution.
- Transport retry preserves Request/key/digest/Attempt; domain retry is a new Command + new
  Attempt.
- Cancel is an abort request, not Rollback; Rollback is an independent governed command;
  Compensating Action is a new governed External Action, never automatic.
- Credentials and raw provider payloads are never exposed to the browser, command payloads,
  outcomes, audit or results.
- High-risk actions are never executed from Home or Command Palette.
- Hidden/access-restricted identities, counts, edges and descriptions are never leaked.

## 6. Explicitly not authorized

- Real Production Connector connection or real external target mutation.
- FE-P5. New runtime dependency (report rationale + alternatives first if truly needed).
- Unjustified lockfile change. Ready / Merge / Deployment / Production Verification.
- Automatic retry or automatic Compensating Action.

## 7. Report cadence (GPT review delegation)

Each completed work unit is reported to GPT through a docs document (filename shared); GPT review
comments are incorporated before the next unit. PR #66 remains OPEN / DRAFT.

## 8. WP1 — Product V1 contracts, strict decoders, typed failures (report 2, 2026-08-05)

Commit `36f08e63b82a820b4c92ca40f80d2f62d76864ca` (push after report 1 head `d2a1966e`).

### Delivered

- `packages/contracts/src/frontend-external-action.ts` — exact V1 contracts:
  - `ExternalActionV1` aggregate (actionId + immutable actionRevision, target/external revision,
    operation, project/access/policy binding, risk/manifest/approval refs, aggregate status,
    capabilities, aggregate state, access masking, compensation marker);
  - `ActionCandidateV1`, `RiskDecisionV1`, `ActionManifestV1` (manifestDigest covers target,
    parameters, evidence and payload; digest verified by the decoder), `ExternalActionApprovalV1`
    (purpose `EXTERNAL_ACTION` only), `PreflightV1` (all six revalidation flags),
    `ExecutionV1` + `ExecutionAttemptV1` (per-attempt idempotency, correlation/causation),
    `VerificationV1` (APPLIED/NOT_APPLIED/MISMATCH), `ResultV1` (safe output refs only),
    `ActionAuditEventV1` (frozen categories), `CompensatingActionV1`, `RollbackV1`;
  - read/write operation contracts (11 governed commands + reads + outcome resolution);
  - strict decoders (`schemaVersion '1.0.0'`, unknown-field rejection, no `any`), bounded queue
    (≤50) and attempt list (≤50);
  - semantic command digests and server manifest digest helper.
- `packages/contracts/src/frontend-external-action-failures.ts` — 22 typed failure mappings.
- `packages/contracts/src/errors.ts` + `failure-contract.ts` — FE-P4-S2 failure codes and
  descriptors registered.
- `packages/contracts/src/index.ts` — exports added.
- `tests/contract/frontend-external-action.contract.test.ts` — 25 tests (strict decoding,
  unknown-field rejection, digest integrity, bounded requests, digest stability, exhaustive
  failure mapping, command-type registration).

### Validation

- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — 25/25 PASS.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on head `36f08e6` is the remote authority (recorded after the run).

### AC coverage (WP1)

- FE-P4-S2-AC-01, AC-02, AC-03 (manifest digest), AC-04, AC-05 (approval binding), AC-07
  (attempts contract), AC-09 (verification contract), AC-13 (credential masking contract),
  AC-14 (budget contract) — contract layer delivered; runtime enforcement follows in WP2/WP4.
- Not yet run (implementation pending): AC-06, AC-08, AC-10, AC-11, AC-12, AC-15, AC-16, AC-17,
  AC-18, AC-19, AC-20, AC-21, AC-22.

## 9. WP1 remediation — GPT review BLOCKED → resolved (report 3, 2026-08-05)

GPT review (Review ID 4858184783) returned **BLOCKED / CHANGES REQUIRED** with 9 remediation
items on the WP1 contracts. All 9 items are implemented in this remediation commit:

Commit `d50aff27f39957cc7aad41463a6146fc013c4f04` (push after report 2 head `f6b6da404`).

### Remediation mapping (GPT items → delivered)

1. **Strict decoders for every frozen operation** — added per-operation request decoders
   (`decodePrepareActionManifestRequestV1`, `decodeApproveExternalActionRequestV1`,
   `decodePreflightExternalActionRequestV1`, `decodeExecuteExternalActionRequestV1`,
   `decodeRetryExecutionAttemptRequestV1`, `decodeVerifyExternalActionRequestV1`,
   `decodeCancelExternalActionRequestV1`, `decodeRollbackExternalActionRequestV1`,
   `decodePrepareCompensatingActionRequestV1`, `decodeResolveExternalActionOutcomeRequestV1`,
   `decodeGetExternalActionRequestV1`, `decodeGetExternalActionDetailRequestV1`,
   `decodeListExternalActionAuditRequestV1`) plus result decoders for all 11 governed commands
   and all read results (list/get/detail/audit). Unknown-field rejection and `schemaVersion`
   `1.0.0` validation apply to each operation; operation-organized tests cover every decoder.
2. **Frozen 12-category audit alignment** — `ExternalActionAuditCategoryV1` is now exactly the
   frozen Stage 11 12-category set (`EXTERNAL_ACTION_AUDIT_CATEGORIES`); the previous 21-value
   set was removed, and out-of-set categories are rejected.
3. **Frozen Project binding rule** — every Product resource (`ActionCandidateV1`,
   `RiskDecisionV1`, `ActionManifestV1`, `ExternalActionApprovalV1`, `PreflightV1`,
   `ExecutionV1`, `ExecutionAttemptV1`, `VerificationV1`, `ResultV1`, `ActionAuditEventV1`,
   `CompensatingActionV1`, `RollbackV1`, `ExternalActionV1`) now binds
   `resourceProjectId` + `effectiveProjectId`; decoders require them.
4. **Access-restricted shell (AC-17)** — `ExternalActionV1` is a discriminated restricted shell:
   when `aggregateState` is `ACCESS_RESTRICTED` or `accessMasking` is `HIDDEN`, `targetRef`,
   `riskDecisionRef`, `manifestRef`, `approvalRef`, `latestExecutionRef` and
   `compensationForActionId` must be absent (decoder fails if present); when not restricted they
   are required/optional as before. Negative AC-17 tests added.
5. **WP1 cross-field invariants** — manifest `parameterDigest`/`evidenceSetDigest` must match
   their refs and `manifestDigest` is verified; `createdAt <= expiresAt`; ACTIVE approval
   requires future expiry; READY Preflight requires all six revalidations and future expiry;
   execution/attempt terminal statuses require `completedAt` (non-terminal forbids it,
   `completedAt >= startedAt`); verification `APPLIED`/`MISMATCH` require `observedDigest`,
   `NOT_APPLIED` forbids it.
6. **Typed Product resource reference** — non-target refs (risk/manifest/approval/execution/
   attempt/provider/verification/candidate) now use `ExternalActionResourceRefV1`
   (`resourceKind` + `resourceId` + optional `resourceRevision`); the target-specific
   `ExternalActionTargetRefV1` (`targetKind`/`targetId`/`targetRevision`/`externalRevision`) is
   used only for the target identity.
7. **Structurally safe audit payload** — `ActionAuditEventV1.eventJson` replaced by typed
   `eventData: ActionAuditEventDataV1` (`schemaVersion`, `message`, `refs` allowlist); raw or
   unsupported payload fields are rejected.
8. **Credential and budget Product views** — `ExternalActionCredentialViewV1` (masked credential
   only, status `CONFIGURED`/`MISSING`/`REVOKED`/`ROTATION_REQUIRED`, capabilities
   `TEST`/`ROTATE`/`REVOKE`) and `ExternalActionBudgetViewV1` (OK/WARNING/EXHAUSTED,
   `softLimit <= hardLimit`) with decoders; capabilities include `READ_CREDENTIAL`/`READ_BUDGET`;
   AC-13/AC-14 are now delivered at the contract layer.
9. **Focused test expansion** — `tests/contract/frontend-external-action.contract.test.ts`
   rewritten: 75 tests, operation-organized, covering every request/result decoder and the
   blocking negative cases above (restricted-shell identity leak, digest consistency, READY
   preflight revalidation, approval expiry, terminal timestamps, verification observed-digest,
   audit safe payload, 12-category set, project binding on all resources, credential/budget
   views). CI #514 (`30942801924`) on `36f08e6` was cancelled as superseded; the automatic CI on
   the remediation head is the remote authority.

### Changed files (this remediation)

- `packages/contracts/src/frontend-external-action.ts` — full remediation rewrite.
- `tests/contract/frontend-external-action.contract.test.ts` — expanded to 75 tests.
- (unchanged) `frontend-external-action-failures.ts`, `errors.ts`, `failure-contract.ts`,
  `index.ts` — failure codes/descriptors already matched the frozen reasons.

### Validation

- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **75/75 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on remediation head `d50aff2` — run **#516** (`30944067154`), and on the report
  head `49299da0` — run **#517** (`30944365379`). (Correction: report 3 initially mislabeled
  `d50aff2` as #517; the authoritative mapping is `d50aff2` → #516, `49299da0` → #517.)

### AC coverage (WP1 after remediation)

- Contract layer delivered: AC-01, AC-02, AC-03, AC-04, AC-05, AC-07, AC-09, AC-13, AC-14,
  **AC-17** (restricted shell negative tests at the contract layer).
- Not yet run (implementation pending in WP2/WP4+): AC-06, AC-08, AC-10, AC-11, AC-12, AC-15,
  AC-16, AC-18, AC-19, AC-20, AC-21, AC-22.

PR #66 remains OPEN / DRAFT. WP2 remains **NOT_AUTHORIZED** pending re-review of this report.

## 10. WP1 second remediation — GPT SECOND review → resolved (report 4, 2026-08-05)

GPT second review (Review ID 4859059633) returned **BLOCKED / SECOND REMEDIATION REQUIRED**.
The first remediation (9 items) was acknowledged as mostly resolved; **6 items** remained
(the second review listed 6 — including response-side collection bounds, which report 3 had
under-counted as 5). All 6 are implemented in this remediation commit:

Commit `94f9f3eb783d9b6e038ccef1229851a08542c9ba` (push after report 3 head `49299da0f`).

### Second remediation mapping (GPT items → delivered)

1. **Frozen individual Read Operations** — added the seven approved single-resource Read
   operations as first-class contracts with strict request + result decoders:
   `GET_MANIFEST` (`decodeGetActionManifestRequestV1`/`decodeGetActionManifestResultV1`),
   `GET_RISK_DECISION`, `GET_PREFLIGHT`, `GET_EXECUTION`, `GET_EXECUTION_ATTEMPTS`,
   `GET_VERIFICATION`, `GET_RESULT`. They are not replaced by the integrated
   `GET_EXTERNAL_ACTION_DETAIL`; the detail endpoint remains an additional read.
2. **Outcome Resolution safe decoding** — `ResolveExternalActionOutcomeResultV1.completed` is
   now the typed `ResolvedCommandResultV1` union, dispatched by `commandType` through the
   corresponding strict result decoder (`decodeCompletedOutcome` switch); no raw/unknown payload
   passes. The exclusive outcome contract is enforced: `COMPLETED` → completed only, `REJECTED`
   → rejection only, `OUTCOME_UNKNOWN` → neither.
3. **Nested Resource binding** — `Execute` result verifies `execution.actionId` and
   `attempt.actionId` equal the result `actionId`, `attempt.executionId` equals
   `execution.executionId`, and project bindings are consistent; `Retry` result verifies the
   attempt belongs to the action. `GetDetail` verifies every embedded resource
   (manifest/riskDecision/approval/preflight/execution/verification/result/rollback) matches the
   action's `actionId` + project binding; a compensating action binds through `sourceActionId`.
   Cross-project fail-closed is enforced by the decoders.
4. **Attempt list invariants (AC-07)** — `decodeAttemptList` enforces: bound ≤50, consecutive
   `attemptNumber` starting at 1, unique `attemptId` and `idempotencyKey`, single
   Action/Execution, project consistency, `attemptCount` matches list length, and
   `latestAttemptRef` matches the last attempt. Applied to `GET_EXECUTION_ATTEMPTS` and to the
   `GetDetail` attempts list.
5. **Evidence metadata correction** — report 3 CI mapping corrected (`d50aff2` → #516 /
   `30944067154`, `49299da0` → #517 / `30944365379`); PR #66 metadata fixed so the historical
   `PROPOSED` wording no longer conflicts with the current `ACCEPTED`/`APPROVED`/`AUTHORIZED`
   state.

### Changed files (this second remediation)

- `packages/contracts/src/frontend-external-action.ts` — individual Read contracts + decoders,
  typed `ResolvedCommandResultV1` outcome dispatch, nested binding assertions, attempt list
  invariant helper.
- `tests/contract/frontend-external-action.contract.test.ts` — expanded to **89 tests**.
- `docs/implementation/frontend-phase-4-section-2-implementation-progress-report-260805001.md`
  — this section; PR #66 metadata.
- (unchanged) `frontend-external-action-failures.ts`, `errors.ts`, `failure-contract.ts`,
  `index.ts`.

### Validation

- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **89/89 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `94f9f3eb7` — run **#518** (`30952447917`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP1 after second remediation)

- Contract layer delivered: AC-01, AC-02, AC-03, AC-04, AC-05, **AC-07** (attempt list
  invariants), AC-09, AC-13, AC-14, **AC-17** (restricted shell), plus the frozen individual
  Read Operations (§9 of the Contract Snapshot).
- Not yet run (implementation pending in WP2/WP4+): AC-06, AC-08, AC-10, AC-11, AC-12, AC-15,
  AC-16, AC-18, AC-19, AC-20, AC-21, AC-22.

PR #66 remains OPEN / DRAFT. WP2 remains **NOT_AUTHORIZED** pending re-review of this report.

## 11. WP1 third remediation — GPT THIRD review → resolved (report 5, 2026-08-05)

GPT third review returned **BLOCKED / SECOND REMEDIATION REQUIRED (final focused fixes)**.
The second remediation was acknowledged as delivered (individual Reads, Attempt invariants,
Detail binding, outcome discrimination, CI #518 SUCCESS); 3 explicit requirements from Review
ID 4859059633 remained. All are implemented in this commit:

Commit (this report head) — push after report 4 head `4b220e17`.

### Third remediation mapping (GPT items → delivered)

1. **Resolve-outcome recursion removed** — `ResolvedCommandResultV1` and
   `decodeCompletedOutcome` now accept only `validate / prepare / approve / preflight / execute /
retry / verify / cancel / rollback / compensation`; `resolve-outcome.v1` is excluded from the
   completed-result `commandType`, so a Resolve Outcome result can no longer nest another Resolve
   Outcome result. A recursion attempt is rejected by the decoder.
2. **Command Result nested binding completed** — `ValidateActionCandidateResultV1` now verifies
   outer `actionId === candidate.actionId === riskDecision.actionId`, Candidate/Risk Decision
   project-binding consistency, and `candidate.riskDecisionRef` → actual `riskDecisionId`.
   `PrepareManifest`, `Approve`, `Preflight`, `Verify` and `Rollback` results now verify their
   nested resource `actionId` against the outer `actionId` (matching the earlier Execute/Retry
   checks), so every Command Result enforces outer/nested binding consistency.
3. **Server-response collection bounds** — `decodeListExternalActionsResultV1.items` (queue ≤ 50) and `decodeListExternalActionAuditResultV1.events` (audit bounded ≤ 50) now reject
   oversized server responses, matching the already-bounded Attempt responses. Oversized
   response negative tests added for queue and audit.

### Changed files (this third remediation)

- `packages/contracts/src/frontend-external-action.ts` — resolve-outcome recursion removed;
  ValidateCandidate/Manifest/Approve/Preflight/Verify/Rollback nested binding; queue/audit
  response bounds.
- `tests/contract/frontend-external-action.contract.test.ts` — expanded to **93 tests**.
- `docs/implementation/frontend-phase-4-section-2-implementation-progress-report-260805001.md`
  — this section; report 4 metadata corrected (2nd review had 6 items, including response-side
  bounds).

### Validation

- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `1c5a544f` — run **#520** (`30953228134`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP1 after third remediation)

- Contract layer delivered: AC-01, AC-02, AC-03, AC-04, AC-05, **AC-07** (attempt list
  invariants + bounded server responses), AC-09, AC-13, AC-14, **AC-17** (restricted shell),
  plus the frozen individual Read Operations (§9 of the Contract Snapshot).
- Not yet run (implementation pending in WP2/WP4+): AC-06, AC-08, AC-10, AC-11, AC-12, AC-15,
  AC-16, AC-18, AC-19, AC-20, AC-21, AC-22.

PR #66 remains OPEN / DRAFT. WP2 remains **NOT_AUTHORIZED** pending re-review of this report.

## 12. WP2 — External Action Product domain (report 6, 2026-08-05)

GPT review (Review ID 4859244173) approved WP1 and authorized WP2:
`FE-P4-S2 WP1: APPROVED / COMPLETE` · `FE-P4-S2 WP2: AUTHORIZED`. WP2 is delivered in this
commit:

Commit `a9a7fa2140af24a16676b4eeb5f8178f6251da9f` (push after report 5 head `16f2acee8`).

### Delivered

- `modules/frontend-external-action/src/product-api.ts` —
  `FrontendExternalActionProductCoordinator` with all 11 governed commands
  (validateCandidate, prepareManifest, approve, preflight, execute, retryAttempt, verify,
  cancel, rollback, prepareCompensation, resolveOutcome) + all reads (list, get, detail, the 7
  individual reads, audit) + outcome resolution rebuilt from produced resources
  (`buildResolvedResult`, commandType-dispatched); structural Command Gateway port; scope-based
  capability derivation; fail-closed restricted shell; the existing Frontend Command Ledger is
  used for acceptance and outcome resolution (no second ledger).
- `modules/frontend-external-action/src/external-action-engine-port.ts` — structural port to the
  Stage 11 engine (preflight/execute/verify) with Product V1 safe views; Stage 11 records and DB
  IDs never cross the boundary.
- `modules/frontend-external-action/src/external-action-store-port.ts` — repositories for all
  Product resources (aggregate, candidate, risk decision, manifest, approval, preflight,
  execution, attempt, verification, result, audit, compensation, rollback, credential, budget)
  - transaction boundary.
- `modules/frontend-external-action/src/external-action-domain.ts` — pure domain helpers
  (aggregate status transitions, approval expiry/status, six-flag preflight revalidation, READY
  preflight validity, budget/credential views, masked credentials, terminal status rules).
- `modules/frontend-external-action/src/external-action-error.ts` — typed error → 22 failure
  codes.
- `adapters/frontend-external-action-in-memory/src/index.ts` — `InMemoryExternalActionStore`
  (copy-on-write + rollback + FIFO serialization) + `FakeExternalActionEngine` (fake connector;
  success is never verified success).
- `tests/integration/frontend-external-action-domain.test.ts` — **8 integration tests**: full
  governed lifecycle to VERIFIED, ordered append-only attempt list + retry, execution blocked
  without ACTIVE approval, budget fail-closed, Cancel ≠ Rollback, OUTCOME resolution through
  original identity (digest mismatch fails closed), VERIFICATION resource (Connector success is
  never verified success), command-type registration.

### CI metadata correction (per GPT Review 4859244173)

Report 5 mislabeled the third-remediation code CI as #519; the authoritative mapping is
`1c5a544f` → CI **#520** (`30953228134`), `16f2acee` → CI **#521** (`30953497457`). Corrected here
as required; no separate remediation cycle was opened for this metadata-only fix.

### Validation

- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **8/8 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `a9a7fa2` — run **#522** (`30956265638`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP2)

- Domain delivered: AC-01 (aggregate), AC-02 (immutable revision), AC-03 (manifest digest),
  AC-04 (approval), AC-05 (purpose-specific approval), AC-06 (re-approval/expiry), AC-07
  (ordered append-only attempts), AC-08 (no auto retry), AC-09 (verification), AC-10 (no
  HTTP-success-as-verified), AC-12 (cancel/rollback/compensation separation), AC-17 (restricted
  shell), AC-18 (command ledger), AC-19 (idempotency), AC-20 (credential/budget server-owned).
- Contract layer also covered: AC-13, AC-14, AC-15 (server authority).
- Not yet run (WP3/WP4/WP5/WP6): AC-11, AC-16, AC-21, AC-22 + DB parity, routes, browser
  workspace, E2E/security/performance evidence.

PR #66 remains OPEN / DRAFT. WP3 Migration 028, Product API/UI, real Connector, Ready and Merge
remain **NOT_AUTHORIZED** pending re-review of this report.

## 13. WP2 remediation — GPT comprehensive review → resolved (report 7, 2026-08-05)

GPT review (Review ID 4859528704) returned **BLOCKED / REMEDIATION REQUIRED** for WP2. All
items are handled in one remediation cycle (two commits):

- Commit `360fe1db1d86db9a0e65e168638b8793463a412a` (read/write capability separation,
  credential/budget store authority).
- Commit `77e595e1d1d33881c3e866621d8631380daeea9d` (comprehensive WP2 remediation).

### Remediation mapping (GPT items → delivered)

1. **Read scope never grants write capabilities** — `externalActionCapabilitiesForScope` now
   grants only reads + `RESOLVE_OUTCOME` to read scopes; `VALIDATE_CANDIDATE`/`PREPARE_MANIFEST`
   require govern, `APPROVE` requires approve, `PREFLIGHT`/`EXECUTE`/`RETRY`/`VERIFY` require
   execute, `CANCEL`/`ROLLBACK`/`PREPARE_COMPENSATING_ACTION`/`READ_CREDENTIAL`/`READ_BUDGET`
   require govern. Negative test added.
2. **Credential/Budget store authority** — `credentialAvailable`/`budgetAvailable` now read the
   credential/budget repositories (async) instead of a test cache; unavailable/unreadable fails
   closed; a revoked/rotation-required credential is unusable; budget exhaustion fails closed;
   budget updates target the actual `scope.activeProjectId`. `setServerOwnedState` removed;
   tests seed the stores.
3. **Idempotent replay** — every governed command now replays an already-COMPLETED command
   through `reconstructReplay` (rebuilds the strict command result from the ledger produced
   resources) instead of returning `OUTCOME_INDETERMINATE`. Negative: digest/identity mismatch
   still fails closed.
4. **Approval · Preflight · Retry revalidation** — `assertApprovalMatchesExecutionContext`
   enforces exact manifest ID/revision/digest, target ID/revision/digest, external revision and
   project/access/policy context on preflight, execute and retry (AC-05/AC-06/AC-15). A new
   manifest revision blocks preflight/execute until re-approval (tested). Domain retry
   revalidates ACTIVE approval, credential, budget, external revision and deducts the budget.
5. **Append-only, recoverable attempts** — execute inserts the attempt exactly once in its
   terminal state (the PENDING attempt is used for the engine call but never double-inserted);
   execution is also written once. Domain resources always survive for OUTCOME_UNKNOWN recovery.
6. **Access-restricted Detail** — when access/policy changed, `GetDetail` returns only the
   restricted shell (no manifest/risk/approval/preflight/execution/attempts/verification/result/
   rollback/compensation/credential/budget). All individual reads now fail closed on access or
   policy changes (AC-17).
7. **Real digests** — manifest `targetDigest` is computed from the exact target identity,
   `payloadDigest` pins the actual execution payload, the dead parameter-digest tautology was
   removed, and a stable deterministic evidence fallback is used (never two different random IDs
   between manifest and its digest). Queue risk level now reads the stored risk decision.
8. **Verification evidence** — only a `SUCCEEDED` execution can be verified; the requested
   attempt must belong to the execution; an `APPLIED` verification without an observed target
   digest is rejected (no fabrication); the Result `externalId` is derived from the connector
   provider ref, never fabricated (AC-09/AC-20).
9. **Rollback · Compensation lifecycle** — Rollback is now a governed state reversal with its own
   manifest, EXTERNAL_ACTION approval, and a rollback execution through the engine port (never
   immediate; ROLLED_BACK only after the rollback execution succeeds). Compensating Action now
   stores a real candidate and its own risk decision (never reuses the source decision), so the
   new governed External Action can proceed through manifest/approval/execute.
10. **Audit wiring** — `appendAudit` is async and awaited at the frozen transition categories
    (`ACTION_EXECUTED`/`ACTION_OUTCOME_UNKNOWN`/`ACTION_VERIFIED`/
    `ACTION_VERIFICATION_FAILED`); sequences are append-only and monotonic.

### Changed files (this remediation)

- `modules/frontend-external-action/src/product-api.ts` — all items above.
- `tests/integration/frontend-external-action-domain.test.ts` — expanded to **13 tests**:
  read-scope negative, budget fail-closed, idempotent replay, approval re-binding rejection,
  restricted Detail shell, append-only audit, full lifecycle, attempt ordering + retry, no-approval
  rejection, Cancel ≠ Rollback, OUTCOME resolution, VERIFICATION resource, command types.

### AC evidence correction (per Review 4859528704)

Report 6 mislabeled the frozen AC meanings: AC-18 is "no direct execution from Home/Command
Palette", AC-19 is "Workspace accessibility", AC-20 is "no Connector-success/Cancel/auto-retry
negative evidence" — these are WP5/UI/negative-evidence concerns, **not** proven by WP2. Corrected
here: WP2 proves **AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-12,
AC-13, AC-14, AC-15, AC-17** (server-authoritative domain lifecycle, exact re-approval, ordered
append-only attempts, no auto-retry, verification-not-HTTP-success, credential/budget
server-owned, restricted shell). AC-11 (rollback as separate governed action) is partially
delivered (rollback manifest/approval/execution lifecycle); AC-16/AC-21/AC-22 + AC-18/AC-19/AC-20
evidence remain for WP3–WP6.

### Validation

- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **13/13 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this remediation head `77e595e` — run **#525** (`30959155254`): Quality,
  Frontend, Required Gates **SUCCESS**. (The interim capability fix `360fe1d` ran CI #524.)

PR #66 remains OPEN / DRAFT. WP3 Migration 028 remains **NOT_AUTHORIZED_TO_START** pending
re-review of this report.

## 14. WP2 second remediation — GPT focused review → resolved (report 8, 2026-08-05)

GPT review (Review ID 4859748120) returned **BLOCKED / SECOND REMEDIATION REQUIRED** for WP2
with six focused items (explicit instruction: the next changes are limited to those six items
and their negative tests). All are implemented in ONE remediation cycle:

Commit `6349e5ff1fa335e744e8118eed758afdbefebdfd`.

### Second remediation mapping (GPT items → delivered)

1. **Connector exception must not lose the attempt** — `runConnectorCommand` (new two-phase
   helper for all connector-touching commands) persists the started IN_PROGRESS attempt +
   execution and COMPLETEs the ledger command inside transaction 1; the connector runs OUTSIDE
   the DB transaction; the terminal state is committed in transaction 2. A connector throw is
   mapped to `OUTCOME_UNKNOWN` and the attempt survives as a persisted, recoverable resource —
   the ledger is never the only surviving record. `executeExternalAction`,
   `retryExecutionAttempt` and `rollbackExternalAction` all run through it. Negative test: fake
   connector throws → execute returns OUTCOME_UNKNOWN, attempt/execution/aggregate persisted as
   OUTCOME_UNKNOWN.
2. **Retry runs a new target-state preflight** — retry now calls `engine.preflight` (fresh
   target-state + external-revision revalidation) before re-calling `engine.execute`; the stored
   external revision comparison alone is not enough. `ALREADY_APPLIED` and `DENIED` outcomes
   block the retry. (Execute already asserts preflight ownership — `actionId`,
   `resourceProjectId`, `effectiveProjectId` — so a preflight cannot be reused across actions;
   `ALREADY_APPLIED` from preflight is preserved as a Product result and blocks execution.)
3. **Risk decision reuse bound to candidate semantics** — an existing risk decision is reused
   only when the existing candidate digest equals the new command semantic digest (which covers
   operation/target/parameter/evidence/compensation). A changed meaning creates a new candidate
   with `candidateRevision = (existing?.candidateRevision ?? 0) + 1` and a NEW risk decision;
   the store returns the latest candidate revision. Negative test: unchanged semantics reuse the
   same risk decision; changed parameter digest ⇒ candidate revision 3 + new risk decision.
4. **Verification pinned to the actual SUCCEEDED attempt** — verify now requires the execution
   to be SUCCEEDED and pins the latest attempt that matches `execution.latestAttemptRef` AND is
   SUCCEEDED AND carries a provider ref. An explicit `attemptId` must be that exact latest
   SUCCEEDED attempt (earlier/failed attempts are rejected). The Result `externalId` is derived
   from the provider ref of the pinned attempt ONLY — the executionId fallback is removed.
   Negative test: verifying the first OUTCOME_UNKNOWN attempt after a SUCCEEDED retry is
   rejected; omitting `attemptId` pins the latest SUCCEEDED attempt.
5. **Rollback as a separate governance lifecycle** — rollback creates its OWN risk decision
   (rollback semantics, never a reuse of the forward decision), its own manifest and
   EXTERNAL_ACTION approval, then runs its OWN `engine.preflight` (rollback semantics) before the
   connector executes the reversal through the two-phase helper. Connector success alone never
   confirms the reversal: `ROLLED_BACK` is reached only when the rollback execution is SUCCEEDED.
   Negative/lifecycle test: full lifecycle to VERIFIED then rollback → ROLLED_BACK (aggregate and
   rollback resource).
6. **Audit store-based monotonic sequence + wiring** — `nextAuditSequence` now reads the
   append-only authority (`repositories.audit.nextSequence`), so sequences stay strictly
   monotonic past 50 events (the previous list-with-cap computation could collide). Audit events
   are now written at ACTION_RISK_DECIDED + ACTION_CANDIDATE_VALIDATED (validate),
   ACTION_APPROVED (approve), ACTION_PREFLIGHT_PASSED / ACTION_PREFLIGHT_FAILED (preflight),
   ACTION_EXECUTED / ACTION_OUTCOME_UNKNOWN (execute and retry), ACTION_VERIFIED /
   ACTION_VERIFICATION_FAILED (verify). Cancel, rollback and compensation have NO frozen
   12-category audit event (the frozen Stage 11 category set has no such category); their
   transitions are recorded through the Command Ledger only. Negative test: 30 changed-semantics
   validations produce 60 events whose sequences are strictly monotonic, unique and continue
   past 50 (page 2 begins at sequence 51).

### Changed files (this second remediation)

- `modules/frontend-external-action/src/product-api.ts` — `runConnectorCommand` two-phase
  helper; execute/retry/rollback converted; retry + rollback preflight; candidate revision +
  semantic risk-decision reuse; verify pinned to latest SUCCEEDED attempt (providerRef-only
  externalId); audit wiring + store-based `nextAuditSequence`.
- `modules/frontend-external-action/src/external-action-store-port.ts` — audit port gains
  `nextSequence(actionId)`.
- `adapters/frontend-external-action-in-memory/src/index.ts` — audit `nextSequence` =
  max(sequence)+1 across all events; approvals `findActiveByAction` returns latest by
  `issuedAt` DESC; candidates `findByActionId` returns latest by `candidateRevision` DESC; fake
  connector gains `executeThrows` and `retryStatus` behaviors.
- `tests/integration/frontend-external-action-domain.test.ts` — expanded to **21 tests**:
  8 new negative/lifecycle tests (connector-throw preservation, re-approval recovery, cross-action
  preflight rejection, ALREADY_APPLIED blocked execution, candidate semantics change → new risk
  decision, verify pinned to latest SUCCEEDED attempt, rollback with own preflight, audit
  monotonic > 50).

### Validation

- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **21/21 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `6349e5f` — run **#527** (`30961275660`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP2 after second remediation)

WP2 now proves **AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-12,
AC-13, AC-14, AC-15, AC-17** (server-authoritative domain lifecycle, exact re-approval, ordered
append-only attempts, no auto-retry, verification-not-HTTP-success, credential/budget
server-owned, restricted shell) plus the strengthened **AC-08** (fresh target-state preflight on
retry), **AC-09/AC-20** (verification pinned to the actual SUCCEEDED attempt, Result identity
from the provider ref only). **AC-11** (rollback as a separate governed action with its own risk
decision + preflight) is now substantially delivered; full reversibility confirmation remains
partially dependent on WP6 verification evidence. AC-16/AC-21/AC-22 + AC-18/AC-19/AC-20
(negative-evidence) remain for WP3–WP6.

PR #66 remains OPEN / DRAFT. WP3 Migration 028 remains **NOT_AUTHORIZED_TO_START** pending
re-review of this report.

## 15. WP2 final domain remediation — GPT focused review → resolved (report 9, 2026-08-05)

GPT review (Review ID 4859910949) returned **BLOCKED / FINAL DOMAIN REMEDIATION REQUIRED** for
WP2 with five focused items. WP2 status: `SECOND_REMEDIATION_CANDIDATE / NOT_APPROVED`. All five
items are implemented in ONE remediation cycle:

Commit `953a229dc20872f899881326eff647d351d75da6`.

### Final domain remediation mapping (GPT items → delivered)

1. **The ledger must not be COMPLETED before the connector call** — `runConnectorCommand` no
   longer completes the ledger inside Phase 1. The started attempt/execution are persisted and
   the ledger command stays ACCEPTED; the connector work runs OUTSIDE the DB transaction; the
   terminal domain state and the ledger COMPLETED transition are committed in ONE transaction
   (Phase 3). A replay of an in-flight (ACCEPTED) command therefore fails closed with
   `OUTCOME_INDETERMINATE` instead of reconstructing a fabricated COMPLETED result from an
   IN_PROGRESS resource. Defense-in-depth: `buildResolvedResult` now rejects IN_PROGRESS
   execution/attempt reconstructions. Negative test: an accepted-but-uncompleted execute command
   re-sent through the coordinator returns OUTCOME_INDETERMINATE.
2. **Retry preflight outside the DB transaction, durable resource first** — retry persists the
   started IN_PROGRESS attempt, the IN_PROGRESS execution, the EXECUTING aggregate AND an initial
   DENIED preflight record inside Phase 1; then `engine.preflight` + `engine.execute` run outside
   the DB transaction. A READY preflight is stored as READY only when BOTH revalidation booleans
   are actually set (otherwise treated as DENIED). A denied/blocked preflight marks the started
   attempt/execution/aggregate FAILED (resource never lost) and rejects the ledger command.
   Negative test: denied retry preflight → attempt 2 survives as FAILED, aggregate FAILED.
   (Rollback no longer performs any engine call inside the rollback command — see item 4 — so
   the rollback preflight-inside-transaction defect is removed by design.)
3. **Risk decision reuse must include the policy context** — an existing risk decision is reused
   only when the candidate semantic digest is equal AND `scope.policyContextRevision` equals the
   aggregate's stored policy context revision. A changed policy context with the same candidate
   meaning creates a NEW numbered candidate revision and a NEW risk decision. Negative test:
   same digest under a changed policy context ⇒ new risk decision, candidate revision 2.
4. **Rollback is a separate, user-approved lifecycle (never auto-executed)** — `rollbackExternalAction`
   is now PREPARE-ONLY: it creates the rollback manifest, its OWN risk decision (bound to the
   aggregate authority via `aggregate.riskDecisionRef`), a `RollbackV1` resource in PREPARED and
   moves the aggregate to ROLLBACK_AVAILABLE with `manifestRef` = rollback manifest. It never
   auto-issues approval, never auto-preflights and never auto-executes. The user then explicitly:
   approves the rollback manifest (`approveExternalAction`, rollback PREPARED → APPROVED),
   preflights (rollback semantics flagged to the engine), executes (rollback resource → EXECUTING;
   engine receives `rollback: true`), and verifies (an APPLIED verification is what transitions the
   aggregate and rollback resource to ROLLED_BACK with `verificationRef`). Connector SUCCEEDED
   alone never confirms the reversal. Lifecycle test: prepare → approve → preflight → execute →
   verify → aggregate + rollback ROLLED_BACK.
5. **Verification external call pinned to the actual attempt** — `engine.verify` now always
   receives the pinned `latestAttempt.attemptId` (never undefined and never an arbitrary attempt),
   so the external target-state check and the stored Verification reference the same SUCCEEDED
   attempt. Rollback verifications are flagged to the engine as rollback semantics.

### Changed files (this final domain remediation)

- `modules/frontend-external-action/src/product-api.ts` — `runConnectorCommand` three-phase
  restructure (ledger completed atomically with the terminal state); retry preflight moved
  outside the transaction with durable resource first + revalidation-boolean gate + `finalizeDenied`;
  risk decision reuse bound to policy context; rollback reworked to PREPARE-ONLY with the full
  separate lifecycle; execute/verify propagate `rollback` context to the engine; verification
  passes the pinned attempt to `engine.verify`; `buildResolvedResult` IN_PROGRESS guards.
- `modules/frontend-external-action/src/external-action-engine-port.ts` — preflight/execute/verify
  requests carry an optional `rollback` semantic flag (rollback never presented as the forward
  operation).
- `adapters/frontend-external-action-in-memory/src/index.ts` — fake connector: `retryPreflightStatus`
  (preflight call counter) for retry-specific preflight behavior.
- `tests/integration/frontend-external-action-domain.test.ts` — expanded to **24 tests**: 4 new
  negative/lifecycle tests (in-flight replay OUTCOME_INDETERMINATE, retry preflight denied →
  FAILED attempt preserved, policy-context change → new risk decision, rollback full separate
  lifecycle to ROLLED_BACK).

### Validation

- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **24/24 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `953a229` — run **#529** (`30963418809`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP2 after final domain remediation)

WP2 now proves **AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-12,
AC-13, AC-14, AC-15, AC-17** plus the strengthened **AC-08** (fresh target-state preflight on
retry, outside the transaction, with revalidation-boolean gating), **AC-09/AC-20** (verification
pinned to the actual SUCCEEDED attempt — the engine call included — Result identity from the
provider ref only), **AC-11** (rollback is now a separate governed reversal prepared by its own
command and executed only through explicit approval → preflight → execute → an APPLIED
verification; connector success alone never confirms ROLLED_BACK), and **AC-16** (in-flight
connector commands are never misjudged as completed; resolution goes through the original command
identity). AC-18/AC-19 (UI/workspace) and AC-21/AC-22 (DB parity / exact-head gates at WP3+)
remain for WP3–WP6.

PR #66 remains OPEN / DRAFT. WP3 Migration 028 remains **NOT_AUTHORIZED_TO_START** pending
re-review of this report.
