# Issue #299 — Review V2 stale convergence implementation record

Status: Correction follow-up for PR #300 (`codex/issue-299-review-v2-stale-convergence`).

## Scope

This record covers the Review V2 correction that converges an authoritative
`STALE_COMPARISON` decision rejection into the persisted current Draft and the
same-session Product/UI read model after candidate or Canonical freshness drift.

Included:

- exact project/change-set/revision/content-digest CAS transition of the mutable
  `review.change_sets_v2` current head to `STALE`;
- PostgreSQL row locking, final-state protection, and exact already-`STALE`
  replay idempotency;
- typed `REVIEW_CONTEXT_STALE` followed by authoritative queue/context reads;
- PostgreSQL-backed Product API end-to-end coverage of approval → 409 →
  queue/context `STALE`;
- the existing manual Recompare control remaining server-derived.

Excluded:

- Canonical writes, decision/manifest/approval-token writes, operation
  resolution, automatic Recompare, automatic approval, and V1 fallback;
- any new ADR, frozen Contract Snapshot wire change, runtime dependency, or
  database migration.

## OSS and integration decision

The reviewed candidates were `garrytan/gbrain`, `lucasastorian/llmwiki`,
`ddsyasas/llm-wiki`, and Inkeep OpenKnowledge. The decision is
`NO_RELEVANT_OSS`: none provides a replaceable Shotgun-specific freshness/CAS
authority or Review Product projection. Existing TypeScript, PostgreSQL, and
React boundaries remain in place; no OSS package is adopted or extracted.

## Contract and safety boundary

- Only the authoritative V2 freshness result `STALE_COMPARISON` may request the
  internal stale transition. `FRESHNESS_UNAVAILABLE` and `DECISION_STALE` never
  persist `STALE`.
- The repository locks the current head and requires the exact project,
  change-set, revision, and digest. A newer/different head or `APPROVED`/
  `REJECTED` final state fails closed; the exact current `STALE` head is an
  idempotent read with no `updatedAt` rewrite.
- Immutable `review.change_set_revisions_v2` history is untouched. No decision,
  manifest, approval token, operation resolution, or Canonical mutation is
  emitted on stale rejection.
- The browser clears its presentation-only `manualContext` shadow and adopts
  the authoritative queue/context query result. It does not synthesize `STALE`,
  retry approval, invoke a write/revalidation command, or auto-Recompare.

## Verification

- Unit: comparison-review V2 bridge stale transition, final-state race, and no
  mutation.
- Contract: frozen Review V2 and Product API contracts unchanged.
- Database: PostgreSQL CAS transition, exact already-`STALE` replay, newer/final
  state guards, zero decision/manifest writes.
- Product integration: PostgreSQL-backed approval → typed 409
  `REVIEW_CONTEXT_STALE` → subsequent queue/context `aggregateState=STALE`.
- Frontend: same-session stale convergence, manual shadow removal, visible
  server-derived Recompare, stale approval remains blocked; #276/#281
  regressions preserved.
- Full gates: Unit 1124, Contract 673, Integration 475 (isolated
  `shotgun_test`), targeted PostgreSQL 8, Review Workspace 9, frontend
  typecheck/build, lint/format, OSS Gate, and exact-head CI all passed.

## Migration, rollback, and limits

No migration is required. Rollback is a normal revert of the PR commit; the
immutable revision table remains available for recovery and no Canonical data is
changed by this path. PR #300 remains open and must not be merged automatically.
Issue #298 remains STOP. Final owner/controller Review approval and merge
decision remain outside this implementation.
