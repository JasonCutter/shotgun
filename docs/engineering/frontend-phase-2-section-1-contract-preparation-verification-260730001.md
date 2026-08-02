# Frontend Phase 2 Section 1 Contract Preparation Verification

- Record ID: `frontend-phase-2-section-1-contract-preparation-verification-260730001`
- Record class: `ARCHITECTURE_VERIFICATION`
- Date: 2026-07-30
- Repository: `JasonCutter/shotgun`
- Scope: Frontend Phase 2 Section 1 — Sources Workspace
- Result: **GAP AUDIT / ADR / AC / CONTRACT / IMPLEMENTATION REQUEST COMPLETE**
- Product implementation: **NOT STARTED**
- Canonical authority: GitHub `main`

## 1. Approved work boundary

The user requested completion through:

```text
Existing implementation Gap review
→ fixed AC identifiers and meanings
→ Contract Snapshot and required ADR
→ implementation request preparation
```

The request did not authorize Product implementation, database Migration execution, Runtime Dependency addition, PR Ready/Merge for a Product implementation, Phase 2 Section 2, deployment or Production SLO claims.

## 2. Prepared Canonical records

- Gap Audit:
  `docs/engineering/frontend-phase-2-section-1-gap-audit-260730001.md`
- ADR-122:
  `docs/architecture/adr/ADR-122-sources-workspace-intake-duplicate-url-and-lifecycle-boundary.md`
- Contract Snapshot:
  `docs/architecture/contracts/snapshots/frontend-phase-2-section-1/frontend-phase-2-section-1-contract-snapshot-260730001.md`
- Implementation Request:
  `docs/implementation/frontend-phase-2-section-1-implementation-request-260730001.md`
- Updated Phase record:
  `docs/architecture/frontend/phase-2-knowledge-input-question.md`
- Updated implementation plan:
  `docs/implementation/frontend-phase-1-5-plan-v1.0.md`

## 3. Gap-review result

Reusable implementation was confirmed in:

- Stage 2 Intake, Source, SourceVersion, OriginalAsset and immutable storage;
- Stage 3 DocumentIR, SourceMap, EvidenceSpan and original-position restoration;
- Stage 8 format adapters and locator contracts;
- Frontend Phase 1 Session, Project, Command, Failure, Route Guard and Cache boundaries.

The Sources Workspace Product layer is not implemented. The current `/sources` route remains a placeholder at the reviewed baseline.

The audit identified and resolved the following architecture gaps:

1. legacy Browser authority headers are not valid Product authority after Phase 1;
2. Stage 2 storage identity does not by itself satisfy explicit Product exact-duplicate choice;
3. URL transformation support does not constitute an operational secure URL fetch boundary;
4. Source visibility, Preview readiness and Ask eligibility require separate Server projections.

## 4. Accepted decision

ADR-122 records that:

- Browser access uses a protected Sources Product API;
- Server derives Principal, Session, Project, capability, sensitivity and policy context;
- Browser `SourceIntakeDraft` and Server `IntakeSubmissionSnapshot` are separate;
- exact duplicate handling uses an immutable Server decision and explicit disposition;
- URL acquisition is Server-side behind an SSRF-resistant replaceable Port;
- Source Library, Detail, Preview and Evidence are Server projections;
- SourceVersion and Citation remain pinned;
- Migration and new Runtime Dependency remain separately controlled.

## 5. Frozen acceptance contract

AC-01 through AC-32 are approved and frozen in the Contract Snapshot.

They cover:

- Product API and Server authority;
- Project-fixed draft and Draft Seed re-entry;
- direct text, file and URL intake;
- secure URL acquisition and provenance;
- command, idempotency, progress, partial result, cancel, retry and outcome recovery;
- exact duplicate detection, disposition, concurrency and stale safety;
- Source Library, search/filter/pagination and capabilities;
- Source detail, SourceVersion, Preview, Evidence and Citation return;
- cache, offline, security, accessibility, performance and completion governance.

Any number or meaning change requires a new Snapshot revision and explicit approval.

## 6. Git publication evidence

- Documentation branch: `agent/frontend-phase-2-section-1-contract`
- PR: #44
- Tested content Head: `2301f7f234722162071713625d635a4d42c73d2e`
- GitHub Actions Run: `30499479422`
- Frontend: **PASS**
- Quality: **PASS**
- Required Gates: **PASS**
- Merge Commit: `f1e9b01cbf5a869f1fc43fea2a7719b3a35a79f6`

The tested Head passed Knowledge Flow generated-output validation, documentation governance, formatting, lint, typecheck, dependency audit and SBOM, Stage 12, the full CI and database suites, frontend typecheck/test/build/E2E and the Required Gates aggregator.

## 7. Current authorization state

```text
Gap Audit: COMPLETE
ADR-122: ACCEPTED
AC-01~AC-32: APPROVED AND FROZEN
Contract Snapshot: ACTIVE_BASE
Implementation Request: PREPARED
Product Implementation: NOT STARTED
Database Migration: NOT AUTHORIZED
New Runtime Dependency: NOT AUTHORIZED
Phase 2 Section 2: NOT STARTED
```

The next permissible transition is a separate user instruction to start Frontend Phase 2 Section 1 Product implementation. Implementation must begin from the latest `main`, create a dedicated branch and Draft PR, and preserve the frozen contract.
