---
id: FRONTEND-PHASE-4-SECTION-2-CONTRACT-SNAPSHOT-260805001
classification: PRODUCT_CONTRACT_SNAPSHOT
status: PROPOSED_PENDING_USER_REVIEW
revision: 1
review_round: 1
review_result: PENDING
approved_by: null
approved_at: null
work_item: FE-P4-S2
governing_adr: ADR-110
accepted_adr: ADR-110
proposed_adr: ADR-129
base_commit_requested: 5f7c3b6f7fb1b6114272fe31c2561a7f21cb124f
branch: codex/frontend-phase-4-section-2-contract-preparation
implementation_authorized: false
---

# FE-P4-S2 Contract Snapshot — External Action Governance and Execution v1

## 1. Scope

This snapshot freezes the FE-P4-S2 Product contract for governed External Actions over the frozen
lifecycle:

```text
Validation → ActionCandidate → Risk Decision → Preview·Manifest → Approval → Preflight →
Execute → Verify → Result·Audit
```

It defines exact typed Product resources, operations, failures, authority, binding, capability,
policy, credential, budget, external-revision, idempotency and re-approval boundaries, target-state
verification, `OUTCOME_UNKNOWN` recovery, and the separation of Cancel, Rollback and Compensating
Action.

It excludes real Connector execution, external target mutation, database migration implementation,
FE-P5, deployment and production verification. Stage 11 internals and DB IDs are never exposed as
Product contracts.

## 2. Product resource model

### 2.1 `ExternalActionV1` (aggregate)

A stable `actionId` and immutable numbered `actionRevision` identify the aggregate. Required
identity fields:

- `schemaVersion: '1.0.0'`;
- `actionId`; `actionRevision`;
- `targetKind` (`KNOWN_TARGET` only in V1); `targetId`; `targetRevision`; `externalRevision`;
- `resourceProjectId`; `effectiveProjectId`;
- `accessRevision`; `policyContextRevision`;
- `operation` (`PREVIEW_ONLY` | `CREATE_DRAFT` | `UPDATE_REVERSIBLE` | `PUBLISH_OR_DELETE` |
  `FINANCIAL_OR_LEGAL`);
- `riskDecisionRef`; `manifestRef`; `approvalRef?`;
- `status`: one of the aggregate statuses below;
- `capabilities`: typed capabilities for the current scope.

Aggregate statuses (server-owned, ordered): `CANDIDATE_VALIDATED` | `MANIFEST_READY` |
`APPROVED` | `PREFLIGHT_READY` | `PREFLIGHT_FAILED` | `READY_TO_EXECUTE` | `EXECUTING` |
`OUTCOME_UNKNOWN` | `FAILED` | `CANCELLING` | `CANCELLED` | `VERIFYING` | `VERIFIED` |
`VERIFICATION_FAILED` | `ROLLBACK_AVAILABLE` | `ROLLING_BACK` | `ROLLED_BACK` |
`COMPENSATION_REQUIRED` | `COMPENSATING` | `COMPENSATED`.

### 2.2 `ActionCandidateV1`

The validated candidate for the Product surface. Required fields: candidate identity, source refs,
`operation`, `targetRef`, `parameterRef`, `evidenceRefs`, `compensationForActionId?`, digests,
risk decision reference, generated timestamps. No raw provider payload or secret is ever included.

### 2.3 `RiskDecisionV1`

A read-only decision computed by the Server from the risk policy. Fields: `riskLevel` (`R0`–`R4`),
`policyVersion`, `requiresUserApproval`, `reasons[]`. The browser never computes or asserts it.

### 2.4 `ActionManifestV1`

The immutable manifest that approval and execution bind to. Fields:

- `schemaVersion: '1.0.0'`; `manifestId`; `manifestRevision`; `actionId`;
- `targetId`; `targetRevision`; `targetDigest`; `externalRevision`;
- `parameterRef`; `parameterDigest`; `evidenceSetRef`; `evidenceSetDigest`;
- `payloadDigest` (computed over the exact execution payload);
- `manifestDigest` (computed over all the above);
- `expiresAt`; `createdAt`; `createdBy`.

