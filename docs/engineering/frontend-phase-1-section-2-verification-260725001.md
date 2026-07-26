# Frontend Phase 1 Section 2 Verification Report

- Date: 2026-07-26
- Target: Frontend Phase 1 Section 2 — Settings & Project Administration
- Branch: `codex/frontend-phase-1-section-2`
- Base working commit: `f016e77c1b646b5a99fcfc0d284fac8c842b34bd`
- Implementation Review: **Pending User Approval** (local AC evidence verified)
- Product API Contract Freeze: **Pending**
- PR: **Draft**
- Merge: **Not Performed**
- Canonical: **Not Updated**
- Phase 1 Section 3: **Not Started**

## Current implementation scope

- Versioned `FrontendCommandRequest 1.0.0` and Section 2 command registry
- Server-derived authority context, `commandId`, semantic digest, accepted contexts, and typed outcomes
- In-memory and PostgreSQL Frontend Command Gateway adapters
- Additive command-ledger migration `018`; committed migration `017` remains unchanged
- Typed revision and policy preconditions for Preference, Project, and Settings writes
- `clientRequestId` outcome recovery without automatic new-key resubmission
- Runtime decoders for Section 2 Product API views
- Server-derived Settings impact metadata
- ADR-114, Module Architecture, OSS review, normalization candidates, and contract snapshots

## AC-01 through AC-30 status

`Verified` means the criterion has matching implementation and passing local evidence on the
current working tree. It does not mean that user review, Product API contract freeze, PR
approval, merge, or Canonical publication has occurred.

- **AC-01 — Typed contract and runtime decoder:** Verified by request/view decoder contract
  tests and fail-closed route integration.
- **AC-02 — Settings scope:** Verified by Principal, Project, System, and Resource scope
  decoder tests.
- **AC-03 — Application mode and risk:** Verified by server-derived impact and
  application-mode tests.
- **AC-04 — Category index:** Verified by category index frontend tests.
- **AC-05 — All Section 2 routes:** Verified by Settings nested-route and workspace
  regression coverage.
- **AC-06 — Active/target/resource context:** Verified by Settings layout, command request,
  and Project binding tests.
- **AC-07 — Draft state:** Verified by actual `useSettingsDraft` state-machine unit tests.
- **AC-08 — Leave guard:** Verified by dirty registration and reset/unregister Hook tests.
- **AC-09 — Server validation:** Verified by runtime validation and Product API negative tests.
- **AC-10 — Impact preview:** Verified by server-derived preview contract and Advanced
  workspace tests.
- **AC-11 — Revision conflict and `STALE`:** Verified by pinned Settings/Policy revision and
  Snapshot-change Hook tests.
- **AC-12 — Idempotency and `OUTCOME_UNKNOWN`:** Verified by Gateway, response-loss E2E, and
  no-resubmission Hook tests.
- **AC-13 — Project list:** Verified by Project administration view and browser tests.
- **AC-14 — Create Project:** Verified by principal-admin command, Owner membership, and
  produced-resource tests.
- **AC-15 — Rename Project:** Verified by metadata command and typed Project precondition
  tests.
- **AC-16 — Archive/restore Project:** Verified by lifecycle command integration and browser
  tests.
- **AC-17 — Delete request:** Verified by delete-request lifecycle command tests.
- **AC-18 — Principal preferences:** Verified by versioned preference command integration and
  browser tests.
- **AC-19 — Model policy:** Verified by Advanced model policy validate/preview/apply tests.
- **AC-20 — Cost and budget:** Verified by cost/budget runtime decoder and workspace
  regression tests.
- **AC-21 — Privacy and retention:** Verified by privacy/retention impact decoder and
  workspace tests.
- **AC-22 — Connector security:** Verified by masked-secret decoder and security negative
  tests.
- **AC-23 — Directive and Fact proposal:** Verified by Proposal-only boundary contract and
  architecture tests.
- **AC-24 — Schema and Advanced Settings:** Verified by Schema decoder and Advanced Settings
  command workflow.
