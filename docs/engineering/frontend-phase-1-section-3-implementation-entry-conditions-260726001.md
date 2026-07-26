# Frontend Phase 1 Section 3 Implementation Entry Conditions

- Record ID: `frontend-phase-1-section-3-implementation-entry-conditions-260726001`
- Status: **Candidate — user approval required**
- Repository baseline: `main@573cf0301cd856123f9f9612350801e68561d145`
- Architecture: ADR-115 **Accepted**
- AC-01–AC-27: **Approved and frozen**
- Product implementation: **Not authorized**
- Canonical synchronization: **No change**
- AC modification: **Prohibited**
- ADR-115 modification: **Prohibited**

## Purpose and guardrails

This record corrects PR #21's historical status separately from its final merge
record and documents the evidence needed before Section 3 product work can be
authorized. It is not a Product API, pagination, cache, storage, performance,
or runtime implementation specification.

This record does not authorize:

- Product TypeScript, Product API, projection ports, Global Shell, Home, search,
  Command Palette, route-guard, or Project Context 2.0.0 implementation.
- A database migration, dependency or lockfile change, test-code change, or CI
  workflow change.
- A new ADR, an ADR-115 change, an AC change, Canonical synchronization, Phase 2
  work, or a Frontend Phase 1 completion claim.

`EXISTING` means observed in the checked baseline. `DERIVED` means inferred from
the listed code, fixture, or contract evidence. `PROPOSED` means a candidate for
a separately authorized implementation decision. `DEFERRED` means that no
baseline evidence exists to justify fixing the value now.

No numeric performance budget is set by this record. Numeric completion budgets
remain a post-baseline, user-approved performance-gate decision under ADR-115
and AC-24.

## Governing sources

- [ADR-115](../architecture/adr/ADR-115-global-shell-action-center-read-projection-and-scope-boundary.md)
- [Section 3 Gap Audit](frontend-phase-1-section-3-gap-audit-260726001.md)
- [Approved Implementation Baseline](../implementation/frontend-phase-1-section-3-implementation-plan-260726001.md)
- [Section 3 Contract Snapshot](../architecture/contracts/snapshots/frontend-phase-1-section-3/frontend-phase-1-section-3-contract-snapshot-260726001.md)
- [Section 3 Canonical Normalization Record](../architecture/canonical-normalization/frontend-phase-1-section-3-normalization-260726001.md)

The governing sources require a representative dataset, server pagination and
caps, prohibition of unbounded DOM/storage, and a measurement method before
product implementation starts. They expressly defer numeric budgets until a
relevant baseline exists.

## PR #21 final merge record

PR #21 is an Architecture and Contract approval record only. Its title remains
unchanged.

### Final merge record

- PR state: **Merged**
- Ready transition: **Completed with user authorization**
- Merge authorization: **Granted by user**
- Merge commit: `573cf0301cd856123f9f9612350801e68561d145`
- Merged at: `2026-07-26`
- Source Head: `f9f1f0c853dca600acbf98901fa688a33d69e2ac`
- Product implementation: **Not started**
- Frontend Phase 1: **Incomplete**

### Historical pre-merge state

Before user authorization, PR #21 remained Draft and did not authorize product
implementation, Ready transition, merge, or Frontend Phase 1 completion. That
historical state must remain visible as history rather than be represented as
the final PR state.

## Existing baseline evidence

### Product API, repository, and query path

