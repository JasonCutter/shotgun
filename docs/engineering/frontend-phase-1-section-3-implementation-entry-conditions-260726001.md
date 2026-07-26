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

The current fixture set has only smoke coverage. The following numbers are
`PROPOSED` implementation-entry dataset candidates, not measured performance
claims or completion budgets. Each seed must record item count, project count,
principal count, resource/sensitivity distribution, cross-project ratio,
retired/forbidden/unavailable ratio, `OUTCOME_UNKNOWN` inclusion,
generator/seed location, and replayability before it is used for a measured
baseline.

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

### Proposed numeric dataset candidates

Counts are per deterministic seed unless stated otherwise. Inaccessible or
forbidden records are created only for server-side authorization and masking
assertions; their titles, snippets, and identifiers are never published to the
browser test evidence.

| Dimension                                |   Baseline | Representative |       Stress | Classification and use                                                                                   |
| ---------------------------------------- | ---------: | -------------: | -----------: | -------------------------------------------------------------------------------------------------------- |
| Principals                               |          1 |              2 |            5 | `PROPOSED`; validates principal replacement and global-scope isolation.                                  |
| Accessible Projects per active principal |          1 |             25 |          250 | `PROPOSED`; supports selector paging, separate active Project delivery, search, and cursor invalidation. |
| Navigation Items / Primary Actions       |      8 / 4 |          8 / 4 |        8 / 4 | `DERIVED` from the approved Shell navigation and primary-action set.                                     |
| Attention Items                          |          3 |             25 |          100 | `PROPOSED`; includes severity, stale, recovery, and masking cases.                                       |
| Continue Working server resources        |          5 |             25 |          100 | `PROPOSED`; includes one `OUTCOME_UNKNOWN` resource in representative and stress data.                   |
| Browser Drafts                           |          0 |              5 |           10 | `PROPOSED`; 10 is also the local-registry safety cap.                                                    |
| Recent Resources / Pinned Resources      |     10 / 5 |        25 / 25 |      50 / 50 | `PROPOSED`; typed resources include safe cross-project labels where authorized.                          |
| Background Items                         |         10 |             50 |          200 | `PROPOSED`; principal-global items span the accessible Project set.                                      |
| Notifications                            |         25 |            100 |          500 | `PROPOSED`; supports cursor/watermark and bounded exception behavior.                                    |
| Search Corpus / returned Results         | 1,000 / 10 |    10,000 / 20 | 100,000 / 20 | `PROPOSED` for Section 3 typed search; these values are not inherited from Stage 7.                      |
| Route Guard requests                     |         10 |             50 |          200 | `PROPOSED`; includes zero-project, hidden, denied, retired, and unavailable decisions.                   |
| Concurrent or `OUTCOME_UNKNOWN` commands |          2 |             10 |           25 | `PROPOSED`; used for leave-warning and outcome lookup scenarios, not command throughput claims.          |

Representative and stress seeds must include at least 20% cross-project
authorized items and at least 10% server-side unavailable, retired, or
forbidden candidates. Only authorized, safe results may cross the Product API
boundary.

### Dataset provenance rules

1. Existing Stage 7 search fixtures may demonstrate its owned claim-search cap;
   they may not be labelled as a Section 3 Home or Global Search benchmark.
2. Existing Section 1/2 browser fixtures may remain regression fixtures; they do
   not establish representative user data volume.
3. A future dataset seed must be deterministic, versioned, and independently
   reproducible. It must contain no secrets, raw search queries, inaccessible
   titles, or protected resource payloads in published evidence.
4. The proposed counts are entry-condition inputs for deterministic seed and
   boundary testing. They are not latency, memory, or completion targets.

## Candidate pagination and response-cap matrix

The structural rule is fixed: list responses are bounded server responses, and
the browser does not locally materialize an unbounded protected dataset. The
following `PROPOSED` page sizes and hard caps are implementation safety
contracts, not measured performance budgets.

