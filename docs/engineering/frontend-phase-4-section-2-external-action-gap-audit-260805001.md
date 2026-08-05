# FE-P4-S2 External Action Governance and Execution — Gap Audit

## Record

- Record ID: `frontend-phase-4-section-2-external-action-gap-audit-260805001`
- Date: 2026-08-05
- Repository: `JasonCutter/shotgun`
- Work item: `FE-P4-S2`
- Parent work item: `FE-P4`
- Canonical base: `main@5f7c3b6f7fb1b6114272fe31c2561a7f21cb124f`
- Working branch: `codex/frontend-phase-4-section-2-contract-preparation`
- Tracking issue: [#65](https://github.com/JasonCutter/shotgun/issues/65)
- Draft PR: [#66](https://github.com/JasonCutter/shotgun/pull/66)
- Governing contract: `docs/architecture/frontend/phase-4-governance-execution.md`
- Governing decision: ADR-110 — External Action Validation·Approval·Preflight·Verify Boundary
- Supporting decisions: ADR-101, ADR-105, ADR-109, ADR-091, ADR-093, ADR-094
- Entry authorization: user, `2026-08-05T03:05:00+09:00`
- Status: `PREPARATION_ONLY`
- Product implementation: `NOT_STARTED`
- Ready, Merge, Deployment and Production Verification: `NOT_AUTHORIZED`

This audit records the reusable foundation, missing Product behavior and decisions that must be
frozen before implementation. It does not accept a new ADR, freeze a Contract Snapshot, authorize a
database migration or authorize Product implementation.

## 1. Canonical responsibility

FE-P4-S2 is the governed External Action surface for the fixed lifecycle:

```text
Validation
→ ActionCandidate
→ Risk Decision
→ Preview·Manifest
→ Approval
→ Preflight
→ Execute
→ Verify
→ Result·Audit
```

The phase-4 canonical contract fixes these boundaries:

1. Information results and Export remain separate from external writes.
2. After Approval, Target, Policy, Credential, Budget and External Revision are revalidated in
   Preflight.
3. A changed Manifest, Target or protected payload requires re-approval.
4. Connector response alone never confirms success; actual Target State must be Verified.
5. Timeout and `OUTCOME_UNKNOWN` never trigger automatic re-execution.
6. Cancel is an execution-abort request and is not Rollback.
7. External recovery is a separate Compensating Action.
8. High-risk Actions are never executed directly from Home or Command Palette; they navigate to the
   Governance screen.
9. `EXTERNAL_ACTION` is the Operational Resource Kind aggregate; Preflight, Execution, Verification
   and Compensation are its Concrete Kinds.
10. The Frontend never asserts Principal, Capability or Accepted Policy Context; the Server decides.

## 2. Confirmed reusable foundation

### 2.1 Stage 11 action-execution module

`modules/action-execution/` (id `stage11.action-execution`, v1.1.0) already provides the internal
server-side flow:

- `ValidatedActionCandidate` / `ServerActionCandidate` with `compensationForActionId` marker and
  `ActionRiskDecision` (R0–R4) from `packages/policy` (`decideActionRisk`);
- immutable `ActionPreview` snapshot with digest and 15-minute expiry;
- `ActionApprovalRecord` bound to snapshot digest, candidate revision and expiry;
- atomic execution claim (`claimForExecution`), `ProviderActionResult`, `ActionVerification`
  (`APPLIED` / `NOT_APPLIED` / `MISMATCH`);
- append-only `ActionAuditEvent` (12 categories) and `ActionFeedback` re-entry to `ACTION_REVIEW`;
- behavioral guarantees: 15-min preview expiry, stale-snapshot revalidation before execute
  (`STALE_ACTION_SNAPSHOT`), no automatic retry, verify required for `VERIFIED`, append-only audit.

Ports: `ActionConnectorPort` (`preflight` / `execute` / `verify`), `ActionCandidateRepositoryPort`,
`IndependentVerificationPort`, `ActionExecutionRepositoryPort`, `ActionClockPort`.

### 2.2 Existing action persistence

Migrations `011_stage11_risk_controlled_action.sql` and
`013_stage12_1_action_snapshot_binding.sql` create `action.executions`, `action.approvals`,
`action.audit_events`, `action.candidates`, `action.preview_snapshots` and
`action.approval_records`, with append-only/immutable constraints and unique idempotency keys.
`scripts/database.ts` manages the `action` schema and `scripts/backup-restore.ts` backs it up.

### 2.3 Connector adapter

`adapters/action-connector-fake/` implements `ActionConnectorPort` with `preflight`
(`READY` / `ALREADY_APPLIED` / `DENIED`), `execute` (`ProviderActionResult` or
`TERMINAL_FAILURE` / `OUTCOME_UNKNOWN`) and `verify` (`APPLIED` / `NOT_APPLIED` / `MISMATCH`),
with internal secret isolation and idempotency-keyed effects.

### 2.4 FE-P4-S1 Review Approval surface

FE-P4-S1 freezes `ReviewApprovalV1` bound to actor, target revision, digests, policy context and
expiry with purposes `KNOWLEDGE_CANONICAL_CHANGE` and `USER_DIRECTIVE_CHANGE`. It deliberately
excludes External Action approval and execution and fails closed with
`EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2` (registered in `errors.ts` and
`failure-contract.ts`). Approval scopes already include `action:approve`.

### 2.5 Frontend command substrate

The versioned `FrontendCommandRequest`, idempotency keys, `ACCEPTED` / `COMPLETED` / `REJECTED` /
`OUTCOME_UNKNOWN` outcome states, `ProducedResourceRef`, `resolveOutcomeState` and `classifyRetry`
are frozen in `frontend-foundation.ts` and `frontend-command-gateway`. `TypedPrecondition` purposes
already reserve `APPROVAL`, `ACTION_MANIFEST`, `PREFLIGHT` and `EXTERNAL_TARGET`.

### 2.6 Policy and failure plumbing

`packages/policy` provides `decideActionRisk` (R0–R4) and `assertSecurityContext`. The typed
failure registry (`errors.ts`, `failure-contract.ts`) and ADR-118 translation are reusable.

### 2.7 Workspace patterns

The FE-P4-S1 Review Workspace, FE-P3-S3 Graph Workspace and Settings workspaces (connectors, costs,
privacy) provide the route-guard, query-key, state-machine, announcement, focus and accessibility
patterns. The Home Action Center is a read-only dashboard projection and is not an execution path.

## 3. Reuse and gap classification

- Stage 11 `action-execution` module: `REUSE_BEHIND_PRODUCT_PORT` — never expose Stage 11 internals
  or DB IDs as Product V1 contracts.
- `action.candidates` / `action.preview_snapshots` / `action.approval_records`:
  `REUSE_AS_IS` for candidate/preview/approval evidence.
- `action.executions` (single attempt, `record_json`): `EXTEND` with Execution Attempt records;
  the single-result shape is insufficient for multi-attempt product semantics.
- Frontend Command Ledger and Typed Preconditions: `REUSE_AS_IS`; no second command ledger.
- FE-P4-S1 `ReviewApprovalV1`: `EXTEND` — new `EXTERNAL_ACTION` purpose approval binding without
  reusing Knowledge/Directive approvals.
- Fake Connector: `REUSE_AS_IS` for contract and negative testing; no real connector.
- `decideActionRisk`: `REUSE_AS_IS`; product contract re-exposes the risk decision read-only.
- Product V1 External Action contracts (`ActionCandidateV1`, `RiskDecisionV1`, `ActionManifestV1`,
  `ExternalActionApprovalV1`, `PreflightV1`, `ExecutionV1`, `ExecutionAttemptV1`,
  `VerificationV1`, `ResultV1`, `AuditV1`, `CompensatingActionV1`): `MISSING`.
- Execution Attempts: `MISSING` (no `action.attempts`).
- Compensating Action product contract and execution: `MISSING` (only `compensationForActionId`
  marker and R2 risk floor exist).
- Cancel and Rollback product contracts: `MISSING`.
- Credential vault boundary for external actions: `MISSING` (only masked `ConnectorSettingsView`
  display and Stage 11 adapter-internal secrets).
- Execution budget boundary: `MISSING` (only model/token `CostBudgetView`).
- External revision tracking: `MISSING`.
- External Action Product API, typed client, workspace and route: `MISSING`.
- Target-state Verification product contract: `MISSING` at product layer (connector `verify`
  exists internally).

## 4. Missing Product behavior

1. No bounded External Action queue or Candidate surface with risk decision.
2. No immutable Action Manifest binding target, parameters, digests, expiry and approval.
3. No purpose-specific External Action Approval binding separate from Knowledge/Directive
   approvals.
4. No Preflight Product contract revalidating permission, credential, budget, policy, target state
   and external revision after approval.
5. No Execution and per-attempt Execution Attempt product records with correlation/causation.
6. No Verify Product contract requiring target-state confirmation beyond Connector success.
7. No separate Cancel (abort request), Rollback (state reversal) and Compensating Action (governed
   external recovery) product resources.
8. No Result and Audit Product read surface with safe masking.
9. No credential vault masking, rotation and revocation boundary for external actions.
10. No execution budget/quota boundary with fail-closed preflight enforcement.
11. No `OUTCOME_UNKNOWN` recovery UX without automatic re-execution.
12. No accessible External Action workspace with focus restoration and access-loss masking.
13. No negative proof that Connector/HTTP success alone ever marks an Action verified.
14. No negative proof that Cancel implies Rollback or that high-risk Actions run from Home.

## 5. Architecture conclusion

ADR-110 fixes the lifecycle boundary; ADR-091/093/094 fix the Stage 11 internal flow; ADR-101,
ADR-105, ADR-109 and FE-P4-S1 fix the shared command, policy and approval surface. The FE-P4-S2
Product resource model — `EXTERNAL_ACTION` product aggregate with concrete Preflight, Execution,
Execution Attempt, Verification, Compensation kinds, the credential/budget boundary, and the
Cancel/Rollback/Compensating-Action separation at the Product layer — is a genuinely new server-side
decision not covered by any existing ADR. A new additive ADR is required (proposed as ADR-129) and
a bounded additive database migration (028) is required for Product implementation; neither is
implemented in this preparation phase.
