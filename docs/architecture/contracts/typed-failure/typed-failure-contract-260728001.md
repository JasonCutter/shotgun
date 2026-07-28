# Typed Failure Contract — Implementation Entry Conditions

## Status

- Decision: **Approved and frozen — 2026-07-28**
- Governing ADR: **ADR-118**
- Product implementation: **Not started / separately unauthorized**
- Compatibility mode: **Additive before removal**

## Required Contract Surface

### Shared taxonomy

- `ErrorCode` remains the authoritative failure-cause union.
- Add `INTERNAL_UNCLASSIFIED` as a registered internal normalization code.
- Define exhaustive `FailureDescriptor` metadata for every `ErrorCode`.
- Descriptor fields include category, retryability, recovery, HTTP status, and allowed details.

### Product API

- Introduce `ProductFailureEnvelope 1.0.0`.
- Preserve existing `code`, `message`, and optional `correlationId` fields.
- Add typed `category`, `retryability`, `recovery`, and safe code-specific `details`.
- Do not expose stack traces, SQL, credentials, internal paths, or raw causes.

### API Client

- Runtime-decode failure envelopes.
- Replace authoritative `code: string` usage with `ErrorCode`-typed failures.
- Keep transport failures separate from domain failures.
- Preserve `OUTCOME_INDETERMINATE` for an unreceived mutation response.

### Frontend

- Preserve original failure and derived UI state simultaneously.
- Replace local error-code string arrays with central typed mappings.
- Prohibit message-based control flow.
- `REVISION_CONFLICT`, `DIGEST_MISMATCH`, and `POLICY_CONTEXT_CHANGED` may derive `STALE` without losing their original codes.
- `OUTCOME_INDETERMINATE` derives `OUTCOME_UNKNOWN` and requires outcome resolution without resubmission.

### Command Ledger

- Persist only registered failure codes.
- Reject or normalize arbitrary string codes.
- Normalize unknown internal errors to `INTERNAL_UNCLASSIFIED`.
- Store safe messages and correlation identifiers only.

## Translation Order

```text
Domain or Application Failure
→ ShotgunError or typed domain failure
→ Product API registry translation
→ ProductFailureEnvelope 1.0.0
→ API Client runtime decode
→ Frontend typed recovery mapping
→ UI state and recovery action
```

## Implementation Sequence

1. Inventory string-based failure control flow.
2. Add shared descriptor registry and Product Failure Envelope decoder.
3. Normalize Backend producers and Command Ledger rejection paths.
4. Replace server HTTP status string arrays with descriptor lookup.
5. Type API Client failures and preserve compatibility fields.
6. Replace Frontend local string classifications.
7. Add enforcement and negative tests.
8. Remove deprecated compatibility paths only through a separately approved contract revision.

## Required Negative Tests

- A new `ErrorCode` without a descriptor fails validation.
- Message wording changes do not alter behavior.
- Unknown remote code is not guessed into a known recovery path.
- Unknown internal error becomes `INTERNAL_UNCLASSIFIED`.
- Authorization failures cannot map to retryable or HTTP 500 behavior.
- Ledger rejects unregistered failure codes.
- Mutation outcome uncertainty does not submit a second command.
- Sensitive internal details are absent from Product API responses.

## Non-scope

This contract does not authorize:

- Product or database implementation,
- dependency or lockfile changes,
- API version removal,
- migration execution,
- PR Ready transition or merge,
- Frontend Phase 1 completion,
- Phase 2 work.