| View or query                     | Current evidence                                                                              | Candidate pagination                                                          | Default / max / hard cap               | Stable ordering and cursor                                                                                                      | Authorization and deleted-item behavior                                                                      | Client policy                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Accessible Project list           | Existing Settings list is an unbounded array.                                                 | `PROPOSED`: cursor/keyset; do not reuse the existing unbounded endpoint.      | 25 / 50 / 50                           | `createdAt DESC, projectId ASC`; opaque cursor binds accessible-project-set, policy, and projection revisions.                  | Reauthorize every page; revision change invalidates the cursor; omit or mask inaccessible/retired existence. | Return active Project separately even outside the page; offer Project search and next-page access. |
| Attention Queue                   | No Section 3 implementation.                                                                  | `PROPOSED`: cursor/keyset server ranking.                                     | 25 / 50 / 50                           | Server severity, urgency, rank, and stable item ID; opaque cursor binds active Project, policy/access, and projection revision. | Fail closed/refetch on scope or revision mismatch; do not expose sensitive total counts.                     | Retain at most two fetched pages; explicit next-page access only.                                  |
| Continue Working server resources | No Section 3 implementation.                                                                  | `PROPOSED`: cursor/keyset server ranking.                                     | 25 / 50 / 50                           | Server recency/rank and stable typed resource ID; opaque revision-bound cursor.                                                 | Purge unavailable/revoked items; preserve only safe typed references.                                        | Separate from browser drafts; retain at most two fetched pages.                                    |
| Recent Resources                  | No Section 3 implementation.                                                                  | `PROPOSED`: bounded snapshot.                                                 | 25 / 50 / 50                           | Server recency and typed resource ID; one revision-bound snapshot.                                                              | Reauthorize and mask before serialization.                                                                   | No browser aggregation across Projects; replace rather than append snapshot.                       |
| Pinned Resources                  | No Section 3 implementation.                                                                  | `PROPOSED`: bounded snapshot.                                                 | 50 / 50 / 50                           | Server preference order and stable resource ID; one revision-bound snapshot.                                                    | Pinned preference never overrides access/revocation.                                                         | Replace snapshot; no retained pin-ID history.                                                      |
| Background Summary detail         | No Section 3 implementation.                                                                  | `PROPOSED`: bounded summary plus cursor/keyset detail.                        | 20 summary groups; 25 / 50 / 50 detail | Server operational order and typed resource ID; detail cursor binds accessible-project-set and projection revisions.            | Principal-global scope with `resourceProjectId` and safe label.                                              | Preserve valid global view across Project switch; retain at most two detail pages.                 |
| Notification Summary              | No Section 3 implementation.                                                                  | `PROPOSED`: cursor/keyset summary with bounded watermark/exception retention. | 25 / 50 / 50                           | Server event order and notification ID; opaque cursor excludes raw sensitive IDs.                                               | Principal-global reauthorization and purge on membership/sensitivity revision.                               | Mark-read refetches; retain at most two pages.                                                     |
| Global Search                     | Stage 7 owned claim search defaults to `10`, schema maximum `20`, and SQL `LIMIT`; no cursor. | `PROPOSED`: bounded typed search snapshot.                                    | 20 / 20 / 20                           | Server ranking only; query text never appears in snapshot key, URL, storage, or logs.                                           | Server applies type, scope, sensitivity, and existence masking before response.                              | Raw query is never persisted; replace, never append, the snapshot.                                 |
| Command Palette navigation/search | No Section 3 implementation.                                                                  | `PROPOSED`: bounded snapshot supplied by server navigation/search contracts.  | 20 / 20 / 20                           | Server availability/ranking and stable command/result identity.                                                                 | Hidden means absent from DOM, palette, and search.                                                           | Filter only within the authorized bounded snapshot.                                                |

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

### Proposed client safety caps

These limits are `PROPOSED` implementation safety limits. They are independent
of later latency or rendering completion budgets and must be enforced before
data reaches a rendered or retained unbounded collection.

