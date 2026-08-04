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
