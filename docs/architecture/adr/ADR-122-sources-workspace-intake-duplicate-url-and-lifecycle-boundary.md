# ADR-122 — Sources Workspace Intake Draft, Duplicate Resolution, URL Acquisition and Source Lifecycle Boundary

- Status: **Accepted**
- Decision date: 2026-07-30
- Approved by: user
- Scope: Frontend Phase 2 Section 1 — Sources Workspace
- Supersedes: none
- Related ADRs: ADR-083, ADR-100, ADR-101, ADR-102, ADR-103, ADR-105, ADR-118, ADR-119

## Context

Shotgun already has reusable Stage 2, 3 and 8 modules for immutable Original Asset storage, Source and SourceVersion creation, format transformation, SourceMap, EvidenceSpan and original-position restoration. Those modules were built before the current Frontend Session, Project, Product API and Command boundaries.

The Sources Workspace must expose these capabilities without allowing the Browser to become Principal, Project, sensitivity, policy, duplicate-resolution or URL-fetch authority.

Four unresolved boundaries require one explicit decision:

1. Intake Drafts must remain editable Browser presentation state while submitted Intake becomes a Server Resource.
2. Exact duplicate handling needs explicit user choice without changing the low-level Stage 2 storage identity rules.
3. URL acquisition needs an operational SSRF and egress boundary; a transformation adapter alone is insufficient.
4. Source Library, Preview and Ask eligibility require Server projections rather than direct access to legacy module endpoints or database rows.

## Decision

### 1. Sources Product API owns the Browser boundary

The Browser accesses Sources through protected, versioned Product API routes.

The Product API:

- derives Principal, Session, Active Project, Resource Project, capability, sensitivity and policy context on the Server;
- rejects Browser authority headers and arbitrary storage or module identifiers;
- runtime-validates all request and response contracts;
- calls existing Intake, Original Asset, Transformation and Evidence ports through an Application Coordinator;
- returns typed Product Views and failure envelopes rather than internal Kernel envelopes or database records.

Existing Stage 2–8 HTTP endpoints may remain for internal development or compatibility, but they are not the Sources Workspace authority surface.

### 2. Intake Draft and Intake Submission are separate resources

`SourceIntakeDraft` is route-scoped Browser presentation state until submission.

A draft:

- is fixed to the Project in which it was created;
- does not move when Active Project changes;
- stores only safe local editing metadata and user-selected files through approved browser mechanisms;
- is not a Source, SourceVersion, OriginalAsset or Canonical record;
- may be seeded by an `IntakeDraftSeed` from another Workspace, but must re-enter Sources validation and explicit submission.

`IntakeSubmissionSnapshot` is the Server authority after submission. It preserves target Project, accepted policy context, input manifests, validation, attempts, progress, user-attention state, outcomes and produced resource references.

### 3. All writes use the Frontend Command Ledger

Create submission, cancel, retry and duplicate disposition are versioned `FrontendCommandRequest` commands.

- Transport retry preserves the same request, idempotency key and semantic digest.
- Domain retry creates a new Attempt linked by correlation and causation.
- `OUTCOME_UNKNOWN` is resolved by `clientRequestId`, Command outcome and expected Resource lookup; the Browser must not submit a new key automatically.
- Cancellation is capability-driven and does not imply rollback of already committed SourceVersion or OriginalAsset data.

### 4. Exact duplicate resolution is a Product decision resource

Content-hash equality, URL normalization signals and existing Source/Version relationships are Server evidence. The Browser does not decide duplicate identity.

When policy requires user choice, the Server creates an immutable `ExactDuplicateDecisionView` with safe references and allowed dispositions:

- `REUSE_EXISTING_VERSION`;
- `CREATE_VERSION_CANDIDATE` for a named existing Source;
- `CREATE_SEPARATE_SOURCE`;
- `CANCEL_SUBMISSION`.

The allowed set is capability- and policy-derived. A disposition is an explicit command with the decision revision as a precondition.

No existing Source is silently reused, versioned or merged. Concurrent decisions are serialized by command idempotency and decision revision.

### 5. URL acquisition is Server-side and replaceable

The Browser submits a URL descriptor; it does not fetch the target content for ingestion.

A replaceable `UrlAcquisitionPort` owns operational retrieval. Every request and redirect hop must enforce:

