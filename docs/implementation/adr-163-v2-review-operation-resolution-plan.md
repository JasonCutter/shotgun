# ADR-163 Implementation Plan — V2 Review Operation Resolution

- Status: **DESIGN-ONLY PLAN / GPT ARCHITECTURE REVIEW PENDING**
- Proposed at: 2026-09-07
- Governing ADR: `docs/architecture/adr/ADR-163-v2-review-operation-resolution.md`
- Subject base: `main@2d64936c08937788a801adeeb29c893abe1585f2`
- Predecessor: PR #228 (`MODIFY_REVIEW` raw approval guard), merged and verified
- Frozen acceptance DB: `shotgun_full_e2e_20260907_r8`
- Frozen project: `8a079162-a26f-43a0-a903-1eb5d0465fc9`
- Implementation status: **NOT AUTHORIZED**

## 1. Purpose and decision boundary

This plan turns ADR-163 into an implementation-ready sequence for a later,
separately authorized work item. It does not implement Product code, create a
database migration, call an AI provider, mutate the r8 database, rerun ECAV,
start Phase F, or start r9.

The narrow objective is to resolve a V2 `MODIFY_REVIEW` recommendation through
an explicit user operation choice while preserving the existing fail-closed
approval guard:

```text
MODIFY_REVIEW revision N
  -> user ResolveReviewOperationV2(ADD_CLAIM | NO_OP)
  -> durable OperationResolution + immutable Draft revision N+1
  -> explicit APPROVE for N+1
  -> existing Stage 6 supported handoff
```

The source revision remains immutable. AI relationships remain analysis
evidence. The browser is never the authority for project, actor, Candidate,
Evidence, Canonical snapshot, manifest, token, or operation semantics.

## 2. Governing constraints

The later implementation must satisfy, in order:

1. Canonical, Evidence, Approval, Action, and Claim/Fact safety boundaries.
2. The module Port/Adapter and data-ownership rules.
3. ADR-160 V2 comparison and relationship freshness semantics.
4. PR #228's raw `MODIFY_REVIEW + APPROVE` fail-closed behavior.
5. Existing Stage 6 `ADD_CLAIM` and `NO_OP` contracts without widening Stage 6.
6. Contract, Golden Corpus, Security, Replay/Idempotency, Replacement, and
   Migration/Rollback gates from `AGENTS.md`.

`REJECT` and `HOLD` remain ordinary Review decisions. They are not converted
into operation resolutions. No relation, merge, replace, delete, conflict-
resolution, or Fact-promotion operation is introduced.

## 3. Scope fence and non-goals

### In scope for the later implementation request

- A versioned Review-module command Port, `ResolveReviewOperationV2@1.0.0`.
- Server-owned resolution of the exact Candidate/Evidence/Comparison/
  Analysis/relationship/Canonical/access/policy identity chain.
- A durable `OperationResolution` and append-only Draft revision N+1.
- Explicit approval binding to the resolved revision and stored operation.
- Durable idempotency, optimistic concurrency, stale detection, and audit.
- In-memory and PostgreSQL Adapter parity behind the same Port.

### Explicitly out of scope

- Product implementation on this design branch.
- Any provider or DeepSeek/OpenAI call.
- Any write, retry, replay, cleanup, or reinterpretation of the frozen r8 DB.
- Direct Relation authority, Claim merge/delete/replace, or Fact promotion.
- Yjs, a second command runtime, or a parallel idempotency store.
- Phase F, r9, deployment, Ready/Merge, or production rollout.

## 4. Required implementation sequence

The following order prevents a half-bound command from reaching Canonical:

### Step 0 — Architecture acceptance and freeze

Before code, GPT/controller must accept ADR-163 and freeze the command,
digest, persistence, failure, rollout, and test contract. Record the accepted
contract version and the exact base SHA in the implementation issue.

Exit gate: no Product work begins while ADR-163 is `DESIGN PROPOSED`.

### Step 1 — Contract and type package

Define the Product-owned Port and typed outcomes first. The caller request is
limited to:

```ts
type ResolveReviewOperationV2Request = {
  draftId: string;
  expectedDraftRevision: number;
  expectedDraftDigest: string;
  chosenOperation: 'ADD_CLAIM' | 'NO_OP';
  clientRequestId: string;
  idempotencyKey: string;
};
```

