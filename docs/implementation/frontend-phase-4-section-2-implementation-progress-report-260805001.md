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
The first remediation (9 items) was acknowledged as mostly resolved; 5 narrow items remained.
All are implemented in this commit:

Commit (this report head) — push after report 3 head `49299da0f`.

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
- Automatic CI on this head is the remote authority (recorded after the run).

### AC coverage (WP1 after second remediation)

- Contract layer delivered: AC-01, AC-02, AC-03, AC-04, AC-05, **AC-07** (attempt list
  invariants), AC-09, AC-13, AC-14, **AC-17** (restricted shell), plus the frozen individual
  Read Operations (§9 of the Contract Snapshot).
- Not yet run (implementation pending in WP2/WP4+): AC-06, AC-08, AC-10, AC-11, AC-12, AC-15,
  AC-16, AC-18, AC-19, AC-20, AC-21, AC-22.

PR #66 remains OPEN / DRAFT. WP2 remains **NOT_AUTHORIZED** pending re-review of this report.
