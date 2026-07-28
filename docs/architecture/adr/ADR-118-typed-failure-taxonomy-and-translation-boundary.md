# ADR-118 — Typed Failure Taxonomy and Translation Boundary

## Status

- Status: **Accepted**
- Accepted: **2026-07-28**
- Approved by: **User**
- Product implementation: **Not authorized by this ADR record**
- Notion record: https://app.notion.com/p/3ab5181d71ad81de8fa2d52827afed19

## Context

Project Shotgun already defines `ErrorCode` and `ShotgunError` in the shared contracts. However, the Product API and API Client currently weaken parts of that type information to `code: string`, while Frontend consumers classify failures through local string arrays and error-message handling.

The current boundary allows several forms of drift:

- HTTP status mapping is maintained separately from the shared error taxonomy.
- API Client errors do not preserve an `ErrorCode`-typed contract.
- Frontend controllers derive `STALE`, `OUTCOME_UNKNOWN`, or generic failure states from local string comparisons.
- Command rejection can persist an unvalidated string from an arbitrary `error.code` value.
- The original failure cause can be lost when it is replaced with a UI state.

This creates inconsistent retry, recovery, authorization, and audit behavior across Backend, Product API, Command Ledger, API Client, and Frontend.

## Decision

Project Shotgun adopts an end-to-end Typed Failure Contract:

```text
ErrorCode
→ FailureDescriptor Registry
→ Versioned Product Failure Envelope
→ Runtime-decoded API Client Error
→ Typed Frontend Recovery Mapping
→ UI State
```

### Invariants

1. Failure codes such as `REVISION_CONFLICT` remain the authoritative cause.
2. `STALE`, `OUTCOME_UNKNOWN`, and similar values are Frontend states derived from a failure; they do not replace the failure code.
3. Human-readable messages are display and diagnostic data only. They must not control program flow.
4. HTTP status alone must not determine Frontend recovery behavior.
5. Unknown remote or internal failures must fail closed and must not be guessed into a known typed failure.

## Failure Descriptor Registry

Every `ErrorCode` must have one central descriptor containing at least:

- failure category,
- retryability,
- recovery action,
- HTTP status,
- allowed safe detail shape.

The registry must be exhaustive:

```ts
const FAILURE_DESCRIPTORS = {
  // ...
} satisfies Record<ErrorCode, FailureDescriptor>;
```

Adding an `ErrorCode` without a descriptor must fail compilation or contract validation.

Representative semantics:

```text
REVISION_CONFLICT
Category: CONFLICT
Retryability: CONDITIONAL
Recovery: REFRESH_AND_REAPPLY
HTTP: 409

OUTCOME_INDETERMINATE
Category: OUTCOME_UNKNOWN
Retryability: UNKNOWN
Recovery: RESOLVE_EXISTING_OUTCOME
HTTP: 503

CAPABILITY_DENIED
Category: AUTHORIZATION
Retryability: NEVER
Recovery: NONE
HTTP: 403
```

## Versioned Product Failure Envelope

The Product API must return a versioned failure envelope with:

```ts
type ProductFailureEnvelope = {
  readonly schemaVersion: '1.0.0';
  readonly code: ErrorCode;
  readonly category: FailureCategory;
  readonly retryability: FailureRetryability;
  readonly recovery: FailureRecovery;
  readonly message: string;
  readonly correlationId?: string;
  readonly details?: ProductFailureDetails;
};
```

The existing `code`, `message`, and optional `correlationId` fields remain available as an additive compatibility boundary.

Failure details must be a code-discriminated typed union. The envelope must not expose stack traces, SQL, credentials, internal paths, or other sensitive implementation details.

## Translation Boundaries

### Domain and Application

Domain and Application code emit typed domain failures or `ShotgunError`. Message matching is prohibited.

### Product API

The Product API uses the central descriptor registry to derive:

- HTTP status,
- category,
- retryability,
- recovery action,
- safe message,
- allowed typed details.

Local string arrays in the server error handler are replaced by registry lookup.

### API Client

The API Client runtime-decodes the failure envelope and preserves the typed failure. Public API errors must not expose `code: string` as the authoritative contract.

