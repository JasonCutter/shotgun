# Issue #259 — Global Search exact Source navigation

## Scope and source audit

Issue #259 repairs the existing `GlobalSearchPort` Source result route. The
server-authorized `FrontendSourcesReadCoordinator.list` result already carries
the typed `sourceId` and `selectedSourceVersionId`, but
`PostgresSourceLibraryGlobalSearch` previously discarded both identities by
returning the generic `/sources` route. The browser continues to navigate only
to the server-returned `targetRoute.href`; it does not derive a Source path.

The existing Product route is `sources/:sourceId`, and the Source Library uses
`/sources/<encoded sourceId>?version=<encoded selectedSourceVersionId>`. The
runtime TargetRoute decoder now registers only this bounded Source-detail shape
in addition to the existing `/sources` base route and Activity deep links.

## Implementation boundary

- `TargetRouteView` accepts `/sources/<id>?version=<version>` only when the
  path and query are the canonical `encodeURIComponent` form emitted by the
  server.
- The decoder rejects external or absolute URLs, fragments, empty identities,
  raw path separators, traversal-like identities, malformed percent escapes,
  duplicate or unexpected query keys, and missing versions.
- The Postgres search adapter builds the route from `source.sourceId` and
  `source.selectedSourceVersionId`; it does not parse `label` or `stableId`.
- `/sources` compatibility, Source Library ordering and limits, active and
  explicit cross-Project authorization, sensitivity checks, and Activity deep
  links are unchanged.
- No active-Project mutation, Source mutation, Canonical/Review/Approval
  mutation, database migration, runtime dependency, or Contract Snapshot edit
  is included.

## OSS integration decision

No OSS runtime is relevant to this typed route/adapter repair. The four
validated references were reviewed and remain `REFERENCE_ONLY`:

| Candidate               | Version / commit                           | License          | Decision and boundary                                                        |
| ----------------------- | ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------- |
| `garrytan/gbrain`       | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT              | Reference only for server-authoritative activity/navigation patterns.        |
| `lucasastorian/llmwiki` | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0       | Reference only; no conversion or runtime code is relevant.                   |
| `ddsyasas/llm-wiki`     | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT              | Reference only for action-centric UX; browser route authority is not reused. |
| Inkeep OpenKnowledge    | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later | Reference only for navigation/review presentation patterns.                  |

No lockfile, dependency, Adapter replacement, or OSS Contract Test change is
required. Rollback is application-only: revert the additive decoder and
adapter mapping, retaining the existing `/sources` route and all Source data.

## Verification

Focused regressions cover:

- registered Source-detail route decoding and `/sources` base compatibility;
- external, traversal-like, empty, fragmented, duplicate, unexpected,
  malformed, and missing-version deep-link rejection;
- exact Source and selected SourceVersion identity in the Postgres search
  adapter;
- browser navigation using the server-returned exact `targetRoute.href`;
- existing active/cross-Project scope and ordering behavior.

The final report records the exact implementation head, PR, exact-head CI run,
Quality/Frontend/Required Gates, database tests, Frontend E2E, and any known
limits for controller review.
