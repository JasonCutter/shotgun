# ADR-166 — Stage 11 Durable Action Feedback Handoff

_Status: Accepted for RUS-1D-D D11-4 (2026-09-15)_

## Context

`ActionFeedbackRecorded` is a required acknowledgement handoff to the active
`stage11.action-feedback-review` consumer. The Action transition and audit row
were durable, but the feedback event could be lost after the Action transaction
committed and before event publication. The existing `canonical.outbox` is not
the authority for Action feedback and must not be reused.

## Decision

The Action producer owns a separate `action.action_feedback_outbox` table and
the `stage11.action-execution.feedback-outbox` authority. A feedback-producing
Action transition writes the Action projection, its audit event, and one
deterministic outbox intent in the same PostgreSQL transaction. The outbox is
identified by `action-feedback:<actionId>:<status>` and is unique per project;
`OUTCOME_UNKNOWN` and `VERIFIED` therefore remain distinct durable records.

The only persisted feedback mappings are `VERIFIED → VERIFIED`,
`OUTCOME_UNKNOWN → OUTCOME_UNKNOWN`, `FAILED → FAILED`, and
`VERIFICATION_FAILED → FAILED`. `PREFLIGHT_FAILED` produces no feedback. The
payload is bounded to Action identity, status, review phase, and timestamp; it
contains no credentials, provider secrets, raw responses, or Evidence bodies.

A bounded `runOnce(limit)` dispatcher claims only this outbox, publishes the
existing `ActionFeedbackRecorded` event with the persisted semantic key, and
marks the row published after acknowledgement. Claim expiry, restart, retry,
and publication ACK loss reuse the same key and existing Connector Runtime
deduplication/required-ack/dead-letter rules. An unknown publication outcome is
fail-closed; the dispatcher never invokes a provider or forces Connector
Runtime replay/reconciliation.

Historical rows are repaired only by deterministic, additive backfill from
`ACTION_FAILED`, `ACTION_OUTCOME_UNKNOWN`, `ACTION_VERIFIED`, and
`ACTION_VERIFICATION_FAILED` audit categories. Backfill uses `ON CONFLICT DO
NOTHING`, never calls a provider, and excludes `ACTION_PREFLIGHT_FAILED`.

## OSS integration decision

The existing Stage 11 OSS review and Module Architecture Role Matrix were
rechecked for this D11-4 boundary. No new runtime dependency is introduced.

| Candidate                                                         | Fixed review reference / license / maintenance                                                                                                              | Decision         | D11-4 boundary and evidence                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                                                        | `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`; PostgreSQL License; existing pinned image and `pg` adapter | `ADOPT`          | `PostgresActionExecutionRepository` owns the new table behind `ActionExecutionRepositoryPort`; row lock, one transaction, `SKIP LOCKED`, unique semantic key. PostgreSQL migration/transaction and the real CI regressions are the prototype/benchmark. |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`; MIT; pinned reference baseline                                                                           | `REFERENCE_ONLY` | Job/retry/lock/recovery patterns only. Runtime, DB schema, Action identity, and provider execution are excluded; no extraction is relevant to this Port.                                                                                                |
| [pg-boss](https://github.com/timgit/pg-boss)                      | tag `12.28.1`, commit `78089bbd51cce5e70282f6e5f9a9d937856ab414`; MIT; reviewed but not locked into this runtime                                            | `DEFER`          | Generic queue could sit behind a Port, but its schema/worker/job identity overlaps the Shotgun outbox and adds migration/maintenance surface. Re-evaluate only with a measured throughput need and replacement benchmark.                               |
| [Graphile Worker](https://github.com/graphile/worker)             | tag `v0.17.3`, commit `195491c6c4ebf58420ab9d1c8291df0334184063`; MIT; reviewed active upstream                                                             | `DEFER`          | Same schema/task identity overlap; it does not own Shotgun semantic keys, ACK ambiguity, or `OUTCOME_UNKNOWN`. No package or provider calls are added.                                                                                                  |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`; Apache-2.0; pinned extracted-package baseline                                                            | `REFERENCE_ONLY` | Conversion/Evidence components have no Action outbox role; SQLite/FTS/VaultFS/runtime excluded.                                                                                                                                                         |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`; MIT; pinned UX baseline                                                                                  | `REFERENCE_ONLY` | Action-centered UX patterns only; backend/storage and event authority excluded.                                                                                                                                                                         |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)  | commit `f2834c237639e2cff603817ed88182b33f83cf91`; GPL-3.0-or-later; pinned UX baseline                                                                     | `REFERENCE_ONLY` | Review/activity UX patterns only; GPL runtime, Canonical, and outbox code excluded.                                                                                                                                                                     |

The Role Matrix remains current; its PostgreSQL `ADOPT` and four reference
assignments are not promoted to a new shared runtime. Replacement is tested at
the `ActionFeedbackOutboxRepositoryPort` and `ActionFeedbackRecorded` contract
boundary; migration rollback retains the additive table and disables dispatch.

## Migration, rollback, and replacement

Migration `074_adr166_stage11_action_feedback_outbox.sql` is additive. Existing
Action, audit, Canonical, Evidence, and Product External Action data is not
rewritten. Disabling the dispatcher leaves pending outbox rows durable for
later delivery. Rollback disables the dispatcher and removes its registration
only after retaining/draining the outbox; the table may be retained for audit
or dropped only through the normal migration policy. The outbox Port is
replaceable by another producer-owned durable adapter after the same contract,
ACK-loss, idempotency, and backfill tests pass.

## Consequences

The post-COMMIT feedback gap is closed without changing Action state semantics,
Provider execution, Connector Runtime authority, Action Review meaning, or
Canonical ownership. A commit-ACK ambiguity is returned as `OUTCOME_UNKNOWN`
unless an authoritative readback proves the Action, audit, and exact outbox
intent together.
