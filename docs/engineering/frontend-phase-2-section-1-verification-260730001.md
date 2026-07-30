# Frontend Phase 2 Section 1 Verification Record

- Record ID: `frontend-phase-2-section-1-verification-260730001`
- Work order date: 2026-07-30
- Repository: `JasonCutter/shotgun`
- Base SHA: `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`
- Branch: `codex/frontend-phase-2-section-1`
- Status: **IMPLEMENTATION_IN_PROGRESS**
- Draft PR: `PENDING`
- Final Evidence Head SHA: `PENDING`
- Canonical authority: GitHub `main`
- Notion classification: Execution Mirror / Candidate
- Product implementation authorization: user, 2026-07-30
- Ready transition: **NOT APPROVED**
- Merge: **NOT APPROVED**
- Frontend Phase 2 completion: **NOT APPROVED**

## 1. Authority and scope

This Git-tracked record is the durable execution, failure, and verification
record for Frontend Phase 2 Section 1. It follows `docs/CANONICAL.md`, ADR-122,
the frozen AC-01 through AC-32 Contract Snapshot, the approved implementation
work order, and the repository-wide OSS integration rules.

The authorized implementation scope is the Sources Workspace Product boundary:
versioned Product API contracts, a server-authoritative Sources Application
Coordinator, project-fixed Intake Draft Queue, Direct Text and File intake,
secure server-side URL acquisition, exact duplicate decisions, Source Library,
Source detail and immutable Version history, Preview, Evidence and Citation
return, protected cache isolation, and offline/degraded behavior.

Frontend Phase 2 Section 2, PR Ready transition, merge, Phase 2 completion,
production SLO claims, new runtime dependencies, schema contraction, and any
database migration remain outside the current authorization.

## 2. Baseline and remote evidence

