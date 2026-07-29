# Frontend Phase 2 Section 1 — Sources Workspace Gap Audit

- Record ID: `frontend-phase-2-section-1-gap-audit-260730001`
- Record class: `ARCHITECTURE_VERIFICATION`
- Date: 2026-07-30
- Repository: `JasonCutter/shotgun`
- Baseline: `main@0eee421676e9dd21e268f8dc2b6bba641b8b162b`
- Scope: Frontend Phase 2 Section 1 — Sources Workspace
- Result: **DESIGN GAP IDENTIFIED / CONTRACT READY**
- Product implementation: **NOT STARTED**
- Canonical authority: GitHub `main` after review and merge

## 1. Review basis

This audit compares the approved Frontend Phase 2 Sources Workspace boundary with the current Product and module implementation.

Canonical sources:

- `docs/architecture/frontend/phase-2-knowledge-input-question.md`
- `docs/architecture/frontend/cross-phase-contract-and-completion-audit.md`
- `docs/architecture/frontend/adr-100-113-consolidated-record.md`
- `docs/implementation/frontend-phase-1-5-plan-v1.0.md`
- `docs/engineering/stage-2-intake-original-asset.md`
- `docs/engineering/stage-3-plain-text-transformation-evidence.md`
- `docs/engineering/stage-8-format-expansion.md`
- `docs/implementation/implementation-roadmap.md`

Inspected Product entry point:

- `apps/shotgun-web/src/app/router.tsx`

## 2. Existing reusable implementation

### 2.1 Intake and immutable assets

Stage 2 already provides:

- direct-text and UTF-8 `.txt` / `.md` intake;
- `IntakeSubmission`, `Source`, `SourceVersion`, `OriginalAsset`, and `StorageReceipt`;
- immutable byte preservation and SHA-256 integrity;
- idempotent submission handling and concurrent SourceVersion protection;
- Project and access-scope checks in the Asset Resolver;
- in-memory and PostgreSQL persistence adapters;
- local content-addressed asset storage.

The existing Stage 2 storage rule is low-level persistence behavior: the same bytes without a supplied `sourceId` create a new Source, while different bytes for an existing Source create a new SourceVersion.

### 2.2 Transformation, evidence, and original return

Stage 3 already provides:

- `DocumentIR`, `SourceMap`, `EvidenceSpan`, Transformation Attempt and Revision;
- exact original-position restoration;
- SourceVersion-scoped document and evidence queries;
- fail-closed validation of offsets, hashes, SourceVersion and Project context.

Stage 8 provides format adapters and locator types for Markdown/HTML, PDF, DOCX, CSV/XLSX, PPTX, images and accessible URL-page text while preserving the common `DocumentIR` and Evidence contracts.

### 2.3 Phase 1 Product foundation

Frontend Phase 1 provides reusable Product boundaries:

- Local Owner Session V1/V2 and Server-authoritative Active Project;
- Route Guard and protected Product API access;
- `FrontendCommandRequest` V1/V2, idempotency and outcome lookup;
- typed Failure Envelope and runtime decoder policy;
- Project/Session/Revision-scoped Query Cache isolation;
- Global Shell, Home Action Center and `/sources` registered navigation target;
- offline, degraded, stale and unknown-outcome presentation patterns.

The `/sources` route currently renders a placeholder. No Sources Workspace Product view is implemented.

## 3. Missing Product implementation

The following Sources Workspace capabilities are not implemented as a Phase 2 Product boundary:

1. typed Sources Product API view and runtime decoder contracts;
2. Project-fixed Intake Draft Queue and local draft lifecycle;
3. unified direct-text, file and URL submission UX;
4. Browser upload progress, validation summary and safe cancellation presentation;
5. Server-authoritative URL acquisition with redirect, DNS/IP and response-size controls;
6. asynchronous Intake Submission Snapshot with partial success, action-required, retry and outcome recovery;
7. Server-authoritative exact-duplicate detection and explicit user disposition;
8. Source Library list, bounded search, filter and pagination projections;
9. Source detail, version history and pinned SourceVersion selection;
10. original Preview and format-specific locator navigation;
11. Evidence list, highlight and Citation return target;
12. `askUsageState` and capability-driven Ask eligibility;
13. Sources-specific cache keys, access-loss purge and offline behavior;
14. Sources Workspace accessibility, security, performance and browser E2E evidence.

## 4. Material contract conflicts and resolutions

