# VP Empty Candidate Batch Epoch Design

## Purpose and target

VP-06 currently advances the knowledge epoch when a direct assertion is
materialized. A completed extraction batch with no accepted claims can still
replace the current batch for a SourceVersion, which changes the current
assertion projection to an empty set without advancing the epoch. That leaves
an Ask snapshot unable to distinguish this completed result from the prior
knowledge state.

Target: `PostgresVPKnowledgeLedger` in `vp-knowledge-postgres`, its
`VPKnowledgeLedgerPort`, `vp.history_events`, and the independent projection
replay checker.

## Decision and behavior

Append one `SOURCE_BATCH_ACTIVATED` event and advance the project epoch once
when a batch is selected by the same completed-batch rules as
`vp.current_assertions` and contains zero READY candidates. This covers an
empty batch and a batch whose candidates were all rejected. The event records
the project, SourceVersion, and batch; its assertion reference is null.

Pending, invalid, or partly materialized batches are not activated. A selected
batch with READY candidates already advances the epoch through each direct
assertion event and does not receive an extra activation event. A unique
project/batch constraint and the existing per-project advisory transaction
lock make repeated ledger ingestion idempotent. An empty replacement batch
therefore retires earlier assertions from the current view and advances the
same epoch used by Ask snapshots.

Replay independently derives selected completed empty batches, checks one
activation event for each, and includes all events in contiguous epoch
validation. The existing authorized project reset removes activation events
through the history-event deletion path.

## OSS and implementation boundary

- PostgreSQL: `AUGMENT`, reusing Shotgun's existing ledger, transaction,
  advisory-lock, and append-only history patterns. No new package or runtime.
- `garrytan/gbrain`: `REFERENCE_ONLY` for previously reviewed Job/Fact/Timeline
  and replay patterns; no runtime or data model adopted.
- pg-boss and Graphile Worker remain `DEFER`; this is an idempotent ledger
  state transition and does not need a second queue owner.
- No new OSS investigation or Role Matrix assignment is needed because these
  exact candidates and boundaries are already recorded in the VP retry design
  and the OSS Role Matrix.

## Verification and rollback

Database tests cover an empty selected batch, an all-rejected selected batch,
replacement of prior current assertions, duplicate ingestion, and a pending
batch that must not activate. Replay must converge and must detect missing or
duplicated activation history. Run the VP ledger/replay DB tests, lint, format,
documentation validation, and the repository typecheck.

Migration is forward-only after activation events exist. Rollback removes the
writer/replay behavior only while preserving recorded events and epochs; do
not delete history to restore an older binary. A later schema rollback would
require a new migration after all activation events have been handled.

## Verification result

- Isolated PostgreSQL ledger test passed 2/2, including the existing ledger
  contract and the new empty/rejected-batch flow.
- A completed empty batch replaced one current assertion with zero current
  assertions, advanced epoch 1 to 2, wrote one activation event, and made
  independent replay converge.
- A later Pending batch wrote no activation event and did not advance epoch.
  After it became fully rejected, the selected empty-result state advanced
  epoch 2 to 3 exactly once; a repeated ingestion did not add an event.
- `npx eslint` passed for the modified adapter, replay checker, and DB test.
- VP-06 remains open for process-level provider acceptance/kill, billing
  reconciliation, unattended runtime restart, and recovery status UX.
