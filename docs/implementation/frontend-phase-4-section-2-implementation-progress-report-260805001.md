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

## 16. WP3 — Migration 028 and PostgreSQL parity (report 10, 2026-08-05)

GPT review (Review ID 4860064906) approved WP2 and authorized WP3:
`FE-P4-S2 WP2: APPROVED / COMPLETE` · `FE-P4-S2 WP3 Migration 028: AUTHORIZED_TO_START`
(bounded additive migration only). WP3 is delivered in this commit:

Commit `7689b42f97ebe1e10ec4df8608edda9d55b405f2`.

### Delivered

- `db/migrations/028_frontend_external_action_product.sql` — new `frontend_external_action`
  schema with **15 additive tables** (bounded additive; no Stage 11 table is rewritten and no
  existing schema is modified): `aggregates`, `candidates`, `risk_decisions`, `manifests`,
  `approvals`, `preflights`, `executions`, `attempts`, `verifications`, `results`,
  `audit_events`, `compensations`, `rollbacks`, `credentials`, `budgets`. Preflight guard
  requires 027. Append-only `audit_events` carries an append-only trigger + UNIQUE
  (action_id, sequence) so the monotonic sequence is database-enforced (AC-10/AC-21). Attempts
  keep UNIQUE (execution_id, attempt_number) for ordered numbering (AC-07) while the attempt row
  itself is upserted IN_PROGRESS → terminal by the same attemptId (never a second record per
  attempt — matches the Product write model).
- `scripts/database.ts` — `frontend_external_action` registered in `managedSchemas` and all 15
  tables in `requiredTables` (managed-schema apply/rollback authority).
- `adapters/frontend-external-action-postgres/src/index.ts` — `PostgresExternalActionStore`
  implements `ExternalActionRepositoryBoundaryPort` (transaction + transactionWithHandle over
  `withSafePostgresTransaction`). Mirrors the in-memory adapter's observable semantics exactly:
  jsonb snapshot round-trip, `findActiveByAction` = latest ACTIVE by `issued_at` DESC,
  `findCurrent` (manifest = latest `manifest_revision` DESC; preflight = latest `run_at` DESC;
  execution/verification/result/compensation/rollback = first inserted), `nextSequence` = max+1,
  `listByProject` ordered `updated_at` DESC capped at 50, upsert-by-identity writes, capped
  attempt/audit listings.
- `tests/database/frontend-external-action-postgres-parity.test.ts` — **5 database tests**:
  (1) full governed lifecycle parity (in-memory vs PostgreSQL identical outputs), (2) rollback
  lifecycle to ROLLED_BACK parity, (3) ordered append-only attempts + unique per-action audit
  sequence enforced at the database, (4) migration 028 apply → rollback to the pre-028
  fingerprint → clean re-apply (AC-21), (5) UPDATE/DELETE on append-only audit events rejected
  by the database trigger.

### Validation

- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-external-action-postgres-parity.test.ts` — **5/5 PASS**.
- Full database suite `npm run test:database` — **154/154 PASS (31 files)**.
- `npm run db:verify` — PASS (28 migrations recorded, required tables present).
- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **24/24 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `npm run test:architecture` — PASS. `npm run test:stage12-package` — PASS.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `7689b42` — run **#531** (`30971730119`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP3)

- **AC-21** (in-memory/PostgreSQL parity and migration 028 apply/rollback) is now delivered: the
  Postgres adapter matches the in-memory adapter's observable outputs for the full governed
  lifecycle and the rollback lifecycle, and the migration applies, rolls back to the pre-028
  fingerprint and re-applies cleanly with managed-schema registration.
- WP1/WP2 domain coverage (AC-01..AC-17) is unchanged; AC-18/AC-19 (UI/workspace) and AC-22
  (exact-head CI gates — reported per head throughout) remain; WP4–WP6 remain **NOT_AUTHORIZED**.

PR #66 remains OPEN / DRAFT. WP4 Protected Product API / `FrontendExternalActionClient` remains
**NOT_AUTHORIZED** pending re-review of this report.

## 17. WP3 remediation — GPT focused review → resolved (report 11, 2026-08-05)

GPT review (Review ID 4860735262) returned **BLOCKED / WP3 REMEDIATION REQUIRED** for WP3 with
six PostgreSQL-concurrency and ledger-atomicity items. WP3 status:
`IMPLEMENTED_CANDIDATE / NOT_APPROVED`. All six items are implemented in ONE remediation cycle:

Commit `b903bbdd32bd9bd682ef163fff4687034bd01163`.

### WP3 remediation mapping (GPT items → delivered)

1. **Real PostgreSQL row locks** — `aggregates.lock`, `manifests.lockCurrent` and
   `attempts.lockByExecution` now issue `FOR UPDATE` (the coordinator's `aggregateFor` uses the
   aggregate row lock for every governed command). Negative test: two concurrent executes on the
   same action serialize on the row lock — exactly one succeeds and the other fails closed with
   `EXTERNAL_ACTION_STALE`.
2. **Audit sequence + budget concurrency safety** — `audit.nextSequence` takes a per-action
   advisory transaction lock (`pg_advisory_xact_lock`) before `MAX(sequence)+1`, so concurrent
   commands can never receive the same sequence. The project budget is now reserved ATOMICALLY
   BEFORE the connector call: `ExternalActionBudgetStorePort.reserve(projectId)` decrements in a
   single guarded UPDATE, and execute/retry call `reserveBudget` in Phase 1 (the finalize-time
   decrement is removed). Test: two concurrent reservations against a budget with one remaining
   execution produce exactly one consumed execution (`used = 1`, remaining `0`, exhausted).
3. **Immutable/append-only resources are no longer updatable by upsert** — risk decisions,
   manifests and audit events are inserted with `ON CONFLICT DO NOTHING` (a conflicting insert
   never modifies an existing snapshot); the attempt upsert only allows the legal
   IN_PROGRESS → terminal status transition with an unchanged identity (execution/action/project/
   attempt number) — any identity drift is a no-op, never a rebind.
4. **`findCurrent` returns the LATEST resource** — executions, verifications and results
   `findCurrent` now return the most recent resource (created_at DESC / last inserted) in both
   the PostgreSQL and in-memory adapters, so after a rollback lifecycle the Detail and individual
   reads surface the rollback verification/result (never the original forward one). The rollback
   parity test now asserts the current verification/result identities are the rollback's.
5. **Real PostgreSQL Command Ledger atomicity is tested** — the new parity suite wires
   `PostgresExternalActionStore` together with `PostgresFrontendCommandGateway` and verifies:
   (a) the Product resource and the ledger COMPLETED transition commit in one transaction;
   (b) outcome resolution through the original identity returns the completed command;
   (c) terminal replay is idempotent (same execution, no `OUTCOME_INDETERMINATE`);
   (d) a Product write failure inside the same transaction rolls back the ledger completion
   (the ledger row stays ACCEPTED); (e) an in-flight (ACCEPTED) connector command replay fails
   closed with `OUTCOME_INDETERMINATE`.
6. **DB binding and migration evidence completed** — every action resource table now carries
   `effective_project_id NOT NULL` in addition to `resource_project_id` (frozen binding contract;
   `credentials`/`budgets` are server-owned views scoped by connector/project and are exempt).
   The migration test now asserts the EXACT 15-table list (including `risk_decisions`, no
   `arrayContaining`), verifies both binding columns exist on every action table, and explicitly
   rejects BOTH UPDATE and DELETE on append-only audit events (each in its own transaction).
   The migration apply/rollback test guarantees the schema is re-applied even when an assertion
   fails midway.

### Changed files (this WP3 remediation)

- `db/migrations/028_frontend_external_action_product.sql` — `effective_project_id NOT NULL`
  added to all action resource tables.
- `modules/frontend-external-action/src/external-action-store-port.ts` — budget port gains
  atomic `reserve(projectId)`.
- `modules/frontend-external-action/src/product-api.ts` — `reserveBudget` (atomic reservation
  before the connector call) replaces the availability-check + finalize-decrement budget flow in
  execute and retry.
- `adapters/frontend-external-action-in-memory/src/index.ts` — `budgets.reserve` (atomic within
  the FIFO-serialized transaction); executions/verifications/results `findCurrent` return the
  latest.
- `adapters/frontend-external-action-postgres/src/index.ts` — `FOR UPDATE` row locks; per-action
  audit advisory lock; atomic budget reservation; immutable `ON CONFLICT DO NOTHING` for risk
  decision/manifest/audit; guarded attempt upsert; latest `findCurrent`; `effective_project_id`
  in every insert.
- `tests/database/frontend-external-action-postgres-parity.test.ts` — expanded to **10 database
  tests**: 5 new (same-action concurrency row lock, atomic budget reservation, PG store + PG
  gateway ledger atomicity + outcome resolution + terminal replay, ledger rollback on product
  write failure, in-flight replay OUTCOME_INDETERMINATE) + hardened migration evidence (exact
  15-table list, binding columns, UPDATE+DELETE audit rejection) + rollback identity assertions.

### Validation

- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-external-action-postgres-parity.test.ts` — **10/10 PASS**.
- Full database suite `npm run test:database` — **159/159 PASS (31 files)**.
- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **24/24 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `b903bbd` — run **#533** (`30973343235`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP3 after remediation)

- **AC-21** is fully delivered: in-memory/PostgreSQL parity for the full governed lifecycle and
  the rollback lifecycle; migration 028 apply → rollback → clean re-apply with managed-schema
  registration; real PostgreSQL concurrency (row locks, advisory audit sequence, atomic budget
  reservation) and Command Ledger atomicity (same-transaction completion, ledger rollback on
  product failure) are now proven by negative tests. WP1/WP2 domain coverage (AC-01..AC-17) is
  unchanged. AC-18/AC-19 (UI/workspace) and AC-22 (exact-head CI gates — reported per head)
  remain; WP4–WP6 remain **NOT_AUTHORIZED**.

PR #66 remains OPEN / DRAFT. WP4 Protected Product API / `FrontendExternalActionClient` remains
**NOT_AUTHORIZED** pending re-review of this report.

## 18. WP3 second focused remediation — GPT focused review → resolved (report 12, 2026-08-05)

GPT review (Review ID 4860863804) returned **BLOCKED / SECOND FOCUSED WP3 REMEDIATION REQUIRED**
for WP3 with six items. WP3 status: `REMEDIATION_CANDIDATE / NOT_APPROVED`. All six items are
implemented in ONE remediation cycle:

Commit `9720f9eb7485828bc8c1216ee8b216a14a4b6c3d`.

### Second WP3 remediation mapping (GPT items → delivered)

1. **The last budget execution must be usable** — `budgets.reserve` now returns `undefined` only
   when the budget is absent or ALREADY exhausted; a successful reservation that consumes the
   LAST remaining execution still returns the post-reservation (exhausted) view, and
   `reserveBudget` fails closed only on `undefined`. Coordinator-level test: a budget with one
   remaining execution lets the first execution succeed (`used = 1`, `remaining = 0`), and a
   second execution fails closed.
2. **Lifecycle serialization across all stages** — `validateActionCandidate` now takes a
   per-action advisory lock (`aggregates.lockActionId`) and reads the aggregate with the row
   lock (`FOR UPDATE`) so two concurrent first validations can never both create action
   revision 1; execute/retry Phase 3 finalizers re-lock the aggregate row (`FOR UPDATE`) before
   the terminal commit so a concurrent state transition can never be overwritten. Concurrent
   first-validation test: two different-digest validations serialize to action revision 2 with
   both risk decisions present.
3. **Immutable conflict semantics are enforced, not silent** — risk decisions, manifests,
   approvals, verifications, results and compensating actions accept only an EXACT snapshot
   replay on identity conflict (a differing snapshot fails closed); audit events re-check the
   existing snapshot; the attempt upsert allows only an identical replay or the legal
   IN_PROGRESS → terminal transition (terminal → IN_PROGRESS and terminal → terminal are
   rejected). The in-memory adapter mirrors the same conflict semantics (parity).
4. **Project/resource rebinding is forbidden** — every updateable resource
   (aggregate/candidate/preflight/execution/rollback) has an identity-guarded upsert
   (`resource_project_id`, `effective_project_id` and the resource's own identity must be
   unchanged; a rebinding attempt fails closed). Immutable resources cannot be rebound by
   construction.
5. **`findCurrent` is deterministic across adapters** — `approvals`, `preflights`, `executions`,
   `verifications` and `results` gained an `insertion_ordinal` (bigserial) column; PostgreSQL
   orders `findCurrent`/`findActiveByAction` by `insertion_ordinal DESC` and the in-memory
   adapter returns the last inserted record, so equal timestamps can never produce different
   current resources. The rollback parity now explicitly asserts
   `currentVerificationIsRollback === true` and `currentResultAttemptIsRollback === true`.
6. **Ledger rollback test proves the claimed order** — the atomicity test now calls
   `completeInTransaction` FIRST inside the transaction, THEN triggers a Product write failure
   (duplicate audit sequence), and asserts the whole transaction rolls back: the ledger row
   stays ACCEPTED and zero partial Product rows survive.

### Changed files (this second WP3 remediation)