A new manifest revision supersedes the old. Execution always pins the approved manifest revision.

### 2.5 `ExternalActionApprovalV1`

The purpose-specific approval binding. It reuses the FE-P4-S1 approval shape with a new purpose
`EXTERNAL_ACTION`. Fields include: `approvalId`, `purpose: 'EXTERNAL_ACTION'`, `actionId`,
`manifestId`, `manifestRevision`, `manifestDigest`, `targetRevision`, `targetDigest`,
`externalRevision`, `actor`, `projectId`, `accessRevision`, `policyContextRevision`, `reason`,
`issuedAt`, `expiresAt`, `status`. Knowledge and Directive approvals are never reused for external
actions, and an External Action approval is never reused for another purpose.

### 2.6 `PreflightV1`

A `PREFLIGHT` concrete-kind resource. Fields: `preflightId`, `actionId`, `manifestRevision`,
`preflightDigest`, result status (`READY` | `ALREADY_APPLIED` | `DENIED`), reasons, revalidated
permission, credential, budget, policy, target state and external revision bindings, `runAt`,
`expiresAt`. `READY` is time-boxed and expires.

### 2.7 `ExecutionV1` and `ExecutionAttemptV1`

- `ExecutionV1`: `executionId`, `actionId`, `manifestRevision`, `status`
  (`PENDING` | `IN_PROGRESS` | `SUCCEEDED` | `FAILED` | `OUTCOME_UNKNOWN` | `CANCELLED`),
  `attemptCount`, `startedAt`, `completedAt?`.
- `ExecutionAttemptV1`: `attemptId`, `attemptNumber` (1-based), `executionId`, `actionId`,
  its own `idempotencyKey`, `status` (`PENDING` | `IN_PROGRESS` | `SUCCEEDED` | `FAILED` |
  `OUTCOME_UNKNOWN` | `CANCELLED`), `policyContextRevision`, `externalRevision`, `providerRef?`,
  `correlationId`, `causationId?`, `startedAt`, `completedAt?`.

Transport retry preserves the same Request, key, digest and Attempt. Domain retry is a new Command
and new Attempt connected by Correlation and Causation.

### 2.8 `VerificationV1`

A `VERIFICATION` concrete-kind resource. Fields: `verificationId`, `actionId`, `executionId`,
`attemptId?`, `targetRevision`, `targetDigest`, `externalRevision`, result status
(`APPLIED` | `NOT_APPLIED` | `MISMATCH`), `observedDigest?`, `verifiedAt`. `VERIFIED` is reached
only when a `VerificationV1` confirms the external target state; Connector/HTTP success alone is
insufficient.

### 2.9 `ResultV1`

A read-only Product result view. Fields: `resultId`, `actionId`, `executionId`, `attemptId?`,
`externalId`, `observedDigest`, `completedAt`, `verificationRef?`, `outputRefs[]` (safe references
only). Raw provider payloads and secrets are never included.

### 2.10 `ActionAuditEventV1`

A read-only append-only audit view. Fields: `auditEventId`, `actionId`, `sequence`, `category`
(frozen 12 categories), `eventJson` (safe structured event; never raw logs, prompts, secrets or
provider payloads), `occurredAt`.

### 2.11 `CompensatingActionV1` and Rollback

- `CompensatingActionV1`: an independent `ExternalActionV1` whose candidate references
  `compensationForActionId`; it follows the full lifecycle (validation, manifest, approval if
  required, preflight, execute, verify) and is never auto-run.
- `RollbackV1`: a separate governed state-reversal resource (`rollbackId`, `actionId`, `status`,
  `manifestRef`, `approvalRef?`, `executionRef`, `verificationRef?`). Rollback is never assumed
  available and never implied by Cancel.

## 3. Operations

All Product writes are versioned `FrontendCommandRequest` commands with typed preconditions and
idempotency keys through the existing Frontend Command Ledger (ADR-101). Browser-only reads:

- `LIST_EXTERNAL_ACTIONS` (bounded queue);
- `GET_EXTERNAL_ACTION` (aggregate snapshot);
- `GET_MANIFEST`; `GET_RISK_DECISION`; `GET_PREFLIGHT`; `GET_EXECUTION`; `GET_EXECUTION_ATTEMPTS`;
  `GET_VERIFICATION`; `GET_RESULT`; `LIST_AUDIT`.