| Area                     | Evidence                                                                                                                                                                                   | Classification | Entry-condition consequence                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Section 3 views          | No Section 3 Product API or projection port exists.                                                                                                                                        | `EXISTING`     | New versioned contracts and server-owned projection paths are still required after authorization.                                         |
| Settings Project list    | `GET /api/v1/projects` obtains all memberships, passes their IDs to `ProjectAdministrationRepositoryPort.getProjects`, filters, and returns an array without a pagination or cap contract. | `EXISTING`     | It must not be reused as an unbounded Section 3 Shell list. This is not an ADR conflict until a reuse proposal is made.                   |
| Stage 7 canonical search | `SearchCanonicalKnowledge 1.0.0` accepts optional `limit`, defaults to `10`, and the JSON schema accepts `1..20`; PostgreSQL applies `ORDER BY score DESC, claim_id LIMIT $4`.             | `EXISTING`     | It is a bounded, stable-sort result-cap example for its owned canonical-claim search only. It is not a Global Search pagination contract. |
| Stage 7 cursor/keyset    | No cursor, cursor payload, next-page token, or keyset predicate was found in the Stage 7 search contract or adapters.                                                                      | `EXISTING`     | Do not claim existing cursor reuse.                                                                                                       |
| Response-size limit      | No repository-wide Product API response-byte ceiling was found.                                                                                                                            | `EXISTING`     | A response-size measurement is required; a numeric ceiling is `DEFERRED`.                                                                 |
| Database list pagination | The inspected Stage 7 PostgreSQL query uses SQL `LIMIT`; no generic cursor/keyset list port was found.                                                                                     | `EXISTING`     | New Section 3 list contracts must own their sort, cursor, and authorization semantics.                                                    |

### Client cache, storage, and draft path

| Area                    | Evidence                                                                                                                                                                                              | Classification | Entry-condition consequence                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Query defaults | `createFrontendQueryClient` explicitly sets only `refetchOnWindowFocus: false` and mutation `retry: false`; repository-specific `staleTime`, `gcTime`, persistence, and cache-size limits are absent. | `EXISTING`     | Existing defaults are not a Section 3 retention or focus-refetch policy. The approved Section 3 snapshot policy must be configured and measured during implementation. |
| Query isolation         | Existing query keys separate `project`, `settings`, `project-admin`, and protected families; session/principal purge helpers remove protected cache families.                                         | `EXISTING`     | Section 3 must add its approved project/global key identities without weakening existing purge behavior.                                                               |
| Browser storage         | No application-source use of `localStorage`, `sessionStorage`, or IndexedDB was found. Browser E2E currently checks that storage does not expose secrets.                                             | `EXISTING`     | No persisted cache or draft store may be assumed to exist. Any storage proposal must be bounded and separately authorized.                                             |
| Local drafts            | Settings drafts are React in-memory state with pinned project/revision context and a Leave Guard. They are not browser-persisted, and ADR-115 excludes Settings drafts from Home Continue Working.    | `EXISTING`     | A Section 3 browser-draft registry is new work and must remain separately labelled, bounded, and non-uploading.                                                        |

### Existing test, fixture, and gate evidence

| Area                  | Evidence                                                                                                                                                                                                  | Classification | Entry-condition consequence                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| Browser fixtures      | `tests/browser/frontend-section-1.spec.ts` and `frontend-section-2.spec.ts` exercise the existing default Session/Project and Settings flow. No Section 3 fixture directory or large-data fixture exists. | `EXISTING`     | Current browser fixtures are smoke fixtures, not representative or stress datasets. |
| Performance evidence  | `docs/engineering/performance/` and `artifacts/performance/` do not exist; no frontend load or browser-timing baseline was found.                                                                         | `EXISTING`     | No latency, render, payload, memory, DOM, or cache numeric budget can be claimed.   |
| Architecture test     | `npm run test:architecture` blocks forbidden frontend dependencies, direct backend/module boundary crossing, and browser authority headers.                                                               | `EXISTING`     | Section 3 implementation must retain this gate.                                     |
| Reuse/operations gate | `npm run stage12:reuse-operations-gate` is an existing Stage 12.1 gate and fails on a non-zero substep.                                                                                                   | `EXISTING`     | It remains a repository quality gate, not Section 3 performance evidence.           |

## Required execution-path confirmation

Every future Section 3 list must be traced through this path before an
implementation candidate is accepted:

```text
Server Query
→ Repository or Read Port
→ Projection or Coordinator
→ Product API
→ Runtime Decoder
→ Client Cache
→ UI Rendering
→ Browser E2E
```

The browser must not fetch an entire authorized dataset and then perform the
authoritative ordering, filtering, ranking, existence masking, or cross-project
authorization locally. Server ranking, scope, revision, and safe metadata stay
server-authoritative.

## Candidate datasets

