# Issue 203 WP6 OSS Integration Decision

## Scope

WP6 adds the operational rollout authority and the application composition
seam for the existing Comparison v1/v2 contracts. It does not add a provider,
Canonical writer, frontend route, migration, or a second persistence runtime.

## Decision

`NO_RELEVANT_OSS` (`REUSED_ADR160_NO_RELEVANT_OSS`). The candidates already
reviewed for ADR-160/WP5 remain `REFERENCE_ONLY`:

- `garrytan/gbrain`: execution/runtime and database identity cannot become the
  Shotgun rollout or Review authority.
- `lucasastorian/llmwiki`: conversion/evidence utilities do not implement the
  frozen ComparisonFreshness and Review Bridge contracts.
- `ddsyasas/llm-wiki`: UX patterns do not replace the Review-owned Draft and
  decision stores.
- Inkeep OpenKnowledge: visual review patterns do not provide Candidate,
  Canonical, approval, or rollback lineage.

No new dependency was introduced. The runtime uses the existing Settings,
Comparison v2, Review v2, semantic generation, and governed provider ports.

## Replacement and rollback

The coordinator depends only on structural ports and its focused tests use two
interchangeable fake orchestrators. A production adapter can be replaced after
Contract, Golden Corpus, Security, and Replacement tests pass. Rollback is a
Settings transition to `V1_ONLY` or `V2_SHADOW`; all existing v1/v2 rows remain
readable and are never deleted, downcast, or replayed automatically.
