# ADR-158: Action feedback re-entry and Discovery safe diagnostics

_Status: Accepted for WP-10 (RIC-N7/RIC-N8)_

## Context

`ActionFeedbackRecorded` was emitted with a durable outbox identity but had no
governed consumer. Separately, a Discovery quality-gate failure in
`semanticEssenceForFinding` excluded one candidate and marked the run `PARTIAL`
without leaving safe operational evidence. The existing Frontend Review V1
contract is intentionally frozen and must not gain an external-action target.

## Decision

Select an active consumer, `stage11.action-feedback-review`, rather than
`DEFER`. The event is consumed using the trusted envelope `projectId` and its
semantic idempotency key. The consumer writes the minimum state to
`action.action_review_work_items`; the database uniqueness constraint on
`(project_id, semantic_key)` is the authority across duplicate delivery,
replay, restart, and concurrent workers. Items are fixed to `ACTION_REVIEW` and
start `PENDING`, with a safe deterministic Action/audit reference.

Feedback consumption is observation/re-entry only. It cannot approve, execute,
retry, verify, make a Canonical write, promote a Fact, or decide a review.
Pending state is queryable by the owning Action. Activity remains a read-only
projection and no Frontend Review V1 enum or public Review API is expanded.

When `semanticEssenceForFinding` fails, the affected Finding is still excluded
and the execution remains `PARTIAL`. The Discovery runtime persists one
project/job/run/attempt-scoped row in
`discovery.semantic_essence_diagnostics`, keyed by an irreversible SHA-256
Finding identity. Only bounded fields are stored: stage, safe reason code,
attempt number, timestamp, completion, and exclusion/candidate counts. Prompts,
source or Finding bodies, provider output, Evidence, credentials, headers,
raw errors, and stack traces never cross the persistence or Activity boundary.
Activity may project only the bounded exclusion aggregate and `PARTIAL`, with
project-scoped reads. The aggregate is represented by at most one bounded
operational event per Discovery run; it is not a numeric `dimensions.progress`
value and is never emitted as one event per Finding or diagnostic row.

## Migration, disable, and rollback

Migration `065_runtime_data_integrity_wp10_action_review_discovery_diagnostics.sql`
is additive. Disabling the consumer stops new materialization; existing review
items remain durable and queryable. The Discovery diagnostic write can be
disabled at the runtime adapter boundary while preserving candidate exclusion
and `PARTIAL` semantics. Rollback removes the consumer registration only after
draining/retaining its durable rows; the additive tables are retained for audit
and can be archived by the normal project-scoped retention process. No prior
migration or Canonical/Evidence data is mutated.

## Consequences

The unresolved Action feedback handoff is now a required acknowledgement edge
to a concrete consumer. Database state, not process memory, proves exact-once
materialization. Discovery operators gain redacted, bounded evidence without
exposing protected content, and existing Activity/API contracts remain stable.
