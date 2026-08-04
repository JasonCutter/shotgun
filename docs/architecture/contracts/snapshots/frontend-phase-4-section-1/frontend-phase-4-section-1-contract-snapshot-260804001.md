---
id: FRONTEND-PHASE-4-SECTION-1-CONTRACT-SNAPSHOT-260804001
classification: PRODUCT_CONTRACT_SNAPSHOT
status: ACCEPTED_PENDING_PUBLICATION
revision: 1
review_round: 1
review_result: APPROVED_FOR_IMPLEMENTATION
approved_by: user
approved_at: 2026-08-04T20:42:00+09:00
work_item: FE-P4-S1
governing_adr: ADR-109
accepted_adr: ADR-128
base_commit_requested: 6ffca675844be445512e06e79bfa5233a71d1b25
branch: codex/frontend-phase-4-section-1-contract-preparation
implementation_authorized: true
---

# FE-P4-S1 Contract Snapshot — Review Center v1

## 1. Scope

This snapshot freezes the FE-P4-S1 Product contract for Review queue, immutable Review Context,
Item decisions, comments, stale revalidation and purpose-specific Approval issuance.

It excludes Canonical Commit, Directive Apply, External Action approval and execution, FE-P4-S2,
FE-P5, deployment and production verification.

## 2. Product targets

`ReviewTargetKindV1` is exactly:

- `KNOWLEDGE_DRAFT_CHANGE_SET`;
- `DISCOVERY_CANDIDATE`;
- `USER_DIRECTIVE_PROPOSAL`.

External Action resources return a typed `EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2` handoff and are
not Review targets in V1.

## 3. Review Context identity

A Review Context has a stable `reviewContextId` and immutable numbered `contextRevision`.

Required identity fields are:

- `schemaVersion: '1.0.0'`;
- `reviewContextId`;
- `contextRevision`;
- `reviewResourceId`;
- `targetKind`;
- `targetId`;
- `targetRevision`;
- `targetDigest`;
- `resourceProjectId`;
- `effectiveProjectId`;
- `accessRevision`;
- `policyContextRevision`;
- `canonicalBase`;
- `artifactRefs`;
- `items`;
- `dependencies`;
- `aggregateState`;
- `capabilities`;
- `generatedAt`;
- optional `staleReason`.

`canonicalBase` is required for Knowledge Draft targets and optional for Candidate or Directive
targets only when their source contract has no Canonical base.

`artifactRefs` separately pins Validation, Evidence, Conflict and Recursive Impact identities.
Missing or partial artifacts remain explicit and never become fabricated complete data.

## 4. Review Items

Every Review Item contains:

- `reviewItemId`;
- `sourceItemKind`;
- `sourceItemId`;
- `sourceItemRevision`;
- `sourceItemDigest`;
- `targetRef`;
- immutable `before` and `after` representations where applicable;
- rationale and expected impact;
- Evidence, Conflict and Impact references;
- `allowedDecisions`;
- `decisionState`;
- `sensitivity`;
- `maskedFields`.

`sourceItemKind` is exactly:

- `KNOWLEDGE_OPERATION`;
- `DISCOVERY_CANDIDATE`;
- `USER_DIRECTIVE_CLAUSE`.

The Server assigns Item IDs and verifies all source identities.

## 5. Dependencies

`ReviewDependencyKindV1` is exactly:

- `REQUIRES`;
- `ATOMIC_WITH`;
- `CONFLICTS_WITH`.

A dependency contains `fromReviewItemId`, `toReviewItemId`, `kind`, `reasonCode` and a safe
description. Hidden Items are removed before counts and descriptions are created. A visible Item
that depends on hidden content is marked unavailable without leaking the hidden identity.

## 6. Decisions and comments

`ReviewDecisionIntentV1` is exactly:

- `APPROVE`;
- `REJECT`;
- `REQUEST_REVISION`;
- `HOLD`.

Every decision command includes:

- Frontend Command identity and semantic digest;
- `reviewContextId`;
- `expectedContextRevision`;
- `expectedTargetRevision`;
- `expectedTargetDigest`;
- one or more Item decisions;
- a non-empty reason for every terminal decision;
- optional safe comment text.

The Server rejects duplicate Item IDs, unsupported decisions, decisions outside capability,
inconsistent reasons and illegal dependency sets.

Decision records are append-only. `HOLD` is nonterminal. Terminal decisions cannot be replaced on
the same context revision.

## 7. Aggregate states

`ReviewAggregateStateV1` is exactly:

- `PENDING`;
- `PARTIALLY_DECIDED`;
- `ON_HOLD`;
- `REVISION_REQUESTED`;
- `REJECTED`;
- `APPROVED_READY`;
- `ACCEPTED_FOR_AUTHORING`;
- `STALE`;
- `ACCESS_RESTRICTED`;
- `UNAVAILABLE`.