The current fixture set has only smoke coverage, so the following datasets are
candidate shapes, not seeded counts or performance claims. Each dataset must
record item count, project count, principal count, resource/sensitivity
distribution, cross-project ratio, retired/forbidden/unavailable ratio,
`OUTCOME_UNKNOWN` inclusion, generator/seed location, and replayability before
it is used for a measured baseline.

| Axis                              | Baseline                                               | Representative                                                                                          | Stress                                                                                          | Current evidence                                                             |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Accessible Projects               | Existing default Project/session smoke flow.           | Multiple accessible Projects with a distinct active Project and safe labels.                            | Authorized Project-set boundary, inaccessible/retired entries, and membership revision purge.   | `EXISTING` smoke only; all counts `DEFERRED`.                                |
| Navigation and Primary Actions    | Availability enum rendering.                           | Mixed available, coming-later, temporarily unavailable, restricted, and hidden actions.                 | Maximum contract-allowed navigation/action rows after caps are fixed.                           | `DERIVED`; no Section 3 seed.                                                |
| Attention                         | Empty and one safe item.                               | Severity, stale/conflict/recovery, and cross-project masking cases.                                     | Cap boundary plus empty-next-page behavior.                                                     | `PROPOSED`; no current source.                                               |
| Continue Working server resources | Empty and one server resource.                         | Project-bound recent work, safe state labels, and an `OUTCOME_UNKNOWN` warning.                         | Cap boundary, retired/forbidden removal, and revision mismatch.                                 | `PROPOSED`; no current source.                                               |
| Continue Working browser drafts   | None.                                                  | Valid local draft, expired draft, project/session/sensitivity/revision mismatch.                        | Maximum contract-allowed bounded local registry.                                                | `PROPOSED`; current Settings draft is evidence only, not reusable Home data. |
| Recent and Pinned                 | Empty and one safe resource.                           | Typed resource kinds, safe labels, stale/revoked item purge.                                            | Cap boundary and cross-project labels.                                                          | `PROPOSED`; no current source.                                               |
| Background and Notifications      | Empty and one principal-global safe item.              | Multiple accessible Projects, notification presentation revision, read watermark behavior.              | Cap boundary, inaccessible-project metadata purge, and bounded watermark/exception behavior.    | `PROPOSED`; no current source.                                               |
| Global Search                     | Stage 7 canonical search smoke query.                  | Typed result kinds, authorization masking, result ranking, and non-content telemetry.                   | Existing Stage 7 maximum-20 owned-claim search plus distinct Section 3 contract boundary tests. | `EXISTING` Stage 7 cap; Section 3 dataset `PROPOSED`.                        |
| Route Guard and commands          | Existing Section 1/2 guarded routes and command tests. | Zero-project session, denied/not-found masking, project switch, concurrent and `OUTCOME_UNKNOWN` cases. | Repeated scope/revision changes without stale protected-cache presentation.                     | `DERIVED`; no Section 3 seed.                                                |

### Dataset provenance rules

1. Existing Stage 7 search fixtures may demonstrate its owned claim-search cap;
   they may not be labelled as a Section 3 Home or Global Search benchmark.
2. Existing Section 1/2 browser fixtures may remain regression fixtures; they do
   not establish representative user data volume.
3. A future dataset seed must be deterministic, versioned, and independently
   reproducible. It must contain no secrets, raw search queries, inaccessible
   titles, or protected resource payloads in published evidence.
4. No count is fixed in this record. Counts become a measured-baseline input,
   not an invented completion target.

## Candidate pagination and response-cap matrix

The structural rule is fixed: list responses are bounded server responses, and
the browser does not locally materialize an unbounded protected dataset. Numeric
page sizes, maximums, and hard caps are intentionally `DEFERRED` until the
candidate datasets and server contracts are approved.

