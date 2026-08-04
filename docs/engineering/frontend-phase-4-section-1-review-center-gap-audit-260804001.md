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
- Draft PR: [#63](https://github.com/JasonCutter/shotgun/pull/63)
- Governing contract: `docs/architecture/frontend/phase-4-governance-execution.md`
- Governing decision: ADR-109 — Review Center as Item-level Approval Gateway
- Entry authorization: user, `2026-08-04T19:52:00+09:00`
- Status: `PREPARATION_ONLY`
- Product implementation: `NOT_STARTED`
- Ready, Merge, Deployment and Production Verification: `NOT_AUTHORIZED`

This audit records the reusable foundation, missing Product behavior and decisions that must be
frozen before implementation. It does not approve ADR-128, freeze the Contract Snapshot, authorize
Migration 027 or authorize Product implementation.

## 1. Canonical responsibility

FE-P4-S1 is the human judgment surface for governed proposals. It must provide:

1. a unified Review entry point without taking ownership of Candidate, DraftChangeSet or
   UserDirectiveProposal resources;
2. Item or Operation-level approve, reject, request-revision and hold decisions;
3. Candidate, Canonical Snapshot, Evidence, Conflict and Recursive Impact in one Review Context;
4. purpose-specific Approval Resources bound to Actor, target revision, digest, policy, reason and
   expiry;
5. stale, permission, policy and Evidence revalidation;
6. dependency and dangling-reference validation before partial approval;
7. preserved rejection, hold, revision-request and comment history;
8. strict separation between Approval and Commit, Directive activation or Connector execution.

External Action approval and execution remain FE-P4-S2 responsibilities. FE-P4-S1 may expose a
handoff state, but it must not issue an External Action Approval or execute Preflight, Execute,
Verify or Compensation.

## 2. Confirmed reusable foundation

### 2.1 FE-P3-S2 Review handoff

FE-P3-S2 already creates immutable Review Submission and Review Resource references for a pinned
Draft revision. The handoff includes operation and content digests, validation and impact artifact
references, Evidence lineage, Project and policy bindings. It explicitly excludes Review decisions,
Approval and Canonical Commit.

### 2.2 Stage 5 change-set review

`modules/change-set-review/src/index.ts` provides:

- whole-ChangeSet `APPROVE`, `HOLD` and `REJECT`;
- Project, Actor, access-scope and freshness checks;
- idempotent decision identity and conflict rejection;
- approval token and ApprovedChangeSetManifest creation;
- decision, manifest and event lineage;
- no Canonical write and no External Action execution.

It is not the FE-P4-S1 Product contract. Its decision unit is the whole ChangeSet, the revision is
fixed to `1`, `REQUEST_REVISION` is absent, dependency-safe partial approval is absent and Approval
is not an independent purpose-specific Product Resource.

### 2.3 Shared Frontend foundation

The repository already provides:

- Server-derived Principal, Session, Project, access and policy authority;
- versioned Frontend Commands, idempotency and outcome resolution;
- typed failure translation and `OUTCOME_UNKNOWN` recovery without automatic resubmission;
- ADR-119 Browser Draft State Machine and scope-safe cache ownership;
- protected Product API and strict typed client patterns;
- Evidence, Conflict and Recursive Impact read sources;
- route focus, announcement and responsive accessibility patterns.

### 2.4 Current `/review` route

`apps/shotgun-web/src/app/router.tsx` protects `/review`, but the route renders only a
`PlaceholderPage`. No Review Product API, typed client, query-key factory, Review state machine or
Review Workspace exists.

## 3. Reuse and gap classification

- FE-P3-S2 Review Submission: `REUSE_AS_IS` for immutable source identity; `EXTEND` with Review
  Context materialization.
- Stage 5 change-set review: `ADAPT_BEHIND_NEW_PORT`; never expose the legacy schema directly.
- Frontend Command Ledger: `REUSE_AS_IS`; do not create a second command outcome ledger.
- Canonical, Evidence, Conflict and Impact reads: `ADAPT_BEHIND_NEW_PORT`.
- Purpose-specific Approval Resource: `MISSING`.
- Item and dependency graph: `MISSING`.
- Partial approval validation: `MISSING`.
- UserDirectiveProposal Review Adapter: `MISSING`.
- Review Product API and strict client: `MISSING`.
- Review Workspace: `MISSING`.
- In-memory and PostgreSQL parity for the Product Review model: `MISSING`.
- Accessible text-equivalent comparison and dependency explanation: `MISSING`.

## 4. Missing Product behavior

1. No bounded Review queue across supported target kinds.
2. No immutable Review Context revision binding target, artifacts and policy identity.
3. No stable Review Item identity or Server-owned dependency graph.
4. No Item-level `APPROVE`, `REJECT`, `REQUEST_REVISION` and `HOLD`.
5. No Server-computed legal partial approval set.
6. No independent purpose-specific Approval Resource lifecycle.
7. No Candidate acceptance-for-authoring effect distinct from Approval issuance.
8. No UserDirectiveProposal Product Review flow.
9. No protected Review Product API or strict runtime decoders.
10. No Review Center Workspace, deep-link restoration or focus restoration.
11. No stale, policy, access, Evidence or `OUTCOME_UNKNOWN` recovery experience.
12. No negative proof that Approval cannot write Canonical state or activate a Directive.

## 5. Architecture conclusion

ADR-109 fixes the responsibility and safety boundary but does not decide the durable Product model.
A new additive decision is required. The proposed decision is ADR-128:

- persist immutable Review Context revisions rather than reconstructing unversioned bundles;
- persist immutable Review Items and dependency edges;
- keep decisions and comments append-only;
- issue an independent Approval Resource only when target-specific eligibility passes;
- adapt the Stage 5 whole-ChangeSet model behind compatibility ports;
- use additive Migration 027 and in-memory/PostgreSQL parity;
- keep Approval, Commit, Directive Apply and External Action execution separate.

## 6. Decisions to freeze

### D1 — Review targets

The V1 Product target kinds are:

- `KNOWLEDGE_DRAFT_CHANGE_SET`;
- `DISCOVERY_CANDIDATE`;
- `USER_DIRECTIVE_PROPOSAL`.

A Candidate `APPROVE` decision means accepted for authoring and does not issue an Approval Resource.
External Action Manifest review and approval remain FE-P4-S2.

### D2 — Review Context revision

A stable `reviewContextId` may have immutable numbered revisions. Each revision binds target,
Project, policy, Canonical base, artifact identities, immutable Review Items and dependencies.
Revalidation creates a new context revision and never rewrites history.

### D3 — Item graph

Every Review Item has a stable Item ID, immutable source reference, content digest, target identity,
Evidence and Impact references, allowed decisions and dependency metadata. Dependency edges are
`REQUIRES`, `ATOMIC_WITH` or `CONFLICTS_WITH`.

### D4 — Decision lifecycle

The V1 intents are `APPROVE`, `REJECT`, `REQUEST_REVISION` and `HOLD`. Decisions are append-only. A
later decision may supersede only a nonterminal `HOLD` on the same current context revision.
Terminal reconsideration requires a new target and context revision.

### D5 — Purpose-specific Approval

Approval purposes are `KNOWLEDGE_CANONICAL_CHANGE` and `USER_DIRECTIVE_CHANGE`. Candidate acceptance
does not create Approval. Approval never performs Commit or Apply.

### D6 — Partial approval

The Server computes dependency closure and atomic groups. It rejects an approval set that omits a
required prerequisite, splits an atomic group, creates a dangling reference or includes stale or
inaccessible content.

### D7 — Persistence

Migration 027 is proposed for Review Context revisions, Items, dependencies, decisions, comments and
Approval Resources. Existing Frontend Command Ledger tables remain the command and outcome
authority.

### D8 — Product operations

The V1 operations cover queue list, Context read, Item detail, revalidation, decision recording,
comment recording, outcome resolution and Approval read. No operation mixes decision, Approval and
Commit.

### D9 — Browser ownership

Router owns selected Review identity. React Query owns authoritative snapshots. The route-scoped
Browser Draft State Machine owns only unsent selections, reasons and comments. Mutation retry is
disabled; uncertain results resolve by the original request identity.

### D10 — Accessibility and scale

The contract requires keyboard-complete navigation, screen-reader equivalent comparison and
dependency explanation, focus restoration, 200% zoom, reduced motion, bounded responses, lazy
Evidence and Impact detail and cancellation on context change.

## 7. Security requirements

1. Bind every read and command to Resource Project, not a changed Active Project.
2. Mask inaccessible target, Evidence, Conflict, Impact and dependency metadata before counts.
3. Reject Browser claims about Actor, Capability, policy acceptance or Approval purpose.
4. Revalidate current permission, policy, target and Evidence before decision completion.
5. Prohibit Approval reuse across Knowledge, Directive and External Action purposes.
6. Fail closed on stale context, changed digest or invalid dependency closure.
7. Preserve attempted command outcome for recovery.
8. Prohibit hidden Commit, Apply or Execute side effects.
9. Preserve rejected, held and revision-requested records.

## 8. Explicit exclusions

- Canonical Commit or automatic Canonical write;
- User Directive activation or application;
- External Action Approval, Preflight, Execute, Verify or Compensation;
- automatic Entity merge or graph mutation;
- FE-P4-S2, FE-P5, deployment and production verification;
- Ready or Merge without separate user authorization.

## 9. Rejected approaches

- Directly expose the legacy whole-ChangeSet Review schema.
- Treat Browser checkbox selection as Approval authority.
- Combine Approval and Commit in one command.
- Reuse one Approval across purposes.
- Delete rejected or held review history.
- Allow partial approval without dependency validation.
- Resolve stale or uncertain outcomes by automatic resubmission.
- Return one unbounded Review bundle with all Evidence and Impact payloads.

## 10. Preparation result

The Gap Audit supports a focused Contract Snapshot and ADR-128 proposal. Product implementation
remains `NOT_STARTED / NOT_AUTHORIZED`. Acceptance Criteria remain candidates until explicit user
approval.