Unknown remote codes normalize to an explicit fail-closed remote failure and must not be classified as retryable, conflict, or authorization failures by inference.

Transport failures remain separate from domain failures. Mutation responses that are not received after submission retain the existing `OUTCOME_INDETERMINATE` contract.

### Frontend

Frontend state is derived by a central typed mapping. Individual controllers must not maintain ad hoc error-code string arrays.

The controller preserves both the cause and the derived state:

```text
Cause: REVISION_CONFLICT
Derived state: STALE
Recovery: REFRESH_AND_REAPPLY
```

The same rule applies to Settings Draft, Session Recovery, Project Administration, Route Guard, Notification, and Dialog flows.

## Mutation Outcome Boundary

When a mutation response is not received and commit status is unknown:

- classify the failure as `OUTCOME_INDETERMINATE`,
- retain the original `clientRequestId`,
- resolve the existing command outcome,
- do not blindly resubmit the mutation.

## Command Ledger Boundary

The Command Ledger stores only registered failure codes.

The implementation must not persist:

```ts
String(error.code)
```

from an arbitrary object.

Unknown internal failures normalize to a new registered code:

```text
INTERNAL_UNCLASSIFIED
Category: TERMINAL
Retryability: UNKNOWN
Recovery: CONTACT_SUPPORT
```

The Ledger stores only safe messages and correlation identifiers. The original cause remains inside the internal logging boundary.

## Migration Order

1. Inventory control-flow uses of `code: string`, `String(error.code)`, `'code' in error`, `includes(errorCode)`, message parsing, and generic `throw new Error(...)` at contract boundaries.
2. Add the exhaustive descriptor registry, typed envelope, typed detail union, and runtime decoders.
3. Normalize Backend producers in Authentication, Project Administration, Settings, Command Gateway, Command Ledger, and Product API.
4. Replace HTTP string-array mapping and type the API Client failure boundary.
5. Replace Frontend string comparisons with central typed recovery mappings.
6. Add architecture, lint, or AST enforcement against regression.

This migration is additive before removal. Existing clients consuming `code`, `message`, and `correlationId` must continue to work during the compatibility period.

## Acceptance Criteria

1. Every `ErrorCode` has a descriptor.
2. Adding an error code without HTTP and recovery semantics fails compilation or contract validation.
3. `REVISION_CONFLICT` remains available as the cause while the Settings Draft state becomes `STALE`.
4. `OUTCOME_INDETERMINATE` resolves the existing outcome without resubmission.
5. Changing a message does not change control flow.
6. Unknown remote failures fail closed.
7. Unknown internal failures normalize to `INTERNAL_UNCLASSIFIED`.
8. Authorization failures cannot silently become retryable or HTTP 500 failures.
9. Failure details do not expose sensitive internal data.
10. Existing additive V1 failure consumers remain operational.
11. The Ledger stores only registered error codes.
12. Settings, Session, Project, Route, Notification, and Dialog recovery behavior matches the central registry.

## Rejected Alternatives

### Frontend-only string cleanup

Rejected because HTTP, API Client, and Ledger type erasure would remain.

### One universal error class for every layer

Rejected because Domain, Transport, Product API, and Frontend state responsibilities would be mixed.

### Rename `REVISION_CONFLICT` to `STALE`

Rejected because it replaces a cause with a presentation state and loses diagnostic meaning.

### Derive recovery from HTTP status alone

Rejected because multiple failures sharing one status can require different recovery behavior.

### Parse error messages

Rejected because wording, localization, and security redaction would change program behavior.

## Consequences

### Positive

- One authoritative failure taxonomy and recovery policy.
- Compile-time detection of missing mappings.
- Stable API Client and Frontend behavior independent of message wording.
- Safer Ledger and audit records.
- Better diagnostics because original failure causes are preserved.

### Costs

- Shared contract and decoder work across multiple packages.
- Compatibility migration for Product API and API Client consumers.
- Removal of local string mappings from multiple Frontend controllers.
- Additional architecture and contract tests.

## Scope Boundary

This ADR accepts the Architecture and Contract decision only. It does not authorize Product TypeScript changes, database migration execution, dependency changes, Ready transition, merge, Frontend Phase 1 completion, or Phase 2 work.