The authenticated command envelope supplies actor/project/access/sensitivity,
correlation, causation, and trace context. The server resolves every other
identity. It must return only safe resolution metadata and a typed failure;
never a provider secret, Candidate body copied from the caller, manifest,
approval token, or internal adapter record.

Required non-success outcomes include `NOT_FOUND`, `FORBIDDEN`,
`PROJECT_SCOPE_MISMATCH`, `INVALID_OPERATION`, `DRAFT_NOT_ELIGIBLE`,
`DRAFT_REVISION_CONFLICT`, `STALE_REVIEW_INPUT`, `ACCESS_REVOKED`,
`POLICY_CHANGED`, `RESOLUTION_CONFLICT`, `IDEMPOTENCY_KEY_REUSE`, and
`OUTCOME_UNKNOWN`.

### Step 2 — Server-side precondition resolver

Implement one resolver owned by the Review module that verifies, in this order:

1. Authenticated human actor, project membership, access, sensitivity, and
   policy revision.
2. Current Draft is pending `MODIFY_REVIEW` with `REVIEW_REQUIRED`.
3. Claim-only activation and supported resource type.
4. Exact Candidate revision/digest, SourceVersion, and Evidence lineage.
5. Immutable ComparisonResultV2, AnalysisRevision, relationship IDs, and
   material digests.
6. Shortlist/retrieval and semantic generation identity.
7. Canonical snapshot ID/version/digest.
8. No previous successful resolution for this source revision except an exact
   idempotent replay.

If any check fails, create no resolution and no Draft revision. Do not refresh,
rebase, downgrade to V1, or turn evidence into `UNRELATED`/`NEW`.

### Step 3 — Durable operation resolution and Draft revision

Add the Review-owned persistence boundary additively. Logical
`OperationResolution` fields are defined by ADR-163, including source and
resolved revisions/digests, Candidate/Evidence/Comparison/Analysis/
relationship references, Canonical snapshot, access/policy revisions, chosen
operation, resolver actor, semantic command identity, digest, and immutable
`RESOLVED` state.

Materialize the same Draft aggregate as immutable revision N+1:

- N remains `MODIFY_REVIEW` and queryable.
- N+1 contains `ADD_CLAIM` or `NO_OP` and remains a normal strict
  `DraftChangeSetV2` `contractVersion: 2.0` object.
- N+1 preserves `disposition = REVIEW_REQUIRED` and
  `reviewRecommendation = MODIFY_REVIEW`; only the Draft `operation` changes.
- N+1 remains unapproved and non-Canonical.
- The current pointer advances atomically only with the resolution record.
- The existing immutable Review submission boundary is reused without adding
  `operationResolutionRef` to the strict Draft or Manifest schemas. Approval
  finds exactly one matching separate resolution by project, change-set,
  resolved revision/digest, and chosen operation.

Keep `review.change_sets_v2` as the backward-compatible current aggregate/head
row. Add an additive immutable `review.change_set_revisions_v2` authority. A
pre-enable migration copies each existing current row into that revision store
at its existing revision/digest as an exact historical snapshot; it creates no
invented OperationResolution and does not reinterpret existing comparisons.
Freeze reader precedence and rollback behavior before migration SQL.

Freeze canonical serialization and digest field order in the accepted contract
before writing migration SQL. Exclude UI order, labels, browser rationale,
timestamps, and unrelated projections from digests.

### Step 4 — Transaction, idempotency, and concurrency

Keep ConnectorRuntime deduplication and the Review domain transaction as two
distinct layers. Do not attempt to make connector completion part of the
Review database transaction and do not create a parallel generic idempotency
subsystem.

The existing connector lifecycle remains:

```text
connector dedup begin
  -> durable job
  -> invoke Review command handler
  -> handler returns
  -> connector dedup complete
```

The Review-owned critical section is:

```text
lock current head N
  -> resolve and validate all server-owned references
  -> check rollout and security policy
  -> enforce one resolution per source revision
  -> insert resolution
  -> insert N+1 Draft revision
  -> advance current pointer
  -> append Review History/Audit
  -> commit
```

The transaction must not call Canonical, Stage 6, a provider, or an external
Action. Database uniqueness protects one logical resolution per source
revision/semantic resolution identity. Competing `ADD_CLAIM` and `NO_OP`
choices serialize so exactly one wins and the other creates no rows.