- **AC-25 — Diagnostics:** Verified by Diagnostics decoder and workspace regression tests.
- **AC-26 — Policy revision/cache invalidation:** Verified by Policy revision pinning,
  query-key, cache purge, and browser tests.
- **AC-27 — Accessibility:** Verified by dialog focus trap, Escape, initial focus, and focus
  restoration E2E.
- **AC-28 — Security negative tests:** Verified by authority injection, CSRF, cross-Project,
  stale, and secret tests.
- **AC-29 — Automated verification:** Verified by core, database, frontend, Stage 12,
  security, OSS, and SBOM gates.
- **AC-30 — End-to-end browser verification:** Verified by the Chromium Section 1/2 suite,
  including recovery without resubmission.

## Verification observations

- PostgreSQL was recreated from migrations and verified before the 16-file, 82-test database run.
- The response-loss E2E intercepted a successful server command response, forced the browser
  into `OUTCOME_UNKNOWN`, resolved the existing command by `clientRequestId`, and confirmed
  that no second command submission occurred.
- The actual `useSettingsDraft` Hook pins active, target, resource, Settings revision, and
  Policy revision context on first edit. A dirty Snapshot/Project change preserves the draft
  and transitions to `STALE`; reset returns `CLEAN` and releases the pin.
- The Stage 12 gate initially encountered an OS permission error in the configured global npm
  cache. A second sandboxed attempt confirmed registry access was required. The same gate then
  passed using an isolated workspace cache with approved registry access.
- `npm audit` similarly required approved advisory-endpoint access and passed with zero
  vulnerabilities.
- The production frontend build passed with non-blocking warnings for the existing
  `node:crypto` browser externalization and a 558.42 kB JavaScript chunk.
- `secret:scan` passed; Git also emitted a non-blocking warning that the sandbox could not read
  the user's global Git ignore file.

## Final command ledger

| Command                                     | Status | Evidence                                                |
| ------------------------------------------- | ------ | ------------------------------------------------------- |
| `npm.cmd run lint`                          | PASS   | ESLint completed with exit 0                            |
| `npm.cmd run format:check`                  | PASS   | All configured files matched Prettier style             |
| `npm.cmd run typecheck`                     | PASS   | Root TypeScript check completed with exit 0             |
| `npm.cmd run test:unit`                     | PASS   | 22 files, 95 tests, including 4 actual Draft Hook tests |
| `npm.cmd run test:contract`                 | PASS   | 18 files, 156 tests                                     |
| `npm.cmd run test:integration`              | PASS   | 10 files, 39 tests                                      |
| `npm.cmd run db:reset`                      | PASS   | Migrations applied and schema recreated                 |
| `npm.cmd run db:verify`                     | PASS   | Database bootstrap verified                             |
| `npm.cmd run test:database`                 | PASS   | 16 files, 82 tests                                      |
| `npm.cmd run test:architecture`             | PASS   | Architecture boundaries verified                        |
| `npm.cmd run frontend:check`                | PASS   | Typecheck, 18 tests, build, and Chromium E2E 8/8        |
| `npm.cmd run check:core`                    | PASS   | Complete core composite gate                            |
| `npm.cmd run stage12:reuse-operations-gate` | PASS   | Six steps passed using an isolated npm cache            |
| `npm.cmd run secret:scan`                   | PASS   | Secret scan passed                                      |
| `npm.cmd run oss:verify`                    | PASS   | 68 decisions, 45 baselines, Stage 0-12 reviews complete |
| `npm.cmd run oss:audit`                     | PASS   | Zero vulnerabilities at the high threshold              |
| `npm.cmd run oss:sbom`                      | PASS   | CycloneDX 1.5 SBOM generated to stdout                  |

## Readiness

The local working tree has implementation and passing evidence for AC-01 through AC-30.
Nevertheless, the workflow remains **Pending User Approval** and **Draft**. This report must
not be read as Product API contract freeze, PR approval, merge authorization, Canonical
publication, or permission to start Phase 1 Section 3. Those transitions require explicit user
approval and the applicable remote evidence.