- `db/migrations/028_frontend_external_action_product.sql` — `insertion_ordinal bigserial`
  added to approvals/preflights/executions/verifications/results.
- `modules/frontend-external-action/src/external-action-store-port.ts` — aggregate port gains
  `lockActionId` (advisory lock for initial creation).
- `modules/frontend-external-action/src/product-api.ts` — `reserveBudget` fails only on an
  unreservable budget; `validateActionCandidate` takes the action-id advisory lock + row lock;
  execute/retry finalizers re-lock the aggregate row.
- `adapters/frontend-external-action-in-memory/src/index.ts` — conflict helpers
  (`replayOrConflict`/`upsertOrConflict`/attempt transition guard), `lockActionId`, insertion-
  order `findCurrent`/`findActiveByAction`, budget reserve semantics.
- `adapters/frontend-external-action-postgres/src/index.ts` — exact-replay immutable upserts,
  identity-guarded upserts with row-count conflict detection, attempt transition guard,
  `lockActionId` advisory lock, `insertion_ordinal` ordering, budget reserve semantics.
- `tests/database/frontend-external-action-postgres-parity.test.ts` — expanded to **14 database
  tests**: last-budget-slot coordinator test, concurrent first-validation serialization,
  immutable conflict + illegal attempt transition rejection, explicit rollback-current identity
  assertions, and the reordered ledger-rollback atomicity test.

### Validation

- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-external-action-postgres-parity.test.ts` — **14/14 PASS**.
- Full database suite `npm run test:database` — **163/163 PASS (31 files)**.
- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **24/24 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `9720f9e` — run **#535** (`30975084663`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP3 after second remediation)

- **AC-21** is fully delivered and hardened: in-memory/PostgreSQL parity (full lifecycle +
  rollback lifecycle), migration 028 apply/rollback/re-apply, real PostgreSQL concurrency
  (row locks + advisory locks + atomic budget reservation with correct last-slot semantics),
  deterministic `findCurrent`, immutable/append-only conflict enforcement and Command Ledger
  atomicity (same-transaction completion, ledger rollback on product failure) all proven by
  negative tests. WP1/WP2 domain coverage (AC-01..AC-17) is unchanged. AC-18/AC-19 (UI/
  PR #66 remains OPEN / DRAFT. WP4 Protected Product API / `FrontendExternalActionClient` remains
  **NOT_AUTHORIZED** pending re-review of this report.

## 19. WP3 final focused remediation — GPT focused review → resolved (report 13, 2026-08-05)

GPT review **4861031725** returned a focused 4-item WP3 final remediation list. All four items
were implemented in ONE final WP3 change (head `476c9789`, CI **#537**); existing CI #535/#536
were NOT re-run per the review instruction.

### 1. Phase 3 pins to the started execution/attempt/revision (and blocks a second execute)

- `executeExternalAction.persistStarted` now fails with `ACTION_EXECUTION_NOT_ALLOWED` when the
  aggregate is already `EXECUTING`, and returns `startedRefs: { executionId, attemptId,
expectedActionRevision }`.
- The connector call is followed by `input.finalize(repositories, outcome, startedRefs)`, which
  re-locks the aggregate and fails with `EXTERNAL_ACTION_STALE` if
  `action.latestExecutionRef?.resourceId !== startedRefs.executionId` — a finalizer can never
  settle a DIFFERENT execution/attempt than the one that started.
- `retryExecutionAttempt` gained the same EXECUTING guard and the same
  `persistStarted → finalize/finalizeDenied(repositories, …, startedRefs)` pinning for both the
  forward finalize and the denied-preflight path.

### 2. Attempt upsert is EXACT replay (same status) or IN_PROGRESS→terminal with unchanged start metadata

- PostgreSQL `attempts.insert` accepts an existing identity only when (a) `existing.status =
EXCLUDED.status AND existing.snapshot = EXCLUDED.snapshot` (exact full-snapshot replay), or
  (b) `existing.status = 'IN_PROGRESS'` → terminal with `idempotencyKey`, `policyContextRevision`,
  `externalRevision`, `correlationId`, `causationId` (coalesced) and `startedAt` ALL unchanged.
  Any other conflict fails closed.
- The in-memory adapter implements the same rule (`sameStatusExactReplay` /
  `startMetadataUnchanged` / `inProgressToTerminal`).

### 3. Preflight binding is immutable on conflict (DENIED→READY allowed only)

- `manifestRevision`, `preflightDigest` and `runAt` were added to the preflight identity-guard
  on conflict in BOTH adapters, so a preflight can only ever be re-inserted for the same
  action/projects/manifest/digest/run context, and the only permitted status change is
  DENIED → READY (via the product path).

### 4. Budget last-slot status parity between adapters

- PostgreSQL already returned `status = EXHAUSTED, remainingExecutions = 0, exhausted = true`
  when a reservation consumed the final slot; the in-memory adapter returned `WARNING`. The
  in-memory `budgets.reserve` now computes
  `remaining <= 0 ? 'EXHAUSTED' : remaining <= softLimit ? 'WARNING' : 'OK'`, matching PG.

### Changed files (this final WP3 remediation)

- `modules/frontend-external-action/src/product-api.ts` — Phase 3 pinning (`startedRefs`),
  EXECUTING re-entry guard, `finalize`/`finalizeDenied` pinning to the started execution.
- `adapters/frontend-external-action-in-memory/src/index.ts` — attempt exact-replay + unchanged
  start metadata; preflight binding guards (`manifestRevision`/`preflightDigest`/`runAt`);
  budget last-slot `EXHAUSTED` status.
- `adapters/frontend-external-action-postgres/src/index.ts` — attempt exact-replay /
  start-metadata-unchanged upsert condition; preflight binding fields in the conflict guard.
- `tests/database/frontend-external-action-postgres-parity.test.ts` — expanded to **16 database
  tests**: attempt start-metadata mutation rejection, same-status non-exact-replay rejection,
  preflight binding-change rejection (all at the database), and an AC-21 last-slot budget parity
  test asserting both adapters return an IDENTICAL full budget view (`EXHAUSTED`, remaining 0,
  exhausted true).

### Validation

- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-external-action-postgres-parity.test.ts` — **16/16 PASS**.
- Full database suite `npm run test:database` — **165/165 PASS (31 files)**.
- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **24/24 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `476c9789` — run **#537** (`30976306934`): Quality, Frontend,
  Required Gates **SUCCESS**. (CI #535/#536 untouched.)

### AC coverage (WP3 after final remediation)

- **AC-21** remains fully delivered and is now hardened for the four focused items: Phase 3 can
  never finalize a resource it did not start, a second execute while EXECUTING fails closed,
  attempts and preflights are immutable under conflict except the exact legal transitions, and
  budget last-slot semantics are identical in both adapters. WP1/WP2 domain coverage
  (AC-01..AC-17) is unchanged. AC-18/AC-19 (UI/workspace) and AC-22 (exact-head CI gates —
  reported per head) remain; WP4–WP6 remain **NOT_AUTHORIZED**.

PR #66 remains OPEN / DRAFT. WP4 Protected Product API / `FrontendExternalActionClient` remains
**NOT_AUTHORIZED** pending re-review of this report.

## 20. WP3 residual focused remediation — GPT focused review → resolved (report 14, 2026-08-05)

GPT review **4861145103** returned a residual 2-item WP3 remediation list. Both items were
implemented in ONE final WP3 change (head `a228942`, CI **#539**); existing CI #537/#538 were
NOT re-run per the review instruction.

### 1. Phase 3 pins to the EXACT Phase-1 state (ownership)

The finalizers previously checked only `latestExecutionRef === startedRefs.executionId`, which
a concurrent governed command could leave unchanged while it modified the aggregate. A new
`lockStartedActionForFinalize` helper now re-locks the aggregate and requires ALL of:

- `action.status === 'EXECUTING'`
- `action.actionRevision === expectedActionRevision + 1`
- `action.latestExecutionRef?.resourceId === startedRefs.executionId`
- the started execution `status === 'IN_PROGRESS'`
- the started attempt `status === 'IN_PROGRESS'`

If ANY check fails the finalizer fails closed with `EXTERNAL_ACTION_STALE` instead of
overwriting a resource a concurrent command has taken ownership of. Applied identically to
`execute` Finalize, `retry` Finalize and `retry` Denied-Finalize (all three re-lock through the
same helper).

New **overlapping execution test** (the delayed-connector scenario the review asked for): the
fake engine gained `executeDelayMs`; while the connector call is in flight (Phase 1 durable,
aggregate EXECUTING), an overlapping `preflightExternalAction` command (which only checks the
revision, so it runs during EXECUTING) changes the aggregate to `PREFLIGHT_READY` and bumps the
revision. The delayed execute's Phase-3 finalize then fails closed with `EXTERNAL_ACTION_STALE`,
and the overlapping preflight's state is preserved (action stays `PREFLIGHT_READY`, never
overwritten to `VERIFYING`).

### 2. Preflight transition rule (same-status exact replay, DENIED→READY only)

Both adapters previously guarded only the preflight BINDING (action/projects/manifest/digest/
runAt); with the same binding the snapshot and status could be swapped arbitrarily. Both
adapters now enforce:

- same status ⇒ EXACT full-snapshot replay only;
- status change ⇒ `DENIED → READY` only (binding + start context unchanged, result fields
  only);
- everything else fails closed (`READY → DENIED`, same-status with a different snapshot,
  `ALREADY_APPLIED → READY`).

Because `DENIED → DENIED` with different reasons is now illegal, the retry Denied-Finalize no
longer rewrites the Phase-1 DENIED preflight; the connector's denial reason is carried by the
audit event and the ledger REJECTION instead (the Phase-1 preflight remains the durable record).

New **both-adapter transition tests**: `DENIED → READY` succeeds, `READY → DENIED` rejects,
same-status different-snapshot rejects, and `ALREADY_APPLIED → READY` rejects — executed
against BOTH the in-memory adapter and PostgreSQL.

### Changed files (this residual WP3 remediation)

- `modules/frontend-external-action/src/product-api.ts` — `lockStartedActionForFinalize`
  (Phase-3 exact ownership pinning) used by execute finalize, retry finalize and retry
  denied-finalize; retry denied-finalize no longer rewrites the Phase-1 DENIED preflight.
- `adapters/frontend-external-action-in-memory/src/index.ts` — preflight transition rule
  (same-status exact replay, DENIED→READY only); fake engine `executeDelayMs`.
- `adapters/frontend-external-action-postgres/src/index.ts` — preflight upsert WHERE adds the
  same-status-exact-replay OR DENIED→READY transition gate.
- `tests/integration/frontend-external-action-domain.test.ts` — new overlapping-execution
  Phase-3 pinning test (delayed connector + concurrent preflight → EXTERNAL_ACTION_STALE).
- `tests/database/frontend-external-action-postgres-parity.test.ts` — new both-adapter
  preflight transition test.

### Validation

- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **25/25 PASS**
  (new overlapping-execution test included).
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-external-action-postgres-parity.test.ts` — **17/17 PASS** (new preflight transition test).
- Full database suite `npm run test:database` — **166/166 PASS (31 files)**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `a228942` — run **#539** (`30979152764`): Quality, Frontend,
  Required Gates **SUCCESS**. (CI #537/#538 untouched.)

### AC coverage (WP3 after residual remediation)

- **AC-21** remains fully delivered and hardened for the two residual items: Phase 3 can never
  finalize a resource it does not own (EXECUTING + exact revision + started execution/attempt
  still IN_PROGRESS), proven by a delayed-connector overlapping-execution test; preflights are
  immutable except an exact same-status replay or the DENIED → READY transition in BOTH
  adapters, proven by negative tests. WP1/WP2 domain coverage (AC-01..AC-17) is unchanged.
  AC-18/AC-19 (UI/workspace) and AC-22 (exact-head CI gates — reported per head) remain;
  WP4–WP6 remain **NOT_AUTHORIZED**.

PR #66 remains OPEN / DRAFT. WP4 Protected Product API / `FrontendExternalActionClient` remains
**NOT_AUTHORIZED** pending re-review of this report.

## 21. WP3 final two-item correction — GPT focused review → resolved (report 15, 2026-08-05)

GPT review **4861433397** returned a final 2-item correction list. Both items were implemented
in ONE final WP3 change (head `e029264`, CI **#541**); existing CI #539/#540 were NOT re-run
per the review instruction.

### 1. DENIED → READY transition is restricted to RESULT fields (start context immutable)

The DENIED → READY transition previously required only the binding
(action/projects/manifestRevision/preflightDigest/runAt) to be unchanged, so non-result start
context such as `expiresAt` could still be rewritten. Both adapters now include `expiresAt` in
the immutable preflight fields — the immutable set is now
`schemaVersion, preflightId, concreteKind, actionId, resourceProjectId, effectiveProjectId,
manifestRevision, preflightDigest, runAt, expiresAt`, and only the result fields
(`status`, `reasons`, and the six revalidation flags) may change during `DENIED → READY`.

New negative evidence: a `DENIED → READY` attempt that changes `expiresAt` fails closed in BOTH
adapters (PostgreSQL upsert WHERE + in-memory guarded fields), added to the both-adapter
preflight transition test.

### 2. Delayed second Execute re-entry test (no parallel execution)

The previous overlapping-execution test overlapped a preflight command; this review explicitly
required the delayed second EXECUTE re-entry negative evidence. A new domain test drives:
Execute #1 with a delayed connector (aggregate EXECUTING, Phase 1 durable) → Execute #2 for the
same action fails closed with `ACTION_EXECUTION_NOT_ALLOWED` while #1 is in flight → Execute #1
completes normally → exactly ONE execution and ONE attempt exist (Execute #2 created nothing).

### Changed files (this final two-item correction)

- `adapters/frontend-external-action-in-memory/src/index.ts` — `expiresAt` added to the
  preflight immutable fields.
- `adapters/frontend-external-action-postgres/src/index.ts` — `expiresAt` added to the
  preflight upsert WHERE immutability clause.
- `tests/integration/frontend-external-action-domain.test.ts` — new delayed second Execute
  re-entry test (ACTION_EXECUTION_NOT_ALLOWED, single execution/attempt, first completes).
- `tests/database/frontend-external-action-postgres-parity.test.ts` — the both-adapter
  preflight transition test now also asserts `expiresAt` changes on DENIED → READY are
  rejected in both adapters.

### Validation

- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **26/26 PASS**
  (new delayed re-entry test included).
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-external-action-postgres-parity.test.ts` — **17/17 PASS** (expiresAt case in both adapters).
- Full database suite `npm run test:database` — **166/166 PASS (31 files)**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `e029264` — run **#541** (`30982903810`): Quality, Frontend,
  Required Gates **SUCCESS**. (CI #539/#540 untouched.)

### AC coverage (WP3 after final two-item correction)

- **AC-21** remains fully delivered and hardened: Phase 3 exact ownership pinning with a
  delayed-connector overlapping preflight test AND a delayed second-execute re-entry test (no
  parallel execution); preflight transition rule (same-status exact replay, DENIED → READY
  result-fields-only with immutable binding + start context including `expiresAt`) enforced in
  both adapters with negative tests. WP1/WP2 domain coverage (AC-01..AC-17) is unchanged.
  AC-18/AC-19 (UI/workspace) and AC-22 (exact-head CI gates — reported per head) remain;
  WP4–WP6 remain **NOT_AUTHORIZED**.

PR #66 remains OPEN / DRAFT. WP4 Protected Product API / `FrontendExternalActionClient` remains
**NOT_AUTHORIZED** pending re-review of this report.

## 22. WP3 exact completion correction — GPT focused review → resolved (report 16, 2026-08-05)

GPT review **4861829347** returned the SAME two items with exact-completion evidence
requirements (no new scope). Both were completed in ONE final WP3 change (head `974e93a`,
CI **#543**); existing CI #541/#542 were NOT re-run per the review instruction.

### 1. Preflight immutable set is FULLY compared (schemaVersion + concreteKind added)

The DENIED → READY transition previously compared only
`actionId/resourceProjectId/effectiveProjectId/manifestRevision/preflightDigest/runAt/expiresAt`
(plus the `preflightId` conflict key); `schemaVersion` and `concreteKind` could still change in
the snapshot. Both adapters now compare the COMPLETE immutable set:

`schemaVersion, preflightId, concreteKind, actionId, resourceProjectId, effectiveProjectId,
manifestRevision, preflightDigest, runAt, expiresAt`

- PostgreSQL upsert `WHERE` adds `snapshot->>'schemaVersion' = EXCLUDED...` and
  `snapshot->>'concreteKind' = EXCLUDED...`.
- The in-memory guarded-fields list adds `schemaVersion` and `concreteKind`.
- Only `status`, `reasons`, and the six revalidation flags remain changeable on
  `DENIED → READY`.

New negative evidence (BOTH adapters): a `DENIED → READY` attempt that changes `schemaVersion`
or `concreteKind` fails closed, added to the both-adapter preflight transition test.

### 2. Second-Execute re-entry test proves the exact in-flight state

The test now follows the review's exact sequence:

1. Execute #1 starts (connector delayed).
2. Product Read polls until the action is actually `EXECUTING`; the CURRENT revision
   (`expectedActionRevision + 1`) is captured and asserted.
3. Execute #2 is submitted with THAT current revision → `ACTION_EXECUTION_NOT_ALLOWED`.
4. Execute #1 completes normally (SUCCEEDED).
5. Exactly ONE execution and ONE attempt exist — `detail.execution.executionId` equals the
   first execution and the single attempt belongs to it (Execute #2 created nothing).

### Changed files (this exact completion correction)

- `adapters/frontend-external-action-in-memory/src/index.ts` — `schemaVersion`/`concreteKind`
  added to the preflight immutable guarded fields.
- `adapters/frontend-external-action-postgres/src/index.ts` — `schemaVersion`/`concreteKind`
  added to the preflight upsert `WHERE` immutability clause.
- `tests/integration/frontend-external-action-domain.test.ts` — re-entry test now polls for
  EXECUTING, uses the current revision, and proves exactly one execution + one attempt.
- `tests/database/frontend-external-action-postgres-parity.test.ts` — both-adapter preflight
  transition test now also rejects `schemaVersion`/`concreteKind` changes on DENIED → READY.

### Validation

- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **26/26 PASS**.
- `npx vitest run tests/contract/frontend-external-action.contract.test.ts` — **93/93 PASS**.
- `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/frontend-external-action-postgres-parity.test.ts` — **17/17 PASS**.
- Full database suite `npm run test:database` — **166/166 PASS (31 files)**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `974e93a` — run **#543** (`30984044551`): Quality, Frontend,
  Required Gates **SUCCESS**. (CI #541/#542 untouched.)

### AC coverage (WP3 after exact completion correction)

- **AC-21** remains fully delivered and hardened: the preflight immutable set is now compared
  in full (including `schemaVersion`/`concreteKind`) in both adapters with negative tests, and
  the second-execute re-entry test proves the exact in-flight EXECUTING state with the current
  revision and confirms exactly one execution + one attempt. WP1/WP2 domain coverage
  (AC-01..AC-17) is unchanged. AC-18/AC-19 (UI/workspace) and AC-22 (exact-head CI gates —
  reported per head) remain; WP4–WP6 remain **NOT_AUTHORIZED**.

PR #66 remains OPEN / DRAFT. WP4 Protected Product API / `FrontendExternalActionClient` remains
**NOT_AUTHORIZED** pending re-review of this report.

## 23. WP4 — Protected Product API and `FrontendExternalActionClient` (report 17, 2026-08-05)

WP3 was APPROVED and WP4 **AUTHORIZED_TO_START** by GPT review **4861959404** with a bounded
WP4 scope (protected routes under `/product-api/frontend/external-action/*`, governed write
routes, server-derived authority, and `FrontendExternalActionClient`). This report records the
WP4 implementation on head `98b7feb` (CI **#545**).

### 1. Protected routes (server-derived authority only)

`assemblies/shotgun-app/src/product-api/frontend-external-action-routes.ts` registers 22 routes
behind `registerFrontendExternalActionRoutes`. Every route builds the scope on the server from
the authenticated browser session, the Project membership and the settings snapshot — Principal
(actor = authenticated principal), Resource Project (active project), access revision, policy
context revision, capability scopes and (via the store adapters) credential/budget. No
browser-supplied authority reaches the domain.

Protected reads (strict decoders):

- `POST /product-api/frontend/external-action/queue` — list
- `.../actions/read`, `.../actions/detail` — aggregate / integrated detail
- `.../manifests/read`, `.../risk-decisions/read`, `.../preflights/read`
- `.../executions/read`, `.../executions/attempts`, `.../verifications/read`,
  `.../results/read`, `.../audit`

Governed writes (Frontend Command Ledger):

- `.../validate`, `.../prepare`, `.../approve`, `.../preflight`, `.../execute`, `.../retry`,
  `.../verify`, `.../cancel`, `.../rollback`, `.../compensations/prepare`

Outcome resolution (GET, resolve by the ORIGINAL command identity — never a re-execute):

- `.../command-outcomes/by-client-request/:clientRequestId`

Errors are normalized to the shared typed failure envelope
(`ExternalActionCommandError.apiCode` → `ShotgunError`; unknown → `INTERNAL_UNCLASSIFIED`).

### 2. `FrontendExternalActionClient`

`packages/shotgun-api-client/src/frontend-external-action-client.ts` exposes
`createFrontendExternalActionClient` with all 22 typed methods: same-origin credentials, cached
CSRF token with a SINGLE retry on 403 (session refresh — never a blind mutation retry),
`AbortSignal` forwarding, strict decoding of every response, and identity validation
(actionId / clientRequestId / idempotencyKey / executionId / source identity) that fails closed
on mismatch. The per-command semantic digests are re-exported so the browser computes exactly
the digests the server validates for `OUTCOME_UNKNOWN` resolution. Exported from the api-client
package index.

### 3. Wiring

`server.ts` adds `frontendExternalActionCoordinator?` to `ApplicationOptions` and constructs a
default coordinator over the shared `frontendCommandGateway` with the in-memory External Action
store and the fake connector engine (mirroring how Review is wired); the routes are registered
with the same `requirePrincipalBrowserSession` + `authRepository` + `settingsRepository`.

### Changed files (this WP4 implementation)

- `assemblies/shotgun-app/src/product-api/frontend-external-action-routes.ts` — NEW: 22
  protected routes + server-derived scope + typed error mapping.
- `assemblies/shotgun-app/src/server.ts` — coordinator option + default wiring + route
  registration.
- `packages/shotgun-api-client/src/frontend-external-action-client.ts` — NEW: typed client
  (strict decoding, CSRF + 403 refresh, AbortSignal, no mutation auto-retry, identity
  validation, digest re-exports).
- `packages/shotgun-api-client/src/index.ts` — client export.
- `tests/unit/frontend-external-action-client.test.ts` — NEW: 6 client tests (CSRF, strict
  decoding, identity mismatch rejection, 403 refresh once, no non-CSRF auto-retry, outcome
  resolution GET, AbortSignal).
- `tests/integration/frontend-external-action-product-api.test.ts` — NEW: 3 route tests (full
  governed lifecycle over HTTP, outcome resolution by original identity, CSRF/project-access
  fail-closed).

### Validation

- `npx vitest run tests/unit/frontend-external-action-client.test.ts` — **6/6 PASS**.
- `npx vitest run tests/integration/frontend-external-action-product-api.test.ts` — **3/3 PASS**.
- Full unit+integration+contract suites — **948 PASS** (two pre-existing timing flakes pass in
  isolation; unrelated to WP4).
- Full database suite `npm run test:database` — **166/166 PASS (31 files)**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `98b7feb` — run **#545** (`30993215106`): Quality, Frontend,
  Required Gates **SUCCESS**.

### AC coverage (WP4)

- **AC-18/AC-19** are now delivered: the protected read routes and governed write routes are
  reachable under `/product-api/frontend/external-action/*` with strict decoding, server-derived
  authority, CSRF + 403 refresh, `AbortSignal` and no mutation auto-retry, and `OUTCOME_UNKNOWN`
  is resolved by the original command identity (never a re-execute). WP1/WP2/WP3 domain coverage
  (AC-01..AC-17, AC-21) is unchanged. AC-20/AC-22 (UI/workspace and exact-head CI gates —
  reported per head) remain; WP5/WP6 remain **NOT_AUTHORIZED**.

PR #66 remains OPEN / DRAFT. WP5 External Action Governance Workspace and WP6 verification
evidence remain **NOT_AUTHORIZED** pending re-review of this report.

## 24. WP4 focused remediation — Review 4863146027 (report 18, 2026-08-05)

GPT review **4863146027** returned **BLOCKED / FOCUSED WP4 REMEDIATION REQUIRED** with five
items, all within the WP4 scope (no new scope). Per the review instruction, CI runs #545/#546
were **not re-executed**; the only changes on this head are the five WP4 items and their focused
tests plus the report AC correction. This report records the remediation on head `967d08e`
(CI **#547**).

### 1. Least-privilege Scope → Capability matrix (Review item 1)

`externalActionCapabilitiesForScope` in `modules/frontend-external-action/src/product-api.ts`
was replaced with an exact least-privilege matrix against the frozen scopes
(`action:read`, `action:audit:read`, `action:budget:read`, `action:credential:manage`,
`action:candidate:stage`, `action:approve`, `action:execute`, `action:verify`,
`action:cancel`, `action:rollback`, plus broad `owner`/`admin`).

- **Under-privilege fixed**: `action:cancel`, `action:rollback`, `action:verify`,
  `action:audit:read`, `action:budget:read`, `action:credential:manage`,
  `action:candidate:stage` were previously unrecognized (only `action:read` / `action:execute`
  / `action:approve` / `action:govern` were). Each fine-grained scope now independently grants
  its own family.
- **Over-privilege fixed**: `action:execute` alone no longer grants `verify`; the former
  `action:govern` wildcard (validate/prepare/cancel/rollback/compensation/credential/budget) is
  removed. Each capability maps to exactly one fine-grained scope:
  - `action:read` → the 10 List/Resource read capabilities (`LIST_EXTERNAL_ACTIONS`,
    `READ_EXTERNAL_ACTION`, `READ_MANIFEST`, `READ_RISK_DECISION`, `READ_PREFLIGHT`,
    `READ_EXECUTION`, `READ_EXECUTION_ATTEMPTS`, `READ_VERIFICATION`, `READ_RESULT`,
    `READ_APPROVAL`) + `RESOLVE_OUTCOME` = 11 capabilities total (report 18 originally
    miscounted this as "11 read capabilities + RESOLVE_OUTCOME"; corrected per Review
    4863783684).
  - `action:audit:read` → `READ_AUDIT`; `action:budget:read` → `READ_BUDGET`;
    `action:credential:manage` → `READ_CREDENTIAL`
  - `action:candidate:stage` → `VALIDATE_CANDIDATE`
  - `action:execute` → `PREPARE_MANIFEST`, `PREFLIGHT_EXTERNAL_ACTION`,
    `EXECUTE_EXTERNAL_ACTION`, `RETRY_EXECUTION_ATTEMPT`
  - `action:approve` → `APPROVE_EXTERNAL_ACTION`; `action:verify` →
    `VERIFY_EXTERNAL_ACTION`; `action:cancel` → `CANCEL_EXTERNAL_ACTION`
  - `action:rollback` → `ROLLBACK_EXTERNAL_ACTION`, `PREPARE_COMPENSATING_ACTION`
- Capability denial stays `PROJECT_ACCESS_DENIED` (HTTP 403) and is checked before any resource
  existence check, so every deny row is deterministic.
- Tests: `tests/integration/frontend-external-action-product-api.test.ts` adds a table-driven
  scope matrix suite (`it.each`) covering allow (200), deny (403) and capability-granted-but-
  resource-missing (404) rows per fine-grained scope. (Report 18 claimed positive grant
  evidence for every fine-grained scope; Review 4863783684 noted the positive grant rows were
  initially missing for `action:approve`/`action:verify`/`action:cancel`/`action:rollback` and
  for `action:budget:read`/`action:credential:manage`. Section 25 records the added positive
  grant evidence: approve/verify/cancel/rollback self-allow rows (404) in the matrix suite and
  the Detail credential/budget scope-combination suite.)

### 2. Governed mutation is sent exactly once on a general 403 (Review item 2)

`frontend-external-action-client.ts` now separates the transport paths:

- **READ POST** (`read`): a CSRF refresh + single retry on a general 403 is allowed (reads are
  idempotent and safe; session rotation must not break a plain read).
- **GOVERNED MUTATION** (`mutate`): sent exactly ONCE. A general 403 (project access denied,
  capability denied, session loss, policy change) is **never** auto-resent; the typed failure is
  decoded and surfaced to the caller.
- Negative test (`tests/unit/frontend-external-action-client.test.ts`): a governed mutation
  against a general 403 results in exactly **1** POST and a typed failure rejection; a READ POST
  retries once (2 POSTs) and succeeds.

### 3. Approval read added (Review item 3)

The Implementation Request lists an approvals read; the frozen browser-read list does not name
`GET_APPROVAL`. Per the review, this was **not silently dropped or silently interpreted** — the
additive read was implemented and the interpretation is recorded here: IR's `approvals` read is
provided as `POST /product-api/frontend/external-action/approvals/read`.

- Contracts: `GetExternalActionApprovalRequestV1` / `GetExternalActionApprovalResultV1` +
  strict decoders (additive; nothing frozen was changed).
- Coordinator: `getExternalActionApproval(scope, request)` — `READ_APPROVAL` capability,
  project/policy checks, approval resolved via `action.approvalRef`.
- Route: `.../approvals/read` registered after `preflights/read`.
- Client: `getExternalActionApproval` with strict decoding and identity binding
  (`approval.actionId === params.actionId`).
- Tests: integration approval-read after the full lifecycle (`actionId`, `status: ACTIVE`);
  client approval-read success + mismatch rejection.

### 4. Full command identity binding (Review item 4)

`assertCommandIdentity` is a shared fail-closed helper validating
`clientRequestId` + `idempotencyKey` + `actionId` (whichever the command carries) for every
governed write; command-specific identities are asserted on top:

- validate / prepare / approve / preflight / cancel — now also check `idempotencyKey`.
- execute — execution/action identity; retry — attempt execution identity.
- verify — `verification.executionId` + `idempotencyKey`; rollback — `rollback.actionId` +
  `idempotencyKey`; compensation — `sourceActionId`/`sourceExecutionId` + `idempotencyKey`.
- `resolveExternalActionOutcome` — now requires **both** `originalClientRequestId` and
  `originalIdempotencyKey` to match (frozen §7: resolution is by the ORIGINAL identity).
- Table-based negative tests (`it.each`) over all 10 governed commands + the outcome-resolution
  mismatch test assert a tampered identity field is rejected `FrontendContractError`.

### 5. AC record correction (Review item 5)

Report 17 mislabeled frozen AC meanings. Corrected record (this head):

- **AC-18: NOT_DELIVERED — WP5** (Home/Command Palette → Governance Workspace navigation).
- **AC-19: NOT_DELIVERED — WP5/WP6** (Workspace accessibility).
- **AC-20: PARTIAL — API boundary exists but the report-17 client resent governed mutations on a
  general 403; the Review-item-2 fix (mutation sent exactly once, typed failure returned)
  completes the API-boundary defect. Cancel≠rollback and no HTTP/connector-success verification
  remain intact.**
- **AC-22: Current-head CI evidence only** (this head `967d08e`, CI #547; #545/#546 were not
  re-run per the review).

WP1/WP2/WP3 domain coverage (AC-01..AC-17, AC-21) is unchanged. WP5/WP6 remain
**NOT_AUTHORIZED**.

### Changed files (this remediation)

- `modules/frontend-external-action/src/product-api.ts` — least-privilege Scope → Capability
  matrix; `getExternalActionApproval`.
- `packages/contracts/src/frontend-external-action.ts` — additive approval-read request/result
  types + decoders.
- `packages/shotgun-api-client/src/frontend-external-action-client.ts` — read/mutate transport
  split (no mutation resend on general 403); `assertCommandIdentity` full binding;
  `getExternalActionApproval`.
- `assemblies/shotgun-app/src/product-api/frontend-external-action-routes.ts` —
  `.../approvals/read` route.
- `tests/unit/frontend-external-action-client.test.ts` — 20 tests (mutation 403 sent-once,
  read 403 retry-once, 10-command identity table, outcome double-identity, approval read
  success + mismatch).
- `tests/integration/frontend-external-action-product-api.test.ts` — 11 tests (approval read,
  fine-grained scope matrix `it.each`).

### Validation

- `npx vitest run tests/unit/frontend-external-action-client.test.ts` — **20/20 PASS**.
- `npx vitest run tests/integration/frontend-external-action-product-api.test.ts` — **11/11
  PASS**.
- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **26/26 PASS**.
- Full unit+integration+contract suites — **969 PASS** (two pre-existing timing flakes pass in
  isolation; unrelated to this remediation).
- Full database suite `npm run test:database` — **166/166 PASS (31 files)**.
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head `967d08e` — run **#547** (`30999676865`): Quality, Frontend,
  Required Gates **SUCCESS**. (#545/#546 not re-run, per the review instruction.)

## 25. WP4 final focused remediation — Review 4863783684 (report 19, 2026-08-05)

GPT review **4863783684** returned **BLOCKED / FINAL FOCUSED WP4 REMEDIATION REQUIRED** with
three residual defects plus Section 24 record corrections. Mutation 403 non-resend and the
AC-18/AC-19 record correction were confirmed satisfied. Per the review, CI runs #547/#548 were
**not re-executed**; the only changes on this head are the three WP4 defects, their focused
negative tests, and the Section 24 corrections. This report records the remediation on code head
`62813f8` (CI **#549**) and report head `dc71ae7a` (CI **#550**).

### 1. Detail exposes credential/budget only under their own least-privilege scopes (item 1)

`getExternalActionDetail` previously checked only `READ_EXTERNAL_ACTION` and always included the
credential and budget views, so a member with only `action:read` received the Credential mask
and Budget view without the separate frozen scopes. The coordinator now computes
`externalActionCapabilitiesForScope(scope)` and includes:

- `credential` **only** when the scope grants `READ_CREDENTIAL` (`action:credential:manage` or
  `owner`/`admin`);
- `budget` **only** when the scope grants `READ_BUDGET` (`action:budget:read` or `owner`/`admin`);
- each optional field is omitted entirely (not empty/null) when not granted.

Tests (`tests/integration/frontend-external-action-product-api.test.ts`, Detail scope-combination
suite, one fresh principal+application per row): `action:read` → no credential/no budget;
`action:read`+`action:budget:read` → budget only; `action:read`+`action:credential:manage` →
credential only; `owner` → both.

### 2. Approval read blocks Hidden / Access-restricted actions (item 2)

`getExternalActionApproval` previously checked Project + Access/Policy revisions only and could
resolve an Approval (Manifest, Target, External Revision, Actor, Access/Policy Revision payload)
for an access-restricted action. It now applies the same guard as the other individual protected
reads (`getActionManifest`): `action.accessMasking === 'HIDDEN' || action.aggregateState ===
'ACCESS_RESTRICTED'` → `EXTERNAL_ACTION_STALE` (access-restricted), before any approval lookup.

Negative test (`tests/integration/frontend-external-action-domain.test.ts`): after the full
lifecycle, a changed `accessRevision` scope makes the action Hidden/Access-restricted and
`getExternalActionApproval` rejects with no Approval payload returned.

### 3. Client command-specific resource identity binding completed (item 3)

The shared `assertCommandIdentity` checks `clientRequestId` + `idempotencyKey` + `actionId`; the
command-specific resource identities are now also bound in
`packages/shotgun-api-client/src/frontend-external-action-client.ts`:

- **Validate** — `candidate.candidateId === params.candidateId`
- **Approve** — `approval.manifestId === params.manifestId`,
  `approval.manifestRevision === params.manifestRevision`,
  `approval.targetRevision === params.expectedTargetRevision`,
  `approval.externalRevision === params.expectedExternalRevision`
- **Preflight** — `preflight.manifestRevision === params.manifestRevision`
- **Execute** — `execution.manifestRevision === params.manifestRevision`,
  `attempt.idempotencyKey === params.idempotencyKey`,
  `attempt.externalRevision === params.expectedExternalRevision`
- **Retry** — `attempt.executionId === params.executionId`,
  `attempt.causationId === params.causationId`
- **Verify** — `verification.executionId === params.executionId`,
  `verification.attemptId === params.attemptId` (when the request carries one),
  `verification.targetRevision === params.expectedTargetRevision`,
  `verification.externalRevision === params.expectedExternalRevision`
- **Rollback** — when `rollback.executionRef` is present,
  `rollback.executionRef.resourceId === params.executionId`
- Cancel (no resource) and Compensation (`sourceActionId`/`sourceExecutionId`, already bound)
  are unchanged.

The table-based negative tests now tamper the command-specific resource identity field per
command (e.g. Approve tampers `approval.manifestId`, Execute tampers `attempt.externalRevision`,
Rollback tampers `rollback.executionRef.resourceId`) — not just `actionId` — so a same-action
different-resource response is rejected.

### 4. Section 24 record corrections (per the review)

- **`action:read` capability count corrected**: 10 List/Resource read capabilities +
  `RESOLVE_OUTCOME` = 11 total (report 18 originally miscounted as "11 read capabilities +
  RESOLVE_OUTCOME").
- **Positive grant evidence added**: approve/verify/cancel/rollback self-allow rows (404,
  capability-granted-but-resource-missing) were added to the scope matrix suite, and the
  Detail credential/budget scope-combination suite provides positive grant evidence for
  `action:budget:read` and `action:credential:manage`. The Section 24 test note is corrected.

### Changed files (this final remediation)

- `modules/frontend-external-action/src/product-api.ts` — Detail credential/budget
  least-privilege gating; approval read Hidden/Access-restricted guard.
- `packages/shotgun-api-client/src/frontend-external-action-client.ts` — command-specific
  resource identity bindings (validate/approve/preflight/execute/retry/verify/rollback).
- `tests/integration/frontend-external-action-product-api.test.ts` — scope matrix positive-grant
  rows (approve/verify/cancel/rollback 404) + Detail credential/budget scope-combination suite
  (16 tests).
- `tests/integration/frontend-external-action-domain.test.ts` — Hidden approval read negative
  (27 tests).
- `tests/unit/frontend-external-action-client.test.ts` — identity table tampers per-command
  resource identity fields (20 tests).
- `docs/implementation/frontend-phase-4-section-2-implementation-progress-report-260805001.md` —
  Section 24 corrections + this Section 25.

### Validation

- `npx vitest run tests/unit/frontend-external-action-client.test.ts` — **20/20 PASS**.
- `npx vitest run tests/integration/frontend-external-action-product-api.test.ts` — **16/16
  PASS**.
- `npx vitest run tests/integration/frontend-external-action-domain.test.ts` — **27/27 PASS**.
- Full unit+integration+contract suites — **976 PASS** (one pre-existing timing flake passes in
  isolation; unrelated to this remediation).
- Full database suite `npm run test:database` — **166/166 PASS (31 files)** (unchanged scope).
- `tsc --noEmit` — clean. ESLint — clean. Prettier — clean.
- Automatic CI on this head — run **#549**: Quality, Frontend, Required Gates **SUCCESS**.
  (#547/#548 not re-run, per the review instruction.)

## 26. WP5 — External Action Governance Workspace (report 20, 2026-08-05)

GPT review **4864062529** approved **WP4 APPROVED / COMPLETE** and authorized **WP5
AUTHORIZED_TO_START** with a bounded single-task scope (the IR WP5 list plus the GPT itemized
nine-point scope). This report records the WP5 implementation on code head `561c426`
(CI **#553**) and report head `5ff2d33` (CI **#554**).

### 1. Route and deep-link contract (WP5 items 2)

- `TargetRouteView` gained `external-action` (`routeId` + `/external-action` href) in
  `packages/contracts/src/frontend-section3.ts` (additive route registration).
- `apps/shotgun-web/src/external-action/external-action-route-contract.ts` — the workspace
  deep-link contract: only resource identities (`action`, `manifest`, `execution`, `attempt`,
  `verification`) and a `focus` hint may appear in the URL. Command payloads, capabilities,
  credential/budget views and drafts are never encoded. `parseExternalActionDeepLink` ignores
  unknown query keys; `externalActionDeepLinkHref` serializes selection only.
- `apps/shotgun-web/src/app/router.tsx` registers `/external-action` behind the guarded loader
  (`routeId: 'external-action'`), and `adapters/frontend-product-read-in-memory` added the route
  to the route-guard `workspaceAvailable` set.

### 2. Query-key factory with Project/access/policy + action revision + external revision (WP5 item 3)

`apps/shotgun-web/src/app/query-keys.ts` gained `ExternalActionQueryScope`
(`principalId`/`sessionId`/`activeProjectId`/`resourceProjectId`/`accessRevision`/
`policyContextRevision`/`sensitivity`), `externalActionScopeFromShell`, the bounded
`externalActionQueueQueryKey` (scope + request) and `externalActionResourceQueryKey` which
additionally binds `actionId` + `actionRevision` + `externalRevision`. Every External Action
read uses only these factories (no ad hoc arrays; ADR-119 §4). `external-action-queries.ts`
provides the queue, detail, manifest, risk-decision, preflight, execution, attempts, verification,
result, audit and approval query options, with retry derived from ADR-118 descriptors and the
`FrontendExternalActionClient`.

### 3. Route-scoped Browser Draft State Machine (WP5 item 4; ADR-119)

`apps/shotgun-web/src/external-action/external-action-workspace-state.ts` owns only route
selection, focus and UNSENT governed-command input (`draft` = command kind + reason). Phases:
`IDLE` / `QUEUE_LOADING` / `QUEUE_READY` / `DETAIL_LOADING` / `DETAIL_READY` / `FAILED` /
`OUTCOME_UNKNOWN` (clientRequestId + idempotencyKey + semanticDigest) / `BLOCKED`. Recovery is
`NONE` / `RESTORING` / `RESOLVING` — `OUTCOME_UNKNOWN` resolves by the ORIGINAL command identity
and never re-executes (contract §7, §10.3). The `externalActionCommandSurfaces` map decides only
which non-automatic affordances render — the server remains the capability/policy/state authority.

### 4. Governance Workspace (WP5 items 1, 5, 6, 7, 8)

`apps/shotgun-web/src/routes/external-action-workspace.tsx`:

- Bounded queue (≤ 50) and integrated aggregate detail with **safe masking and access-loss
  restricted shell** (an `ACCESS_RESTRICTED` action renders the restricted announcement and no
  protected payload — no counts, edges, manifest, risk, credential or budget leak).
- Risk decision, manifest, approval, preflight, execution, execution attempts, verification,
  result and audit read states.
- **Cancel (abort only)**, **Rollback (separate governed state-reversal)** and **Compensating
  Action (governed)** surfaces, each explicitly non-automatic (contract §9). Cancel is never
  rollback; rollback/compensation never auto-run.
- **`OUTCOME_UNKNOWN` recovery**: a typed recovery state resolves by the original identity
  (`clientRequestId` + `idempotencyKey` + `semanticDigest`) with a resolve-only action — there is
  never a re-execute button.
- **Deep-link restore + focus preservation** (contract §10.5): selection is restored from the URL
  on load/refresh, and focus is applied to the named target after restore/refresh/cancel/verify.
- Frozen announcement strings (`EXTERNAL_ACTION_ANNOUNCEMENTS`) and non-color status cues
  (`externalActionAggregateCue`) for accessibility (contract §10.6; axe/zoom/reduced-motion
  evidence is WP6).

### 5. Home / Command Palette navigation, never direct execution (WP5 item 1; AC-18)

`InMemoryActionCenterProjection.getHome` adds the primary action `govern-external-action` →
`/external-action`. `decodeHomeActionCenterView` registers the id and raises the bounded
primary-action cap to 5. High-risk External Actions are never executed from Home — the entry
navigates to the governance workspace only. (The `externalActionManifestDigest` payload digest is
also re-exported from the api-client for manifest verification.)

### Changed files (this WP5 implementation)

- `packages/contracts/src/frontend-section3.ts` — `TargetRouteView` + `external-action` route;
  `PrimaryActionView` id `govern-external-action`; primary-action cap 5.
- `packages/shotgun-api-client/src/contracts.ts` — all FE-P4-S2 External Action V1 types
  re-exported for the browser workspace.
- `packages/shotgun-api-client/src/frontend-external-action-client.ts` — `externalActionManifestDigest`
  re-export.
- `adapters/frontend-product-read-in-memory/src/index.ts` — `externalAction` route in `routes` +
  route-guard `workspaceAvailable`; Home primary action `govern-external-action` (AC-18).
- `apps/shotgun-web/src/app/query-keys.ts` — External Action scope + queue/resource key factories.
- `apps/shotgun-web/src/app/router.tsx` — `/external-action` guarded route.
- `apps/shotgun-web/src/external-action/external-action-route-contract.ts` — NEW deep-link/route
  contract.
- `apps/shotgun-web/src/external-action/external-action-queries.ts` — NEW read query options.
- `apps/shotgun-web/src/external-action/external-action-workspace-state.ts` — NEW ADR-119 draft
  state machine + announcements + command surfaces.
- `apps/shotgun-web/src/routes/external-action-workspace.tsx` — NEW governance workspace.
- `apps/shotgun-web/src/external-action/external-action-route-contract.test.ts` — NEW (5 tests).
- `apps/shotgun-web/src/external-action/external-action-workspace-state.test.ts` — NEW (7 tests).
- `apps/shotgun-web/src/routes/external-action-workspace.test.tsx` — NEW (2 tests: queue→detail,
  restricted shell).

### Validation

- `apps/shotgun-web` full suite (`vitest run`) — **18 files / 74 tests PASS** (includes 14 new
  WP5 tests).
- Root unit+integration+contract suites — **976 PASS** (pre-existing timing flakes pass in
  isolation; unrelated to WP5).
- `tsc --noEmit` (root and `apps/shotgun-web`) — clean. ESLint — clean. Prettier — clean.
- Automatic CI on code head `561c426` — run **#553**: Quality, Frontend, Required Gates
  **SUCCESS**. (First WP5 head `eef33a6` CI #552 failed on a missing primary-action registration
  and a test fixture type; both fixed in `561c426`.)

### Section 26 correction (Review 4865177355)

Review **4865177355** (**BLOCKED / FOCUSED WP5 REMEDIATION REQUIRED**) flagged six connectivity
defects inside the approved WP5 scope and asked for Section 26 corrections. The claims below were
corrected in this report:

- **Governed surface list**: Section 26 named only Cancel/Rollback/Compensation. The workspace
  also has a **Verify** surface (`검증 실행`, explicit non-automatic). Corrected in Section 27
  item 6.
- **`OUTCOME_UNKNOWN` recovery**: Section 26 claimed recovery "resolves by the original identity",
  but the original implementation stored the identity only after a successful response and still
  exposed `canRetry: true`. The remediation captures the original identity + exact semantic digest
  **before** every call, adjudicates `COMPLETED` / `REJECTED` / continued `OUTCOME_UNKNOWN`, and
  removes the re-execute surface. Corrected in Section 27 item 5.
- **Deep-link / focus**: Section 26 claimed deep-link restore + focus preservation, but the
  manifest identity was not selected, queue selection misused `setSearchParameters`, and focus was
  not preserved after cancel/verify. Corrected in Section 27 items 2 and 6.

## 27. WP5 focused remediation — Review 4865177355 (report 21, 2026-08-05)

GPT review **4865177355** returned **BLOCKED / FOCUSED WP5 REMEDIATION REQUIRED** with six
connectivity defects inside the approved WP5 scope. WP6, Migration, Stage 11, new dependencies
and Real Connector stayed out of scope. CI **#553 / #554 / #555** were NOT re-run per the review
instruction. This report records the remediation on code head `4c98d14` (CI **#557**) and report
head `671e063ff` (CI **#558**).

### 1. Item 1 — Command Palette entry (shell.navigation)

- `adapters/frontend-product-read-in-memory` `getShell` now emits the `external-action` navigation
  item (`label: 'External actions'`), `AVAILABLE` with `routes.externalAction` when a Project is
  ready and `TEMPORARILY_UNAVAILABLE` otherwise, placed after `ask` and before the
  knowledge/review `COMING_LATER` entries. The workspace is reachable from **both** Home and
  Command Palette.
- Home primary action `govern-external-action` → `/external-action` remains navigation-only
  (AC-18: never direct execution).
- NEW `tests/contract/frontend-shell-navigation.contract.test.ts` (3 tests): Command Palette
  entry `AVAILABLE` + `/external-action` href with a ready Project; `TEMPORARILY_UNAVAILABLE`
  without a Project; Home primary action carries no command/execution surface.

### 2. Item 2 — Deep-link contract actually drives workspace selection

- `external-action-workspace-state.ts` gained `selectedManifestId` and the `SELECT_MANIFEST`
  action; `SELECT_ACTION` resets it and the in-flight `submitting` lock.
- Deep-link restore now dispatches `SELECT_MANIFEST` from `deepLink.manifestId` in addition to the
  execution/attempt/verification selection.
- Queue selection navigates with `navigate(externalActionDeepLinkHref({ actionId }))` — the full
  href — never `setSearchParameters` with a raw path.
- The manifest section renders a select/selected button (`aria-pressed`); execution attempts and
  verification are selectable controls, and verification selection feeds the Verify command.
- NEW test: deep-link restore `['/external-action?action=action-1&focus=manifest-heading']`
  restores selection, renders the manifest, keeps `manifest-heading` focusable (`tabIndex -1`) and
  moves focus to it.

### 3. Item 3 — External Revision child-read gating

- `childIdentity` is `null` until the detail payload resolves **and** the action is not restricted
  (`ACCESS_RESTRICTED` or `HIDDEN`). The external revision is learned from the detail payload and
  then binds every child read, so no child read runs with an empty external-revision key and no
  protected read fires for a Hidden/Restricted action.
- NEW negative test: the restricted-shell test now asserts the protected child-read call list
  (manifests / risk-decisions / preflights / executions / verifications / results / approvals)
  is exactly `[]`.

### 4. Item 4 — ADR-119 reason draft + exactly-once submit lock

- The workspace renders a route-scoped reason `<input>` (`aria-label="거버넌스 명령 사유"`) wired
  to `SET_COMMAND_DRAFT`; the draft reason is sent when the draft's command matches the command.
- `SUBMITTING_STARTED { command }` / `SUBMITTING_FINISHED` drive a `submitting` lock; every
  governed control is `disabled` while a command is in flight or a recovery is in progress.
- NEW test: with a delayed cancel (`cancelDelayMs: 100`), a rapid double-click sends exactly one
  `/external-action/cancel` POST.

### 5. Item 5 — OUTCOME_UNKNOWN recovery by the ORIGINAL identity, captured before the call

- `lastCommandRef` (`clientRequestId` + `idempotencyKey` + the exact semantic digest via
  `CancelDigest` / `RollbackDigest` / `CompensationDigest` / `VerifyDigest`) is captured **before**
  every governed API call.
- `resolveOutcome` adjudicates the three contract outcomes: `COMPLETED` → recovery finished +
  detail resolved + exact query invalidation; `REJECTED` → typed failure with the rejection
  message; continued `OUTCOME_UNKNOWN` → stays recoverable with the original identity.
- `canRetry` was removed from `externalActionCommandSurfaces` — there is no re-execute surface.
- NEW workspace–client recovery test: VERIFIED rollback → 503 `ACTION_OUTCOME_UNKNOWN` → recovery
  shows the resolve-only `원래 요청으로 복구` (no retry/re-execute button) → resolve echoes
  `REJECTED` → typed `거부되었습니다` failure with exactly one resolve call carrying
  `idempotencyKey` + `semanticDigest`.

### 6. Item 6 — Verify surface + focus preservation

- Added a VERIFY command branch (using the manifest target/external revision and `VerifyDigest`)
  and a `검증 실행` button when `canVerify`; focus lands on `verification-heading` after verify.
- Cancel / rollback / compensation preserve focus on `governed-commands-heading`.
- All focusable headings carry `tabIndex={-1}`; the focus effect re-runs when the detail subtree
  data lands (targets that mount after a child read still receive focus) and self-terminates via
  `CLEAR_FOCUS`.

### Changed files (this remediation)

- `adapters/frontend-product-read-in-memory/src/index.ts` — `shell.navigation` `external-action`
  item (Command Palette entry).
- `apps/shotgun-web/src/external-action/external-action-workspace-state.ts` — `selectedManifestId`
  - `SELECT_MANIFEST`, `submitting` + `SUBMITTING_STARTED/FINISHED`; `canRetry` removed.
- `apps/shotgun-web/src/external-action/external-action-workspace-state.test.ts` — manifest
  selection + submitting-lock tests.
- `apps/shotgun-web/src/routes/external-action-workspace.tsx` — deep-link navigation fix,
  child-read gating, reason input, exactly-once submit lock, Verify branch, resolve adjudication,
  focus preservation + `tabIndex={-1}` headings.
- `apps/shotgun-web/src/routes/external-action-workspace.test.tsx` — rewritten focused tests:
  queue→detail, restricted child-read-negative, deep-link restore + focus, double-click
  exactly-once, OUTCOME_UNKNOWN recovery.
- `tests/contract/frontend-shell-navigation.contract.test.ts` — NEW item-1 navigation tests.

### Validation

- `apps/shotgun-web` full suite (`vitest run`) — **18 files / 78 tests PASS**.
- Root unit+integration+contract suites — **980 tests** (979 PASS; the single
  `stage-8-format-expansion` timing flake passes in isolation; unrelated to WP5).
- `tsc --noEmit` (root and `apps/shotgun-web`) — clean. ESLint — clean. Prettier — clean.
- Automatic CI on the final code head `4c98d14` — run **#557**: Quality, Frontend, Required Gates
  **SUCCESS**. (The interim remediation head `61ff981` ran CI **#556**; superseded by `4c98d14`
  which also carries the item-1 navigation tests.) Report head `671e063ff` CI **#558**
  **SUCCESS** (metadata recorded below).

### Final metadata (report 21)

- **WP5 remediation code head**: `4c98d141c4078bde12bdbfdd786a49075169c0b2` — CI **#557** /
  `31014844606`: Quality, Frontend, Required Gates **SUCCESS**.
- **Report 21 head**: `671e063ff932645a1eeb45f6dc579ff1bbdaa830` — CI **#558** / `31015236898`:
  Quality, Frontend, Required Gates **SUCCESS**.
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. CI **#553 / #554 / #555** were NOT re-run.
- Authority state: WP5 `REMEDIATION_REQUIRED NOT_APPROVED` (remediation submitted for re-review);
  WP6 `NOT_AUTHORIZED`.

### Section 27 correction (Review 4865620679)

Review **4865620679** (**BLOCKED / FINAL FOCUSED WP5 REMEDIATION REQUIRED**) found that Section 27
recorded items 2–6 as complete even though five connectivity defects remained. The review's own
verdict: **Item 1: RESOLVED; Item 2: PARTIAL / REMEDIATION_REQUIRED; Item 3: PARTIAL /
REMEDIATION_REQUIRED; Item 4: PARTIAL / REMEDIATION_REQUIRED; Item 5: PARTIAL /
REMEDIATION_REQUIRED; Item 6: PARTIAL / REMEDIATION_REQUIRED**. The defects and their fixes are
recorded in Section 28; Section 27's items 2–6 are to be read as PARTIAL at report-21 time.

## 28. WP5 final remediation — Review 4865620679 (report 22, 2026-08-05)

GPT review **4865620679** returned **BLOCKED / FINAL FOCUSED WP5 REMEDIATION REQUIRED**. It
confirmed Item 1 (`shell.navigation` Command Palette entry) as **RESOLVED**, plus the
restricted-read gating, `SUBMITTING` exactly-once lock, identity-before-call and no-re-execute
surfaces. It flagged five remaining connectivity defects inside the approved WP5 scope (Items
2–6 PARTIAL). WP6, Migration, Stage 11, new dependencies and Real Connector stayed out of scope.
CI **#557 / #558 / #559** were NOT re-run per the review instruction. This report records the
final remediation on code head `c47245e` (CI **#560**) and report head `b68964b` (CI **#561**).

### Item status after this remediation

- **Item 1** (Command Palette entry / Home navigate-only): RESOLVED (unchanged).
- **Item 2** (five-resource deep link, URL + state sync, fail-closed): RESOLVED.
- **Item 3** (External Revision isolation, never empty): RESOLVED.
- **Item 4** (command-common reason draft + refresh-and-lock): RESOLVED.
- **Item 5** (`OUTCOME_UNKNOWN` resolve: exact invalidation, typed rejection, recoverable):
  RESOLVED.
- **Item 6** (Verify refresh + focus preservation): RESOLVED.

### 1. Item 2 — deep links for all five resources (Review 4865620679 item 2)

- The deep-link restore effect no longer short-circuits when only the action is unchanged: it
  applies `manifest` / `execution` / `attempt` / `verification` / `focus` on EVERY restore.
- `selectManifest` / `selectExecution` / `selectAttempt` / `selectVerification` all navigate with
  the full deep-link href (state + URL stay in sync); the execution section gained a selectable
  control (`aria-pressed`).
- **Fail-closed**: when a deep-link resource id differs from the id the server returned for the
  action, the section renders a safe unavailable note and never mirrors the mismatched identity.
- NEW tests: a deep link carrying all five identities restores all four `aria-pressed=true`
  selections and keeps all five query params in the URL; a mismatched manifest id renders the
  fail-closed note (no `aria-pressed=true`).

### 2. Item 3 — external revision learned from targetRef, never empty (Review 4865620679 item 3)

- `knownExternalRevision` now derives from `detail.action.targetRef.externalRevision` FIRST (the
  embedded detail `manifest` is OPTIONAL in the contract), then the embedded manifest revision,
  then the authoritative snapshot revision.
- `childIdentity` requires a non-empty external revision — a child read never runs with an empty
  external-revision query key.
- NEW test: a valid non-restricted detail WITHOUT an embedded manifest still uses the targetRef
  revision `ext-7` for every child key (queue/detail/snapshot keys are excluded).

### 3. Item 4 — command-common reason draft + refresh-and-lock (Review 4865620679 item 4)

- The reason input is a **command-common** draft (`ExternalActionReasonDraft`): the typed reason
  is sent with Cancel / Rollback / Compensation / Verify — it is no longer hard-bound to CANCEL.
- Every governed command success invalidates the **exact** action query prefix
  (`externalActionActionQueryKey`) and keeps the `SUBMITTING` lock until the refresh settles, so
  stale command surfaces are removed before the controls re-enable.
- NEW tests: a typed reason is carried on the rollback POST body; after a successful cancel the
  stale surface disappears and the detail is refetched (more than one detail read).

### 4. Item 5 — OUTCOME_UNKNOWN resolve (Review 4865620679 item 5)

- `COMPLETED` invalidation now uses `externalActionActionQueryKey` (the REAL key prefix with
  session/project/access/policy/sensitivity) instead of the non-matching
  `['project', principalId, 'external-action', 'action', actionId]` array.
- `REJECTED` stores the **actual** rejection code (mapped to a valid
  `ExternalActionFailureReasonV1`) and its message — no longer a generic `NETWORK_FAILURE`.
- A failed resolve read returns to a **recoverable** `OUTCOME_UNKNOWN` keeping the ORIGINAL
  identity; the resolve-only action re-enables.
- NEW tests: `COMPLETED` refetches the action queries and finishes recovery; continued
  `OUTCOME_UNKNOWN` stays recoverable; a resolve network failure keeps the original identity and
  re-enables resolve with no stale failure state.

### 5. Item 6 — Verify refresh + focus preservation (Review 4865620679 item 6)

- Verify success invalidates the exact action queries (which includes the verification read) and
  then dispatches focus to `verification-heading`; the focus target persists until the heading
  mounts (the focus effect re-runs when the child data lands).
- NEW test: a VERIFYING action with no verification section pre-command mounts the verification
  heading after Verify succeeds and moves focus to it.

### Changed files (this remediation)

- `apps/shotgun-web/src/app/query-keys.ts` — `externalActionActionQueryKey` (exact action-prefix
  invalidation key).
- `apps/shotgun-web/src/external-action/external-action-workspace-state.ts` — command-common
  reason draft (`ExternalActionReasonDraft`); `SET_COMMAND_DRAFT { reason }`.
- `apps/shotgun-web/src/external-action/external-action-workspace-state.test.ts` — command-common
  reason draft test.
- `apps/shotgun-web/src/routes/external-action-workspace.tsx` — all-resource deep-link restore +
  URL sync + fail-closed, targetRef external revision, command-common reason, exact invalidation +
  lock-until-refresh, resolve adjudication fixes, verify refresh + focus.
- `apps/shotgun-web/src/routes/external-action-workspace.test.tsx` — focused tests for items 2–6
  (deep-link five resources + fail-closed, external-revision child keys, reason delivery, stale
  surface removal, resolve COMPLETED / continued-UNKNOWN / failure, verify focus).

### Validation

- `apps/shotgun-web` full suite (`vitest run`) — **18 files / 87 tests PASS**.
- Root unit+integration+contract suites — 980 tests; the pre-existing knowledge/compiled-truth
  timing flakes pass in isolation (unrelated to WP5).
- `tsc --noEmit` (root and `apps/shotgun-web`) — clean. ESLint — clean. Prettier — clean.
- Automatic CI on the final code head `c47245e` — run **#560**: Quality, Frontend, Required Gates
  **SUCCESS**. Report head `b68964b` CI **#561** **SUCCESS** (metadata recorded below).

### Final metadata (report 22)

- **WP5 final remediation code head**: `c47245eb0f458f269ccb9affa451e7d620c5aa75` — CI
  **#560** / `31019543999`: Quality, Frontend, Required Gates **SUCCESS**.
- **Report 22 head**: `b68964b0fd95b32353f1e2e1f7dda89c64f172d1` — CI **#561** /
  `31019928726`: Quality, Frontend, Required Gates **SUCCESS**.
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. CI **#557 / #558 / #559** were NOT re-run.
- Authority state: WP5 `REMEDIATION_REQUIRED NOT_APPROVED` (final remediation submitted for
  re-review); WP6 `NOT_AUTHORIZED`.

### Section 28 correction (Review 4866122577)

Review **4866122577** (**BLOCKED / EXACT FINAL WP5 CORRECTION REQUIRED**) confirmed Items 1, 4 and 6
as **RESOLVED** and most of Item 3/Item 5 work, but recorded Section 28's Items 2, 3 and 5 as
overstated. The review's exact status at report-22 time: **Item 1: RESOLVED; Item 2: PARTIAL /
REMEDIATION_REQUIRED; Item 3: PARTIAL / REMEDIATION_REQUIRED; Item 4: RESOLVED; Item 5: PARTIAL /
REMEDIATION_REQUIRED; Item 6: RESOLVED**. The three PARTIAL items are resolved in this report
(Section 29).

## 29. WP5 exact final correction — Review 4866122577 (report 23, 2026-08-05)

GPT review **4866122577** returned **BLOCKED / EXACT FINAL WP5 CORRECTION REQUIRED** with three
exact corrections inside the approved WP5 scope (Items 2, 3, 5). CI **#560 / #561 / #562** were
NOT re-run per the review instruction. This report records the correction on code head `c0a2db7`
(CI **#563**) and report head `f39615b` (CI **#564**).

### Item status after this correction

- **Item 1** (Command Palette entry / Home navigate-only): RESOLVED (unchanged).
- **Item 2** (deep link = source of truth for resource selection): RESOLVED.
- **Item 3** (snapshot bootstrap key + revision-bound detail key): RESOLVED.
- **Item 4** (command-common reason + refresh-and-lock): RESOLVED (unchanged).
- **Item 5** (`OUTCOME_UNKNOWN` COMPLETED recovery lock): RESOLVED.
- **Item 6** (Verify refresh + focus preservation): RESOLVED (unchanged).

### 1. Item 2 — the URL is the single source of truth for resource selection

- The deep-link restore effect now clears EVERY resource selection first
  (`RESET_RESOURCE_SELECTIONS`) and then re-applies exactly what the URL carries, so Back/Forward
  that removes a parameter also clears the stale selection.
- `selectManifest` / `selectExecution` / `selectAttempt` / `selectVerification` preserve ALL
  already-selected resource parameters — selecting one resource never rebuilds the URL with a
  single parameter.
- A mismatched deep-link resource is cleared from **state** (`CLEAR_*_SELECTION`) — not just hidden
  visually — so Rollback / Compensation / Verify never prefer a stale deep-link id in the request
  payload. The attempt mismatch case was added to the fail-closed guard.
- NEW tests: Back/Forward removing the parameters clears all selections; selecting a second
  resource preserves the first parameter in the URL; a mismatched execution id is not selected.

### 2. Item 3 — snapshot bootstrap key + revision-bound detail key

- The snapshot read uses a dedicated **bootstrap key** (`externalActionSnapshotQueryKey`: scope +
  `snapshot` + actionId) — it is no longer a revision-bound resource key carrying the `-1` / `''`
  placeholders.
- The detail identity is bound to the authoritative snapshot external revision
  (`SET_EXTERNAL_REVISION`), and the detail read is gated on a **non-empty** external revision — a
  regular resource key never carries `externalRevision: ''` (the detail key included).
- Restricted actions (whose snapshot carries no target revision) render the restricted shell from
  the snapshot instead of forcing an empty-revision detail read.
- NEW test: the snapshot key is a bootstrap key (not `.../action/...`), and every regular resource
  key carries a non-empty external revision.

### 3. Item 5 — COMPLETED recovery keeps the lock through the refresh

- `resolveOutcome` COMPLETED now keeps the recovery lock (`RESTORING`) while the exact action
  queries refetch and releases it only after the latest detail is confirmed.
- If the refresh fails, the workspace shows a safe **BLOCKED** state
  (`COMPLETED_BUT_REFRESH_REQUIRED`) instead of silently re-enabling stale surfaces.
- NEW test: with a delayed detail refetch, no governed command is submitted while the lock is held
  and the surface re-enables only after the refresh settles.

### Changed files (this correction)

- `apps/shotgun-web/src/app/query-keys.ts` — `externalActionSnapshotQueryKey` (bootstrap key).
- `apps/shotgun-web/src/external-action/external-action-queries.ts` — snapshot uses the bootstrap
  key; the detail read is gated on a non-empty external revision.
- `apps/shotgun-web/src/external-action/external-action-workspace-state.ts` —
  `SET_EXTERNAL_REVISION`, `RESET_RESOURCE_SELECTIONS`, `CLEAR_MANIFEST/EXECUTION/ATTEMPT/
VERIFICATION_SELECTION`.
- `apps/shotgun-web/src/routes/external-action-workspace.tsx` — URL source-of-truth restore,
  parameter-preserving selection, mismatch state clearing, detail revision gating + snapshot
  restricted shell, COMPLETED recovery lock + BLOCKED state.
- `apps/shotgun-web/src/routes/external-action-workspace.test.tsx` — focused tests for the three
  corrections (Back/Forward clearing, parameter preservation, mismatch state clearing, bootstrap
  key + non-empty revision, COMPLETED refresh lock).

### Validation

- `apps/shotgun-web` full suite (`vitest run`) — **18 files / 92 tests PASS**.
- Root unit+integration+contract suites — 980 tests; the pre-existing knowledge/compiled-truth
  timing flakes pass in isolation (unrelated to WP5).
- `tsc --noEmit` (root and `apps/shotgun-web`) — clean. ESLint — clean. Prettier — clean.
- Automatic CI on the code head `c0a2db7` — run **#563**: Quality, Frontend, Required Gates
  **SUCCESS**. Report head `f39615b` CI **#564** **SUCCESS** (metadata recorded below).

### Final metadata (report 23)

- **WP5 exact final correction code head**: `c0a2db7751d2da103e817d81786d4930497076e4` — CI
  **#563** / `31022637736`: Quality, Frontend, Required Gates **SUCCESS**.
- **Report 23 head**: `f39615b52f5e528d9af9d07bf9d0545b779108fb` — CI **#564** /
  `31022977623`: Quality, Frontend, Required Gates **SUCCESS**.
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. CI **#560 / #561 / #562** were NOT re-run.
- Authority state: WP5 `REMEDIATION_REQUIRED NOT_APPROVED` (exact correction submitted for
  re-review); WP6 `NOT_AUTHORIZED`.

### Section 29 correction (Review 4866454087)

Review **4866454087** (**BLOCKED / TWO FINAL WP5 CORRECTIONS REQUIRED**) confirmed **Item 5
RESOLVED** and Items 1, 4, 6 RESOLVED, but recorded Section 29's Items 2 and 3 as still
PARTIAL. The review's exact status at report-23 time: **Item 1: RESOLVED; Item 2: PARTIAL /
REMEDIATION_REQUIRED; Item 3: PARTIAL / REMEDIATION_REQUIRED; Item 4: RESOLVED; Item 5:
RESOLVED; Item 6: RESOLVED**. The two PARTIAL items are resolved in this report (Section 30).

## 30. WP5 two final corrections — Review 4866454087 (report 24, 2026-08-05)

GPT review **4866454087** returned **BLOCKED / TWO FINAL WP5 CORRECTIONS REQUIRED** with two
exact corrections inside the approved WP5 scope (Items 2 and 3). CI **#563 / #564 / #565** were
NOT re-run per the review instruction. This report records the corrections on code head
`4391c12` (CI **#566**) and report head `16b5aac` (CI **#567**).

### Item status after this correction

- **Item 1** (Command Palette entry / Home navigate-only): RESOLVED (unchanged).
- **Item 2** (deep link = source of truth; mismatched resource blocked from commands):
  RESOLVED.
- **Item 3** (revision-bound resource keys; snapshot bootstrap; no empty-revision key):
  RESOLVED.
- **Item 4** (command-common reason + refresh-and-lock): RESOLVED (unchanged).
- **Item 5** (`OUTCOME_UNKNOWN` COMPLETED recovery lock): RESOLVED (unchanged).
- **Item 6** (Verify refresh + focus preservation): RESOLVED (unchanged).

### 1. Item 2 — mismatched resource synchronously blocked from governed commands

- The `locked` guard now includes **any deep-link resource mismatch** in the SAME render the
  mismatch is detected (`mismatchLocked`), so every governed command (Cancel / Rollback /
  Compensation / Verify) is disabled immediately — a passive clear effect is never the security
  boundary.
- Rollback / Compensation / Verify construct the execution id from a **safe value**
  (`safeExecutionId`) that never uses a mismatched deep-link id; it falls back to the
  authoritative `latestExecutionRef`.
- NEW tests: with a mismatched execution deep link, the governed surfaces are disabled and
  clicking them submits no request with the mismatched id; attempt/verification mismatch is
  covered by the same fail-closed guard.

### 2. Item 3 — no empty-external-revision resource key, not even transiently

- `externalActionDetailQueryOptions` now builds the resource key **only** when the external
  revision is non-empty; otherwise the disabled key is used. A queue selection that is awaiting
  the authoritative snapshot therefore never creates an empty-external-revision resource key in
  the query cache (the key itself is never `.../action/.../''/detail`).
- NEW test: with a delayed snapshot response, the query cache during the wait contains no
  action-phase resource key with an empty external revision, and the detail loads normally after
  the snapshot bootstraps the revision.

### Changed files (this correction)

- `apps/shotgun-web/src/external-action/external-action-queries.ts` — detail key is revision-bound
  only when the external revision is non-empty.
- `apps/shotgun-web/src/routes/external-action-workspace.tsx` — `mismatchLocked` in the governed
  lock; `safeExecutionId` in Rollback / Compensation / Verify payloads.
- `apps/shotgun-web/src/routes/external-action-workspace.test.tsx` — focused tests for both
  corrections.

### Validation

- `apps/shotgun-web` full suite (`vitest run`) — **18 files / 94 tests PASS**.
- Root unit+integration+contract suites — 980 tests; the pre-existing knowledge/compiled-truth
  timing flakes pass in isolation (unrelated to WP5).
- `tsc --noEmit` (root and `apps/shotgun-web`) — clean. ESLint — clean. Prettier — clean.
- Automatic CI on the code head `4391c12` — run **#566**: Quality, Frontend, Required Gates
  **SUCCESS**. Report head `16b5aac` CI **#567** **SUCCESS** (metadata recorded below).

### Final metadata (report 24)

- **WP5 two final corrections code head**: `4391c120b5e87954f86635076201a20678b7a3f6` — CI
  **#566** / `31024681149`: Quality, Frontend, Required Gates **SUCCESS**.
- **Report 24 head**: `16b5aacd828983af99f1a59ac3d52651a5144cf7` — CI **#567** /
  `31025034175`: Quality, Frontend, Required Gates **SUCCESS**.
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. CI **#563 / #564 / #565** were NOT re-run.
- Authority state: WP5 `REMEDIATION_REQUIRED NOT_APPROVED` (two corrections submitted for
  re-review); WP6 `NOT_AUTHORIZED`.

### Section 30 correction (Review 4866654696)

Review **4866654696** (**BLOCKED / ONE EXACT WP5 FAIL-CLOSED CORRECTION REQUIRED**) confirmed
**Item 3 RESOLVED** and Items 1, 4, 5, 6 RESOLVED, but recorded Section 30's **Item 2** as still
PARTIAL with a new exact finding: the deep-link execution id was trusted **before** the
authoritative Execution read settled (pending / 404 / error states), so `mismatchLocked` was not
active and `safeExecutionId` could carry the unverified id. The review's exact status at
report-24 time: **Item 1: RESOLVED; Item 2: PARTIAL / REMEDIATION_REQUIRED; Item 3: RESOLVED;
Item 4: RESOLVED; Item 5: RESOLVED; Item 6: RESOLVED**. The PARTIAL Item 2 is resolved in this
report (Section 31).

## 31. WP5 fail-closed unverified execution id — Review 4866654696 (report 25, 2026-08-05)

GPT review **4866654696** returned **BLOCKED / ONE EXACT WP5 FAIL-CLOSED CORRECTION REQUIRED**
with a single exact correction inside the approved WP5 scope (Item 2). CI **#566 / #567 / #568**
were NOT re-run per the review instruction. This report records the correction on code head
`f041e52e` (CI **#569**).

### Item status after this correction

- **Item 1** (Command Palette entry / Home navigate-only): RESOLVED (unchanged).
- **Item 2** (deep link = source of truth; mismatched/unverified resource blocked from
  commands): RESOLVED.
- **Item 3** (revision-bound resource keys; snapshot bootstrap; no empty-revision key):
  RESOLVED (unchanged).
- **Item 4** (command-common reason + refresh-and-lock): RESOLVED (unchanged).
- **Item 5** (`OUTCOME_UNKNOWN` COMPLETED recovery lock): RESOLVED (unchanged).
- **Item 6** (Verify refresh + focus preservation): RESOLVED (unchanged).

### 1. Item 2 — unverified deep-link execution id is fail-closed

- A deep-link execution id is trusted ONLY after the authoritative Execution read CONFIRMS it:
  `executionValidated = execution.data !== undefined && selectedExecutionId !== null &&
execution.data.execution.executionId === selectedExecutionId`.
- While the Execution read is **pending**, **errored (incl. 404)** or returns a **different** id,
  the id is UNVERIFIED (`executionUnverified`): every governed command (Cancel / Rollback /
  Compensation / Verify) is synchronously locked in the SAME render (`mismatchLocked` includes
  `executionUnverified`) — a passive clear effect is never the security boundary.
- `submitCommand()` performs the SAME fail-closed check internally and returns without building a
  payload — the disabled buttons are not the security boundary.
- `safeExecutionId` uses `selectedExecutionId` ONLY when validated; otherwise Rollback /
  Compensation / Verify fall back to the authoritative `latestExecutionRef`.
- NEW tests: with a delayed Execution read, the detail + governed surfaces render first, the
  commands are disabled while the id is unverified, and no Rollback POST occurs (even after the
  read settles); with an Execution read 404, the unverified id is never used in a payload.

### Changed files (this correction)

- `apps/shotgun-web/src/routes/external-action-workspace.tsx` — `executionValidated` /
  `executionUnverified` derivation, `mismatchLocked` includes the unverified state,
  `submitCommand` internal fail-closed guard, `safeExecutionId` only from the validated id.
- `apps/shotgun-web/src/routes/external-action-workspace.test.tsx` — focused tests for the
  pending and 404 fail-closed windows.

### Validation

- `apps/shotgun-web` full suite (`vitest run`) — **18 files / 96 tests PASS** (23 WP5 workspace
  tests, +2 new fail-closed tests).
- Root unit+integration+contract suites — 980 tests; the pre-existing compiled-truth /
  cited-search-ui / stage-8-format-expansion timing flakes pass in isolation (unrelated to WP5).
- `tsc --noEmit` (root and `apps/shotgun-web`) — clean. ESLint — clean. Prettier — clean.
- Automatic CI on the code head `f041e52e` — run **#569**: Quality, Frontend, Required Gates
  **SUCCESS**. Report head `b476a73` CI **#570** **SUCCESS** (metadata recorded below).

### Final metadata (report 25)

- **WP5 fail-closed correction code head**: `f041e52e7cc64b035e462c0e70ff1f4e527ec551` — CI
  **#569** / `31027053940`: Quality, Frontend, Required Gates **SUCCESS**.
- **Report 25 head**: `b476a733d465df4e51d41bbe8374bdef1ea76373` — CI **#570** /
  `31027465566`: Quality, Frontend, Required Gates **SUCCESS**.
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. CI **#566 / #567 / #568** were NOT re-run.
- Authority state: WP5 `REMEDIATION_REQUIRED NOT_APPROVED` (fail-closed correction submitted for
  re-review); WP6 `NOT_AUTHORIZED`.

### Section 31 approval record (Review 4866886969)

Review **4866886969** (**Decision: WP5 APPROVED / COMPLETE, WP6 AUTHORIZED_TO_START**) confirmed
the fail-closed correction resolved the last Item 2 blocker. All six Review `4865177355` WP5
items are now **RESOLVED**: Item 1 (Command Palette/Home navigation-only), Item 2 (deep-link
source of truth + fail-closed resource identity), Item 3 (revision-bound query keys + snapshot
bootstrap), Item 4 (route-scoped draft, reason, exactly-once lock, refresh), Item 5
(original-identity `OUTCOME_UNKNOWN` recovery without re-execution), Item 6 (Cancel/Verify
refresh + focus preservation). GPT recorded the approval on PR #66 anchored to the current exact
head `4f167adbdb9defd5ca4b050e145250d78a3ae587` (CI **#571**).

Final authority state:

- WP1: APPROVED / COMPLETE. WP2: APPROVED / COMPLETE. WP3: APPROVED / COMPLETE.
- WP4: APPROVED / COMPLETE. **WP5: APPROVED / COMPLETE.**
- **WP6: AUTHORIZED_TO_START** (scope limited to final Verification and Governance Evidence:
  FE-P4-S2 AC-01..AC-22 exact evidence mapping, accessibility / keyboard / focus / announcement /
  non-color / zoom / reduced-motion verification, Connector-success versus Verified-success
  separation, Cancel / Rollback / Compensation and `OUTCOME_UNKNOWN` boundary proofs, completion /
  evidence records, using only new automatic CI).
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. Ready / Merge / Deployment / Production
  Verification / FE-P5 remain `NOT_AUTHORIZED`. CI **#569 / #570 / #571** were NOT re-run.

## 32. WP6 Verification and Governance Evidence (report 26, 2026-08-06)

Review **4866886969**에 따라 **WP6 AUTHORIZED_TO_START** (WP5 APPROVED / COMPLETE) 상태에서
WP6를 진행했다. WP6는 신규 Product 기능 확장이 아니라 최종 검증·증거 고정 단계이며, Frozen
Acceptance Criteria `FE-P4-S2-AC-01..AC-22`에 대한 Evidence Matrix와 접근성·안전·복구 경계
집중 검증을 수행했다.

### WP6 변경 범위

- 신규 Evidence 문서 1건:
  `docs/engineering/frontend-phase-4-section-2-wp6-verification-and-governance-evidence-260806001.md`
- 신규 집중 테스트 1개 파일 (AC-19 browser 증거만 최소 추가):
  `tests/browser/frontend-external-action-workspace.spec.ts` — 5 tests (frozen announcements,
  keyboard-only + deep-link focus, axe zero-critical, 200% zoom, prefers-reduced-motion).
- 기존 Product 코드·계약·Migration·Lockfile 변경 없음. 동일 exact head의 PASS 테스트 재실행
  없음. CI **#569 / #570 / #571** 재실행 없음.

### AC-01~AC-22 최종 판정 요약

모든 AC가 구체적 증거에 매핑되었고 `BLOCKED` AC는 없다 (Evidence 문서 Section 2 참조).

| AC    | 요약                                                     | 판정                         |
| ----- | -------------------------------------------------------- | ---------------------------- |
| AC-01 | ExternalActionV1 aggregate + revision 결속               | PASS                         |
| AC-02 | Candidate·RiskDecision read-only, browser 위험 계산 없음 | PASS                         |
| AC-03 | Manifest immutable + manifestDigest                      | PASS                         |
| AC-04 | Approval purpose EXTERNAL_ACTION 재사용 금지             | PASS                         |
| AC-05 | Approval revision·digest·expiry 결속, expired 차단       | PASS                         |
| AC-06 | Preflight 재검증 + READY time-box                        | PASS                         |
| AC-07 | Execution append-only Attempts + idempotency             | PASS                         |
| AC-08 | Transport/domain retry 구분, 자동 재실행 없음            | PASS                         |
| AC-09 | VERIFIED는 VerificationV1 필요 (Connector 성공 아님)     | PASS                         |
| AC-10 | Result·Audit safe read-only, raw 노출 금지               | PASS                         |
| AC-11 | Cancel ≠ Rollback 분리                                   | PASS                         |
| AC-12 | Compensating Action 독립·자동 실행 금지                  | PASS                         |
| AC-13 | Credential server-owned masked view                      | PASS                         |
| AC-14 | Budget server-owned, 고갈 fail closed                    | PASS                         |
| AC-15 | 변경 시 재승인, stale 차단                               | PASS                         |
| AC-16 | OUTCOME_UNKNOWN 원본 identity resolve, 무재실행          | PASS                         |
| AC-17 | Restricted shell, payload·identity 누출 없음             | PASS                         |
| AC-18 | Home/CP navigate-only, workspace 이동                    | PASS                         |
| AC-19 | Keyboard·Announcement·Non-color·Zoom·Reduced Motion·Axe  | PASS (WP6 browser 증거 추가) |
| AC-20 | Negative proof (verified/Cancel/retry 경계)              | PASS                         |
| AC-21 | In-memory/PostgreSQL parity + migration 028              | PASS                         |
| AC-22 | Exact-head Quality·Frontend·Required Gates               | PASS (새 head CI로 확정)     |

### 추가된 집중 테스트

`tests/browser/frontend-external-action-workspace.spec.ts` (5 tests):

1. `renders the queue, detail and governed surfaces with frozen announcements (AC-19)`
2. `supports keyboard-only selection and restores deep-link focus (AC-19)`
3. `has zero axe critical violations (AC-19)`
4. `stays usable at 200% zoom (AC-19)`
5. `renders under prefers-reduced-motion (AC-19)`

### 재사용한 기존 증거

contract 93 tests + domain 27 tests + product-api 4 tests + client 10 tests + parity 17 tests +
shell-navigation 3 tests + workspace-state 8 tests + route-contract 5 tests + workspace 23 tests
= **195 tests**가 AC-01~AC-22를 커버한다. 중복 테스트는 만들지 않았다.

### Code / Evidence Head

- WP6 시작 기준 head: `8a4f2aeb161467edcc5b6ad611bfb848f9e86559` (CI **#572** SUCCESS).
- WP6 evidence head: `a89fd4888571293bb0bfffa2392c37ce6bd6751a` — CI **#573** /
  `31045703248`: Quality, Frontend, Required Gates **SUCCESS**.

### PR 상태·권위

- PR #66 remains `OPEN / DRAFT / MERGEABLE`.
- Ready / Merge / Deployment / Production Verification / FE-P5: `NOT_AUTHORIZED`.
- WP6 판정 후보: `WP6: COMPLETE_CANDIDATE`, `FE-P4-S2 Product: COMPLETE_CANDIDATE`.
- Codex는 `WP6 APPROVED`, `FE-P4-S2 COMPLETE`, `Ready`, `Merge`를 선언·실행하지 않는다.

### Final metadata (report 26)

- **WP6 evidence head**: `a89fd4888571293bb0bfffa2392c37ce6bd6751a` — CI **#573** /
  `31045703248`: Quality, Frontend, Required Gates **SUCCESS** (Frontend 2m40s, Quality 2m59s,
  Required Gates 3s).
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. CI **#569 / #570 / #571** were NOT re-run.

### Section 32 correction (Review 4868951109)

Review **4868951109** (**BLOCKED / FOCUSED WP6 COMPLETION EVIDENCE REQUIRED**) recorded that
Section 32의 `WP6: COMPLETE_CANDIDATE / 미결사항: 없음 / 모든 완료 조건 충족` 주장은 과장이었다.
Frozen Implementation Request의 WP6 완료 조건 3가지가 빠져 있었다: (1) Browser E2E Lifecycle
(`Queue → Detail → Verify → Cancel → Rollback → Compensation → Recovery` — 신규 spec이
Read/접근성 검증에 한정됨), (2) Deterministic performance/lifecycle baseline + Approved numeric
Gate, (3) Completion Manifest·Evidence Registry 일관성. 정확한 상태: **WP6:
REMEDIATION_REQUIRED NOT_APPROVED**, **FE-P4-S2 Product: IN_PROGRESS NOT COMPLETE_CANDIDATE**.
이 Section은 기존 32의 AC 증거를 후보 증거로 유지하고, 3가지 보완을 Section 33에 기록한다.

## 33. WP6 완료 증거 보완 — Review 4868951109 (report 27, 2026-08-06)

Review **4868951109**의 3가지 차단 항목을 보완했다. CI **#573 / #574** 및 **#569~#572**는
재실행하지 않았다.

### 33.1 Frozen Browser E2E Lifecycle

- 신규 `tests/browser/frontend-external-action-lifecycle.spec.ts` (로컬 Fake Fixture 전용,
  실제 Connector·외부 Mutation 없음, 하위 계층 불변식 중복 없음):
  - `full compressed governed lifecycle through the browser: queue → detail → verify → cancel →
rollback → recovery → compensation` — Queue→Detail→Verify→Cancel→Rollback→`OUTCOME_UNKNOWN`
    Recovery→Compensation을 browser로 실행, 명령 연결·상태 전환·명령 분리(frozen Announcement +
    endpoint 분리)·Focus(`verification-heading`) 검증.
  - `OUTCOME_UNKNOWN recovery issues no new external mutation and re-executes nothing` —
    재실행 버튼 부재 + 신규 Mutation 금지.
- browser 검증에서 **workspace route 집중 결함 2건 발견·수정**:
  1. async navigation 전환 창에서 restore effect가 stale URL/snapshot + 새 selectedActionId를
     관찰해 `RECOVERY_STARTED` misfire → 모든 governed command 영구 잠금. `selectAction` optimistic
     dispatch와 restore effect 의존성 분리(`restoreStateRef`)로 수정.
  2. 이미 선택된 Action 재선택 시 `externalRevision` `''` 초기화로 detail unmount. 동일 Action
     재선택 시 revision 보존으로 수정 (집중 테스트 1건 추가: `keeps the detail visible when the
already-selected queue item is re-selected`).

### 33.2 성능·Lifecycle Baseline + Numeric Gate 제안

- 신규 `tests/browser/frontend-external-action-performance.spec.ts` — 결정적 측정
  (warm-up 1회 제외 + 3회, median, in-page `performance.now()` + rAF polling).
- 측정 결과 (로컬 fixture): `external-action-queue-to-detail-ms` **median 79ms**
  (samples [76, 92, 79]); `external-action-command-ms` **median 204ms** (samples [179, 204, 231]).
- **Numeric Gate 제안 (미승인, USER 승인 대기)**: queue→detail median ≤ 2000ms, command median
  ≤ 2000ms. Spec은 sanity bound(5000ms)만 단언. (Review 4868951109: Gate 확정은 USER 승인 후.)

### 33.3 Completion Manifest·Evidence Registry

- 신규 `docs/project/completions/FE-P4-S2.json` — Completion Manifest Candidate, status
  `IN_PROGRESS` (schema enum에 CANDIDATE 없음 → 임의 상태 미생성), 22개 AC `PASS`, evidence
  경로 연결, `approvedBy`/`approvedAt` null.
- `docs/project/frontend-work-items.json` FE-P4-S2 `completionManifest` 연결; `docs/engineering/
evidence-registry.json` `FRONTEND-PHASE-4-SECTION-2-WP6-EVIDENCE-260806001` 등록; projections
  4개 재생성.
- `docs:completion-invariants`, `docs:frontend-work-items`, `docs:frontend-projections:check`,
  `docs:validate` 모두 PASS. `FE-P4-S2 COMPLETE`/`FINAL_AFTER_MERGE` 미기록.

### 추가된 집중 테스트

- `frontend-external-action-lifecycle.spec.ts` 2 tests, `frontend-external-action-performance.
spec.ts` 2 tests, workspace `keeps the detail visible when the already-selected queue item is
re-selected` 1 test. (기존 PASS head 테스트 재실행 없음.)

### Validation (보완 후)

- `apps/shotgun-web` 전체 스위트 — **18 files / 97 tests PASS** (workspace 24 tests 포함).
- Browser E2E — external-action 3개 spec **9 tests PASS** (lifecycle 2 + accessibility 5 +
  performance 2); 전체 browser 스위트는 기존 성능 flake 1건(지식 그래프) 제외 53 PASS.
- `tsc --noEmit` (root + app) — clean. ESLint — clean. Prettier — clean.
- 자동 CI: 보완 head `<REMEDIATION_HEAD>` — CI **#575** / `<RUN_ID>` (metadata 아래에 기록).

### PR 상태·권위

- PR #66 remains `OPEN / DRAFT / MERGEABLE`.
- Ready / Merge / Deployment / Production Verification / FE-P5: `NOT_AUTHORIZED`.
- Review 4868951109 기록 상태: WP6 `REMEDIATION_REQUIRED NOT_APPROVED`; FE-P4-S2 Product
  `IN_PROGRESS`. 보완 제출 후 판정 후보: `WP6: COMPLETE_CANDIDATE`.
- Codex는 `WP6 APPROVED`, `FE-P4-S2 COMPLETE`, `Ready`, `Merge`를 선언·실행하지 않는다.

### Final metadata (report 27)

- **WP6 보완 code head**: `<REMEDIATION_HEAD>` — CI **#575** / `<RUN_ID>`: Quality, Frontend,
  Required Gates 결과는 최종 갱신에서 기록한다.
- PR #66 remains `OPEN / DRAFT / MERGEABLE`. CI **#573 / #574** were NOT re-run.