Governed writes (Server capability enforced):

- `VALIDATE_ACTION_CANDIDATE` (creates candidate + risk decision);
- `PREPARE_MANIFEST` (creates/advances manifest revision);
- `APPROVE_EXTERNAL_ACTION` (issues purpose-specific approval bound to manifest);
- `PREFLIGHT_EXTERNAL_ACTION` (revalidates and creates `PreflightV1`);
- `EXECUTE_EXTERNAL_ACTION` (creates Execution + first Attempt);
- `RETRY_EXECUTION_ATTEMPT` (new Command + new Attempt; domain retry only, never automatic);
- `VERIFY_EXTERNAL_ACTION` (creates `VerificationV1` and advances to `VERIFIED`/`VERIFICATION_FAILED`);
- `CANCEL_EXTERNAL_ACTION` (abort request; never rollback);
- `ROLLBACK_EXTERNAL_ACTION` (separate governed state reversal);
- `PREPARE_COMPENSATING_ACTION` (governed recovery as a new External Action);
- `RESOLVE_ACTION_OUTCOME` (by original command identity).

## 4. Server/client authority and binding rules

1. The Server derives Principal, Resource Project, Capability, Policy Context, credential and
   budget state; the browser never asserts them.
2. Every resource binds `resourceProjectId` and `effectiveProjectId`; cross-project reads and
   writes fail closed.
3. Commands carry typed preconditions for `APPROVAL`, `ACTION_MANIFEST`, `PREFLIGHT` and
   `EXTERNAL_TARGET` with expected revision/digest where required.
4. Accepted Policy Context (ADR-105) is recorded on commands, attempts and results; current policy
   is revalidated before provider/connector use.
5. The browser holds only resource snapshots and safe views; SSE/live updates are not authority.

## 5. Capability, policy, credential, budget, external revision and idempotency boundaries

- **Capability**: scopes `action:candidate:stage`, `action:approve`, `action:execute`,
  `action:cancel`, `action:rollback`, `action:verify`, `action:read`, `action:audit:read`,
  `action:budget:read`, `action:credential:manage` are server-derived; capabilities are scope
  derived like FE-P4-S1 `reviewCapabilitiesForScope`.
- **Policy**: risk policy (`decideActionRisk`, R0–R4) is reused; a stricter current policy blocks or
  masks; a relaxed policy never expands access automatically (ADR-105).
- **Credential**: server-owned secrets never reach the browser, command payloads, outcomes, audit
  or results; product views expose only masked state and `canTest`/`canRotate`/`canRevoke`.
- **Budget**: a project-scoped external-execution budget is server-owned; preflight revalidates it
  and exhaustion fails closed; the browser never computes it.
- **External revision**: `externalRevision` is tracked on the aggregate, manifest, preflight,
  attempt and verification; a changed external revision invalidates readiness and requires
  re-validation/re-approval.
- **Idempotency**: `clientRequestId` + `idempotencyKey` + semantic digest per ADR-101; replay is
  idempotent and `OUTCOME_UNKNOWN` resolves by original identity without a new key.

## 6. Manifest digest, target revision, approval expiry, stale state and re-approval

1. `manifestDigest` covers manifest identity, target revision/digest, external revision,
   parameters, evidence set and payload.
2. `targetDigest` and `externalRevision` must match at preflight and execute; otherwise the action
   is `STALE` and blocks.
3. Approval expiry is enforced (default 30 days like `FRONTEND_REVIEW_APPROVAL_TTL_MS`); expired or
   non-`ACTIVE` approval blocks execution and requires re-approval.
4. A new manifest revision supersedes the old; execution pins the approved manifest revision.
5. Stale states are explicit (`STALE_ACTION_SNAPSHOT`, `REVIEW_TARGET_CHANGED` equivalents) and are
   never silently refreshed.

## 7. `OUTCOME_UNKNOWN` resolution

