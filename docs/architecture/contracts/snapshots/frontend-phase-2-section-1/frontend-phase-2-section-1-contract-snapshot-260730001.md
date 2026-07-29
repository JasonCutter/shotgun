# Frontend Phase 2 Section 1 — Sources Workspace Contract Snapshot

- Snapshot ID: `frontend-phase-2-section-1-contract-snapshot-260730001`
- Approval date: 2026-07-30
- Approved by: user
- Status: **APPROVED AND FROZEN**
- Classification: `ACTIVE_BASE`
- Governing ADR: ADR-122
- Product implementation at approval: **NOT STARTED / SEPARATELY UNAUTHORIZED**
- Canonical authority: GitHub `main` after merge

## 1. Scope

This Snapshot freezes the Product acceptance contract for Frontend Phase 2 Section 1 — Sources Workspace.

In scope:

- Project-fixed Intake Draft Queue;
- direct text, file and URL input;
- validation, progress, asynchronous submission and recovery;
- exact-duplicate detection and explicit disposition;
- Source Library, search, filters and pagination;
- Source detail and SourceVersion history;
- original Preview and format-specific locators;
- Evidence highlight, Citation return and Ask eligibility;
- Project, Session, capability, sensitivity, policy, cache and offline boundaries;
- accessibility, security, performance and E2E completion evidence.

Out of scope:

- Phase 2 Section 2 Ask and Conversations implementation;
- Canonical Knowledge editing or approval;
- External Action execution;
- Production deployment and Production SLOs;
- audio/video file analysis, automatic transcription and frame analysis;
- automatic Source merge or semantic near-duplicate merge;
- Migration or Runtime Dependency authorization.

## 2. Fixed terminology

- `SourceIntakeDraft`: Browser route-scoped, Project-fixed presentation draft before submission.
- `IntakeDraftSeed`: typed seed from another Workspace that must re-enter Sources validation.
- `IntakeSubmissionSnapshot`: Server-authoritative submitted intake resource and current state.
- `InputManifest`: safe metadata describing submitted direct text, files or URLs.
- `ExactDuplicateDecisionView`: immutable Server snapshot describing exact-duplicate evidence and allowed user dispositions.
- `Source`: user-managed logical source.
- `SourceVersion`: immutable version selected for Preview, Evidence and Ask.
- `OriginalAsset`: immutable original bytes or direct-text representation identified by content hash.
- `SourcePreviewView`: Server projection for original or transformed preview and locator navigation.
- `askUsageState`: Server-provided Ask eligibility distinct from Library visibility and Preview readiness.

## 3. Acceptance Criteria

### AC-01 — Versioned Product API and runtime decoding

All Sources reads and writes use versioned Product API contracts with deep runtime decoders and the shared typed failure envelope. Browser code must not consume internal Kernel envelopes, raw database rows or unvalidated payloads.

### AC-02 — Server-derived authority context

Principal, Session, Active Project, Resource Project, capability, sensitivity, retention and policy context are derived and validated by the Server. Browser authority headers, arbitrary storage keys and client-created Source/Version authority are rejected.

### AC-03 — Sources route and protected workspace

`/sources` replaces the placeholder with a protected Sources Workspace behind the common Session and Route Guard boundary. Route denial, zero-project state, backend unavailable and access loss fail closed without leaking protected Source existence.

### AC-04 — Project-fixed Intake Draft Queue

Each `SourceIntakeDraft` is fixed to its creation Project. Active Project changes do not migrate, submit or discard the draft automatically. The UI clearly shows Draft Project when it differs from Active Project and provides explicit return, discard or switch actions subject to Leave Guard.

### AC-05 — Draft Seed re-entry

`IntakeDraftSeed` may prefill safe input metadata, but it never creates an IntakeSubmission, Source or SourceVersion directly. The user must review validation and explicitly submit from Sources Workspace.

### AC-06 — Supported input modes

The Product contract supports direct text, file and URL descriptors. Supported formats and limits are Server descriptors. Unsupported, encrypted, corrupt, inaccessible, policy-blocked or oversized inputs produce typed validation results rather than generic failure strings.

