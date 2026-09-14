# Issue #304 — Terminal Review state on Recompare

## Scope and source audit

This correction is confined to the Stage 5 Comparison V2 Review bridge. A
Recompare of an immutable Comparison may replay the existing Review row. The
repository is intentionally idempotent on `(project_id, comparison_id)` and
preserves an existing Review decision; the bridge must therefore use the
authoritative status returned by `saveDraft()` rather than the newly-built
pending Draft status.

In scope:

- report `DRAFT_CREATED` only when the stored Draft remains `PENDING_REVIEW` or
  `ON_HOLD`;
- classify a stored `STALE` Draft as `BLOCKED / STALE_COMPARISON`;
- classify stored `APPROVED` and `REJECTED` Drafts as
  `BLOCKED / REVIEW_NOT_ELIGIBLE`;
- preserve the Product success predicate and typed recovery response.

Out of scope:

- reopening, cloning, or overwriting terminal Review state;
- Review decisions, approval tokens, Canonical writes, migrations, or V1
  fallback;
- changing the Product queue to treat terminal Reviews as pending work.

## Integration decision

`NO_RELEVANT_OSS`: this is a Shotgun-owned status/authority contract at the
Review materialization boundary. The Stage 5 reference candidates remain
`REFERENCE_ONLY`; no external runtime or package can replace this contract:

- `garrytan/gbrain`, commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT;
- `lucasastorian/llmwiki`, commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0;
- `ddsyasas/llm-wiki`, commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT;
- Inkeep OpenKnowledge, commit `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later.

No Adapter, Extract, Fork, dependency, ADR, Contract version, or database
migration is introduced. PostgreSQL remains the authoritative persistence
adapter and retains terminal-state idempotency.

## Safety and rollback

- The correction fails closed at the Review bridge and reuses existing typed
  `BLOCKED` reasons.
- Product success remains limited to `V2_ACTIVE + COMPLETED + DRAFT_CREATED`.
- No automatic approval, ReviewDecision, approval token, Canonicalization, or
  Canonical write is reachable from Recompare.
- Rollback is a revert of the correction commit; no data migration is needed.

## Verification record

The final controller completion report records the exact branch head, PR, and
CI runs. Required proof is:

- bridge unit coverage for `APPROVED`, `REJECTED`, and `STALE` replay results;
- normal fresh `PENDING_REVIEW` / `ON_HOLD` materialization remains
  `DRAFT_CREATED`;
- PostgreSQL Product re-entry coverage proves a rejected same-Comparison
  replay remains `REJECTED`, creates no pending row, reports typed `BLOCKED`,
  and does not change decision counts, Canonical version, or provider attempts;
- focused Contract, security/approval negative, typecheck, lint, format, and
  database verification passes.

Known limitation: a terminal Review remains terminal by design. Operators must
start a new governed Comparison identity when a new Review is required.