- `OUTCOME_UNKNOWN` is not failure and never auto-reruns with a new key.
- Resolution is by `clientRequestId` → idempotency + semantic digest ledger → expected Domain
  resource (`ExecutionV1` / `ExecutionAttemptV1` / `VerificationV1`), then snapshot re-read.
- A user-issued domain retry creates a new Command and Attempt with Correlation and Causation.

## 8. Target-state verification contract

1. Connector or HTTP success alone is not verified success.
2. `VERIFIED` requires a `VerificationV1` confirming the external target state (`APPLIED` /
   `NOT_APPLIED` / `MISMATCH`) against the expected target revision and digest.
3. `MISMATCH` and `NOT_APPLIED` remain separate, audited, non-retried states.
4. Verification revalidates current policy and external revision.

## 9. Cancel, Rollback and Compensating Action

- **Cancel** is an abort request (`CANCELLING` → `CANCELLED`); it implies no external reversal and
  never auto-re-executes.
- **Rollback** is a separate governed state-reversal command with its own manifest, risk decision,
  approval (if required) and verification; never assumed available.
- **Compensating Action** is an independent External Action referencing `compensationForActionId`;
  it follows the full governed lifecycle and is never auto-run.

## 10. Masking, access-loss, recovery and workspace contract

1. Hidden or access-restricted actions return a restricted shell (`ACCESS_RESTRICTED`) without the
   protected payload; counts, edges, descriptions and announcements never leak hidden identities.
2. Credentials and raw provider payloads are never rendered; safe masked views only.
3. `OUTCOME_UNKNOWN` recovery surfaces a typed recovery state with a resolve-by-original-identity
   action and never a re-execute button.
4. High-risk actions are never executed from Home or Command Palette; they navigate to the
   governance workspace.
5. The workspace preserves focus on deep-link restore, refresh, cancel and verification.
6. The workspace follows the FE-P4-S1 accessibility contract: keyboard matrix, frozen
   announcements, non-color cues, 200% zoom, reduced motion and axe zero-critical.

## 11. Persistence and migration decision

The Stage 11 tables (011/013) remain the base. Product implementation requires a bounded additive
migration `028_frontend_external_action_product.sql` for Execution Attempts, Compensating Action
and product binding columns. The migration is proposed, not implemented in preparation. The
`action` schema remains managed and append-only.

## 12. Product API candidates

Protected routes under `/product-api/frontend/external-action/*` with the same guard/CSRF/decoder
pattern as FE-P4-S1 routes, and a strict `FrontendExternalActionClient`. No legacy `/actions/*`
shape is exposed as the Product contract.

## 13. Typed failures

New typed failure reasons registered in the shared registry, including (non-exhaustive):
`EXTERNAL_ACTION_NOT_FOUND`, `ACTION_MANIFEST_CHANGED`, `ACTION_APPROVAL_EXPIRED`,
`ACTION_APPROVAL_INVALID`, `ACTION_PREFLIGHT_FAILED`, `ACTION_PREFLIGHT_EXPIRED`,
`EXTERNAL_ACTION_STALE`, `ACTION_BUDGET_EXCEEDED`, `ACTION_CREDENTIAL_UNAVAILABLE`,
`ACTION_CANCEL_NOT_ALLOWED`, `ACTION_ROLLBACK_NOT_AVAILABLE`,
`ACTION_VERIFICATION_MISMATCH`, `ACTION_OUTCOME_UNKNOWN`, `EXTERNAL_TARGET_CHANGED`,
`ACTION_COMPENSATION_REQUIRED`. Each maps to normalized code, HTTP status, retryability and safe
message per ADR-118.

## 14. Browser state and cache

Route-scoped Browser Draft State Machine for pending drafts (ADR-119), scope-safe query keys with
Project/access/policy, and snapshot-based recovery.

## 15. Performance and bounded behavior

- Bounded action queue page (≤ 50) and bounded attempt listing.
- No unbounded provider payload retention in Product views.
- Deterministic local baseline and an approved numeric Gate proposed before implementation.

## 16. Frozen Acceptance Criteria

The following Acceptance Criteria are frozen for FE-P4-S2 Product implementation (proposed; they
become binding when the snapshot is approved):