If the Review commit succeeds but connector completion/acknowledgement is
lost, the connector record becomes `OUTCOME_UNKNOWN`. Restart must perform a
read-only authoritative domain lookup using project plus `clientRequestId`
and/or semantic resolution identity. The lookup proves committed status,
resolution ID, source/resolved revision and digest, and chosen operation. Only
then does existing `ConnectorRuntime.reconcileOutcome` converge the ledger.
The handler is not blindly replayed, no new idempotency key is created, and no
second revision is possible.

### Step 5 — Approval bridge

Retain PR #228's raw guard. The existing APPROVE route must require a resolved
N+1 revision whose separate `OperationResolution` is `RESOLVED`; find exactly
one match by project, change-set, resolved revision, resolved digest, and
chosen operation. Bind the approval to resolution ID, source revision,
resolved revision/digest, Candidate/Evidence/Comparison/relationship/Analysis
identities, Canonical snapshot, access, and policy. Revalidate freshness
immediately before manifest/token/handoff.

The resolved Draft remains valid ordinary strict V2.0 and retains
`disposition = REVIEW_REQUIRED` plus `reviewRecommendation = MODIFY_REVIEW`.
Only its user-resolved `operation` is `ADD_CLAIM` or `NO_OP`; the existing
ApprovedChangeSetManifestV2 and Stage 6 contracts remain unchanged.

Resolution actor and approval actor are independently authorized users. Record
both `resolverActorId` and `approverActorId`; they may be the same user but are
not required to match by this plan.

The caller cannot replace the stored operation. Raw `MODIFY_REVIEW + APPROVE`
stops before persistence, manifest, token, handoff, or Canonical mutation.

### Step 6 — Existing Stage 6 semantics

`ADD_CLAIM` delegates to the current supported Stage 6 path and advances
Canonical exactly once, preserving source and Evidence lineage. `NO_OP` uses
the current Stage 6 no-op contract, advances Canonical by zero, and creates no
Claim, Fact, Relation, merge, delete, or replacement. `REJECT`/`HOLD` keep their
existing ordinary Review paths.

For the Tesla 2008/2009 conflict, an explicit `ADD_CLAIM` may retain both
source-supported Claims; disagreement remains inspectable evidence. No system
actor selects truth automatically.

### Step 7 — Freshness and normal re-entry

Canonical, Candidate, Evidence, relationship, analysis, shortlist, semantic
generation, access, or policy drift makes resolution or approval stale. Never
silently rebase a resolved revision. Re-entry uses ADR-160's explicit
`RecompareClaimCandidate@1.0.0` to produce a new comparison, analysis, and
Draft. Historical r8 artifacts remain immutable and untouched.

### Step 8 — Adapter and migration gates

Implement the in-memory Adapter first for deterministic Contract tests, then
the PostgreSQL Adapter behind the same Port. Keep
`review.change_sets_v2` as the current aggregate/head compatibility surface
and add `review.change_set_revisions_v2` as immutable revision authority. The
migration deterministically snapshots every existing current row at its
existing revision/digest, without semantic backfill or fabricated resolution.
It is additive, reader-compatible before enablement, uniqueness-protected,
and has forward verification plus restore/replay drills. No destructive down
migration is allowed. A project-scoped capability flag controls rollout;
disabling it is fail-closed and leaves immutable resolution history readable.
Connector `OUTCOME_UNKNOWN` reconciliation must be tested separately from the
Review transaction and must never invoke a blind handler replay.

## 5. Acceptance and test contract

The implementation request must map each requirement to a test and evidence
artifact. At minimum:

