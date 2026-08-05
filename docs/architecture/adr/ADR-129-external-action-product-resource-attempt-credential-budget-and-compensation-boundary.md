# ADR-129 — External Action Product Resource, Attempt, Credential, Budget and Compensation Boundary

- Status: **ACCEPTED**
- Proposed at: 2026-08-05
- Accepted at: 2026-08-05T03:50:22+09:00
- Accepted by: `USER`
- Work item: `FE-P4-S2`
- Related ADRs: ADR-091, ADR-093, ADR-094, ADR-101, ADR-105, ADR-109, ADR-110, ADR-118, ADR-119, ADR-124, ADR-128
- Contract snapshot:
  `docs/architecture/contracts/snapshots/frontend-phase-4-section-2/frontend-phase-4-section-2-contract-snapshot-260805001.md`
- Decision owner: `USER`
- Product implementation: `AUTHORIZED`

## Context

ADR-110 fixes the External Action lifecycle boundary
(`Validation → ActionCandidate → Risk Decision → Preview·Manifest → Approval → Preflight →
Execute → Verify → Result·Audit`) and requires target-state verification, no automatic re-run,
re-approval on change, and separation of Cancel, Rollback and Compensating Action. The phase-4
canonical contract fixes the `EXTERNAL_ACTION` aggregate and its Preflight, Execution, Verification
and Compensation concrete kinds.

Stage 11 (`modules/action-execution`, migrations 011/013) provides an internal flow with a single
`ActionExecutionRecord`, one `ProviderActionResult` and one `ActionVerification`. It has no Product
V1 contracts, no execution attempts, no credential or budget boundary, no Cancel/Rollback, and only
a `compensationForActionId` marker with an R2 risk floor for compensating actions.

None of ADR-110, ADR-091/093/094, ADR-101, ADR-105, ADR-109 or FE-P4-S1 decides the durable
Product External Action representation, the per-attempt execution model, the external-action
credential and budget boundaries, or the Product separation of Cancel, Rollback and Compensating
Action.

## Decision

Adopt a server-authoritative External Action Product model over the Stage 11 engine, exposed only
through Product V1 contracts and protected Product API routes.

### 1. `EXTERNAL_ACTION` aggregate and concrete kinds

- `EXTERNAL_ACTION` is the Product Operational Resource aggregate with a stable `actionId` and
  immutable numbered `actionRevision`.
- Concrete Kinds are `PREFLIGHT`, `EXECUTION`, `VERIFICATION` and `COMPENSATION`; each is a
  versioned Product resource linked to the aggregate by `actionId` and correlation/causation.
- Stage 11 internals, DB IDs and `record_json` are never exposed as Product contracts.

### 2. Execution Attempt model

- An Action Execution owns an ordered, append-only list of Execution Attempts.
- Each Attempt has a stable `attemptId`, `attemptNumber`, its own idempotency key, attempt state
  (`PENDING` / `IN_PROGRESS` / `SUCCEEDED` / `FAILED` / `OUTCOME_UNKNOWN` / `CANCELLED`), the used
  Policy Context, target external revision, provider response reference and timestamps.
- Transport retry preserves the same Request, key, digest and Attempt (ADR-101). Domain retry is a
  new Command and new Attempt connected by Correlation and Causation.
- `OUTCOME_UNKNOWN` is not failure and never triggers automatic re-execution with a new key.

### 3. Credential boundary

- External Action credentials are Server-owned secrets, never transmitted to the browser, stored in
  command payloads, outcomes, audit events or Result resources.
- Product views expose only masked credential state and typed capabilities (`canTest`, `canRotate`,
  `canRevoke`) per `ConnectorSettingsView` precedent.
- Rotation and revocation are Server Capabilities; a rotated credential invalidates pending
  Preflight and requires re-validation.

### 4. Budget boundary

- An Execution Budget is a Server-owned Project-scoped quota for external executions, distinct from
  model/token cost budgets.
- Preflight revalidates the budget with the current policy; exhaustion fails closed and blocks
  execution.
- Budget is never inferred by the browser.

### 5. Cancel, Rollback and Compensating Action

- **Cancel** is an abort request for an in-flight execution or attempt. It is exposed only by Server
  Capability, does not imply any external state reversal and never auto-re-executes.
- **Rollback** is a separate, governed state-reversal command with its own manifest, risk decision,
  approval (if required) and verification. It is never assumed available.
- **Compensating Action** is an independent `EXTERNAL_ACTION` whose candidate references
  `compensationForActionId`; it follows the full governed lifecycle and is never auto-run.

### 6. Verification contract

- Connector or HTTP success alone is not verified success.
- `VERIFIED` requires a `VERIFICATION` resource confirming the external Target State
  (`APPLIED` / `NOT_APPLIED` / `MISMATCH`) against the expected target revision and digest.
- `MISMATCH`, `NOT_APPLIED`, timeout and `OUTCOME_UNKNOWN` remain separate states with no automatic
  retry.

### 7. Re-approval rules

- Approval binds the exact Action Manifest digest, target revision, parameters, policy context and
  expiry.
- Changed Manifest, target, protected payload, credential, budget or external revision, or expired
  approval, blocks execution and requires re-approval.
- A new Manifest revision supersedes the old; execution always pins the approved Manifest revision.

### 8. Server authority

- The Server derives Principal, Resource Project, Capability, Policy Context, credential and budget
  state. The browser never asserts them.

## Consequences

External state changes remain governed and auditable, duplicates and stale authority are blocked,
credentials and budgets are never exposed, and Cancel/Rollback/Compensating Action remain distinct
and never automatic.

## Rejected alternatives

- exposing Stage 11 records or DB IDs as Product contracts;
- a single execution record without attempts;
- automatic re-execution after timeout or `OUTCOME_UNKNOWN`;
- treating Cancel as Rollback or assuming Rollback availability;
- HTTP success as verified success;
- browser-computed budget or credential eligibility.
