---
id: FRONTEND-PHASE-4-SECTION-2-IMPLEMENTATION-REQUEST-260805001
classification: IMPLEMENTATION_REQUEST
status: AUTHORIZED
revision: 1
work_item: FE-P4-S2
canonical_base: 5f7c3b6f7fb1b6114272fe31c2561a7f21cb124f
branch: codex/frontend-phase-4-section-2-contract-preparation
tracking_issue: 65
draft_pr: 66
governing_adr: ADR-110
accepted_adr: ADR-129
proposed_adr: null
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-4-section-2/frontend-phase-4-section-2-contract-snapshot-260805001.md
implementation_authorized: true
authorized_by: USER
authorized_at: 2026-08-05T03:50:22+09:00
---

# FE-P4-S2 External Action Governance and Execution — Authorized Implementation Request

## 1. Request status

ADR-129, Contract Snapshot revision 1, AC-01 through AC-22 and this Implementation Request are
approved by the user. FE-P4-S2 Product implementation and Migration 028 are authorized to start.

Ready, Merge, deployment, production verification, FE-P5 and any real Connector enablement remain
unauthorized.

## 2. Objective

Implement a server-authoritative External Action Governance and Execution product over the frozen
lifecycle `Validation → ActionCandidate → Risk Decision → Preview·Manifest → Approval → Preflight →
Execute → Verify → Result·Audit` such that:

- External Actions are typed Product resources (`EXTERNAL_ACTION` aggregate with concrete
  Preflight, Execution, Verification and Compensation kinds);
- Executions own ordered, append-only Execution Attempts with per-attempt idempotency and
  correlation/causation;
- approval is purpose-specific (`EXTERNAL_ACTION`) and bound to an exact manifest, target and
  policy;
- preflight revalidates permission, credential, budget, policy, target state and external revision
  after approval;
- `VERIFIED` requires target-state verification, never Connector/HTTP success alone;
- `OUTCOME_UNKNOWN` resolves by original command identity and never auto-reruns;
- Cancel, Rollback and Compensating Action are separate governed resources and never automatic;
- credentials and budgets are server-owned and safely masked;
- an accessible governance workspace provides safe masking, access-loss and recovery UX.

## 3. Work packages

### WP1 — Contract and decoder implementation

- Add `packages/contracts/src/frontend-external-action.ts`.
- Export exhaustive V1 aggregate, candidate, risk decision, manifest, approval, preflight,
  execution, attempt, verification, result, audit, compensating action and rollback contracts
  (per Contract Snapshot section 2).
- Add strict request and response decoders with unknown-field rejection and `schemaVersion
'1.0.0'`.
- Add cross-field invariants for Project, action revision, manifest digest, target revision,
  external revision, approval purpose and attempt ordering.
- Register the new typed failure reasons (Contract Snapshot section 13) in the shared registry.
- Add contract tests organized by operation.

### WP2 — External Action domain and persistence

- Add `modules/frontend-external-action` as a Product domain module over the Stage 11 engine via a
  structural port (never exposing Stage 11 records or DB IDs).
- Add immutable manifest revisions, risk decision reuse, purpose-specific approval issuance,
  preflight revalidation, execution/attempt lifecycle, verification, cancel, rollback and
  compensating-action entry points.
- Add execution-attempt and compensating-action repositories and in-memory adapters.
- Add credential mask and budget repository ports.
- Use the existing Frontend Command Ledger for acceptance and outcome resolution.

### WP3 — Migration 028 and PostgreSQL parity

- Add `028_frontend_external_action_product.sql` (bounded, additive) for execution attempts,
  compensating actions and product binding columns.
- Preserve append-only and immutable constraints; register in managed schemas and rollback.
- Add PostgreSQL adapters and parity tests.
- Do not rewrite Stage 11 tables.

### WP4 — Protected Product API and client

- Add protected routes under `/product-api/frontend/external-action/*` (queue, aggregate, manifest,
  risk decision, preflight, execution, attempts, verification, result, audit, approvals, outcome
  resolution).
- Add governed write routes for validate, prepare manifest, approve, preflight, execute, retry,
  verify, cancel, rollback and prepare compensation.
- Derive Principal, Resource Project, access, policy, capability, credential and budget on the
  Server.