| Evidence                                      | Result                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `origin/main`                                 | `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`                                                                              |
| Canonical Revision in Notion execution mirror | exact match                                                                                                             |
| Frontend Phase 1 completion                   | `COMPLETE / USER APPROVED`                                                                                              |
| Section 3 PR                                  | [#42](https://github.com/JasonCutter/shotgun/pull/42), merged                                                           |
| Section 1 contract PRs                        | [#44](https://github.com/JasonCutter/shotgun/pull/44) and [#45](https://github.com/JasonCutter/shotgun/pull/45), merged |
| Base required-gate run                        | [30499930248](https://github.com/JasonCutter/shotgun/actions/runs/30499930248), `PASS`                                  |
| Isolated implementation worktree              | `C:\tmp\shotgun-frontend-phase-2-section-1`                                                                             |
| Original worktree protection                  | The user-owned untracked Section 3 ADR candidate remains untouched and excluded                                         |

## 3. Initial gap and impact audit

### Existing reusable foundation

- Stage 2 Direct Text and File intake normalization, immutable Original Asset
  bytes, Source, SourceVersion and StorageReceipt persistence
- Stage 3 DocumentIR, SourceMap and EvidenceSpan contracts
- Stage 8 bounded format adapters and format-specific structural selectors
- Product Session, Project Context, protected Product API, typed failure
  envelopes, Frontend Command Ledger V2 and outcome lookup
- React Router route selection, TanStack Query scoped cache ownership, protected
  cache purge, responsive Global Shell and offline/degraded axes
- PostgreSQL 16 persistence adapters and replaceable Module Ports

### Missing Product implementation

- Sources-specific versioned views, requests and deep runtime decoders
- protected Sources Product API and server-derived authority context
- Sources Application Coordinator over Stage 2, 3 and 8 Ports
- project-fixed browser draft queue and server submission snapshots
- exact duplicate detection, immutable disposition and stale-decision protection
- Source Library, detail, Version history, Preview, Evidence and Citation-return
  projections
- replaceable secure URL acquisition adapter and adversarial SSRF corpus
- Sources-specific cache keys, offline behavior, UI, accessibility, performance
  evidence and browser E2E

### Expected change areas

| Area                     | Expected repository boundary                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Contracts and decoders   | `packages/contracts`, `packages/shotgun-api-client`                                                      |
| Application coordination | new replaceable Sources Product module and adapters                                                      |
| Persistence              | existing Stage 2/3/8 and Command Ledger Ports; additive migration only after separate approval           |
| Product API              | `assemblies/shotgun-app` protected routes                                                                |
| Browser state and cache  | `apps/shotgun-web`, typed route draft and query-key families                                             |
| Verification             | contract, unit, integration, database, security, accessibility, performance, E2E and architecture suites |

### Security impact

The implementation handles untrusted filenames, content types, original bytes,
URLs, redirect chains, DNS/IP resolution, duplicate evidence, protected Source
metadata, Version-specific locators and browser caches. Every route must derive
Principal, Session, Project, capability, sensitivity and policy context on the
server; reject browser authority headers and arbitrary storage identifiers; mask
cross-Project or sensitive existence; redact credentials and original payloads;
and fail closed on unknown versions, enum values, routes and policy state.

## 4. Migration and dependency decision

### Database migration

`APPROVAL_REQUIRED`

The Base can durably store Direct Text and File intake, immutable Original
Assets, Sources, SourceVersions, StorageReceipts, Evidence and Frontend Command
outcomes. It cannot durably represent the ADR-122 URL acquisition provenance
receipt, including redirect-hop validation, DNS/IP observations, final
destination, acquisition limits and receipt revision.

The Frontend Command Ledger payload is not the owner of URL provenance and will
not be used as an untyped side store. A browser-generated identifier, local
storage record or fake Source is also prohibited.

An additive migration candidate may be designed and documented, but migration
SQL creation, local execution and activation require separate user approval.
Until then AC-09 and AC-10 remain `BLOCKED`; dependent URL E2E and final
repository completion evidence cannot pass.

### Runtime dependency

`NONE`

The implementation will use the current pinned runtime and Node platform APIs.
No parser, URL-fetch, upload, virtualization, client-state or component runtime
dependency will be added without separate approval.

## 5. OSS integration decisions

| Candidate                                       | Exact baseline                                                | Decision                    | Product boundary                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `lucasastorian/llmwiki`                         | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0       | `AUGMENT` existing extracts | reuse the existing format and locator packages behind Stage 8 and Evidence Ports; no SQLite, VaultFS, MCP or watcher runtime |
| `ddsyasas/llm-wiki`                             | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT              | `REFERENCE_ONLY`            | Source intake and action-oriented information hierarchy only; no backend, SQLite, ingest/query or LLM client                 |
| Inkeep OpenKnowledge                            | `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later | `REFERENCE_ONLY`            | source preservation, preview and evidence-grouping UX patterns only; no GPL code or runtime                                  |
| `garrytan/gbrain`                               | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT              | `REFERENCE_ONLY`            | bounded Source/Search/Job projection patterns only; no runtime, database or Canonical identity                               |
| PostgreSQL                                      | existing repository pin                                       | `ADOPT` existing            | Shotgun-owned durable Source, Version, Evidence and Command state behind Ports                                               |
| React, React Router, TanStack Query, Playwright | existing lockfile pins                                        | `ADOPT` existing            | rendering, route selection, scoped server cache and browser verification only                                                |

No upstream ID, schema, database or runtime becomes a Shotgun Product or
Canonical authority. Adapter replacement tests remain mandatory.

## 6. AC-01 through AC-32 traceability matrix

Only `PASS`, `FAIL`, `BLOCKED`, and `NOT_RUN` are used. An item remains
`NOT_RUN` until its implementation and required evidence have actually run.

| AC    | Initial status | Planned code and evidence                                                                                                     |
| ----- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | `NOT_RUN`      | versioned Sources requests/views, deep decoder and unknown-version/enum fail-closed tests                                     |
| AC-02 | `NOT_RUN`      | server-derived Principal/Session/Project/capability/sensitivity/policy and authority-header negative tests                    |
| AC-03 | `NOT_RUN`      | protected `/sources` route, registered deep links and Route Guard integration                                                 |
| AC-04 | `NOT_RUN`      | project-fixed route draft queue, switch isolation and leave-guard tests                                                       |
| AC-05 | `NOT_RUN`      | bounded Draft Seed handoff and re-entry without browser authority                                                             |
| AC-06 | `BLOCKED`      | Direct Text and File can proceed; URL mode depends on approved provenance persistence                                         |
| AC-07 | `NOT_RUN`      | advisory client preflight plus authoritative server validation tests                                                          |
| AC-08 | `NOT_RUN`      | upload, hash/size/media validation and immutable original-byte restoration                                                    |
| AC-09 | `BLOCKED`      | replaceable server URL acquisition adapter and SSRF/DNS-rebinding corpus; durable attempt receipt requires migration approval |
| AC-10 | `BLOCKED`      | immutable URL provenance receipt and revision require additive persistence approval                                           |
| AC-11 | `NOT_RUN`      | versioned command, semantic digest, idempotency and mismatch tests                                                            |
| AC-12 | `NOT_RUN`      | server-authoritative Intake Submission Snapshot and revision                                                                  |
| AC-13 | `NOT_RUN`      | multi-item partial result and stable user-attention presentation                                                              |
| AC-14 | `NOT_RUN`      | `clientRequestId` outcome recovery without automatic resubmission                                                             |
| AC-15 | `NOT_RUN`      | cancellation state machine and too-late/no-op semantics                                                                       |
| AC-16 | `NOT_RUN`      | domain retry with a new explicit command and no blind transport retry                                                         |
| AC-17 | `NOT_RUN`      | server exact-content detection and authorized duplicate evidence                                                              |
| AC-18 | `NOT_RUN`      | immutable duplicate disposition command and allowed-enum tests                                                                |
| AC-19 | `NOT_RUN`      | duplicate decision revision, race and stale precondition tests                                                                |
| AC-20 | `NOT_RUN`      | bounded Active-Project Source Library projection                                                                              |
| AC-21 | `NOT_RUN`      | protected POST search/filter/sort/cursor contract and ordering tests                                                          |
| AC-22 | `NOT_RUN`      | separate library visibility, Preview readiness and Ask usage-state axes                                                       |
| AC-23 | `NOT_RUN`      | Source detail, immutable identity and protected metadata masking                                                              |
| AC-24 | `NOT_RUN`      | SourceVersion history, explicit Version pin and no-auto-latest tests                                                          |
| AC-25 | `NOT_RUN`      | original/transformed Preview and supported text/page/cell/shape/CSS locators                                                  |
| AC-26 | `NOT_RUN`      | Evidence list/highlight and capability-revalidated original return                                                            |
| AC-27 | `NOT_RUN`      | typed CitationReturnTarget with focus and scroll restoration                                                                  |
| AC-28 | `NOT_RUN`      | Principal/Session/Project/Source/Version/revision/sensitivity/policy cache isolation and purge                                |
| AC-29 | `NOT_RUN`      | stale authorized read-only offline snapshot and blocked write/search/download tests                                           |
| AC-30 | `NOT_RUN`      | CSRF, authority, cross-Project, masking, storage, logging, SSRF and capability negative suites                                |
| AC-31 | `NOT_RUN`      | keyboard, screen reader, focus, zoom, responsive, representative/stress performance baseline and later budget                 |
| AC-32 | `BLOCKED`      | requires implementation evidence, Draft PR gates, user approval and merge; no Phase 2 completion claim                        |

## 7. Pre-change baseline

The exact Base required-gate run passed remotely. Local commands are recorded
below as they run; a remote pass does not conceal local environment divergence.

| Command                                                      | Result    | Evidence                                                                                            |
| ------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `npm run docs:knowledge-flow:check`                          | `NOT_RUN` | pending local baseline                                                                              |
| `npm run docs:validate`                                      | `PASS`    | 303 Markdown links, ADR 1-122, Canonical/evidence/generated-artifact registries and migration drift |
| `npm run format:check`                                       | `NOT_RUN` | pending local baseline                                                                              |
| `npm run lint`                                               | `NOT_RUN` | pending local baseline                                                                              |
| `npm run typecheck`                                          | `NOT_RUN` | pending local baseline                                                                              |
| `npm run audit:dependencies` or current canonical equivalent | `NOT_RUN` | pending local baseline                                                                              |
| `npm run stage12:reuse-operations-gate`                      | `NOT_RUN` | pending local baseline                                                                              |
| `npm run test:ci`                                            | `NOT_RUN` | pending local baseline                                                                              |
| `npm run test:database`                                      | `NOT_RUN` | pending local baseline                                                                              |
| `npm --prefix apps/shotgun-web run typecheck`                | `NOT_RUN` | pending local baseline                                                                              |
| `npm --prefix apps/shotgun-web test`                         | `NOT_RUN` | pending local baseline                                                                              |
| `npm --prefix apps/shotgun-web run build`                    | `NOT_RUN` | pending local baseline                                                                              |
| `npm --prefix apps/shotgun-web run test:e2e`                 | `NOT_RUN` | pending local baseline                                                                              |

## 8. Failure and retry history

1. Initial repository inspection confirmed that no URL acquisition provenance
   owner exists in migrations 001 through 019. This is a contract gap, not a
   test failure. The implementation will not conceal it in command payloads or
   browser storage.
2. A broad read-only inventory command included two obsolete documentation
   filenames and returned `PathNotFound`; the current canonical filenames were
   located with `rg`. No repository state changed.

## 9. Approval boundaries

The following remain explicitly unapproved:

- database migration creation or execution
- new runtime dependency
- PR Ready transition
- merge to `main`
- Frontend Phase 2 completion declaration
- Frontend Phase 2 Section 2 work
- production SLO declaration
- schema contraction or V1 compatibility removal
