# ADR-128 — Review Context Revision, Item Decision and Purpose-bound Approval Boundary

- Status: **PROPOSED**
- Proposed at: 2026-08-04
- Work item: `FE-P4-S1`
- Related ADRs: ADR-101, ADR-105, ADR-107, ADR-109, ADR-118, ADR-119, ADR-124, ADR-126
- Contract snapshot:
  `docs/architecture/contracts/snapshots/frontend-phase-4-section-1/frontend-phase-4-section-1-contract-snapshot-260804001.md`
- Decision owner: `USER`
- Product implementation: `NOT_AUTHORIZED`

## Context

ADR-109 establishes Review Center as an Item-level Approval Gateway. It requires purpose-specific
Approval, dependency-safe partial approval, stale revalidation and separation from Commit. It does
not decide the durable Product representation needed to implement that boundary.

The repository has two useful but incomplete sources:

1. FE-P3-S2 creates immutable Review Submission and Review Resource references for a pinned
   DraftChangeSet revision.
2. Stage 5 `change-set-review` stores whole-ChangeSet decisions and an approved manifest.

Neither source provides immutable Product Review Context revisions, Item dependency graphs,
`REQUEST_REVISION`, Candidate acceptance-for-authoring or independent purpose-bound Approval
Resources.

## Decision candidate

Adopt a durable Review Product model with immutable context revisions and append-only decisions.

### 1. Review target kinds

The V1 Review target kinds are:

- `KNOWLEDGE_DRAFT_CHANGE_SET`;
- `DISCOVERY_CANDIDATE`;
- `USER_DIRECTIVE_PROPOSAL`.

External Action Manifest approval remains FE-P4-S2. FE-P4-S1 may expose a handoff state only.

### 2. Immutable Review Context revisions

`reviewContextId` is stable across revalidation. `contextRevision` is monotonically increasing.
Every revision is immutable and binds the exact target, content digest, Project, access and policy
revisions, Canonical base, Evidence, Conflict, Impact and Item dependency graph.

Revalidation creates a new revision. It does not mutate the submitted target or prior context.

### 3. Item and dependency model

Review Items are immutable projections of target Operations, Candidate content or Directive
clauses. Every Item has a stable ID, source reference, digest, allowed decisions and artifact
references.

Dependency edges are:

- `REQUIRES`;
- `ATOMIC_WITH`;
- `CONFLICTS_WITH`.

The Server computes dependency closure and legal decision sets. The Browser cannot invent or remove
edges.

### 4. Decision model

Decision intents are `APPROVE`, `REJECT`, `REQUEST_REVISION` and `HOLD`.

Decision records and comments are append-only. `HOLD` is nonterminal and may be superseded on the
same current context revision. `APPROVE`, `REJECT` and `REQUEST_REVISION` are terminal for the Item
on that context revision. Reconsideration requires a new target revision and Review Context
revision.

### 5. Target-specific approval effect

- Approving eligible DraftChangeSet Items may issue a `KNOWLEDGE_CANONICAL_CHANGE` Approval.
- Approving an eligible UserDirectiveProposal may issue a `USER_DIRECTIVE_CHANGE` Approval.
- Approving a Discovery Candidate records `ACCEPTED_FOR_AUTHORING`; it creates no Approval Resource
  and cannot write Canonical knowledge.

This preserves the rule that AI and discovery output remain Candidate until authored and reviewed
through the appropriate governed path.

### 6. Independent Approval Resource

Approval is an independent Server Domain Resource. It binds:

- approval purpose;
- Actor and authority scope;
- Review Context and target identity;
- exact target revision and approved Item IDs;
- content and manifest digests;
- Project, access revision and policy context revision;
- reason, issued time and expiry;
- lifecycle status and invalidation reason.

Approval lifecycle states are `ACTIVE`, `EXPIRED`, `REVOKED`, `CONSUMED` and `INVALIDATED`.

Approval does not perform Canonical Commit, Directive Apply or External Action execution. A later
consumer must revalidate purpose, target, policy, expiry and digest.

### 7. Partial approval

The Server rejects a proposed approval set when it:

- omits a `REQUIRES` prerequisite;
- splits an `ATOMIC_WITH` group;
- includes a `CONFLICTS_WITH` pair;
- creates a dangling target reference;
- includes stale, inaccessible or policy-invalid content.

The approved manifest contains the exact approved Item set and dependency closure.

### 8. Persistence and transaction boundary

Add Migration 027 with Product-owned tables for:

- Review Context revisions;
- Review Items;
- Review dependency edges;
- Review decisions;
- Review comments;
- Approval Resources.

Do not create a second command ledger. Existing Frontend Command Ledger remains the authority for
acceptance, idempotency, completion and outcome resolution.

Decision completion uses one authoritative transaction after command acceptance:

1. lock the current Review Context revision;
2. validate expected context revision, target digest and command digest;
3. revalidate access, policy, target, Evidence and dependency closure;
4. append decision and comment records;
5. issue an Approval Resource only when target-specific eligibility passes;
6. complete the existing command outcome.

In-memory and PostgreSQL adapters must have parity.

### 9. Stage 5 compatibility

The Stage 5 whole-ChangeSet model remains preserved. It is adapted behind a
`LegacyChangeSetReviewPort` and may supply historic decisions or manifests. It is not the FE-P4-S1
Product contract and is not destructively migrated.

New Product decisions do not rewrite legacy records. Where an eligible legacy manifest is imported,
the adapter creates a traceable Review Context source reference rather than fabricating Item-level
history.

### 10. Browser and Product API boundary

The Browser owns only route selection and unsent decision input. Server snapshots own Review
authority. Mutations do not retry automatically. `OUTCOME_UNKNOWN` resolves with the original
`clientRequestId`, idempotency key and semantic digest.

The Product API separates list, read, revalidate, decide, comment, outcome and Approval read
operations. No broad endpoint mixes Approval with Commit or Apply.

## Consequences

The decision adds one migration and a dedicated Product Review model, but it makes partial approval,
stale handling and purpose separation explicit and auditable. Stage 5 compatibility is retained
without constraining the Product contract to a whole-ChangeSet schema.

## Rejected alternatives

- extend the legacy whole-ChangeSet schema in place;
- reconstruct unversioned Review bundles on every read;
- store Approval only as a UI flag or bearer token;
- approve Discovery Candidates directly into Canonical knowledge;
- combine decision, Approval and Commit in one transaction;
- reuse Knowledge Approval for Directive or External Action purposes;
- allow Browser-computed partial approval;
- delete rejected or held history.

## Approval boundary

This ADR is a proposal. It does not authorize Migration 027, Product implementation, Ready, Merge,
deployment, production verification or FE-P4-S2.
