# Frontend Phase 1 Section 3 Verification Record

- Record ID: `frontend-phase-1-section-3-verification-260729001`
- Work order date: 2026-07-29
- Repository: `JasonCutter/shotgun`
- Base SHA: `ec750c91c2a405cfa684bb73eed73e4ad02938c2`
- Branch: `codex/frontend-phase-1-section-3`
- Status: **PERFORMANCE_BUDGET_APPROVAL_PENDING**
- Draft PR: [#42](https://github.com/JasonCutter/shotgun/pull/42)
- Final Head SHA: `6df6a2ee6e9d1697311ddac74d94d822ed86098c`
- Frontend Phase 1 completion: **NOT APPROVED**
- Canonical authority: GitHub `main`
- Notion classification: Execution Mirror / Candidate

## 1. Authority and scope

This Git-tracked record is the durable execution, failure, and verification
record for Frontend Phase 1 Section 3. It follows `docs/CANONICAL.md`,
ADR-115, ADR-116, ADR-118, ADR-119, the frozen AC-01 through AC-27 Contract
Snapshot, and the approved persistence revision.

The implementation scope is Global Shell, Home Action Center, protected Global
Search, navigation-only Command Palette, server route guards, first-run and
zero-project handling, and offline/degraded recovery. Phase 2 work, durable
knowledge processing, Hybrid Semantic Retrieval, production SPA serving, PR
Ready transition, merge, and Frontend Phase 1 completion are excluded.

## 2. Baseline and remote evidence

| Evidence               | Result                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/main`          | `ec750c91c2a405cfa684bb73eed73e4ad02938c2`                                                                                                   |
| GitHub Actions on Base | `PASS` — CI run `30423606386`                                                                                                                |
| GitHub Actions URL     | <https://github.com/JasonCutter/shotgun/actions/runs/30423606386>                                                                            |
| Section branch         | Existing merged Section 3 documentation branch fast-forwarded to the exact Base; no history rewrite                                          |
| Pre-existing user file | `docs/engineering/frontend-phase-1-section-3-adr-required-candidate-260728001.md` remains untracked, unmodified, and excluded from this work |

## 3. Initial gap and impact audit

### Existing reusable foundation

- Product Session V1 runtime decoder and protected Session Boundary
- server-authoritative active Project switching with CSRF and same-origin checks
- `X-Project-Id` and other legacy authority-header rejection
- React Router route selection and TanStack Query server cache
- Project-scoped protected-cache purge
- route-scoped Settings Draft and Leave Guard
- Frontend Command Ledger V1 and `clientRequestId` outcome lookup
- ADR-118 typed failure descriptor registry and Product failure envelope
- React 19.2.8, React Router 8.3.0, TanStack Query 5.101.4, and Playwright 1.61.1

### Missing Section 3 implementation

- Product Session V2 and Frontend Command Request V2 runtime contracts
- Principal-scoped command persistence and atomic first-Project bootstrap
- Section 3 projection/search ports and Application Coordinator
- Global Shell, Home Action Center, Global Search, Command Palette, and
  server-decoded Route Guard Product API views
- responsive Section 3 UI and zero-project onboarding
- Section 3 cache-key families, browser-draft presentation registry, recovery
  behavior, security tests, accessibility tests, performance evidence, and E2E

### Expected change areas

| Area                                     | Expected repository boundary                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Shared contracts and decoders            | `packages/contracts`, `packages/shotgun-api-client`                                      |
| Authentication and Session compatibility | `packages/authentication`, `adapters/postgres-auth`, Product Session routes              |
| Command V2 persistence                   | Frontend Command Gateway module/adapters and database schema                             |
| Atomic Project bootstrap                 | Assembly Application Coordinator or explicit transaction adapter                         |
| Read projections and search              | new replaceable application ports/adapters behind Product API                            |
| Web state ownership                      | typed query-key factories, route-scoped draft/presentation state, no global client store |
| UI                                       | `apps/shotgun-web` Global Shell, Home, search, palette, route guards, recovery           |
| Tests                                    | contract, unit, integration, database, architecture, frontend, and browser suites        |

### Security impact

The implementation touches Principal/Session/Project authority, Project
switching, command idempotency, protected query metadata, route existence
masking, and browser cache isolation. Every new route must reuse authenticated
server context, CSRF and same-origin protection where applicable, reject
browser authority headers, validate registered internal routes, and serialize
only authorized sensitivity-safe metadata.

## 4. Migration and dependency decision

### Database migration

`APPROVED_IMPLEMENTED`

The Base does not contain the ADR-116 schema expansion needed for:

- nullable `auth.sessions.active_project_id`,
- command-ledger V2 `envelope_version`, `scope_kind`,
  `active_project_id`, and `scope_binding_key`,
- nullable `target_project_id` for `PRINCIPAL` commands,
- version-aware scope constraints, and
- the per-Project single-owner partial unique index.

The existing schema cannot represent a valid zero-project Session or a
`PRINCIPAL project.create.v1` command without a fabricated Project. Product code
must fail closed rather than create a sentinel Project or browser side store.

The approved migration shape is:

```text
Preflight
-> Schema Expand
-> V1/V2 Compatibility Application
-> V2 Activate
-> Validate and Constrain
```

Required rollback is to the V1/V2 compatibility application after V2 data is
activated. Converting V2 rows to V1, restoring `active_project_id NOT NULL`
while zero-project Sessions exist, or inserting fake Projects is prohibited.
The migration was created and executed after the user granted the separate
ADR-116 migration approval.

### Runtime dependency

`NONE`

The initial implementation continues with the existing pinned React, React
Router, TanStack Query, and Playwright dependencies. Redux, Zustand, React Aria
Components, cmdk, TanStack Virtual, fetch-event-source, and new SSE
infrastructure are not introduced.

## 5. OSS integration decisions

| Candidate                    | Decision             | Boundary                                                 |
| ---------------------------- | -------------------- | -------------------------------------------------------- |
| React 19.2.8                 | `ADOPT` existing pin | component rendering only                                 |
| React Router 8.3.0           | `ADOPT` existing pin | route selection; no authorization ownership              |
| TanStack Query 5.101.4       | `ADOPT` existing pin | server cache through typed scope keys                    |
| Playwright 1.61.1            | `ADOPT` existing pin | browser verification                                     |
| React Aria Components 1.19.0 | `DEFER`              | no new dependency without separate evidence and approval |
| cmdk 1.1.1                   | `DEFER`              | palette implemented with existing dependencies           |
| TanStack Virtual 3.14.8      | `DEFER`              | adoption requires measured need and replacement tests    |
| fetch-event-source 2.0.1     | `DEFER`              | no initial SSE runtime                                   |
| `ddsyasas/llm-wiki`          | `REFERENCE_ONLY`     | action-oriented Home information hierarchy               |
| Inkeep OpenKnowledge         | `REFERENCE_ONLY`     | cockpit/activity presentation patterns only              |

No OSS runtime, internal database identifier, or schema becomes a Shotgun
Product API or Canonical identifier.

## 6. AC-01 through AC-27 traceability matrix

Statuses are only `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`. An item remains
`NOT_RUN` until its implementation and required evidence have actually run.

| AC    | Initial status | Planned code and evidence                                                                                                            |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01 | `BLOCKED`      | V1/V2 Session and Command contracts, runtime decoders, typed failures, command outcome recovery; ADR-116 migration approval required |
| AC-02 | `NOT_RUN`      | `GlobalShellView`, server navigation/readiness/warning/background/notification projections, contract and integration tests           |
| AC-03 | `NOT_RUN`      | desktop/tablet/mobile/narrow-mobile/200%-zoom Shell layouts and browser evidence                                                     |
| AC-04 | `NOT_RUN`      | non-optimistic switch, Leave Guard, outcome-unknown warning, project-cache purge tests                                               |
| AC-05 | `NOT_RUN`      | active/resource Project presentation, Resource binding, deep-link tests                                                              |
| AC-06 | `NOT_RUN`      | typed Home snapshot, six regions, loading/empty/error/unavailable/stale tests                                                        |
| AC-07 | `NOT_RUN`      | server-provided Primary Actions and navigation-only tests                                                                            |
| AC-08 | `NOT_RUN`      | server-ranked Attention items, stable identity, bounded cursor/cap tests                                                             |
| AC-09 | `NOT_RUN`      | server-resource and local browser-draft separation, cap/expiry/scope tests                                                           |
| AC-10 | `NOT_RUN`      | authorized Recent/Pinned snapshots and preference/domain separation tests                                                            |
| AC-11 | `NOT_RUN`      | principal-global Background summary projection and scope tests                                                                       |
| AC-12 | `NOT_RUN`      | Settings-owned bounded notification presentation and no-domain-effect tests                                                          |
| AC-13 | `NOT_RUN`      | server-prioritized leading warning and bounded summary tests                                                                         |
| AC-14 | `NOT_RUN`      | protected POST search request/result decoder and raw-query non-persistence tests                                                     |
| AC-15 | `NOT_RUN`      | server-order navigation/project-switch palette, dialog/keyboard/IME tests                                                            |
| AC-16 | `BLOCKED`      | zero-project Session V2, Principal bootstrap command, onboarding, atomic database tests; ADR-116 migration approval required         |
| AC-17 | `NOT_RUN`      | server `RouteGuardDecisionView`, masked decisions, fail-closed decoder tests                                                         |
| AC-18 | `NOT_RUN`      | registered deep-link recovery without active-Project mutation                                                                        |
| AC-19 | `NOT_RUN`      | connectivity/auth/session/backend/stale axes and mutation recovery tests                                                             |
| AC-20 | `NOT_RUN`      | typed project/global keys, revision isolation, purge and replacement tests                                                           |
| AC-21 | `NOT_RUN`      | projection ports/coordinator ownership and architecture tests                                                                        |
| AC-22 | `NOT_RUN`      | authority, CSRF, cross-project, masking, cache, redirect, and query negative tests                                                   |
| AC-23 | `NOT_RUN`      | keyboard, focus, name/role/state, live region, contrast, zoom, touch, and IME evidence                                               |
| AC-24 | `NOT_RUN`      | deterministic dataset, caps, baseline measurement, later user-approved numeric budget and final gate                                 |
| AC-25 | `NOT_RUN`      | all repository, contract, architecture, security, replacement, accessibility, performance, and OSS gates                             |
| AC-26 | `NOT_RUN`      | Section 3 desktop/tablet/mobile Playwright E2E                                                                                       |
| AC-27 | `BLOCKED`      | separate post-merge Frontend Phase 1 Completion Review and explicit user approval                                                    |

## 7. Pre-change baseline results

| Command                                 | Result    | Evidence                                                                                         |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `npm run docs:knowledge-flow:check`     | `FAIL`    | Base generated Knowledge Flow HTML is reported stale on Windows                                  |
| `npm run docs:validate`                 | `PASS`    | 289 Markdown links, ADR 1-121, Canonical/evidence/generated-artifact registries, migration drift |
| `npm run format:check`                  | `FAIL`    | 17 pre-existing files fail Prettier before Section 3 changes                                     |
| `npm run lint`                          | `PASS`    | completed before the formatting failure in `check:core`                                          |
| `npm run typecheck`                     | `PASS`    | root TypeScript check                                                                            |
| `npm run test:unit`                     | `PASS`    | 24 files, 106 tests                                                                              |
| `npm run test:contract`                 | `PASS`    | 19 files, 164 tests                                                                              |
| `npm run test:integration`              | `PASS`    | 11 files, 41 tests                                                                               |
| `npm run test:architecture`             | `PASS`    | architecture boundaries verified                                                                 |
| `npm run test:stage12-package`          | `BLOCKED` | Windows npm cache `EPERM` during `npm pack`; repository assertions did not run                   |
| `npm run test:database`                 | `BLOCKED` | PostgreSQL unavailable at localhost:5432 (`ECONNREFUSED`)                                        |
| `npm run frontend:check`                | `PASS`    | frontend typecheck; 5 files/18 unit tests; production build; 8 Playwright tests                  |
| `npm run stage12:reuse-operations-gate` | `BLOCKED` | first standalone-package step hit the same npm cache `EPERM`                                     |
| `npm run oss:audit`                     | `BLOCKED` | npm audit endpoint/cache unavailable in restricted baseline environment                          |

These are pre-change results. They are not Section 3 completion evidence.
Existing failures and environmental blockers must be rerun and resolved at the
final Head; none is waived.

## 8. Failure and retry history

1. `npm run check` stopped at stale generated Knowledge Flow output.
2. `check:core` was split into independent commands; lint and typecheck passed,
   while formatting retained its pre-existing failure.
3. `test:ci` passed unit, contract, integration, and architecture suites, then
   failed in the standalone package check because npm could not write its
   Windows cache.
4. `test:database` was executed and failed closed because PostgreSQL was not
   listening on localhost:5432.
5. A task-specific npm cache retry was attempted for the Stage 12.1 gate, but
   the restricted environment denied creation of that cache directory.
6. `oss:audit` was executed and retained as blocked when the npm audit endpoint
   and cache were unavailable.

## 9. Current approval boundary

- Implementation start: **APPROVED**
- ADR-116 database migration creation/execution: **APPROVED AND DONE**
- New runtime dependency: **NONE REQUESTED**
- Draft PR Ready transition: **NOT APPROVED**
- Merge: **NOT APPROVED**
- Frontend Phase 1 completion: **NOT APPROVED**

## 10. Final implementation update

The initial matrix and baseline above are retained as historical evidence.
This section is the current implementation and verification state.

Implemented scope:

- Product Session V2 and Frontend Command V2 runtime contracts while retaining
  the exact V1 API and writer path.
- additive ADR-116 migration, deterministic V1 backfill, compatibility trigger,
  and server-authoritative `PRINCIPAL project.create.v1`.
- atomic first-Project bootstrap across Project, single Owner membership,
  active Session, Settings/Policy revisions, command result, and audit records.
- replaceable Section 3 read ports, server Global Shell and Home projections,
  protected Search, and server Route Guard.
- responsive Global Shell, six-area Home Action Center, navigation-only Command
  Palette, zero-project onboarding, browser-draft isolation, cache isolation,
  degraded-state presentation, and recovery behavior.

The user-owned untracked file
`docs/engineering/frontend-phase-1-section-3-adr-required-candidate-260728001.md`
remains unmodified and is excluded from every commit.

## 11. Migration execution, compatibility, and rollback

Migration:
`db/migrations/019_frontend_section3_principal_bootstrap.sql`

### Expand

- `auth.sessions.active_project_id` becomes nullable.
- Command Ledger adds `envelope_version`, `scope_kind`,
  `active_project_id`, and `scope_binding_key`.
- `target_project_id` becomes nullable only for a valid V2 `PRINCIPAL` shape.
- V1/V2 scope-shape constraints and version-aware idempotency/scope indexes
  are additive.
- the existing single-Owner partial unique index is preserved and normalized
  to `auth_single_owner_per_project_idx`.

Preflight fails closed if an active Project has multiple Owners or an active
Session references a Project without a matching membership.

### Compatibility

- every V1 row is deterministically backfilled to envelope `1.0.0`, scope
  `PROJECT`, its existing target Project, and the exact canonical scope-binding
  JSON used by the TypeScript digest implementation.
- `frontend_command.apply_v1_scope_defaults()` and its `BEFORE INSERT` trigger
  keep an unmodified V1 writer operational after migration 019.
- V1 command lookup, idempotency error meaning, Product Session, and existing
  Section 2 command APIs remain available.
- migration replay through `runtime.schema_migrations` is idempotent.

### Activate

- a fresh Local Owner Session is valid with `activeProject: null` and
  `accessibleProjects: []`.
- the browser sends only a `PRINCIPAL` command and access revision `0`; it does
  not send a Project ID.
- the server creates the UUID Project, one Owner membership, active Session,
  command result, Settings/Policy state, and audits in one database
  transaction.
- a late Settings failure rolls back all bootstrap writes; concurrent initial
  bootstrap attempts permit exactly one commit.
- completed outcomes are recoverable by the original `clientRequestId`; an
  indeterminate outcome is not automatically resubmitted.

### Rollback and data impact

- before V2 activation, the V1 application can continue writing through the
  compatibility trigger.
- after any V2 or zero-project data exists, application rollback targets the
  V1/V2 compatibility application, not the pre-019 schema.
- rollback must not restore `active_project_id NOT NULL`, drop V2 columns, or
  translate Principal commands into fabricated Projects.
- schema contraction and V1 removal require a separately approved migration
  after proving that no zero-project Session or V2 ledger row remains.
- existing V1 rows and identifiers are preserved.

Runtime dependency change: **NONE**

## 12. Final AC-01 through AC-27 matrix

Only `PASS`, `FAIL`, `BLOCKED`, and `NOT_RUN` are used.

| AC    | Status    | Evidence                                                                                             |
| ----- | --------- | ---------------------------------------------------------------------------------------------------- |
| AC-01 | `PASS`    | V1/V2 contracts, deep runtime decoders, typed failures, scoped keys, browser-write negatives         |
| AC-02 | `PASS`    | server Global Shell projection and Product API integration                                           |
| AC-03 | `PASS`    | desktop, tablet rail, mobile bottom navigation/More, and 200% browser scenario                       |
| AC-04 | `PASS`    | non-optimistic switch, Leave Guard, unknown-outcome warning, scoped purge                            |
| AC-05 | `PASS`    | active/resource Project simultaneous presentation and deep-link binding                              |
| AC-06 | `PASS`    | six-area typed Home with loading, empty, stale, and error presentation                               |
| AC-07 | `PASS`    | server Primary Actions; unavailable workspaces have no active link                                   |
| AC-08 | `PASS`    | bounded Attention decoder preserves server order and stable identity                                 |
| AC-09 | `PASS`    | browser draft identity, expiry, revision, Project, Session, sensitivity, and route validation        |
| AC-10 | `PASS`    | bounded Recent/Pinned server snapshots and Project binding                                           |
| AC-11 | `PASS`    | independent background summary port composed by the coordinator                                      |
| AC-12 | `PASS`    | notification presentation port separated from domain resolution                                      |
| AC-13 | `PASS`    | single server-prioritized warning plus bounded additional count                                      |
| AC-14 | `PASS`    | protected typed Search, explicit cross-Project scope, transient raw text                             |
| AC-15 | `PASS`    | navigation-only palette, shortcut, focus trap/restore, no high-risk commands                         |
| AC-16 | `PASS`    | zero-project V2 Session, Principal bootstrap, atomic/replay/concurrency DB tests, browser onboarding |
| AC-17 | `PASS`    | server Route Guard and denied-route decoder masking                                                  |
| AC-18 | `PASS`    | allowed/masked deep links do not mutate active Project                                               |
| AC-19 | `PASS`    | separate connectivity/session/backend/readiness/stale states and no outcome auto-resubmit            |
| AC-20 | `PASS`    | Principal/Session/Project/revision keys, switch purge, global cache preservation                     |
| AC-21 | `PASS`    | replaceable read ports/coordinator and architecture boundary test                                    |
| AC-22 | `PASS`    | authority header/injection, CSRF, cross-Project, sensitivity, Search, masking negatives              |
| AC-23 | `PASS`    | keyboard, name/role/state, focus trap/restore, live status, responsive and 200% scenarios            |
| AC-24 | `BLOCKED` | 600-run baseline and numeric budget candidates recorded; explicit numeric budget approval remains    |
| AC-25 | `PASS`    | exact Head `1eccfb38` passed every required GitHub Gate in run `30444809403`                         |
| AC-26 | `PASS`    | 13 Chromium E2E tests including 5 Section 3 scenarios                                                |
| AC-27 | `BLOCKED` | requires final Draft PR gates, user approval, merge, and separate completion review                  |

Section 3 and Frontend Phase 1 are not declared complete.

## 13. Final local verification

### Passing commands

| Command                                 | Result                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run docs:validate`                 | `PASS`: 289 links, ADR 1-121, registries and migration drift                                        |
| `npm run lint`                          | `PASS`                                                                                              |
| `npm run typecheck`                     | `PASS`                                                                                              |
| `npm run test:ci`                       | `PASS`: Unit, Contract, Integration, Architecture, and Stage 12 package on the final local worktree |
| `npm run test:unit`                     | `PASS`: 26 files, 115 tests                                                                         |
| `npm run test:contract`                 | `PASS`: 20 files, 171 tests                                                                         |
| `npm run test:integration`              | `PASS`: 13 files, 48 tests                                                                          |
| `npm run test:architecture`             | `PASS`                                                                                              |
| `npm run test:stage12-package`          | `PASS` after approved OS-level npm cache access                                                     |
| `npm run test:database`                 | `PASS`: 17 files, 86 tests                                                                          |
| `npm run db:reset`                      | `PASS`: migrations 001 through 019 reapplied                                                        |
| `npm run db:verify`                     | `PASS`                                                                                              |
| `npm run frontend:typecheck`            | `PASS`                                                                                              |
| `npm run frontend:test`                 | `PASS`: 6 files, 22 tests                                                                           |
| `npm run frontend:build`                | `PASS`: 594.76 kB JS / 170.93 kB gzip, with the AC-24 chunk warning recorded                        |
| `npm run frontend:test:e2e`             | `PASS`: 13 tests                                                                                    |
| `npm run frontend:performance:baseline` | `PASS`: 600 runs, 0 failures, artifact digest `c5c7ef75...84332`                                    |
| `npm run stage12:reuse-operations-gate` | `PASS`: package, assembly/replacement, quality, DB, secret, OSS                                     |
| `npm run oss:audit`                     | `PASS`: 0 vulnerabilities                                                                           |
| GitHub Actions run `30444459626`        | `PASS` on implementation Head `6e7fa537`: Frontend, Quality, and Required Gates                     |
| GitHub Actions run `30444809403`        | `PASS` on exact Head `1eccfb38`: Frontend, Quality, Required Gates, Database, and E2E               |

### Local environment divergence

| Command                             | Result                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run docs:knowledge-flow:check` | `LOCAL_ENVIRONMENT_DIVERGENCE`: generated baseline differed locally; exact Head passed remotely |
| `npm run format:check`              | `LOCAL_ENVIRONMENT_DIVERGENCE`: local Windows result differed; exact Head passed remotely       |

These results remain visible and are not rewritten as local passes. GitHub
Actions run `30444809403` executed both required Gates on the exact final
implementation Head in a clean environment, so they do not block AC-25.

## 14. Final failure and retry history

1. PostgreSQL was initially unavailable. The repository database container was
   started, migration 019 was applied, a clean reset was performed, and the
   full Database Gate passed.
2. Migration review found that non-null V2 columns alone would break an old V1
   writer. A compatibility trigger and real post-migration V1 INSERT regression
   were added before activation.
3. one terminated database command left task-started Node children holding
   locks. Only those processes were stopped; reset and migration tests passed.
4. browser tests exposed a missing Vite `/product-api` proxy and a
   Session/Route-Guard loader race. The proxy and query-deduplicated Session
   ordering were corrected.
5. Search checkbox state read a React event after the callback. The checked
   value is captured synchronously and E2E passes.
6. zero-project E2E exposed a V1-only Session Boundary decoder. The API client
   now validates and carries Product Session V1 or V2 while V1 remains intact.
7. asynchronous Home rendering exposed missed heading focus. A bounded
   MutationObserver focuses the route H1 and disconnects.
8. the browser fixture custom Project repository omitted the Owner membership
   callback. Restoring it fixed the Section 2 parallel regression.
9. Stage 12 package and audit initially failed on restricted npm cache/network
   access. Exact commands passed with approved OS-level access. The temporary
   workspace cache was verified and removed.
10. local Windows formatting and Knowledge Flow divergence remains recorded;
    the exact implementation Head passed both required Gates in GitHub Actions
    run `30444809403`.
11. the first final `test:ci` retry hit the existing Stage 9 NetworkX comparison
    test's 5-second timeout at 5.466 seconds. The focused test then passed in
    1.600 and 1.367 seconds for its two adapters, and an unchanged full
    `test:ci` rerun passed all 113 Unit, 171 Contract, and 48 Integration tests,
    Architecture, and the Stage 12 package check.
12. the performance harness preflight corrected Windows process invocation,
    an unsafe temporary-output location, cross-Project fixture data, an omitted
    metric timestamp, and Scenario 05 route readiness. The first canonical
    Scenario 05 attempt then exposed structural sharing that prevented the
    browser-draft composition boundary from remounting. The harness now uses a
    Settings-to-Home navigation, and the final canonical run passed 600 runs
    with zero measured failures.
13. parallel local Gate execution caused a 5.025-second Stage 8 test timeout
    and a 10.135-second Database setup-hook timeout. The focused tests passed
    in 2.145 and 1.764 seconds. Sequential reruns then passed exact
    `test:ci` (115 Unit, 171 Contract, 48 Integration, Architecture, Package),
    all 86 Database tests, and the complete Stage 12 reuse operations Gate.
14. the first focused Database retry omitted the repository `.env` loader and
    failed before collecting tests. Repeating the exact test with
    `--env-file-if-exists=.env` passed; no test assertion was changed.
15. local `npm pack` and dependency Audit initially hit restricted npm cache
    and registry access. Their exact commands passed with approved OS-level
    access, and Audit reported zero vulnerabilities.

## 15. Performance evidence

- Baseline:
  `docs/engineering/performance/frontend-phase-1-section-3-performance-baseline-260729001.md`
- Artifact path:
  `artifacts/performance/frontend-phase-1-section-3/260729001/`
- Measurement Head: `6df6a2ee6e9d1697311ddac74d94d822ed86098c`
- Recorded runs: 600
- Measured failures: 0
- Artifact aggregate SHA-256:
  `c5c7ef75bfdc3f9a932d50b2f9cb8b1be65392952f62e0ebe49a3b4970084332`
- Measured bundle: 597,436 raw JavaScript bytes; 170,169 direct gzip bytes;
  Vite reports 597.43 kB / 171.86 kB gzip and the 500 kB warning.
- Final uninstrumented Product build: 594.76 kB / 170.93 kB gzip.
- Worst Interaction Readiness P95: Desktop Cold 5,289.9 ms, Desktop Warm
  1,663.3 ms, Mobile Cold 12,462.4 ms, Mobile Warm 3,431.1 ms.
- Proposed budgets: recorded in the baseline and awaiting explicit approval.
- Optimization decision: route-level lazy splitting is recommended;
  virtualization is not required at the current caps.

## 16. Final publication boundary

- Implementation Head `6e7fa537` GitHub Actions run `30444459626`:
  **FRONTEND PASS, QUALITY PASS, REQUIRED GATES PASS**
- Exact prior final Head `1eccfb38` GitHub Actions run `30444809403`:
  **KNOWLEDGE FLOW, DOCUMENTATION, FORMAT, LINT, TYPECHECK, DEPENDENCY,
  STAGE 12, CI, DATABASE, FRONTEND TYPECHECK/TEST/BUILD/E2E, QUALITY,
  FRONTEND, REQUIRED GATES PASS**
- Draft PR Ready transition: **NOT APPROVED**
- Merge: **NOT APPROVED**
- Frontend Phase 1 completion: **NOT APPROVED**
- Phase 2 start: **NOT APPROVED**

The Draft PR remains Draft. AC-24 remains blocked on numeric budget approval,
and AC-27 remains blocked on merge plus a separate completion review. AC-25 is
`PASS`.