| View or query                     | Current evidence                                                                              | Candidate pagination                                                                                                               | Default / max / hard cap                                                                     | Stable ordering and cursor                                                                                             | Authorization and deleted-item behavior                                                        | Client policy                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Accessible Project list           | Existing Settings list is an unbounded array.                                                 | `PROPOSED`: server cursor/keyset list for any Section 3 large-list use; do not reuse the existing unbounded endpoint.              | `DEFERRED`                                                                                   | `PROPOSED`: server-defined stable Project lifecycle/name key plus opaque cursor and accessible-project-set revision.   | Reauthorize each page; omit or mask inaccessible/retired existence according to server policy. | Query only the requested page; no full-list browser sort/filter.                 |
| Attention Queue                   | No Section 3 implementation.                                                                  | `PROPOSED`: cursor/keyset server ranking.                                                                                          | `DEFERRED`                                                                                   | Server priority plus stable item identity; opaque cursor binds active Project, policy/access, and projection revision. | Fail closed/refetch on scope or revision mismatch; do not expose sensitive total counts.       | Bounded first-page render; next page only on explicit user need.                 |
| Continue Working server resources | No Section 3 implementation.                                                                  | `PROPOSED`: cursor/keyset server ranking.                                                                                          | `DEFERRED`                                                                                   | Server recency/rank plus stable typed resource identity; opaque revision-bound cursor.                                 | Purge unavailable/revoked items; preserve only safe typed references.                          | Separate from browser drafts.                                                    |
| Recent Resources                  | No Section 3 implementation.                                                                  | `PROPOSED`: cursor/keyset.                                                                                                         | `DEFERRED`                                                                                   | Server recency plus typed resource identity.                                                                           | Reauthorize and mask before serialization.                                                     | No browser aggregation across Projects.                                          |
| Pinned Resources                  | No Section 3 implementation.                                                                  | `PROPOSED`: bounded snapshot or cursor/keyset, selected after dataset evidence.                                                    | `DEFERRED`                                                                                   | Server preference order plus stable resource identity.                                                                 | Pinned preference never overrides access/revocation.                                           | No unbounded retained pin IDs.                                                   |
| Background Summary detail         | No Section 3 implementation.                                                                  | `PROPOSED`: server-bounded summary, cursor/keyset only if detail expansion needs it.                                               | `DEFERRED`                                                                                   | Server operational ordering and typed resource identity.                                                               | Principal-global scope with `resourceProjectId` and safe label.                                | Do not discard valid global data solely on active-Project change.                |
| Notification Summary              | No Section 3 implementation.                                                                  | `PROPOSED`: cursor/keyset summary with bounded watermark/exception retention.                                                      | `DEFERRED`                                                                                   | Server event order plus notification identity; opaque cursor excludes raw sensitive IDs.                               | Principal-global reauthorization and purge on membership/sensitivity revision.                 | Mark-read refetches the derived view; no unbounded notification-ID accumulation. |
| Global Search                     | Stage 7 owned claim search defaults to `10`, schema maximum `20`, and SQL `LIMIT`; no cursor. | `PROPOSED`: bounded typed search snapshot for an approved Section 3 adapter; cursor only if a later measured contract requires it. | Existing Stage 7 `10/20` is not automatically a Section 3 value; Section 3 value `DEFERRED`. | Server ranking only; query text never appears in cursor, URL, storage, or logs.                                        | Server performs type, scope, sensitivity, and existence masking before response.               | Raw query is never persisted; any cache key uses a non-reversible digest only.   |
| Command Palette navigation/search | No Section 3 implementation.                                                                  | `PROPOSED`: bounded snapshot supplied by server navigation/search contracts.                                                       | `DEFERRED`                                                                                   | Server availability/ranking and stable command/result identity.                                                        | Hidden means absent from DOM, palette, and search.                                             | Filter only within an already authorized bounded result set.                     |

No offset pagination is proposed because no existing Section 3 offset contract or
revision-safe offset behavior exists. A future choice of offset requires explicit
evidence for stable ordering, mutation behavior, authorization masking, and
snapshot binding.

## DOM, cache, and browser-storage entry conditions

### Structural limits fixed before implementation

- No unbounded DOM rows for Navigation, Attention, Continue Working, Recent,
  Pinned, Notification, Search, or Command Palette results.
- No unbounded LocalStorage, IndexedDB, TanStack Query retention, notification
  ID accumulation, browser-draft registry, route-recovery state, or persisted
  UI preferences.
- No raw search query in URL, browser storage, persistent query cache, default
  request-body logs, telemetry, HAR, or published trace evidence.
- No sensitive resource metadata or inaccessible-resource cache retention after
  membership, capability, sensitivity, policy, principal, or session change.
