# Issue #258 — Citation Evidence visible highlight

## Scope and source audit

Issue #258 closes the presentation gap after an Ask citation returns to the
Source Evidence view. The existing Source detail route already validates the
exact `CitationReturnTarget` (including grouped-member identity), selects the
Evidence view, scrolls the resolved `<li>` into view, and moves DOM focus to
it. The correction adds a persistent cited state to that same resolved card;
it does not calculate a second identity or alter the citation round trip.

## Implementation boundary

- The existing `isCitationTarget` result is the sole source of the visible
  state.
- A cited card receives the `cited-evidence` class,
  `data-citation-target="true"`, and `aria-current="true"`.
- The cited state uses accent border geometry, a persistent outline/shadow,
  and a subtle surface tint so it remains obvious after focus moves; normal
  `:focus-visible` indication remains enabled.
- Non-target cards and ordinary Evidence navigation without citation state are
  unmarked. Ask and Knowledge citation return targets keep their existing
  identity, scroll, focus, and return-link behavior.
- No Source, Evidence, Canonical, Review, or Approval data is mutated. No ADR,
  frozen Contract Snapshot, database migration, or runtime dependency is
  included.

## OSS integration decision

This is a small presentation-only correction and does not adopt an OSS
runtime. The validated references were reviewed and remain `REFERENCE_ONLY`:

| Candidate               | Version / commit                           | License          | Decision and boundary                                                        |
| ----------------------- | ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------- |
| `garrytan/gbrain`       | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT              | Reference only for evidence/citation navigation patterns.                    |
| `lucasastorian/llmwiki` | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0       | Reference only for highlight/annotation presentation; no runtime extraction. |
| `ddsyasas/llm-wiki`     | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT              | Reference only for Ask UX; no backend or identity model reuse.               |
| Inkeep OpenKnowledge    | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later | Reference only for visual source/evidence review patterns.                   |

No lockfile, adapter, or OSS Contract Test change is required. Rollback is
application-only: remove the cited marker/class and CSS while retaining the
existing citation identity, focus, scroll, and Source data.

## Verification

Focused regression coverage proves that the exact grouped citation member is
focused and receives all cited-state semantics, while a non-target card stays
unmarked. Existing ordinary Evidence rendering also asserts that no cited
state is emitted without citation return state. The final report records the
implementation head, PR, exact-head CI, required gates, and known limits for
controller review.