| ID | Scenario | Required proof |
| --- | --- | --- |
| R1 | Raw `MODIFY_REVIEW + APPROVE` | Blocked; no persistence/handoff |
| R2 | Resolve to `ADD_CLAIM` | N+1 exists; N is unchanged |
| R3 | Approve resolved `ADD_CLAIM` | Stage 6; Canonical `+1`; lineage valid |
| R4 | Resolve to `NO_OP` | N+1 exists; N is unchanged |
| R5 | Approve resolved `NO_OP` | Canonical `+0`; no Claim/Fact |
| R6 | Raw `REJECT` | Existing decision; Canonical `+0` |
| R7 | Raw `HOLD` | Existing decision; Canonical `+0` |
| R8 | Base changes before resolution | Typed stale block; no rows |
| R9 | Base changes before approval | Typed stale approval block |
| R10 | Same idempotency replay | One resolution/result |
| R11 | Conflicting concurrent choices | One winner; loser has no rows |
| R12 | Restart after command | Exact durable outcome restored |
| R13 | Tesla 2008 + 2009 | Both Claims may coexist; conflict inspectable |
| R14 | Relationship evidence | No automatic Canonical Relation |
| R15 | Claim authority | No automatic Fact |
| R16 | r8 historical artifacts | Untouched, unretried, unrewritten |
| R17 | Contract compatibility | Resolved N+1 is strict V2.0; Stage 6 unchanged |
| R18 | Immutable revision migration | Existing current row is exact snapshot; N remains retrievable |
| R19 | Domain commit then connector ack loss | `OUTCOME_UNKNOWN` lookup/reconcile; no duplicate revision |
| R20 | Recommendation/operation separation | `REVIEW_REQUIRED` + `MODIFY_REVIEW` preserved; only operation changes |
| R21 | Resolver/approver provenance | Both authorized actors audited; same/different actors supported |

Required gates are Contract, Review bridge unit, Product/PostgreSQL boundary,
Security Negative, Replay/Idempotency, concurrency, restart,
Migration/Rollback, Adapter Replacement, Connector `OUTCOME_UNKNOWN`
reconciliation, immutable revision migration, and the bounded ECAV conflict
corpus.
Golden Corpus evidence is required for any comparison/evidence behavior change.
No Product or r8 test is authorized on this design branch.

## 6. OSS and dependency decision

The later implementation records `NO_RELEVANT_OSS` for semantic review-operation
authority and adds no runtime dependency. The reviewed candidates remain
`REFERENCE_ONLY` at their pinned commits:

- `garrytan/gbrain` `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT — job,
  idempotency, and history patterns only.
- `lucasastorian/llmwiki` `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0
  — evidence/locator patterns only.
- `ddsyasas/llm-wiki` `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT — review
  and action UX patterns only.
- Inkeep OpenKnowledge `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-
  later — activity/diff UX patterns only; Runtime/storage/Yjs excluded.

Existing PostgreSQL, JSON Schema/Ajv, and Transactional Outbox decisions are
reused. The Open-source Role Matrix remains unchanged because nothing is newly
adopted, extracted, or augmented.

## 7. Work packages and stop gates

| Package | Deliverable | Stop gate |
| --- | --- | --- |
| A | Accepted Port/types/failures | Contract reviewed and version frozen |
| B | Server resolver | Freshness/security negative tests pass |
| C | Resolution + N+1 persistence | Atomicity/idempotency/concurrency pass |
| D | Approval bridge | Raw guard and resolved binding pass |
| E | In-memory/PostgreSQL Adapters | Replacement/rollback evidence pass |
| F | Rollout/migration | Restore/replay drill and reader compatibility pass |
| G | E2E corpus | R1–R21 and required gates pass |

Any failure keeps the work item blocked. There is no `COMPLETE_WITH_LIMITS`
shortcut for an unreviewed OSS decision, missing Contract test, unsafe
Canonical/Approval boundary, or missing migration/rollback evidence.

## 8. Completion report template for the later implementation

The eventual completion report must state:

- implementation and exclusion scope;
- exact base SHA, contract versions, migration and rollout state;
- OSS candidates, decisions, commits, licenses, and Role Matrix status;
- Port/Adapter boundaries and direct-implementation justification;
- Contract, Golden Corpus, Security, Replay/Idempotency, Replacement,
  Migration/Rollback, Connector `OUTCOME_UNKNOWN`, and R1–R21 results;
- r8 immutability evidence and any known limitations;
- the next accepted Contract version or explicit blocker.

## 9. Design-branch validation and handoff

This design branch is limited to Markdown and ADR-index metadata. Run only:

```text
npm run docs:adr-index
npm run docs:validate
npm run docs:links
npm run docs:canonical
git diff --check
```

Do not run Product tests, database migrations, provider calls, r8 commands,
ECAV, or Phase F/r9 from this branch. Commit and push the design branch and
open a **Draft** PR. Stop there for GPT/controller architecture review; do not
mark Ready, merge, or declare final completion.
