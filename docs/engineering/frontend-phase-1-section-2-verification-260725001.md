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

| AC    | Criterion                               | Current status | Evidence                                                                |
| ----- | --------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| AC-01 | Ownership separation                    | Verified       | Domain ports, coordinator boundary, ADR-114, architecture gate          |
| AC-02 | Settings scopes                         | Verified       | Contract decoders and settings-policy tests                             |
| AC-03 | Application modes                       | Verified       | Descriptor/impact decoders and frontend tests                           |
| AC-04 | Server risk calculation                 | Verified       | Server-derived impact and Product API tests                             |
| AC-05 | Server capability/lifecycle             | Verified       | Project route negative and lifecycle tests                              |
| AC-06 | Secret masking                          | Verified       | Masked connector view contract and security regression tests            |
| AC-07 | Idempotency and client request identity | Verified       | Gateway unit, integration, database, and response-loss E2E tests        |
| AC-08 | Revision conflicts                      | Verified       | Typed preference, project, settings, and policy precondition tests      |
| AC-09 | CSRF                                    | Verified       | Product API and browser regression tests                                |
| AC-10 | Leave guard                             | Verified       | Frontend unit and browser tests                                         |
| AC-11 | Project context visibility              | Verified       | Settings layout and browser tests                                       |
| AC-12 | Monotonic Settings revision             | Verified       | PostgreSQL Section 2 tests                                              |
| AC-13 | Category index                          | Verified       | Frontend tests                                                          |
| AC-14 | Principal preferences                   | Verified       | Versioned command integration and browser tests                         |
| AC-15 | Project list/create                     | Verified       | Principal administration, owner membership, and produced resource tests |
| AC-16 | Project lifecycle                       | Verified       | Typed Project precondition and lifecycle tests                          |
| AC-17 | Model workspace                         | Verified       | Runtime decoder, validate/preview/apply UI, and browser tests           |
| AC-18 | Cost/budget workspace                   | Verified       | Runtime decoder and frontend regression tests                           |
| AC-19 | Privacy/retention workspace             | Verified       | Impact decoder and frontend regression tests                            |
| AC-20 | Connector workspace                     | Verified       | Masked-secret contract and frontend regression tests                    |
| AC-21 | Directive workspace                     | Verified       | Proposal-only boundary, contract, and architecture tests                |
| AC-22 | Schema workspace                        | Verified       | Runtime decoder and frontend regression tests                           |
| AC-23 | Diagnostics workspace                   | Verified       | Runtime decoder and frontend regression tests                           |
| AC-24 | Cache invalidation                      | Verified       | Query-key, project-cache, and browser tests                             |
| AC-25 | WAI-ARIA/keyboard                       | Verified       | Focus trap, Escape, initial focus, and focus restoration E2E            |
| AC-26 | Contract tests                          | Verified       | 18 files, 156 tests                                                     |
| AC-27 | Unit tests                              | Verified       | 22 files, 96 tests                                                      |
| AC-28 | Product API integration                 | Verified       | 10 files, 39 tests                                                      |
| AC-29 | Browser E2E                             | Verified       | Chromium 8/8, including recovery without resubmission                   |
| AC-30 | Full quality/security/OSS gates         | Verified       | Core, frontend, Stage 12, secret, audit, OSS, and SBOM gates            |

## Verification observations

- PostgreSQL was recreated from migrations and verified before the 16-file, 82-test database run.
- The response-loss E2E intercepted a successful server command response, forced the browser
  into `OUTCOME_UNKNOWN`, resolved the existing command by `clientRequestId`, and confirmed
  that no second command submission occurred.
- The Stage 12 gate initially encountered an OS permission error in the configured global npm
  cache. A second sandboxed attempt confirmed registry access was required. The same gate then
  passed using an isolated workspace cache with approved registry access.
- `npm audit` similarly required approved advisory-endpoint access and passed with zero
  vulnerabilities.
- The production frontend build passed with non-blocking warnings for the existing
  `node:crypto` browser externalization and a 557.47 kB JavaScript chunk.
- `secret:scan` passed; Git also emitted a non-blocking warning that the sandbox could not read
  the user's global Git ignore file.

## Final command ledger

| Command                                     | Status | Evidence                                                |
| ------------------------------------------- | ------ | ------------------------------------------------------- |
| `npm.cmd run lint`                          | PASS   | ESLint completed with exit 0                            |
| `npm.cmd run format:check`                  | PASS   | All configured files matched Prettier style             |
| `npm.cmd run typecheck`                     | PASS   | Root TypeScript check completed with exit 0             |
| `npm.cmd run test:unit`                     | PASS   | 22 files, 96 tests                                      |
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
