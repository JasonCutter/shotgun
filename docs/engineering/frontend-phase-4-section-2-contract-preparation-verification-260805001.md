# FE-P4-S2 Contract Preparation Verification

- Record ID: `frontend-phase-4-section-2-contract-preparation-verification-260805001`
- Record class: `ARCHITECTURE_VERIFICATION`
- Date: 2026-08-05 (revision 1)
- Repository: `JasonCutter/shotgun`
- Scope: Frontend Phase 4 Section 2 — External Action Governance and Execution
- Result: **PREPARATION COMPLETE — AWAITING USER REVIEW** (ADR-129 PROPOSED / CONTRACT SNAPSHOT revision 1 PROPOSED / IMPLEMENTATION REQUEST revision 1 PROPOSED / PRODUCT IMPLEMENTATION NOT_AUTHORIZED)
- Product implementation: **NOT_AUTHORIZED**
- Canonical authority: GitHub `main`

## 1. Approved work boundary

The user requested FE-P4-S2 contract preparation only:

```text
Start FE-P4-S2 (branch, tracking issue, Draft PR, registry IN_PROGRESS, projections)
→ Audit existing assets (preparation only)
→ Gap Audit
→ Exact typed resource model (ActionCandidate, Risk Decision, Action Manifest,
   External Action Approval, Preflight, Execution, Execution Attempt, Verification,
   Result, Audit, Compensating Action)
→ Operation and failure contracts
→ Server/client authority and Project/target binding rules
→ Capability, policy, credential, budget, external revision, idempotency boundaries
→ Manifest digest, target revision, approval expiry, stale state, reapproval rules
→ OUTCOME_UNKNOWN resolution without automatic re-execution
→ Target-state verification contract (Connector/HTTP success is not verified success)
→ Cancel / Rollback / Compensating Action separation
→ Safe masking, access-loss, recovery and accessible workspace contracts
→ Numbered, objective Acceptance Criteria frozen before implementation
→ Executable English Implementation Request
→ Contract-preparation verification and Evidence Registry records
→ Frontend Work Item Registry transition FE-P4-S2 -> IN_PROGRESS and projection regeneration
→ Draft PR linked to issue #65
```

The request did not authorize Product implementation, real Connector execution, external target
mutation, database migration implementation, new runtime dependencies, FE-P5, Ready, Merge,
Deployment or Production Verification.

## 2. Prepared records

- Gap Audit:
  `docs/engineering/frontend-phase-4-section-2-external-action-gap-audit-260805001.md`
- Proposed ADR-129:
  `docs/architecture/adr/ADR-129-external-action-product-resource-attempt-credential-budget-and-compensation-boundary.md`
- Contract Snapshot revision 1:
  `docs/architecture/contracts/snapshots/frontend-phase-4-section-2/frontend-phase-4-section-2-contract-snapshot-260805001.md`
- Implementation Request revision 1:
  `docs/implementation/frontend-phase-4-section-2-implementation-request-260805001.md`
- Contract Preparation Record:
  `docs/implementation/frontend-phase-4-section-2-contract-preparation-record-260805001.md`
- This Preparation Verification record.
- Registry update: `docs/project/frontend-work-items.json` — `FE-P4-S2` set to `IN_PROGRESS`;
  `FE-P4` remains `IN_PROGRESS`.
- Regenerated status projections (generator): `docs/architecture/frontend/README.md`,
  `docs/architecture/frontend/phase-2-knowledge-input-question.md`,
  `docs/implementation/frontend-phase-1-5-plan-v1.0.md`, `docs/architecture/add/README.md`.

## 3. ADR boundary decision

Decision: **NEW_PROPOSED_ADR_REQUIRED — ADR-129**.

ADR-110 fixes the lifecycle boundary; ADR-091/093/094 fix the Stage 11 internal flow; ADR-101,
ADR-105, ADR-109 and FE-P4-S1 fix the shared command, policy and approval surface. The FE-P4-S2
Product resource model (Product `EXTERNAL_ACTION` aggregate with concrete kinds, execution attempts,
credential and budget boundaries, and the Product separation of Cancel, Rollback and Compensating
Action) is a genuinely new server-side decision not covered by an existing ADR.

ADR-129 is created as **PROPOSED** (not accepted) and records the exact user decision required.
Blocked Acceptance Criteria until acceptance: FE-P4-S2-AC-03, AC-06, AC-07, AC-11, AC-12, AC-13,
AC-14, AC-15, AC-16.

## 4. Migration decision

Decision: **MIGRATION_REQUIRED_FOR_PRODUCT_IMPLEMENTATION — `028_frontend_external_action_product.sql`**
(bounded, additive, not implemented in preparation).

Migrations 011/013 cover candidates, previews, approval records, executions and audit. They lack
execution attempts, compensating actions and product binding columns required by the proposed
Product model. The migration is proposed only and is not implemented during preparation.

## 5. Contract snapshot status

The Contract Snapshot is a `PROPOSED_PENDING_USER_REVIEW` proposal, revision 1. It preserves
ADR-110 and freezes:

- the exact typed Product resource model (`ExternalActionV1` aggregate, `ActionCandidateV1`,
  `RiskDecisionV1`, `ActionManifestV1`, `ExternalActionApprovalV1`, `PreflightV1`, `ExecutionV1`,
  `ExecutionAttemptV1`, `VerificationV1`, `ResultV1`, `ActionAuditEventV1`, `CompensatingActionV1`,
  `RollbackV1`);
- operation and failure contracts;
- server/client authority and Project/target binding rules;
- capability, policy, credential, budget, external-revision and idempotency boundaries;
- manifest digest, target revision, approval expiry, stale-state and re-approval rules;
- `OUTCOME_UNKNOWN` resolution without automatic re-execution;
- target-state verification (Connector/HTTP success is not verified success);
- Cancel / Rollback / Compensating Action separation;
- safe masking, access-loss, recovery and accessible workspace contracts;
- numbered Acceptance Criteria FE-P4-S2-AC-01 through FE-P4-S2-AC-22;
- persistence and migration decision;
- authorization boundary.

## 6. Focused validation

Focused checks were run on the changed contract and governance files only (per validation rules;
tests already passing on the same exact head were not rerun):

- `npm run docs:validate` — passed;
- `npm run docs:completion-invariants` — passed;
- `npm run docs:frontend-projections:check` — passed (projections regenerated);
- `npm run docs:adr-index` — passed (ADR-129 registered).

Automatic CI on the final preparation head is the remote authority for that Head and is reported in
the Contract Preparation Record.

## 7. Current authority

- ADR-129: PROPOSED (not accepted). Contract Snapshot r1: PROPOSED (not approved).
- FE-P4-S2-AC-01..AC-22: proposed (not frozen). Implementation Request r1: PROPOSED (not authorized).
- FE-P4-S2 Product implementation: NOT_AUTHORIZED.
- Migration 028: not authorized, not implemented.
- Ready / Merge: NOT_AUTHORIZED. Deployment / Production Verification: NOT_STARTED / NOT_RUN.
- FE-P5: NOT_AUTHORIZED.
