# Frontend Phase 1 Section 3 Verification Record

- Record ID: `frontend-phase-1-section-3-verification-260729001`
- Work order date: 2026-07-29
- Repository: `JasonCutter/shotgun`
- Base SHA: `ec750c91c2a405cfa684bb73eed73e4ad02938c2`
- Branch: `codex/frontend-phase-1-section-3`
- Status: **IMPLEMENTATION_IN_PROGRESS**
- Draft PR: **PENDING**
- Final Head SHA: **PENDING**
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

`REQUIRED_PENDING_APPROVAL`

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
No migration is created or executed before separate user approval.

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
- ADR-116 database migration creation/execution: **PENDING SEPARATE APPROVAL**
- New runtime dependency: **NONE REQUESTED**
- Draft PR Ready transition: **NOT APPROVED**
- Merge: **NOT APPROVED**
- Frontend Phase 1 completion: **NOT APPROVED**