### AC-07 — Client-side preflight is advisory

Browser validation may improve feedback but is not authority. The Server repeats format, size, hash, filename, protocol, policy, capability and safety validation before accepting the command.

### AC-08 — File upload and immutable original preservation

Accepted file input preserves original bytes through the existing Original Asset boundary. Upload progress, cancellation availability and retry meaning are typed. Browser paths are never transmitted as authority or returned by the Product API.

### AC-09 — Secure Server-side URL acquisition

URL intake uses a Server `UrlAcquisitionPort`. Every request and redirect hop revalidates protocol, DNS result, IP class, egress policy, redirect limits, timeouts, compressed/decompressed byte limits, content type and credential forwarding. Browser direct fetch is not used for ingestion.

### AC-10 — URL provenance receipt

Successful or failed URL acquisition records safe provenance including requested URL, final URL, redirect-chain digest, retrieval timestamp, response metadata, content hash, policy context and typed failure reason. Sensitive headers, cookies, credentials and private addresses are never exposed in Browser views or logs.

### AC-11 — Command, idempotency and semantic digest

Submission, cancel, retry and duplicate disposition use `FrontendCommandRequest` with `clientRequestId`, idempotency, semantic digest, Project context, policy binding and typed preconditions. Duplicate transport delivery creates no duplicate Domain resource.

### AC-12 — Intake Submission Snapshot authority

After acceptance, `IntakeSubmissionSnapshot` is the authority for state and progress. At minimum it distinguishes validation, queued, running, partial, action required, succeeded, failed, cancel requested, cancelled and outcome-indeterminate conditions without relying on client inference.

### AC-13 — Partial success and user attention

Multi-input submission may complete partially. The Snapshot provides per-item result, produced resource references, safe failure reason, retry capability and explicit user-attention reason. Partial success is not flattened to total success or total failure.

### AC-14 — Outcome Unknown recovery

A lost or timed-out response does not trigger automatic submission with a new key. The Browser resolves the existing command by `clientRequestId`, then resolves the expected IntakeSubmission and produced Source/Version references.

### AC-15 — Cancellation semantics

Cancel is available only when the Server supplies capability. Cancellation does not claim rollback of already persisted OriginalAsset, Source or SourceVersion data. Per-item and submission-level outcomes remain auditable.

### AC-16 — Domain retry semantics

Retry is a new Domain Attempt linked by correlation and causation. The UI distinguishes same-context retry, current-policy retry and new submission where the Server exposes those capabilities. Retry never overwrites prior Attempt history.

### AC-17 — Exact duplicate detection authority

Exact duplicate evidence is computed by the Server from immutable content hash and accepted source/version context. Browser filename, URL string or preview similarity alone cannot establish duplicate identity.

### AC-18 — Explicit duplicate disposition

When user choice is required, an immutable `ExactDuplicateDecisionView` exposes only Server-allowed dispositions: reuse existing version, create a version candidate for an identified Source, create a separate Source or cancel. The choice is an explicit command with decision revision precondition.

### AC-19 — Duplicate concurrency and stale decision safety

Concurrent or repeated duplicate decisions produce at most one accepted disposition per decision revision and idempotency scope. Stale decisions fail with a typed conflict and are not silently applied to changed Source state.

### AC-20 — Source Library projection

The Source Library is a bounded Server projection scoped to the active Project. It provides stable item identity, safe metadata, readiness, user-attention state and capabilities. The Browser does not rank or derive authoritative lifecycle state from raw counts.

### AC-21 — Search, filters and pagination

Library search, filters, sort and pagination are Server-authoritative, bounded and cursor-based. Cursors bind to Project, query/filter digest, ordering and projection revision. Access or revision changes invalidate stale cursors safely.

### AC-22 — Visibility, Preview and Ask eligibility separation

Library visibility, Preview readiness and `askUsageState` are independent. `askUsageState` uses `NOT_READY`, `SOURCE_VERSION_READY`, `EVIDENCE_READY`, `ACTION_REQUIRED`, `FAILED` or `ACCESS_RESTRICTED` and includes typed selection capabilities and explanation.

