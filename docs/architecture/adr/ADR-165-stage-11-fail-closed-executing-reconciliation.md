# ADR-165 — Stage 11 Fail-Closed `EXECUTING` Reconciliation

- Status: **ACCEPTED**
- Proposed at: 2026-09-15
- Accepted at: 2026-09-15
- Acceptance authority: Project Shotgun GPT/controller (user-delegated approval)
- Decision owner: Project Shotgun architecture/controller approval
- Work item: RUS-1D-C / D11-3
- Subject base: `main@cea3c1b2ebb851e01f5f0479c0289f43a01189f6`
- Implementation branch: `codex/rus1d-d11-3-executing-recovery`
- Related decisions: ADR-091, ADR-094, ADR-155, ADR-157, ADR-158
- Product implementation: **AUTHORIZED by the RUS-1D-C implementation instruction**
- Database migration: **NOT REQUIRED**

## Context

Stage 11 persists `EXECUTING` before it invokes the Action Connector. A process
may therefore stop after the claim, during preflight or provider execution, or
after a provider side effect but before `ACTION_EXECUTED` is durably recorded.
The local `EXECUTING` value cannot establish whether the provider mutation was
never attempted, applied, still running, or applied with a lost response.

The deterministic Action idempotency key is necessary for a future provider
adapter, but its presence is not proof of provider-side durable deduplication,
remote lookup, or exactly-once mutation. The current concrete Stage 11
connector is a process-local fake; its effect map is not authoritative after a
restart. Audit history records local workflow progress and is not, by itself,
proof of an external side effect.

## Decision

Stage 11 `EXECUTING` is non-resumable by default. Shotgun MUST NOT call
`preflight()`, `execute()`, or `verify()` solely because an Action remains
`EXECUTING`.

The bounded correction is an explicit, fail-closed
`ReconcileExecutingAction` command:

```text
EXECUTING --(explicit owner/service reconciliation + exact expectedUpdatedAt)--> OUTCOME_UNKNOWN
```

The command:

1. accepts `actionId` and `expectedUpdatedAt`;
2. uses the existing `action:execute` authorization scope and rejects system
   actors, leaving owner or service-principal invocation subject to the normal
   security context;
3. loads the authoritative execution record and returns it unchanged when it
   is already `OUTCOME_UNKNOWN`;
4. returns typed `CONFLICT` for every non-`EXECUTING` state;
5. performs no Connector call;
6. requires an exact `expectedUpdatedAt` match after the repository locks the
   authoritative execution row;
7. transitions only `EXECUTING` to `OUTCOME_UNKNOWN`, preserving the immutable
   Preview, Approval, digests, and any already-persisted provider data;
8. records one existing `ACTION_OUTCOME_UNKNOWN` audit event with
   `automaticRetry: false`, `reconciliation: 'orphaned-executing'`, and the
   expected timestamp; and
9. publishes the existing `ActionFeedbackRecorded` event only after a new
   transition. Replayed reconciliation of an already-unknown record publishes
   neither a second audit event nor duplicate feedback from this handler.

`expectedUpdatedAt` is an optimistic concurrency value only. It is not a
timeout, lease, heartbeat, worker-death proof, or recovery authority. The
repository checks it after locking the row, so a newer valid transition wins
and a stale reconciliation cannot overwrite it. The in-memory adapter follows
the same contract.

The existing D11-1/D11-2 `withSafePostgresTransaction` and commit-ambiguity
read-back behavior remains unchanged. No new Preview, Approval, Provider result,
lease system, scanner, queue, outbox, or automatic provider replay is added.

## Authority boundaries

- The Stage 11 execution record remains the local Action authority.
- Immutable Preview and Approval remain authoritative bindings and are never
  regenerated or mutated by reconciliation.
- `ACTION_OUTCOME_UNKNOWN` expresses uncertainty; reconciliation never changes
  uncertainty to `FAILED` or `EXECUTED`.
- The outer Connector Runtime job/dedup state remains an execution-delivery
  authority only. It is not promoted to provider outcome authority.
- Future provider-aware verification or replay requires a separate architecture
  decision and a real Connector contract proving authoritative remote
  verification and/or replay-safe provider idempotency.
- D11-4 feedback reconstruction remains a separate boundary. This decision
  only uses the normal feedback publication path for a newly recorded
  reconciliation transition.

## OSS integration decision

`NO_RELEVANT_OSS` for this bounded correction. Existing PostgreSQL transaction
and row-lock infrastructure is reused behind the current Action repository
Port. The verified `gbrain` recovery/job material is `REFERENCE_ONLY`; MCP SDK,
provider official SDKs, and Temporal remain `DEFERRED` in the current role
matrix. No OSS dependency, version, lockfile, or provider integration is
adopted by this decision.

## Verification, migration, and rollback

Required verification covers the module Contract, Connector-call zero proof,
exact optimistic CAS, idempotent `OUTCOME_UNKNOWN` replay, authorization and
immutable binding negatives, PostgreSQL restart, PostgreSQL concurrency, and
the existing D11-1/D11-2 transaction-ambiguity suites. The recovery command
must not perform a real external Action.

No migration is required because the existing `record_json`, `updated_at`,
status, and row lock are sufficient for an exact CAS; `updated_at` is not given
timeout semantics. Rollback disables the command/route implementation while
retaining existing Action rows and `OUTCOME_UNKNOWN` audit evidence. No prior
Preview, Approval, or Action row is rewritten.

## Explicit exclusions

This ADR does not authorize automatic startup or periodic scans, timeout-based
reclaim, lease/fencing, provider replay, provider integration, D11-4, Product
External Action changes from PR #317, or changes to Stage 6, 7, or 10.
