# Issue 203 WP5 OSS Integration Decision

## Scope

WP5 composes the already approved WP1–WP4 Comparison v2 contracts into a
Comparison-owned orchestration port and an additive Change Set Review v2
bridge. It does not introduce a provider runtime, Canonical writer, or a
second persistence identity.

## Decision

`NO_RELEVANT_OSS` for the orchestration and Review authority boundary.

- `gbrain`: `REFERENCE_ONLY`; its execution/runtime and database identity are
  outside the Shotgun Comparison and Review ports.
- `lucasastorian/llmwiki`: `REFERENCE_ONLY`; its conversion/evidence pieces do
  not provide the frozen ComparisonResultV2 or Review freshness contracts.
- `ddsyasas/llm-wiki`: `REFERENCE_ONLY`; its UX/backend runtime is not a
  replacement for the Review-owned v2 Draft store.
- Inkeep OpenKnowledge: `REFERENCE_ONLY`; its review/graph patterns do not
  provide the required Candidate-to-Canonical lineage and rollout authority.

No new OSS dependency or unpinned code was introduced. Existing WP3 shortlist,
WP4 semantic-analysis, and WP2 aggregate ports remain replaceable seams.

## Replacement and rollback

The orchestration and Review services depend only on structural ports. A future
adapter may replace any shortlist, semantic-analysis, aggregate, freshness, or
Review repository implementation after the common contract and replacement
tests pass. Rollback is additive: disable v2 orchestration/Review writes or
select `V1_ONLY`/`V2_SHADOW`; historical v1 rows and handlers are unchanged.
