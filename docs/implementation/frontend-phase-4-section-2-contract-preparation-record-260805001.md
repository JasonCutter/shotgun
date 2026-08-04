---
id: FRONTEND-PHASE-4-SECTION-2-CONTRACT-PREPARATION-260805001
classification: IMPLEMENTATION_PREPARATION_RECORD
status: APPROVED_FOR_PRODUCT_IMPLEMENTATION
work_item: FE-P4-S2
canonical_base: 5f7c3b6f7fb1b6114272fe31c2561a7f21cb124f
tracking_issue: 65
draft_pr: 66
prepared_head: 1789456c1e15c7dcbdd5f68f6a23272dabf15d51
approval_authority: USER
approved_at: 2026-08-05T03:50:22+09:00
implementation_authorized: true
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

FE-P4-S2-AC-01 through FE-P4-S2-AC-22 are approved and frozen for FE-P4-S2 Product implementation
(2026-08-05). ADR-129 is ACCEPTED; no AC is blocked.

## 4. ADR decision

A new ADR is required: **ADR-129 ACCEPTED** (External Action Product Resource, Attempt, Credential,
Budget and Compensation Boundary) by user on `2026-08-05T03:50:22+09:00`.

## 5. Migration decision

A database migration is required for Product implementation: **`028_frontend_external_action_product.sql`**
(bounded, additive) — **AUTHORIZED within the FE-P4-S2 scope** by user on `2026-08-05`. The
implementation must not rewrite Stage 11 tables.

## 6. Current authority

- ADR-129: **ACCEPTED** by user on `2026-08-05T03:50:22+09:00`.
- Contract Snapshot revision 1: **APPROVED / FROZEN**.
- FE-P4-S2-AC-01..AC-22: **FROZEN / BINDING**.
- Implementation Request revision 1: **AUTHORIZED**.
- FE-P4-S2 Product implementation: **AUTHORIZED**.
- Migration 028: AUTHORIZED within the FE-P4-S2 scope (bounded additive).
- Ready and Merge: NOT_AUTHORIZED.
- Deployment and Production Verification: NOT_STARTED / NOT_RUN.
- FE-P5: NOT_AUTHORIZED.

## 6b. Exact-head validation evidence

Preparation exact Head `1789456c1e15c7dcbdd5f68f6a23272dabf15d51` triggered automatic CI #510
(run `30939040759`).

- Quality: PASS.
- Frontend: PASS.
- Required Gates: PASS.
- No manual duplicate CI was triggered.

## 7. Next step

The user accepted ADR-129, approved Contract Snapshot revision 1 and the Implementation Request,
and authorized FE-P4-S2 Product implementation and Migration 028 on `2026-08-05T03:50:22+09:00`.
Product implementation continues on this branch and Draft PR #66.