- Add `FrontendExternalActionClient` with strict decoding, CSRF handling, 403 refresh behavior,
  `AbortSignal` and no mutation auto-retry.

### WP5 — Browser state and governance workspace

- Add a governed External Action workspace reachable from Home/Command Palette navigation (never
  direct execution).
- Add route and deep-link contract for action, manifest, execution, attempt and verification
  selection.
- Add query-key factory with Project, access, policy, action revision and external revision.
- Add route-scoped Browser Draft State Machine for pending drafts (ADR-119).
- Add bounded queue, aggregate summary, risk decision, manifest, preflight, execution attempts,
  verification, result, audit and recovery states.
- Add Cancel (abort), Rollback (separate) and Compensating Action (governed) surfaces with
  explicit non-automatic behavior.
- Add safe masking, access-loss restricted shells and `OUTCOME_UNKNOWN` recovery (resolve by
  original identity; never a re-execute button).
- Preserve focus on deep-link restore, refresh, cancel and verification.

### WP6 — Verification and governance evidence

- Unit, contract, integration and database parity tests.
- Security and hidden-resource negative matrix (no secret/raw payload leak, no auto-retry, no
  Cancel-as-Rollback, no HTTP-success verification).
- Browser E2E for queue, detail, manifest/approval, preflight, execute, verify, cancel, rollback,
  compensation and recovery.
- Accessibility evidence: keyboard, screen reader, non-color cues, 200% zoom, reduced motion, axe
  zero-critical.
- Deterministic performance/lifecycle baseline and an approved numeric Gate.
- Verification record, Completion Report, Completion Manifest and Evidence Registry entry.

## 4. Required implementation properties

1. No browser authority for Actor, Project, Capability, policy, credential or budget.
2. No automatic mutation retry and no automatic re-execution after timeout or `OUTCOME_UNKNOWN`.
3. No second command ledger.
4. No destructive Stage 11 migration.
5. No unbounded action queue or attempt listing.
6. No Connector/HTTP success as verified success.
7. No cross-purpose Approval reuse and no cross-action approval reuse.
8. No assumption that Cancel is Rollback and no assumed Rollback availability.
9. No automatic Compensating Action.
10. No secret, raw provider payload, prompt or credential in command payloads, outcomes, audit,
    results or browser views.
11. No hidden resource leakage through counts, edges, descriptions or announcements.

## 5. Migration and dependency authority

- Database migration: `028_frontend_external_action_product.sql` is proposed as part of FE-P4-S2
  Product implementation; not authorized and not implemented during preparation.
- New runtime dependency: not authorized unless a later reviewed need is proven and separately
  approved. Real Connector integration is out of scope.
- Lockfile change: not expected and not authorized without explanation.
- Canonical knowledge schema change: none.

## 6. Test execution policy

Run only tests required by changed scope and the repository's automatic required CI.

- Do not rerun tests on an exact Head that already passed.
- Do not add manual duplicate CI.
- Preserve all failed attempts and corrections.
- Use focused checks during development, then one full required exact-head validation.
- Treat automatic GitHub Actions on each new commit as the remote authority for that Head.

## 7. Completion boundary

FE-P4-S2 completion requires all frozen FE-P4-S2-AC-01 through FE-P4-S2-AC-22 to pass, exact-head
Quality/Frontend/Required Gates to pass, Completion Manifest and Evidence Registry consistency,
user approval of Product completion, separate Ready/Merge authorization, post-merge main CI, and a
post-merge Governance Closure recording `FINAL_AFTER_MERGE`.

Deployment and production verification remain separate.

## 8. Explicit exclusions

- Real Connector execution or external target mutation;
- any database migration implementation during preparation;
- automatic retry or automatic compensating action;
- treating Cancel as Rollback;
- treating Connector/HTTP success as verified success;
- FE-P5;
- deployment and production verification;
- Ready and Merge without separate authorization.

## 9. Authorization

The user accepted ADR-129, approved Contract Snapshot revision 1 (FE-P4-S2-AC-01 through AC-22),
this Implementation Request, FE-P4-S2 Product implementation entry and Migration 028 at
`2026-08-05T03:50:22+09:00`.
