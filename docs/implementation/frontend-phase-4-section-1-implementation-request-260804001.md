---
id: FRONTEND-PHASE-4-SECTION-1-IMPLEMENTATION-REQUEST-260804001
classification: IMPLEMENTATION_REQUEST_CANDIDATE
status: NOT_AUTHORIZED
revision: 1
work_item: FE-P4-S1
canonical_base: 6ffca675844be445512e06e79bfa5233a71d1b25
branch: codex/frontend-phase-4-section-1-contract-preparation
tracking_issue: 62
draft_pr: 63
governing_adr: ADR-109
proposed_adr: ADR-128
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-4-section-1/frontend-phase-4-section-1-contract-snapshot-260804001.md
implementation_authorized: false
---

# FE-P4-S1 Review Center — Implementation Request Candidate

## 1. Request status

This document is a candidate implementation request prepared under the user's FE-P4-S1 design and
contract authorization. It does not authorize Product implementation.

Implementation may begin only after explicit approval of ADR-128, the Contract Snapshot,
Acceptance Criteria and this request.

## 2. Objective

Implement a server-authoritative Review Center that:

- reads bounded Review queue and immutable Review Context revisions;
- presents Candidate, Canonical base, Evidence, Conflict and Impact in one context;
- records Item-level approve, reject, request-revision and hold decisions;
- validates partial approval dependencies and dangling references;
- issues purpose-specific Approval Resources without Commit or Apply;
- supports Candidate accepted-for-authoring without direct Approval;
- preserves decision, comment and legacy Stage 5 lineage;
- provides an accessible `/review` Workspace and safe recovery.

## 3. Work packages

### WP1 — Contract and decoder implementation

- Add `packages/contracts/src/frontend-review.ts`.
- Export exhaustive V1 target, Context, Item, dependency, decision, Approval, queue and failure
  contracts.
- Add strict request and response decoders with unknown-field rejection.
- Add cross-field invariants for Project, context revision, target digest, Item references,
  dependency edges and Approval purpose.
- Register Review-specific failure descriptors in the shared typed failure registry.
- Add contract tests organized by Product operation.

### WP2 — Review domain and persistence

- Add `modules/frontend-review`.
- Add immutable Review Context materialization and revalidation.
- Add Item and dependency graph generation ports.
- Add decision, comment and Approval repositories.
- Add target adapters for FE-P3-S2 Review Submission, Discovery Candidate and
  UserDirectiveProposal.
- Add `LegacyChangeSetReviewPort` for Stage 5 compatibility.
- Use the existing Frontend Command Ledger for acceptance and outcome resolution.
- Add in-memory adapters.

### WP3 — Migration 027 and PostgreSQL parity

- Add `027_frontend_review_center.sql`.
- Create Product Review Context revision, Item, dependency, decision, comment and Approval tables.
- Preserve append-only and immutable constraints.
- Add indexes for Project queue, current context revision, target identity and Approval lookup.
- Add rollback and managed-schema verification.
- Add PostgreSQL adapters and parity tests.
- Do not rewrite legacy Stage 5 tables.

### WP4 — Protected Product API and client

- Add protected Review queue, Context, Item, revalidate, decision, comment, Approval and outcome
  routes.
- Derive Principal, Resource Project, access, policy and capabilities on the Server.
- Add `FrontendReviewClient` with strict decoding, CSRF handling, 403 refresh behavior,
  `AbortSignal` and no mutation auto-retry.
- Validate cross-resource identity before returning data.

### WP5 — Browser state and Review Workspace

- Replace `/review` Placeholder with `ReviewWorkspace`.
- Add route and deep-link contract for Context and Item selection.
- Add Review query-key factory with Project, access, policy and Context revisions.
- Add route-scoped Browser Draft State Machine for unsent selections, reasons and comments.
- Add bounded queue, filters, Context summary, Item comparison, Evidence, Conflict, Impact,
  dependencies, decisions, history and Approval result.
- Add Candidate authoring handoff and revision-request return targets.
- Add stale, access, policy and `OUTCOME_UNKNOWN` recovery.
- Preserve focus on deep-link restore, refresh, decision completion and handoff.

### WP6 — Verification and governance evidence

- Unit, contract, integration and database parity tests.
- Security and hidden-resource negative matrix.
- Browser E2E for queue, detail, decisions, partial approval, revision request and recovery.
- Accessibility evidence for keyboard, screen reader, non-color cues, 200% zoom and reduced motion.
- Deterministic performance and lifecycle baseline and approved numeric Gate.
- Negative proof that no Review route commits Canonical knowledge, applies a Directive or executes
  an External Action.
- Verification record, Completion Report, Completion Manifest and Evidence Registry entry.

## 4. Required implementation properties

1. No Browser authority for Actor, Project, Capability, policy or Approval purpose.
2. No automatic mutation retry.
3. No second command ledger.
4. No destructive Stage 5 migration.
5. No unbounded Review bundle.
6. No Candidate-to-Canonical direct path.
7. No cross-purpose Approval reuse.
8. No Approval and Commit mixing.
9. No deletion of rejected, held or revision-requested history.
10. No hidden resource leakage through counts, edges, descriptions or announcements.

## 5. Expected migration and dependency impact

- Database migration: `027_frontend_review_center.sql` is proposed and separately requires
  implementation authorization.
- New runtime dependency: none expected.
- Lockfile change: none expected.
- Canonical knowledge schema change: none.
- External Connector enablement: none.

## 6. Test execution policy

Run only tests required by changed scope and the repository's automatic required CI.

- Do not rerun tests on an exact Head that already passed.
- Do not add manual duplicate CI.
- Preserve all failed attempts and corrections.
- Use focused checks during development, then one full required exact-head validation.
- Treat automatic GitHub Actions on each new commit as the remote authority for that Head.

## 7. Completion boundary

FE-P4-S1 completion requires:

- all frozen AC-01 through AC-32 pass;
- exact-head Quality, Frontend and Required Gates pass;
- Completion Manifest and Evidence Registry are consistent;
- user approves Product completion;
- Ready and Merge receive separate user approval;
- post-merge main CI passes;
- post-merge Governance Closure records `FINAL_AFTER_MERGE`.

Deployment and production verification remain separate.

## 8. Explicit exclusions

- Canonical Commit and Compiled Truth regeneration;
- User Directive activation or application;
- External Action Approval, Preflight, Execute, Verify or Compensation;
- FE-P4-S2 and FE-P5;
- deployment and production verification;
- Ready and Merge without separate authorization.

## 9. Authorization requested later

After design review, request explicit approval for:

1. ADR-128 acceptance;
2. Contract Snapshot revision 1 and AC-01 through AC-32 freeze;
3. this Implementation Request;
4. FE-P4-S1 Product implementation entry;
5. Migration 027;
6. no new runtime dependency unless a later reviewed need is proven.

Until then, implementation remains `NOT_STARTED / NOT_AUTHORIZED`.
