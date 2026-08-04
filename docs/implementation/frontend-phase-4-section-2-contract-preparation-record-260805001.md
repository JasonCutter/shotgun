---
id: FRONTEND-PHASE-4-SECTION-2-CONTRACT-PREPARATION-260805001
classification: IMPLEMENTATION_PREPARATION_RECORD
status: PREPARATION_COMPLETE_PENDING_USER_REVIEW
work_item: FE-P4-S2
canonical_base: 5f7c3b6f7fb1b6114272fe31c2561a7f21cb124f
tracking_issue: 65
draft_pr: 66
prepared_head: <PREPARATION_HEAD>
approval_authority: USER
approved_at: null
implementation_authorized: false
---

# FE-P4-S2 External Action Governance and Execution — Contract Preparation Record

## 1. Prepared artifacts

- Gap Audit:
  `docs/engineering/frontend-phase-4-section-2-external-action-gap-audit-260805001.md`
- Proposed ADR-129:
  `docs/architecture/adr/ADR-129-external-action-product-resource-attempt-credential-budget-and-compensation-boundary.md` (PROPOSED)
- Contract Snapshot revision 1:
  `docs/architecture/contracts/snapshots/frontend-phase-4-section-2/frontend-phase-4-section-2-contract-snapshot-260805001.md` (PROPOSED_PENDING_USER_REVIEW)
- Implementation Request revision 1:
  `docs/implementation/frontend-phase-4-section-2-implementation-request-260805001.md` (PROPOSED)
- Preparation Verification:
  `docs/engineering/frontend-phase-4-section-2-contract-preparation-verification-260805001.md`

## 2. Proposed decisions

1. `EXTERNAL_ACTION` is the Product Operational Resource aggregate; Preflight, Execution,
   Verification and Compensation are concrete kinds (ADR-110 / phase-4 canonical).
2. Execution owns an ordered, append-only `ExecutionAttemptV1` list with per-attempt idempotency
   and correlation/causation (ADR-101).
3. `ExternalActionApprovalV1` has purpose `EXTERNAL_ACTION` and is never reused across purposes or
   actions.
4. Approval binds manifest revision, manifest digest, target revision, target digest, external
   revision, policy context and expiry; change or expiry requires re-approval.
5. Preflight revalidates permission, credential, budget, policy, target state and external revision.
6. `VERIFIED` requires target-state verification; Connector/HTTP success alone is insufficient.
7. Cancel is an abort request; Rollback is a separate governed command; Compensating Action is an
   independent governed External Action; none is automatic.
8. Credentials and execution budgets are server-owned and never reach the browser beyond masked
   views and typed capabilities.
9. `OUTCOME_UNKNOWN` resolves by original command identity and never auto-reruns.
10. A bounded additive migration `028_frontend_external_action_product.sql` is proposed for Product
    implementation (attempts, compensation, product bindings); not implemented in preparation.
11. The governance workspace is accessible with safe masking, access-loss restricted shells and
    recovery UX.

## 3. Frozen Acceptance Criteria

FE-P4-S2-AC-01 through FE-P4-S2-AC-22 are proposed in Contract Snapshot revision 1 and become
frozen for FE-P4-S2 Product implementation only after user approval. AC-03, AC-06, AC-07, AC-11,
AC-12, AC-13, AC-14, AC-15, AC-16 are blocked until ADR-129 is accepted.

## 4. ADR decision

A new ADR is required: **ADR-129 proposed** (External Action Product Resource, Attempt, Credential,
Budget and Compensation Boundary). ADR-110 governs the lifecycle boundary but does not decide the
durable Product representation. ADR-129 is PROPOSED and awaits user acceptance.

## 5. Migration decision

A database migration is required for Product implementation: **`028_frontend_external_action_product.sql`**
(bounded, additive). The existing Stage 11 tables (011/013) lack execution attempts, compensating
actions and product binding columns. The migration is proposed only and is not implemented during
preparation.

## 6. Current authority

- ADR-110: accepted (governing). ADR-129: proposed, not accepted.
- Contract Snapshot revision 1: proposed, not approved.
- FE-P4-S2-AC-01..AC-22: proposed, not frozen.
- Implementation Request revision 1: proposed, not authorized.
- FE-P4-S2 Product implementation: NOT_AUTHORIZED.
- Migration 028: not authorized, not implemented.
- Ready and Merge: NOT_AUTHORIZED.
- Deployment and Production Verification: NOT_STARTED / NOT_RUN.
- FE-P5: NOT_AUTHORIZED.

## 7. Next step

The user must decide: accept ADR-129, approve Contract Snapshot revision 1 and the Implementation
Request, and authorize FE-P4-S2 Product implementation. Until then this branch remains a
preparation-only Draft PR.