- Browser drafts remain a client presentation group; they are not uploaded,
  server-ranked, or assigned server stable IDs.

### Numeric completion budgets deferred

The following are required measurement dimensions but have no approved numeric
value yet: simultaneously rendered rows, cache entries/bytes, draft count,
draft payload bytes, route-recovery bytes, persisted-preference bytes, response
bytes, render time, and retained-query lifetime. Virtualization is also
`DEFERRED`; it is not adopted automatically and requires measured benefit plus
accessibility, focus, and stable-identity replacement evidence.

## Measurement method candidate

### Recorded environment

Each baseline result must record:

- Node `v24.15.0`, npm `11.12.1`, and Playwright `1.61.1` for this initial
  environment record; browser exact version must be captured in every result.
- Browser, viewport/device profile, headless/headed mode, CPU throttling,
  network profile, build mode, database state, seed revision, and cold/warm
  cache condition.
- Measurement repetition count, median, P95, and outlier rule. These are
  required fields; their numeric values are not fixed here.
- Repository commit, test command, fixture/seed digest, and artifact digest.

The existing Playwright configuration uses the `Desktop Chrome` device profile,
headless execution, and failure-only trace/screenshot/video retention. It is a
starting harness, not a completed Section 3 performance harness.

### Required scenarios

Measure, after the relevant implementation exists:

1. Global Shell initial authorized snapshot.
2. Authenticated zero-project Shell without a Home Action Center query.
3. Active Project switch and project-scoped cache invalidation.
4. Home Action Center first render and Attention first page.
5. Continue Working server-resource first page and separately composed browser
   draft group.
6. Global Notification open and bounded mark-read refresh.
7. Global Search first result and Command Palette open/filter.
8. Route Guard decision, including masked denied/retired states.
9. Cache purge after membership, sensitivity, policy, session, or principal
   revision.
10. Offline or backend-unavailable transition without presenting stale cache as
    authoritative.

For every scenario, record separately: server query time, projection composition
time, network transfer bytes, runtime decode time, client render time, and
interaction readiness. Do not combine these into an un-attributed browser
number.

### Evidence location and safety

Future measured evidence belongs at:

```text
docs/engineering/performance/
frontend-phase-1-section-3-performance-baseline-<date>-<sequence>.md

artifacts/performance/frontend-phase-1-section-3/
```

The paths are candidate locations only; no directory or artifact is created by
this record. Published trace, HAR, screenshot, or result summaries must exclude
raw search text, cookies, CSRF tokens, credentials, sensitive titles, and
inaccessible Project or Resource identifiers.

## Authorization boundary and ADR review

`ADR_REQUIRED_CANDIDATE`: **No current candidate**.

The following conditions stop implementation and require an ADR-required report
before product code is written:

```text
ADR_REQUIRED_CANDIDATE
Reason
Affected AC
Affected Canonical decision
Options
Implementation impact
Migration impact
```

Trigger conditions are:

- `SettingsRepository` cannot express bounded Notification presentation state.
- An existing Product API pagination contract conflicts with the approved
  Section 3 contract and cannot be isolated by a new versioned route/adapter.
- Persistent projection storage, new SSE infrastructure, a new runtime OSS, or
  a database migration becomes required before implementation.
- Existing cache ownership cannot isolate Project and principal-global scope.

## Required approval before product implementation

Before any Section 3 product code starts, the user must explicitly approve this
Candidate record or a successor that fixes the candidate dataset, list-contract
shape, structural bounds, and measurement method. That approval still does not
approve numeric performance budgets; those follow a measured baseline.

The product implementation then remains bound to ADR-115, the immutable
AC-01–AC-27 Snapshot, existing architecture and Stage 12 gates, and the
repository's OSS evaluation requirements.

## Verification for this documentation change

Required for this record:

- `git diff --check`
- `git diff --cached --check`
- `npm run format:check`
- exact assertion that this record remains `Candidate`, does not authorize
  product implementation, does not modify AC-01–AC-27 or ADR-115, distinguishes
  current PR #21 state from historical Draft state, contains every required
  dataset and list category, and fixes no numeric performance budget.

Not run for this documentation-only change: new Product, Database, Browser E2E,
or performance suites. No such unexecuted suite is represented as passing.
