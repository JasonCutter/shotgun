# FE-P4-S1 Review Center — Gap Audit

## Record

- Record ID: `frontend-phase-4-section-1-review-center-gap-audit-260804001`
- Date: 2026-08-04
- Repository: `JasonCutter/shotgun`
- Work item: `FE-P4-S1`
- Parent work item: `FE-P4`
- Canonical base: `main@6ffca675844be445512e06e79bfa5233a71d1b25`
- Working branch: `codex/frontend-phase-4-section-1-contract-preparation`
- Tracking issue: [#62](https://github.com/JasonCutter/shotgun/issues/62)
- Governing contract: `docs/architecture/frontend/phase-4-governance-execution.md`
- Governing decision: ADR-109 — Review Center as Item-level Approval Gateway
- Entry authorization: user, `2026-08-04T19:52:00+09:00`
- Status: `PREPARATION_ONLY`
- Product implementation: `NOT_STARTED`
- Ready / Merge / Deployment / Production Verification: `NOT_AUTHORIZED`

This audit opens FE-P4-S1 preparation only. It records confirmed reusable assets,
missing Product behavior, contract decisions that must be frozen, and excluded
scope. It does not approve a new ADR, freeze Acceptance Criteria, authorize
Product implementation, or change the Canonical Work Item Registry.

## 1. Canonical responsibility

FE-P4-S1 is the Product Review Center for human judgment over governed proposals.
The accepted boundary requires:

1. a unified Review entry point without transferring ownership of underlying
   Candidate, DraftChangeSet or UserDirectiveProposal resources to the UI;
2. Item/Operation-level approval, rejection, revision request and hold;
3. Candidate, Canonical Snapshot, Evidence, Conflict and Recursive Impact in one
   Review Context;
4. purpose-specific Server Approval Resources bound to Actor, scope, target
   revision, content or manifest digest, policy context, reason and expiry;
5. stale, permission, policy and Evidence revalidation;
6. dependency and dangling-reference validation for partial approval;
7. preservation of rejected and held items and their reasons;
8. strict separation between Approval and Canonical Commit, Directive activation
   or Connector execution.

External Action approval and execution remain FE-P4-S2 responsibilities. FE-P4-S1
may display an external-action handoff or unavailable state only after a frozen
contract explicitly defines that boundary; it must not implement Preflight,
Execute, Verify or Compensation.

## 2. Confirmed existing foundation

The following capabilities exist and should be reused or adapted rather than
reimplemented.

### 2.1 FE-P3-S2 Review handoff

FE-P3-S2 already provides authoritative DraftChangeSet materialization, typed
Operation authoring, validation, bounded Impact Preview and immutable Review
Submission creation. Its completed boundary ends at Review Resource handoff and
explicitly excludes Review decisions, Approval and Canonical Commit.

### 2.2 Stage 5 `change-set-review` module

`modules/change-set-review/src/index.ts` provides an earlier domain review
foundation:

- repository operations for DraftChangeSet, decision and approved-manifest
  persistence;
- `GetDraftChangeSet`, `ListDraftChangeSets`, `GetReviewBundle` and
  `GetApprovedChangeSetManifest` queries;
- `RecordReviewDecision` with whole-ChangeSet `APPROVE | HOLD | REJECT`;
- actor, Project, access-scope and freshness checks;
- idempotent decision identity and conflict rejection;
- approval token and `ApprovedChangeSetManifest` creation after approval;
- `ReviewDecisionRecorded` and `ChangeSetApproved` events;
- no Canonical write and no external Action execution.

This module is a reusable domain reference and Adapter candidate. It is not the
FE-P4-S1 Product contract because its current decision unit is the whole
DraftChangeSet, its revision contract is fixed to revision `1`, it has no
`REQUEST_REVISION` decision, and approval is embedded in the legacy
ChangeSet/manifest flow rather than represented as the purpose-specific Product
Approval Resource required by ADR-109.

### 2.3 Cross-Frontend foundations

The repository already provides:

- Server-derived Principal, Session, Active/Resource Project, access and policy
  authority;
- versioned Frontend command requests, idempotency and outcome resolution;
- typed failure translation and `OUTCOME_UNKNOWN` recovery without automatic
  mutation resubmission;
- ADR-119 route-scoped Browser Draft State Machine and scope-safe cache ownership;
- protected Product API route patterns and strict typed API clients;
- Evidence, Conflict and Recursive Impact source contracts from earlier Stages
  and Frontend Sections;
- shared accessibility, route-focus, status/alert and responsive UI patterns.

### 2.4 Current `/review` route

`apps/shotgun-web/src/app/router.tsx` contains a guarded `/review` route, but it
renders only a `PlaceholderPage`. No Review Center Product Workspace, Review
state machine, Review query keys, typed Review client or Review Product API is
wired to the route.

## 3. Asset reuse and gap inventory

Classification legend:
`REUSE_AS_IS` · `EXTEND` · `ADAPT_BEHIND_NEW_PORT` · `REFERENCE_ONLY` · `MISSING`

| Asset | Location | Classification | FE-P4-S1 use or gap |
| --- | --- | --- | --- |
| FE-P3-S2 Review Submission and Review Resource handoff | `packages/contracts/src/frontend-knowledge-draft.ts`, `modules/frontend-knowledge-draft` | `REUSE_AS_IS` / `EXTEND` | Preserve immutable submitted revision and Project binding; add Review Context resolution without mutating the submission. |
| Stage 5 change-set review domain | `modules/change-set-review` | `ADAPT_BEHIND_NEW_PORT` | Reuse freshness, decision lineage and manifest concepts; do not expose the legacy whole-ChangeSet schema as the Product contract. |
| Stage 5 decision schemas | `packages/contracts/schemas/record-review-decision.v1.schema.json` and related schemas | `REFERENCE_ONLY` / `EXTEND` | Current enum lacks revision request and item identity; fixed revision `1` is insufficient. |
| Canonical, Evidence, Conflict and Impact reads | Stage 3, 5, 6, 9 and FE-P3 modules | `ADAPT_BEHIND_NEW_PORT` | Resolve one immutable Review Context with source revisions and access masking. |
| Frontend command ledger and outcome resolution | existing Frontend Product command foundation | `REUSE_AS_IS` | All decisions and approval issuance use the existing command/outcome boundary. |
| Purpose-specific Product Approval Resource | none identified at FE-P4-S1 Product boundary | `MISSING` | Must be independent from Commit/Apply/Execute and bound to exact purpose and target digest. |
| Review Context list/detail Product contract | none | `MISSING` | Need bounded queue/list, immutable detail snapshot and typed capabilities. |
| Item/Operation decision graph | none | `MISSING` | Need stable item IDs, dependencies, atomic groups and dangling-reference validation. |
| Partial approval computation | legacy whole-ChangeSet only | `MISSING` | Server must calculate legal decision sets and aggregate outcome. |
| Revision-request flow | none in legacy decision enum | `MISSING` | Must route correction to the owning authoring Phase without silently editing Review state. |
| UserDirectiveProposal Review Adapter | no FE-P4-S1 Product surface identified | `MISSING` | Review and approval are separate from Directive activation. |
| Review Product API routes and typed client | none | `MISSING` | Protected list/detail/decision/outcome operations and strict decoders required. |
| Review Center React Workspace | `/review` placeholder | `MISSING` | Queue, context, comparison, evidence, impact, decisions and recovery UI required. |
| Review persistence parity | legacy Stage 5 persistence only | `EXTEND` / `MISSING` | Audit exact in-memory/PostgreSQL coverage for Review Context, item decisions, comments/holds and Approval Resources. |
| Accessible comparison/diff patterns | FE-P3 editor/graph and shared components | `EXTEND` | Need keyboard and screen-reader equivalent review, not a visual diff-only surface. |

## 4. Missing Product behavior

1. No server-authoritative Review queue spanning supported Review target kinds.
2. No immutable Product `ReviewContext` binding a submitted target, target
   revision, Canonical Snapshot, Evidence, Conflict, Impact, access revision and
   policy context revision.
3. No stable Product Review Item/Operation identity or dependency graph.
4. No Item/Operation-level approve, reject, request-revision and hold commands.
5. No Server-computed legal partial-approval set or dangling-reference rejection.
6. No independent purpose-specific Approval Resource lifecycle.
7. No approved-item manifest that remains separate from Canonical Commit or
   Directive activation.
8. No UserDirectiveProposal Review flow at the Product boundary.
9. No protected Review Product API, typed API client or strict runtime decoders.
10. No `/review` queue/detail Workspace, Browser state machine, query-key factory,
    deep-link restoration or focus restoration.
11. No Review-specific stale/policy/access/evidence recovery experience.
12. No Review Product E2E proving that Approval cannot write Canonical state.

## 5. Contract decisions that must be frozen

The following are decision candidates, not accepted design.

### D1 — Supported Review target kinds

The contract must define the exact V1 set. The minimum candidate set is:

- `KNOWLEDGE_CHANGE` for submitted DraftChangeSet content;
- `USER_DIRECTIVE_PROPOSAL` for a separately owned proposal resource.

`EXTERNAL_ACTION` remains excluded from FE-P4-S1 decision execution and belongs
to FE-P4-S2. Any read-only handoff representation must not create or reuse a
Knowledge Approval.

### D2 — Review Context identity and immutability

A Review Context candidate should bind at least:

- Review resource and target resource IDs;
- target kind, target revision and target digest;
- Resource Project and accepted access/policy revisions;
- Canonical base snapshot and digest where applicable;
- Evidence, Conflict and Impact artifact revisions;
- context generation time, expiry or invalidation state;
- Server-issued capabilities.

The context must be restorable without allowing the Browser to resubmit a
modified target as the same Review.

### D3 — Item/Operation graph

The contract must define:

- stable Review item identity;
- source Operation identity and immutable before/after content;
- dependency and atomic-group edges;
- evidence, conflict and impact references per item;
- allowed decision set per item;
- Server-computed aggregate readiness and unresolved dependencies.

### D4 — Decision lifecycle

The candidate decision vocabulary is:

- `APPROVE`;
- `REJECT`;
- `REQUEST_REVISION`;
- `HOLD`.

The contract must decide whether a later decision supersedes a prior nonterminal
decision, how comments and reasons are versioned, and which transitions require
a new Review Context. A Client selection is never a decision until a Server
command completes.

### D5 — Purpose-specific Approval Resource

Approval must be a separate Server Domain Resource, not a UI state or an embedded
permission token alone. The contract must bind:

- approval purpose;
- actor and authority scope;
- Review and target identities;
- exact target/item revisions and digests;
- Canonical base or Directive proposal revision where applicable;
- policy context and access revision;
- reason, issued time and expiry;
- status and invalidation reason.

A Knowledge Approval cannot authorize Directive activation or External Action
execution, and an Approval cannot perform Commit/Apply/Execute.

### D6 — Partial approval and aggregate outcome

The Server must validate dependencies and reject illegal partial approval. The
contract must define aggregate states such as pending, partially decided,
revision requested, held, rejected, approved-ready and stale without collapsing
per-item history.

### D7 — Persistence and transaction boundary

A focused architecture review must decide:

- whether immutable Review Context snapshots are persisted or reconstructed from
  submitted resources and pinned artifact revisions;
- how decisions, comments, holds and Approval Resources are stored;
- the atomic boundary between decision recording and Approval issuance;
- in-memory/PostgreSQL parity and retention;
- compatibility and migration from the Stage 5 whole-ChangeSet model.

ADR-109 fixes the responsibility and safety boundary but does not fully decide
this Product persistence and compatibility model. A new ADR or explicit ADR-109
amendment candidate is required if the contract introduces a new durable model.

### D8 — Product operations

The exact V1 Product operations must include, at minimum, bounded equivalents of:

- list Review resources;
- read Review Context;
- record one or more item decisions;
- resolve command outcome by original request identity;
- read resulting decision/Approval state;
- refresh or revalidate stale Review Context;
- route a revision request to the owning authoring Workspace.

The contract must avoid one broad mutation that mixes decision, Approval and
Commit.

### D9 — Browser state and cache ownership

The Review Center must follow ADR-119:

- route and selected Review identity in Router state;
- authoritative Review snapshots in React Query;
- only unsent reason/comment/selection state in a route-scoped Browser Draft
  State Machine;
- Project/access/policy/context revisions in query keys;
- no automatic mutation retry;
- original `clientRequestId` outcome resolution after uncertainty.

### D10 — Accessibility and responsive behavior

The frozen contract must require:

- keyboard access to queue, item navigation, Evidence, Impact and decision
  controls;
- visible and programmatic item/aggregate status;
- information-equivalent text representation for visual diff and impact views;
- focus restoration after deep link, decision completion, stale refresh and
  revision-request routing;
- screen-reader announcements that do not expose hidden resources;
- 200% zoom and reduced-motion behavior without content loss.

## 6. Security and authority gaps

1. Every Review read and command must bind to Resource Project, not silently to
   a changed Active Project.
2. Inaccessible Review, target, Evidence, Conflict or Impact resources must not
   leak through queue counts, labels, descriptions or dependency edges.
3. Browser-provided actor, role, capability, policy acceptance or approval
   purpose is non-authoritative.
4. Current permission, policy and Evidence revisions must be revalidated before
   decision completion and Approval issuance.
5. Approval purpose reuse across Knowledge, Directive and External Action is
   prohibited.
6. Stale Review Context or changed target digest must fail closed and preserve the
   attempted command outcome for recovery.
7. Approval issuance must not call Canonical Commit, Directive Apply or Connector
   Execute as a hidden side effect.
8. Rejected and held records remain auditable and cannot be deleted as ordinary
   Browser cleanup.

## 7. Accessibility and UX gaps

- No Review queue or detail semantics exist at `/review`.
- No accessible per-item comparison of Candidate versus Canonical Snapshot.
- No Evidence-return and focus restoration contract from Review Context.
- No dependency/partial-approval explanation for keyboard and screen-reader
  users.
- No stale, policy-change, access-loss or `OUTCOME_UNKNOWN` recovery UI.
- No responsive evidence for large Review bundles, 200% zoom or reduced motion.

## 8. Performance and scale gaps

The preparation contract must define bounded Product behavior rather than an
unbounded Review bundle:

- queue page and filter limits;
- maximum items and dependency edges per Review Context response;
- Evidence/Impact lazy-detail rules;
- cancellation and cache eviction on route/context change;
- measured queue/detail composition and decision-response budgets;
- a virtualization trigger based on evidence, with accessible fallback if later
  adopted.

No numeric performance budget is approved by this audit.

## 9. Explicit deferred and excluded scope

- Canonical Commit, Fact/Claim application and Compiled Truth regeneration;
- User Directive activation/application;
- External Action Approval, Preflight, Execute, Verify and Compensation;
- automatic Entity merge or relation mutation;
- FE-P4-S2, FE-P5-S1, FE-P5-S2;
- deployment and production verification;
- Ready or Merge without separate user authorization.

## 10. Rejected approaches

| Rejected approach | Consequence | Status |
| --- | --- | --- |
| Expose the Stage 5 whole-ChangeSet schema as the FE-P4-S1 Product contract | Cannot satisfy item-level decisions, revision request or purpose-specific Approval | Rejected as direct Product contract; retain as Adapter/reference candidate |
| Treat selected checkboxes as approval authority | Browser state can bypass Server validation and audit | Rejected |
| Approve and Commit in one Review command | Violates ADR-109 and prevents independent stale/policy validation | Rejected |
| Reuse one Approval for Knowledge, Directive and External Action | Cross-purpose authority escalation | Rejected |
| Delete rejected or held candidates | Destroys decision history and future comparison evidence | Rejected |
| Allow partial approval without dependency validation | Creates dangling references and inconsistent changes | Rejected |
| Resolve stale state by automatic resubmission | Duplicates decisions and can approve changed content | Rejected |
| Load all Evidence and Impact data in one unbounded response | Creates disclosure and scale risk | Rejected |

## 11. Risk evaluation

1. **Approval/Commit conflation — HIGH.** Mitigation: independent Approval
   Resource and no Commit operation in FE-P4-S1.
2. **Illegal partial approval — HIGH.** Mitigation: Server-owned dependency graph,
   atomic groups and dangling-reference validation.
3. **Stale target approval — HIGH.** Mitigation: target revision/digest and
   current policy/evidence revalidation at decision completion.
4. **Cross-purpose Approval reuse — HIGH.** Mitigation: explicit purpose and
   target-kind binding; no coercion between approval types.
5. **Cross-Project disclosure — HIGH.** Mitigation: Resource Project binding,
   access masking before counts and Project/revision-aware cache keys.
6. **Legacy Stage 5 model becoming accidental authority — HIGH.** Mitigation:
   Product Port/Adapter boundary and explicit migration/compatibility decision.
7. **Browser decision authority — HIGH.** Mitigation: Server capabilities,
   command ledger, idempotency and outcome resolution.
8. **Evidence/Impact drift — HIGH.** Mitigation: immutable Review Context artifact
   revisions and stale invalidation.
9. **Rejected history loss — MEDIUM.** Mitigation: append-preserving decisions and
   retention rules.
10. **Large Review bundle lockup — MEDIUM/HIGH.** Mitigation: bounded list/detail,
    lazy artifact detail and measured performance Gate.
11. **Inaccessible visual diff — HIGH.** Mitigation: semantic item representation,
    keyboard flow and screen-reader-equivalent content.

## 12. Initial conclusion

FE-P4-S1 is not a greenfield implementation. FE-P3-S2 supplies immutable Review
Submission handoff, and Stage 5 supplies reusable freshness, decision lineage and
approved-manifest concepts. The Product gap is the normalized Review Center
boundary: immutable Review Context, Item/Operation decision graph, legal partial
approval, revision request, independent purpose-specific Approval Resources,
protected Product APIs and the accessible `/review` Workspace.

The next preparation unit is a focused architecture and contract review that
freezes D1–D10, determines whether a new persistence/compatibility ADR is needed,
and then defines numbered Acceptance Criteria and an implementation request.
Until those records are explicitly accepted, Product implementation remains
`NOT_STARTED` and `NOT_AUTHORIZED`.