- allowed protocols;
- DNS resolution and resolved-IP validation;
- loopback, link-local, private, multicast, metadata-service and policy-blocked address rejection;
- redirect count and cross-origin policy;
- connection, header, body and total time limits;
- compressed and decompressed byte limits;
- content-type and filename policy;
- egress and Connector policy;
- credential, cookie and authorization-header non-forwarding unless an approved Connector owns them;
- provenance receipt including requested URL, final URL, redirect chain digest, retrieval time, response metadata and content hash.

Redirects are revalidated hop by hop. DNS rebinding and address changes fail closed. URL Preview and later retry use Server snapshots and do not trust Browser-fetched bytes.

### 6. Library, detail and Preview are Server projections

Sources Workspace reads versioned Product Views:

- `SourceLibraryPageView`;
- `SourceDetailView`;
- `SourceVersionHistoryView`;
- `SourcePreviewView`;
- `EvidenceListView`;
- `IntakeSubmissionSnapshot`;
- `ExactDuplicateDecisionView`.

Server projections own ranking, bounded search/filter, pagination cursors, status, readiness, capabilities, sensitivity-safe labels and user-attention reasons.

The Browser does not infer states from raw Stage names or database columns.

### 7. Library visibility, Preview readiness and Ask eligibility are distinct

A Source may be visible before it is usable by Ask.

The Server provides:

- Library visibility state;
- Preview readiness state;
- `askUsageState` with `NOT_READY`, `SOURCE_VERSION_READY`, `EVIDENCE_READY`, `ACTION_REQUIRED`, `FAILED` or `ACCESS_RESTRICTED`;
- typed actions and selection capabilities.

Selecting a Source pins a specific SourceVersion. The Browser never silently advances a selection or Citation to the latest Version.

### 8. Evidence and return context remain version-pinned

Citation and Evidence navigation bind to SourceVersion, EvidenceSpan and exact locator.

`CitationReturnTarget` preserves the originating Workspace, route, resource revision, scroll, focus and panel context. Returning to Sources must not mutate Active Project or move to a newer SourceVersion.

Original and translated or summarized text remain distinct. Generated text is not Original Evidence.

### 9. Cache and offline behavior follow authority scope

Query keys include Principal, Session, Active or Resource Project, Source identity, SourceVersion, projection revision, sensitivity and relevant policy revision.

Access loss, Session revocation or Project switch purges or masks protected Sources data according to scope.

Offline mode may show an explicitly stale, previously authorized safe Snapshot. It blocks submission, URL acquisition, search requiring Server authorization, duplicate disposition, retry, cancel and protected original download.

### 10. Schema and dependency changes remain separately controlled

This ADR does not authorize a database Migration or Runtime Dependency.

If implementation requires new durable resources or fields, use an additive `Expand → Compatibility → Activate → Validate` Migration, preserve existing Stage 2–8 data and adapters, and obtain explicit approval before execution.

A new upload, fetch, parsing, virtualization or state library requires an OSS decision, exact version and license, Port boundary, replacement test and separate approval.

## Consequences

- Existing Stage 2–8 modules remain reusable and are not replaced by a parallel Sources database model.
- Browser authority injection and direct internal endpoint coupling are prevented.
- Exact duplicates become auditable user decisions rather than implicit storage behavior.
- URL ingestion gains a secure operational boundary and provenance.
- Source Library status and Ask eligibility become explainable and version-safe.
- Implementation requires Product API projections, orchestration and likely additive persistence review rather than only a React page.

## Rejected alternatives

- exposing Stage 2 or Stage 3 endpoints directly to Browser code;
- trusting Browser-supplied Project, actor, scope or sensitivity headers;
- Browser-side URL fetch followed by upload;
- considering format-adapter URL support sufficient for secure acquisition;
- silently reusing an exact duplicate;
- always creating a new Source for an exact duplicate without user choice;
- silently adding identical bytes as the latest Version;
- treating Source processing status as Ask eligibility;
- automatically selecting the newest SourceVersion;
- using LocalStorage as durable Intake Submission authority;
- introducing a second Source or Evidence persistence model for the Frontend.

## Verification requirements

Implementation is not complete until the frozen Section Contract passes:

- contract and runtime-decoder tests;
- Product API integration and database tests;
- authority-header, cross-Project, SSRF, redirect, content-limit and masking negative tests;
- idempotency, duplicate-decision concurrency, cancellation, retry and unknown-outcome recovery tests;
- SourceVersion and Citation pinning tests;
- Desktop, tablet, mobile, keyboard, screen-reader and 200% zoom E2E;
- bounded-list and approved performance gates;
- separate user approval, merge and Section completion review.