| ID             | Criterion                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FE-P4-S2-AC-01 | `ExternalActionV1` aggregate with stable `actionId` and immutable numbered `actionRevision` binds target, external revision, operation, risk decision, manifest, approval, project, access and policy. |
| FE-P4-S2-AC-02 | `ActionCandidateV1` and `RiskDecisionV1` are validated and read-only; the browser never computes risk.                                                                                                 |
| FE-P4-S2-AC-03 | `ActionManifestV1` is immutable per revision and `manifestDigest` covers target, parameters, evidence and payload; a new revision supersedes the old.                                                  |
| FE-P4-S2-AC-04 | `ExternalActionApprovalV1` has purpose `EXTERNAL_ACTION` and is never reused for Knowledge or Directive purposes, nor reused across actions.                                                           |
| FE-P4-S2-AC-05 | Approval binds manifest revision, manifest digest, target revision, target digest, external revision, policy context and expiry; expired or non-active approval blocks execution.                      |
| FE-P4-S2-AC-06 | `PreflightV1` revalidates permission, credential, budget, policy, target state and external revision after approval; `READY` is time-boxed.                                                            |
| FE-P4-S2-AC-07 | `ExecutionV1` owns an ordered append-only `ExecutionAttemptV1` list; each attempt has its own idempotency key and correlation/causation.                                                               |
| FE-P4-S2-AC-08 | Transport retry preserves request, key, digest and attempt; domain retry is a new command and attempt; no automatic re-execution on timeout or `OUTCOME_UNKNOWN`.                                      |
| FE-P4-S2-AC-09 | `VERIFIED` requires a `VerificationV1` confirming external target state; Connector/HTTP success alone never marks verified.                                                                            |
| FE-P4-S2-AC-10 | `ResultV1` and `ActionAuditEventV1` are safe read-only views; raw provider payloads, prompts and secrets are never exposed.                                                                            |
| FE-P4-S2-AC-11 | Cancel is an abort request distinct from Rollback; Rollback is a separate governed command never assumed available.                                                                                    |
| FE-P4-S2-AC-12 | `CompensatingActionV1` is an independent governed External Action referencing `compensationForActionId` and is never auto-run.                                                                         |
| FE-P4-S2-AC-13 | Credentials are server-owned and only masked views and typed capabilities reach the browser.                                                                                                           |
| FE-P4-S2-AC-14 | A project-scoped execution budget is server-owned; preflight revalidates it and exhaustion fails closed.                                                                                               |
| FE-P4-S2-AC-15 | Changed manifest, target, protected payload, credential, budget or external revision requires re-approval and blocks stale execution.                                                                  |
| FE-P4-S2-AC-16 | `OUTCOME_UNKNOWN` resolves by original command identity and never auto-submits a new key.                                                                                                              |
| FE-P4-S2-AC-17 | Hidden or access-restricted actions return a restricted shell without protected payload or identity leak.                                                                                              |
| FE-P4-S2-AC-18 | High-risk actions are never executed from Home or Command Palette; they navigate to the governance workspace.                                                                                          |
| FE-P4-S2-AC-19 | The workspace is accessible: keyboard matrix, frozen announcements, non-color cues, 200% zoom, reduced motion, axe zero-critical.                                                                      |
| FE-P4-S2-AC-20 | Negative proof: no Connector/HTTP success alone marks verified; no Cancel implies Rollback; no automatic retry after timeout.                                                                          |
| FE-P4-S2-AC-21 | In-memory/PostgreSQL parity and migration 028 apply/rollback (implementation phase).                                                                                                                   |
| FE-P4-S2-AC-22 | Exact-head Quality, Frontend and Required Gates pass at the implementation head (implementation phase).                                                                                                |

Blocked until ADR-129 acceptance: AC-03, AC-06, AC-07, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16.

## 17. Authorization boundary

- Product implementation: NOT_AUTHORIZED until the user accepts ADR-129 and approves this snapshot
  and the Implementation Request.
- Migration 028: proposed only; not authorized and not implemented.
- Ready, Merge, Deployment and Production Verification: NOT_AUTHORIZED.
- FE-P5: NOT_AUTHORIZED.
