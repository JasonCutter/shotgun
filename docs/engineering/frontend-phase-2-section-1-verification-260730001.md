# Frontend Phase 2 Section 1 Verification Record

- Record ID: `frontend-phase-2-section-1-verification-260730001`
- Verification date: 2026-07-30
- Repository: `JasonCutter/shotgun`
- Base SHA: `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`
- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: [#46](https://github.com/JasonCutter/shotgun/pull/46)
- Tested implementation Head: `496af3d5a5b5903dbd1dcc6a19af157a6b836214`
- Exact-head GitHub Actions run: `30536214153`
- Status: **VERIFIED / USER APPROVED / READY FOR MERGE**
- AC result: **AC-01 through AC-32 PASS**
- FAIL: none
- BLOCKED: none
- NOT_RUN: none
- Canonical authority: GitHub `main` after PR #46 is merged
- Product implementation authorization: user, 2026-07-30
- Migration 020 authorization: user, 2026-07-30
- Product Write Route, Browser Submit, Production Staging and Production URL Fetch authorization: user, 2026-07-30
- PR Ready, merge and Section completion authorization: user, 2026-07-30

## 1. Final decision

Frontend Phase 2 Section 1 — Sources Workspace satisfies the frozen ADR-122 and
AC-01 through AC-32 contract on the tested implementation Head.

The implementation is approved for PR Ready transition and merge. The Section
completion claim becomes Canonical when PR #46, including this record and the
separate completion record, is merged to `main`.

This decision does not authorize or claim Frontend Phase 2 Section 2 Product
implementation, whole Phase 2 completion, Production deployment or Production
SLO completion.

## 2. Implemented boundary

The verified Product boundary includes:

- protected, versioned Sources Product read and write APIs;
- server-derived Principal, Session, Project, capability, sensitivity and policy authority;
- Project-fixed Browser Draft Queue and typed Draft Seed re-entry;
- Direct Text and File raw-input staging before Command acceptance;
- server-side URL acquisition with protocol, DNS, IP-class, redirect and byte limits;
- encrypted, context-bound and expiring Staging References;
- PostgreSQL Migration 020 for Sources Product submission, attempt, duplicate and URL provenance ownership;
- atomic Source, SourceVersion, OriginalAsset and Product submission persistence;
- exact duplicate decisions and explicit immutable dispositions;
- cancel, retry, outcome and per-item partial-result lifecycle projections;
- bounded Source Library, detail, immutable Version history and explicit Version pinning;
- original Preview, Evidence views and typed Citation return;
- protected cache isolation, Project switching, offline and degraded behavior;
- responsive and accessible Browser presentation within the approved Sources boundary.

## 3. Migration and dependency decisions

### Migration 020

**APPROVED / IMPLEMENTED / VERIFIED**

Migration 020 is additive. It introduces the durable `source_product` owners and
the Stage 2 compatibility amendment required for URL provenance, submission
snapshots, attempts and duplicate decisions. It does not contract an existing
schema or backfill historical Sources Product state.

Database reset, Stage 12 reuse/operations validation and the complete database
suite passed on the exact implementation Head.

### Runtime dependency

**APPROVED IF REQUIRED / NOT REQUIRED / NOT ADDED**

No new runtime package was necessary. Production Staging and URL acquisition use
current Node platform APIs and existing Shotgun Ports and Adapters. The lockfile
runtime dependency set was not expanded for this Section.

## 4. Exact-head remote verification

GitHub Actions run `30536214153` tested
`496af3d5a5b5903dbd1dcc6a19af157a6b836214`.

| Gate | Result |
| --- | --- |
| Knowledge Flow generated baseline | PASS |
| Documentation governance | PASS |
| Formatting | PASS |
| ESLint | PASS |
| Root TypeScript | PASS |
| Dependency audit | PASS |
| CycloneDX SBOM generation and validation | PASS |
| Database reset and Migration 020 application | PASS |
| Stage 12 reuse and operations gate | PASS |
| Unit, contract, integration, architecture and package suites | PASS |
| PostgreSQL database suite | PASS |
| Frontend TypeScript | PASS |
| Frontend component tests | PASS |
| Frontend production build | PASS |
| Chromium E2E, 16 tests | PASS |
| Required Gates aggregate | PASS |

The three Sources-specific Chromium scenarios passed in approximately 0.7 to
1.3 seconds each on the hosted runner. They cover successful Direct Text staging
and submission, Project-fixed Leave Guard behavior, responsive mobile URL
preflight and offline write/search blocking. Broader Preview, Version, Evidence,
duplicate, partial-result and URL security behavior is covered by the Product API,
component, contract, integration, unit and PostgreSQL suites below.

## 5. Evidence map

### Contract and decoder evidence

- `tests/contract/frontend-sources.contract.test.ts`
- `packages/contracts/src/frontend-sources.ts`
- `packages/contracts/src/frontend-sources-staging.ts`
- `packages/shotgun-api-client/src/sources-write-types.ts`
- `packages/shotgun-api-client/src/sources-write-client.ts`

### Product API and coordination evidence

- `tests/integration/frontend-sources-product-api.test.ts`
- `assemblies/shotgun-app/src/product-api/sources-routes.ts`
- `assemblies/shotgun-app/src/product-api/sources-write-runtime.ts`
- `modules/frontend-sources-product/src/index.ts`
- `modules/frontend-sources-write/src/product-service.ts`

### Persistence and lifecycle evidence

- `tests/database/frontend-phase-2-section-1-migration-020.test.ts`
- `tests/database/frontend-phase-2-section-1-sources-persistence.test.ts`
- `tests/database/frontend-phase-2-section-1-product-write.test.ts`
- `tests/database/frontend-phase-2-section-1-sources-lifecycle.test.ts`
- `tests/database/frontend-phase-2-section-1-duplicate-persistence.test.ts`
- `adapters/frontend-sources-write-postgres/src/product-service.ts`
- `db/migrations/020_frontend_phase2_sources_product_persistence.sql`

### Staging and URL security evidence

- `tests/unit/frontend-sources-staging.test.ts`
- `tests/unit/url-acquisition-security.test.ts`
- `tests/unit/url-acquisition-node.test.ts`
- `adapters/frontend-sources-staging-sealed/src/index.ts`
- `adapters/url-acquisition-node/src/index.ts`
- `modules/url-acquisition/src/index.ts`

The final security correction rejects non-canonical Base64URL encodings before
AES-GCM authentication, so an alternate textual token cannot resolve to the same
sealed bytes.

### Browser, accessibility and cache evidence

- `tests/browser/frontend-phase-2-section-1.spec.ts`
- `apps/shotgun-web/src/routes/sources-workspace.test.tsx`
- `apps/shotgun-web/src/routes/sources-leave-guard.integration.test.tsx`
- `apps/shotgun-web/src/sources/source-intake-drafts.test.tsx`
- `apps/shotgun-web/src/routes/source-detail-workspace.tsx`
- `tests/unit/frontend-query-keys.test.ts`

The Sources UI uses labelled controls, semantic lists, live status regions,
explicit alerts, pinned Evidence focus and typed return state. The mobile
390-by-844 Chromium scenario passed. Bounded Server pagination, a 50-item default
Library request, a one-MiB staging limit and measured hosted-runner interaction
times provide the current Section performance boundary. Phase 1 Global Shell
zoom, keyboard, focus and responsive gates remain the containing application
boundary and were rerun without regression.

## 6. AC-01 through AC-32 final traceability

| AC | Result | Final evidence |
| --- | --- | --- |
| AC-01 | PASS | Versioned contracts, deep decoders and typed failures |
| AC-02 | PASS | Protected routes derive authority from authenticated Server context; injection negatives pass |
| AC-03 | PASS | `/sources` and detail routes run behind Session and Route Guard boundaries |
| AC-04 | PASS | Project-fixed Draft Queue and Leave Guard component/E2E evidence |
| AC-05 | PASS | Typed Draft Seed re-enters Sources validation without creating Domain state |
| AC-06 | PASS | Direct Text, File and URL descriptors and bounded validation results |
| AC-07 | PASS | Browser advisory validation plus authoritative staging and Product validation |
| AC-08 | PASS | Immutable File bytes, content hash, progress state and Original Asset persistence |
| AC-09 | PASS | Replaceable server URL Port, DNS/IP/redirect/timeout/byte security corpus |
| AC-10 | PASS | Durable redacted URL provenance and failure/success receipt ownership |
| AC-11 | PASS | Versioned commands, idempotency, semantic digest and replay protection |
| AC-12 | PASS | Server-authoritative IntakeSubmissionSnapshot lifecycle |
| AC-13 | PASS | Per-item partial results, capabilities and attention reasons |
| AC-14 | PASS | Existing clientRequestId outcome resolution; no automatic new-key resubmit |
| AC-15 | PASS | Capability-controlled cancel and non-rollback semantics |
| AC-16 | PASS | New linked Attempts for same-context/current-policy retry |
| AC-17 | PASS | Exact duplicate authority from immutable content hash and accepted context |
| AC-18 | PASS | Immutable Decision and explicit allowed disposition command |
| AC-19 | PASS | Stale and concurrent decision tests permit at most one disposition |
| AC-20 | PASS | Bounded active-Project Source Library projection |
| AC-21 | PASS | Server search/filter/sort/cursor contract and bounded query |
| AC-22 | PASS | Library visibility, Preview readiness and Ask state remain independent |
| AC-23 | PASS | Source detail masks storage keys and private paths |
| AC-24 | PASS | Ordered Version history and explicit Version pinning |
| AC-25 | PASS | Original Preview and approved text/page/cell/shape/CSS locators |
| AC-26 | PASS | Evidence binding, highlight, hash/revision verification and original return |
| AC-27 | PASS | Typed Citation return preserves resource revision, scroll, focus and panel identity |
| AC-28 | PASS | Principal/Session/Project/Version/revision/policy cache keys and purge negatives |
| AC-29 | PASS | Offline blocks write/search/download actions while stale safe reads remain explicit |
| AC-30 | PASS | CSRF, authority, cross-Project, storage, payload, URL and token negative suites |
| AC-31 | PASS | Semantic accessibility tests, mobile E2E, containing Shell gates and bounded measured performance |
| AC-32 | PASS | Exact-head full remote Gates, explicit user approval and authorized merge/completion record |

Aggregate:

```text
PASS: AC-01 through AC-32
FAIL: none
BLOCKED: none
NOT_RUN: none
```

## 7. Corrections discovered during final verification

Final gate execution found and corrected the following blocking defects without
changing the frozen AC meanings:

1. the PostgreSQL Browser Fixture had an Auth membership for the default Project
   without the corresponding Project Administration row;
2. the Fixture unnecessarily replaced the existing Settings test Adapter, which
   expanded Section 1 scope and broke unrelated Settings descriptors;
3. Node 24 URL transport required the `lookup({ all: true })` callback form;
4. URL stream limit rejection could race with response completion;
5. alternate non-canonical Base64URL spellings could decode to the same sealed
   token bytes.

The fixes preserve the intended Domain and Adapter boundaries. Historical failed
runs remain evidence and are not rewritten as passes.

## 8. Preserved boundaries

The following remain outside this completion claim:

- Frontend Phase 2 Section 2 Ask and Conversations Product implementation;
- Canonical Knowledge editing and approval;
- External Action execution changes;
- semantic near-duplicate merge or automatic Source merge;
- audio/video analysis and automatic transcription;
- Production deployment, production traffic validation and Production SLOs;
- schema contraction or removal of compatibility paths;
- whole Phase 2 or whole Frontend completion.

## 9. Completion transition

The user explicitly authorized PR #46 Ready transition, merge, final evidence,
Canonical plan and Evidence Registry updates, and Section 1 completion on
2026-07-30.

When PR #46 is merged:

```text
Frontend Phase 2 Section 1: COMPLETE / USER APPROVED / MERGED
AC-01 through AC-32: PASS
Frontend Phase 2 Section 2: NOT STARTED
```

The exact merge commit is GitHub's PR #46 merge object and is verified after the
merge operation. This record does not silently alter earlier Candidate,
BLOCKED or NOT_RUN history; it is the later final authority once present on
`main`.