### 4.1 Legacy Browser authority headers

Stage 2 and Stage 3 engineering guides describe `x-project-id`, `x-actor-id`, `x-access-scope` and `x-sensitivity` request headers. Frontend Phase 1 later established that Browser-supplied Principal, Project, Membership, Scope and sensitivity authority is rejected.

**Resolution:** Existing Kernel/module contracts and internal development endpoints remain historical compatibility surfaces. The Sources Workspace Browser uses protected Product API routes. The Server derives Principal, Session, Project, capability, sensitivity and policy context, then calls the reusable Intake, Original Asset, Transformation and Evidence ports.

### 4.2 Storage idempotency versus Product exact-duplicate choice

Stage 2 low-level storage creates a new Source when identical bytes arrive without `sourceId`. The approved Phase 2 design requires the user to choose reuse, new Version candidate, separate Source or cancel.

**Resolution:** Storage identity and Product duplicate resolution are separate. The Product API creates an immutable Exact Duplicate Decision Snapshot before a new Source or SourceVersion is committed when policy requires user choice. No existing Source is silently reused or versioned.

### 4.3 URL format support versus operational URL acquisition

Stage 8 can transform accessible URL-page text, but its engineering record explicitly states that operational URL fetch still requires redirect-by-redirect DNS/IP revalidation and response limits.

**Resolution:** URL intake is not treated as ready merely because an HTML/URL transformation adapter exists. The Product implementation requires a replaceable URL Acquisition Port with SSRF-resistant redirect, address, protocol, content-type, byte, timeout and egress-policy enforcement. Browser direct fetch is prohibited.

### 4.4 Source visibility versus Ask usability

A Source may exist in the Library before a stable SourceVersion or Evidence is usable by Ask.

**Resolution:** Library visibility, preview readiness and Ask eligibility are distinct Server fields. The Browser never infers Ask usability from generic processing status.

## 5. Required new architecture decision

Existing ADR-100 through ADR-105 define Project binding, async command/outcome, Source/Ask re-entry, policy, Shell and policy-context rules. They do not fully decide:

- where Intake Draft authority lives;
- how exact-duplicate user decisions relate to low-level Source storage;
- the secure operational boundary for URL acquisition;
- the Sources Product API versus legacy module endpoints;
- Source Library and Preview projection ownership.

Therefore ADR-122 is required:

`ADR-122 — Sources Workspace Intake Draft, Duplicate Resolution, URL Acquisition and Source Lifecycle Boundary`.

## 6. Data and migration impact

The approved contract requires implementation-time verification of whether the current schema can represent:

- Intake Draft Seeds or durable draft handoff metadata;
- exact-duplicate Decision Snapshots and dispositions;
- URL Acquisition Attempt and provenance receipts;
- Product-facing Intake Submission state and user-attention reason;
- Source display metadata, processing readiness and `askUsageState` projection revisions.

No Migration is authorized by this document. If current tables cannot represent the frozen contract without overloaded fields, implementation must propose an additive Migration using `Expand → Compatibility → Activate → Validate`, preserve existing Stage 2–8 data and APIs, and obtain separate approval before execution.

## 7. Dependency impact

No new Runtime Dependency is selected or authorized.

Implementation must first evaluate existing adapters and already-reviewed candidates. A URL fetch, upload or list-virtualization library may be adopted only behind the approved Port, with exact version, license, replacement test and separate approval when it changes Runtime dependencies.

## 8. Recommended implementation slices

1. typed Product API contracts, runtime decoders and Sources query keys;
2. Source Library and Source detail read projections;
3. direct-text and existing-file Intake through Product API;
4. Draft Queue, validation and asynchronous submission recovery;
5. exact-duplicate detection and disposition workflow;
6. Preview, version history, Evidence highlight and Citation return;
7. secure URL Acquisition Adapter;
8. accessibility, security, performance and end-to-end completion gates.

The order may be refined inside one Section implementation PR, but Phase 2 Section 2 must not start in parallel.

## 9. Final audit conclusion

The reusable backend modules are substantial, but Phase 2 Section 1 is not a UI-only task. The missing work is a Product orchestration, projection, security and lifecycle layer that safely exposes Stage 2, 3 and 8 capabilities through the Phase 1 Session, Project, Command and cache boundaries.

The accompanying Contract Snapshot freezes AC-01 through AC-32. ADR-122 records the new authority boundary. Product implementation remains separately unauthorized until the implementation request is explicitly activated.