| Client concern                                       | Proposed safety cap                                                      | Required behavior at the cap                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Navigation DOM rows                                  | 8                                                                        | Render the server availability snapshot only; no client expansion.                                                            |
| Attention DOM rows                                   | 50                                                                       | Render at most two 25-item pages; require explicit next-page fetch after replacement/eviction.                                |
| Continue Working server DOM rows                     | 50                                                                       | Render at most two 25-item pages; browser drafts use a separate group.                                                        |
| Continue Working browser-draft DOM rows              | 10                                                                       | Reject/expire additional local drafts through the registry; do not evict a valid draft silently.                              |
| Recent DOM rows / Pinned DOM rows                    | 50 / 50                                                                  | Render the bounded server snapshot only.                                                                                      |
| Background detail DOM rows                           | 50                                                                       | Render at most two 25-item detail pages; summary remains bounded to 20 groups.                                                |
| Notification DOM rows                                | 50                                                                       | Render at most two 25-item pages; refetch from watermark instead of accumulating IDs.                                         |
| Search DOM rows / Command Palette result rows        | 20 / 20                                                                  | Replace the bounded snapshot on query/filter change; never append an unbounded client result set.                             |
| TanStack Query retained pages per Section 3 list key | 2                                                                        | Evict the oldest page before retaining a third; no persistent query cache.                                                    |
| Project-switch cache preservation                    | 0 prior active-Project Section 3 pages; valid principal-global keys only | Cancel and remove project-scoped keys on switch; retain global keys only while their scope/policy revisions still match.      |
| Browser Draft registry                               | 10 drafts, 64 KiB per draft, 512 KiB total                               | Reject new draft writes over either limit with a typed local limit state; never truncate or auto-upload.                      |
| Notification explicit exception set                  | 100 IDs                                                                  | Compact through an authoritative server watermark/snapshot before adding another exception; never silently drop an exception. |
| Route recovery state                                 | 8 KiB per route, 32 KiB per Session                                      | Drop only non-authoritative presentation state on overflow and retain a safe default route state.                             |
| Persisted UI preferences                             | 16 KiB per Principal                                                     | Reject surplus preference payload; do not store protected resource metadata or server data.                                   |

### Numeric completion budgets deferred

The following remain performance-completion dimensions with no approved target:
response bytes, server/query/projection/decode/render latency, interaction
readiness, cache memory, and retained-query lifetime. Virtualization is also
`DEFERRED`; it is not adopted automatically and requires measured benefit plus
accessibility, focus, and stable-identity replacement evidence.

## Measurement method candidate

### Recorded environment

Each baseline result must record:

- Node `v24.15.0`, npm `11.12.1`, and Playwright `1.61.1` for this initial
  environment record; browser exact version must be captured in every result.
- Browser, viewport/device profile, headless/headed mode, CPU throttling,
  network profile, build mode, database state, seed revision, and cold/warm
  cache condition as fixed below.
- Repository commit, test command, fixture/seed digest, and artifact digest.

The existing Playwright configuration uses the `Desktop Chrome` device profile,
headless execution, and failure-only trace/screenshot/video retention. It is a
starting harness, not a completed Section 3 performance harness.

### Fixed measurement procedure candidate

| Concern              | Fixed candidate                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser engine       | Chromium through the pinned Playwright version; record the exact browser build.                                                                                                               |
| Desktop viewport     | 1440 × 900 CSS pixels.                                                                                                                                                                        |
| Mobile viewport      | 390 × 844 CSS pixels with touch enabled.                                                                                                                                                      |
| CPU profile          | Desktop: 4× throttling. Mobile: 6× throttling.                                                                                                                                                |
| Network profile      | Desktop: 10 Mbps down, 2 Mbps up, 40 ms RTT. Mobile: 1.6 Mbps down, 750 Kbps up, 150 ms RTT.                                                                                                  |
| Build and database   | Production build against a reset database and the versioned deterministic seed.                                                                                                               |
| Warm-up              | 3 unrecorded warm-up iterations for each scenario/profile.                                                                                                                                    |
| Recorded repetitions | 15 per scenario/profile: 5 cold-profile and 10 warm-profile runs.                                                                                                                             |
| Cold profile         | Fresh browser context, empty browser storage, empty Query Client, and freshly seeded/reset test state.                                                                                        |
| Warm profile         | Same authenticated browser context after one successful authorized snapshot; no scope, policy, or seed change between runs.                                                                   |
| Statistics           | Report every valid run, median, and nearest-rank P95 separately for cold and warm sets.                                                                                                       |
| Outliers             | Do not discard statistical outliers. Exclude only an instrumented failure with its error, trace reference, and rerun count recorded; a replacement run is appended, not substituted silently. |
| Evidence location    | `docs/engineering/performance/frontend-phase-1-section-3-performance-baseline-<date>-<sequence>.md` and `artifacts/performance/frontend-phase-1-section-3/<date>-<sequence>/`.                |

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

Measured evidence belongs at:

```text
docs/engineering/performance/
frontend-phase-1-section-3-performance-baseline-<date>-<sequence>.md

artifacts/performance/frontend-phase-1-section-3/
```

No directory or artifact is created by this record. Published trace, HAR,
screenshot, or result summaries must exclude raw search text, cookies, CSRF
tokens, credentials, sensitive titles, and inaccessible Project or Resource
identifiers.

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