Aggregate state is Server-derived and never accepted from the Browser.

## 8. Approval Resource

`ApprovalPurposeV1` is exactly:

- `KNOWLEDGE_CANONICAL_CHANGE`;
- `USER_DIRECTIVE_CHANGE`.

`ApprovalStatusV1` is exactly:

- `ACTIVE`;
- `EXPIRED`;
- `REVOKED`;
- `CONSUMED`;
- `INVALIDATED`.

An Approval binds:

- `approvalId`;
- `purpose`;
- `reviewContextId` and `contextRevision`;
- target kind, ID, revision and digest;
- exact approved Item IDs;
- approved manifest digest;
- Actor;
- Project, access and policy revisions;
- reason;
- `issuedAt`;
- `expiresAt`;
- status and optional invalidation reason.

Discovery Candidate approval produces `ACCEPTED_FOR_AUTHORING` and no Approval Resource.

Approval issuance has no Commit, Apply or Execute side effect.

## 9. Review queue contract

Queue reads are bounded and Server-ranked.

Request fields are:

- `schemaVersion: '1.0.0'`;
- optional target-kind, aggregate-state and attention filters;
- optional safe text query;
- `pageSize` from 1 through 50;
- optional opaque cursor.

Response fields are:

- accepted Project, access and policy revisions;
- queue snapshot revision;
- bounded Items;
- next cursor;
- total-count status as `EXACT`, `LOWER_BOUND` or `UNAVAILABLE`;
- safe attention reasons and capabilities.

Hidden resources are excluded before counts and ranking.

## 10. Context and detail reads

V1 read operations are:

1. `ListReviewQueue`;
2. `GetReviewContext`;
3. `GetReviewItemDetail`;
4. `GetReviewApproval`.

Evidence, Conflict and Impact detail is lazy and uses existing protected source contracts through
Review-bound references. Review reads validate cross-resource Project, policy and revision
invariants.

## 11. Write and recovery operations

V1 command operations are:

1. `RevalidateReviewContext`;
2. `RecordReviewDecisions`;
3. `AddReviewComment`.

V1 recovery operation is `ResolveReviewCommandOutcome`.

Revalidation creates a new immutable context revision. Decision and comment commands never mutate
the submitted target. Revision-request responses include a typed return target for Knowledge Editor
or Directive authoring.

## 12. Product API candidates

The protected Product API family is:

- `POST /product-api/frontend/review/queue`;
- `POST /product-api/frontend/review/contexts/read`;
- `POST /product-api/frontend/review/items/read`;
- `POST /product-api/frontend/review/contexts/revalidate`;
- `POST /product-api/frontend/review/decisions`;
- `POST /product-api/frontend/review/comments`;
- `POST /product-api/frontend/review/approvals/read`;
- `GET /product-api/frontend/review/command-outcomes/by-client-request/:clientRequestId`.

All requests and responses use strict runtime decoding, reject unknown fields and validate
cross-field identity invariants.

## 13. Typed failures

The V1 failure set includes:

- `REVIEW_CONTEXT_NOT_FOUND`;
- `REVIEW_CONTEXT_STALE`;
- `REVIEW_TARGET_CHANGED`;
- `REVIEW_ITEM_NOT_FOUND`;
- `REVIEW_DECISION_NOT_ALLOWED`;
- `REVIEW_DEPENDENCY_UNSATISFIED`;
- `REVIEW_ATOMIC_GROUP_SPLIT`;
- `REVIEW_CONFLICTING_APPROVAL_SET`;
- `REVIEW_DANGLING_REFERENCE`;
- `REVIEW_EVIDENCE_CHANGED`;
- `REVIEW_POLICY_CHANGED`;
- `REVIEW_ACCESS_CHANGED`;
- `REVIEW_APPROVAL_NOT_ISSUED`;
- `REVIEW_APPROVAL_EXPIRED`;
- `REVIEW_REVISION_ROUTE_UNAVAILABLE`;
- `EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2`.

Failures map through the shared typed Product failure envelope. Inaccessible resources fail closed
without confirming existence.

## 14. Persistence

Migration 027 adds:

- `frontend_review_context_revision`;
- `frontend_review_item`;
- `frontend_review_dependency`;
- `frontend_review_decision`;
- `frontend_review_comment`;
- `frontend_review_approval`.

Context, Item and dependency rows are immutable. Decision and comment rows are append-only. Approval
status changes preserve history. The existing Frontend Command Ledger remains the command and
outcome authority.

In-memory and PostgreSQL adapters must pass the same parity suite.

## 15. Browser state and cache

Route state owns selected Context and Item. React Query owns queue, Context, Item and Approval
snapshots. A route-scoped Browser Draft State Machine owns only unsent Item selections, reasons and
comments.