### AC-23 — Source detail and immutable identity

Source detail displays logical Source identity, Project, safe metadata, lifecycle, capabilities and current projection state without exposing internal storage keys or private paths. Source rename or metadata edit, if implemented, remains a separate versioned command.

### AC-24 — SourceVersion history and pinning

Version history is ordered and bounded. Opening Preview, selecting for Ask or following a Citation pins an explicit SourceVersion. New Versions never silently replace the selected Version or move the user's focus.

### AC-25 — Original Preview and format-specific locators

Preview uses Server-authorized asset/document projections and supports the approved locator kinds, including text position/quote, page/BBox, cell, shape and CSS selector where available. Unsupported locator or missing asset fails explicitly without fabricated position.

### AC-26 — Evidence list, highlight and original return

Evidence views bind to SourceVersion, EvidenceSpan and exact locator. Highlight and original-return behavior verifies hash and revision. Translation, summary, annotation and AI output are visibly distinct and are not presented as Original Evidence.

### AC-27 — Citation return target

Navigation from another Workspace to Source/Evidence and back preserves originating route, Resource revision, selected Citation/assertion, scroll, focus and panel state. Return does not mutate Active Project or advance to a newer SourceVersion.

### AC-28 — Cache, storage and access-loss isolation

Query keys include Principal, Session, Active/Resource Project, Source, SourceVersion, projection revision, sensitivity and policy context. Session revocation, Project switch and access loss cancel or purge affected protected queries. Original payload, protected Evidence and credentials are not placed in persistent Browser storage by default.

### AC-29 — Offline, degraded and stale behavior

Offline mode may display only explicitly stale, previously authorized safe Snapshots. It blocks submit, URL acquisition, duplicate disposition, Server search, cancel, retry and protected original download. Backend degraded, projection lag and partial failure remain separate presentation axes.

### AC-30 — Security and privacy negative verification

Tests cover authority-header injection, CSRF, cross-Project reads/writes, masked existence, storage-key injection, filename/path disclosure, oversized and decompression-bomb input, disallowed URL protocols, private/link-local/metadata IPs, redirect revalidation, DNS rebinding simulation, credential forwarding, raw payload logging and sensitivity downgrade.

### AC-31 — Accessibility, responsive and performance gates

Desktop, tablet, mobile and 200% zoom provide equivalent core functionality. Keyboard and screen reader users can operate Draft Queue, validation, duplicate decision, Library, filters, Preview, version history and Evidence return. Focus, status/live regions, error association, dialog traps, touch targets and non-color state cues are verified. Bounded data sets and numeric performance budgets are measured and approved before completion.

### AC-32 — Implementation and completion governance

Completion requires contract, unit, integration, architecture, database, security, accessibility, performance and Chromium E2E evidence on an exact Head; all required remote Gates; explicit user approval; merge to `main`; and a separate Section completion record. Phase 2 Section 2 must not start before this Section is approved and merged.

## 4. Required implementation evidence

At minimum:

- Product API request/view runtime-decoder contract tests;
- existing Stage 2, 3 and 8 adapter replacement/compatibility tests;
- application coordinator integration tests;
- PostgreSQL persistence, idempotency, concurrency and rollback tests;
- URL acquisition security corpus and redirect/DNS/IP tests;
- exact-duplicate decision and race tests;
- SourceVersion, Evidence and Citation pinning tests;
- Project, Session, capability, sensitivity and cache negative tests;
- offline/degraded/outcome recovery tests;
- accessibility component and browser tests;
- deterministic representative/stress performance baseline and approved budget;
- end-to-end flows for direct text, file, URL, duplicate choice, partial success, Library, Preview and Evidence return.

## 5. Change control

AC-01 through AC-32 numbers and meanings are frozen.

Any change requires:

1. a new Contract Snapshot revision;
2. explicit base or supersession relation;
3. impact analysis;
4. ADR when authority, lifecycle, security, persistence or technology selection changes;
5. explicit user approval.

Implementation convenience, an OSS default or an existing database shape is not sufficient reason to weaken this contract.