Query keys include Resource Project, access revision, policy revision, Review Context ID and context
revision. Mutations have no automatic retry. Outcome uncertainty resolves by original
`clientRequestId`.

## 16. Review Workspace

`/review` must provide:

- bounded queue and filters;
- Context summary and stale state;
- Item list and status;
- accessible before-and-after comparison;
- Evidence, Conflict and Impact detail;
- dependency and atomic-group explanation;
- decision controls with reason validation;
- decision history and comments;
- Approval result or Candidate authoring handoff;
- recovery for stale, access, policy and `OUTCOME_UNKNOWN`.

No button performs Commit, Directive Apply or External Action execution.

## 17. Accessibility and responsive contract

The Workspace requires:

- keyboard-complete queue, Item and decision navigation;
- screen-reader equivalent comparison and dependency explanation;
- visible and programmatic focus after deep links, refresh and decisions;
- non-color decision and dependency status;
- live announcements for completed, stale and uncertain outcomes;
- 200% zoom without content loss;
- reduced-motion behavior;
- no protected metadata in announcements;
- mobile and tablet layouts with the same decision information.

## 18. Performance and bounded behavior

The implementation must freeze and measure numeric budgets after a deterministic baseline. The
contract fixes:

- queue page size at 50 maximum;
- Context response at 200 Items maximum;
- dependency response at 500 edges maximum;
- Evidence and Impact detail as lazy reads;
- request cancellation on route or Context change;
- no unbounded prefetch;
- cache eviction across Project, access, policy and Context revisions.

Virtualization is not required unless measured DOM, memory or responsiveness evidence crosses an
approved trigger and accessible equivalence is retained.

## 19. Frozen Acceptance Criteria

- **AC-01**: ADR-109 and ADR-128 boundaries are represented without Approval and Commit conflation.
- **AC-02**: V1 target kinds and target-specific approval effects are exhaustive.
- **AC-03**: FE-P3-S2 Review Submission materializes idempotently into an immutable Review Context.
- **AC-04**: Revalidation creates a new immutable context revision.
- **AC-05**: Context identity binds target, Project, access, policy, Canonical base and artifacts.
- **AC-06**: Review Items preserve source identity, digest, comparison and artifact lineage.
- **AC-07**: Dependency edges are Server-owned and strictly decoded.
- **AC-08**: Item decisions support exactly approve, reject, request revision and hold.
- **AC-09**: Terminal decisions cannot be silently replaced on the same context revision.
- **AC-10**: Legal partial approval requires dependency closure and atomic-group integrity.
- **AC-11**: Dangling references and conflicting approval sets fail closed.
- **AC-12**: Candidate approval produces accepted-for-authoring and no Approval Resource.
- **AC-13**: Knowledge and Directive Approval purposes are separate and non-reusable.
- **AC-14**: Approval binds exact Actor, target, Item set, digests, policy and expiry.
- **AC-15**: Approval issuance performs no Canonical Commit, Directive Apply or external execution.
- **AC-16**: Stage 5 compatibility is Adapter-based and preserves legacy history.
- **AC-17**: Migration 027 is additive, reversible and covered by managed-schema verification.
- **AC-18**: In-memory and PostgreSQL Review adapters have behavioral parity.
- **AC-19**: Decision recording and Approval issuance use one authoritative completion transaction.
- **AC-20**: Existing Frontend Command Ledger provides idempotency and outcome recovery.
- **AC-21**: Queue, Context, Item and Approval reads are protected, bounded and strictly decoded.
- **AC-22**: Cross-Project, access, policy and hidden-resource leakage tests pass.
- **AC-23**: `/review` replaces the Placeholder with the Review Center Workspace.
- **AC-24**: Browser state follows ADR-119 and cannot become Review authority.
- **AC-25**: Stale and `OUTCOME_UNKNOWN` recovery never automatically resubmits a decision.
- **AC-26**: Revision request routes to the correct authoring Workspace and restores focus.
- **AC-27**: Keyboard and screen-reader Review flows are information-equivalent.
- **AC-28**: 200% zoom, reduced motion, mobile and tablet evidence shows no information loss.
- **AC-29**: Deterministic performance and lifecycle budgets are approved and pass.
- **AC-30**: Negative tests prove no Commit, Apply, Execute or cross-purpose Approval route exists.
- **AC-31**: Exact-head Quality, Frontend and Required Gates pass.
- **AC-32**: Completion evidence, manifest, Registry and user approval are recorded before Ready.

## 20. Authorization boundary

This Contract Snapshot revision 1 and AC-01 through AC-32 are approved and frozen. FE-P4-S1 Product
implementation and Migration 027 are authorized. Ready, Merge, deployment, production
verification, FE-P4-S2 and FE-P5 remain unauthorized.
