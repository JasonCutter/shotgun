# Issue #203 — Semantic Comparison Graduation Implementation Plan

- Status: **DESIGN PACKAGE — pending ADR-160 approval**
- Canonical base: `main@fb209bffb5876ac3c717b429654be026dc1d84c3`
- Governing ADR proposal: [ADR-160](../architecture/adr/ADR-160-stage-5-semantic-comparison-relationships.md)
- Blocked validation: ECAV-01B Gate A
- Product implementation in this package: **none**

## 1. Purpose and non-goals

Issue #203 is the smallest architecture package that closes the gap exposed by
ECAV Gate A: a Candidate must be compared with real pre-existing Canonical
resources and the relationship must be durable and inspectable. The package
does not rerun ECAV and does not repair the gap by manufacturing comparison
rows.

This branch contains only the decision, implementation sequence, migration and
acceptance contract. It does not change Product TypeScript, JSON schemas,
database migrations, lockfiles, provider configuration, Canonical data,
validation fixtures or the ECAV report.

## 2. Current-to-target boundary

| Current Stage 5 MVP                                                             | Target after ADR-160 implementation                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| v1 classification is one of `NEW_CLAIM`, `EXACT_DUPLICATE`, `POSSIBLE_CONFLICT` | v2 candidate disposition is separate from `relationships[]`                   |
| text diff chooses one closest Claim                                             | bounded authorized shortlist, then zero/one/many durable relationships        |
| `similarity >= 0.6` implies `POSSIBLE_CONFLICT`                                 | similarity only selects targets; semantic conflict needs a typed rationale    |
| `matchedClaim` is the only target identity                                      | each relationship pins resource type/id/revision and Canonical snapshot       |
| unavailable semantic capability can look like novelty                           | explicit `SEMANTIC_UNAVAILABLE`; no success completion, Draft or approval     |
| v1 JSON is the stored result                                                    | additive v2 summary + normalized relationships + immutable analysis revisions |

ADR-085 remains the v1 authority. No historical v1 row is rewritten or
reclassified.

## 3. Current codebase impact inventory

The following current-main surfaces were inspected and are the only Product
surfaces that a later implementation request may change. They are listed here
to prevent an implementation from silently missing a consumer or widening the
scope:

| Surface                                                                                                        | Current boundary                                                                                                                             | Later v2 work                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/comparison/src/index.ts`                                                                              | `bestMatch()` performs normalized equality plus text similarity; `CandidateValidated` persists one v1 result and emits `ComparisonCompleted` | Add a v2 orchestration path, shortlist/analysis Ports, state machine and multi-relationship persistence while keeping v1 handler isolated |
| `modules/comparison/module-manifest.json`                                                                      | owns `comparison.results`, v1 event/query ranges                                                                                             | Additive v2 capability/ranges and ownership declarations                                                                                  |
| `packages/contracts/src/comparison-review.ts`                                                                  | one `ComparisonClassification`, optional `matchedClaim`, v1 Draft/Manifest and digest inputs                                                 | Add v2 immutable identities, relationship records, analysis references and disposition; retain v1 types                                   |
| `packages/contracts/schemas/comparison-result.v1.schema.json` and `comparison-completed.v1.schema.json`        | three-value enum and v1 required fields                                                                                                      | Add v2 schemas/events; do not widen v1 schemas in place                                                                                   |
| `packages/contracts/schemas/draft-change-set.v1.schema.json` and `approved-change-set-manifest.v1.schema.json` | v1 classification/operation only                                                                                                             | Add v2 Review contracts with relationship/freshness references and unavailable blocking                                                   |
| `modules/change-set-review/src/index.ts`                                                                       | consumes v1 `ComparisonCompleted`, creates v1 Draft and user approval                                                                        | Add explicit v2 consumer; never downcast unavailable or multi-relation results                                                            |
| `adapters/postgres-stage5/src/index.ts`                                                                        | stores v1 summary JSON and review rows                                                                                                       | Add v2 repositories/transactions and idempotency/recovery paths                                                                           |
| `db/migrations/005_stage5_comparison_review.sql`                                                               | owns v1 `comparison.results` and review tables                                                                                               | Add a later additive migration; never mutate historical v1 rows                                                                           |
| `modules/*/module-manifest.json` and assembly wiring                                                           | v1 compatibility ranges and handler acknowledgement                                                                                          | Version-negotiated v2 registration and rollout flag                                                                                       |
| `tests/contract`, `tests/database`, `tests/integration`, `tests/architecture`                                  | v1 Contract, PostgreSQL and Stage 5 flow evidence                                                                                            | Add focused v2, security-negative, replay, stale, replacement and ECAV fixtures                                                           |

This inventory is an implementation boundary, not authorization to modify these
files in the current design PR.

## 4. Chosen v2 contract

The v2 contract has three durable layers:

1. **Comparison summary** — Candidate identity/digest, source/evidence IDs,
   Canonical snapshot, candidate-level disposition, review recommendation,
   shortlist digest, analysis IDs, relationship IDs, access scope and
   sensitivity.
2. **Relationship records** — one record per material relationship to one
   eligible Canonical resource. A Candidate may have multiple different
   relationships; no winning `matchedClaim` is required.
3. **Analysis revisions** — immutable provider-neutral execution identity,
   input/output material digests, prompt/schema/policy revisions, attempt and
   outcome. Protected material remains behind the existing access boundary.

The v2 message/query family must be versioned independently from v1:

```text
ComparisonResultV2
ComparisonCompletedV2
ComparisonIncompleteV2 / ComparisonFailedV2
GetComparisonResultV2
CheckComparisonFreshnessV2
DraftChangeSetV2 / ApprovedChangeSetManifestV2
```

The exact JSON names and schema IDs are frozen in Work Package 1. A v1 client
never receives a lossy conversion of multi-resource v2 semantics.

### Initial Product activation scope

The mature v2 relationship union remains extensible to the Phase 4 resource
vocabulary, but Issue #203's first implementation and ECAV Gate A closure are
strictly **`CLAIM` comparison only**. The implementation must not silently
expand into `FACT`, `ENTITY`, `RELATION`, `EVENT` or `DECISION`. `FACT` remains
deferred under ADR-147 and is not Product-eligible. A future resource type
requires its own authoritative Canonical read/snapshot boundary, retrieval
eligibility, security lineage and acceptance evidence; until then it cannot be
treated as `NEW`, `UNRELATED` or an eligible semantic-analysis target.

The v2 shortlist audit must durably pin the Canonical snapshot, lexical
projection watermark/base, semantic generation ID and source-projection digest,
semantic Canonical base version, query readiness, policy revision, K/cap,
selected target identities, exclusion counts, truncation and coverage status.
The shortlist projection/generation must be exactly compatible with the pinned
comparison snapshot. A stale, degraded, unavailable or base-mismatched
retrieval channel fails closed and cannot support a `NEW` disposition. `NEW`
means only that a completed, versioned bounded policy found no material
relationship within valid coverage; it is not a global novelty claim. When
coverage is insufficient, Review receives an incomplete/unavailable `HOLD`
state and no Draft or approval is allowed.

## 5. Work package sequence

### WP0 — Approval and baseline freeze

**Entry:** ADR-160 accepted by the architecture/user authority.

**Actions**

- Freeze current v1 schemas, module manifests, DB ownership and ADR-085 history.
- Record Issue #203, ECAV Gate A blocked evidence and canonical base in the
  implementation request.
- Confirm no Product code, database or ECAV work is mixed into the design PR.

**Exit**

- Accepted ADR and explicit implementation authorization.
- Contract version and compatibility owner assigned.

### WP1 — Contract and state machine

**Owner:** Comparison/Review contract owners.

**Actions**

- Define `ComparisonResultV2`, `SemanticRelationshipV2`, `AnalysisRevisionV2`,
  v2 events, queries, failure codes and digest material.
- Freeze Issue #203 activation to `CLAIM` comparison only. Keep other Phase 4
  resource types contract-reserved, but require a separate authorization and
  evidence package before any of them becomes Product-eligible.
- Define `NEW`, `EXACT_DUPLICATE`, `REVIEW_REQUIRED`, `ANALYSIS_PENDING`,
  `SEMANTIC_UNAVAILABLE`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`,
  `POLICY_BLOCKED`, and `STALE` state transitions.
- Define the project rollout state machine `V1_ONLY` → `V2_SHADOW` →
  `V2_ACTIVE` and enforce exactly one Review-authoritative comparison contract
  for each project + Candidate revision.
- Define event acknowledgement: success completion only for `COMPLETED`; an
  unavailable/failure event is explicit and never creates a Draft ChangeSet.
- Define freshness invalidation for Candidate, Canonical snapshot, shortlist,
  access policy, provider/model, prompt/schema and semantic policy revisions.

**Exit tests**

- JSON/TypeScript contract vectors cover missing identity, multiple relations,
  conflict subtype, protected scope and unavailable outcomes.
- Architecture tests reject a v2 relationship without Candidate, Canonical or
  AnalysisRevision identity.

### WP2 — Additive persistence and recovery

**Owner:** Comparison persistence adapter.

**Actions**

- Add v2 summary, relationship and AnalysisRevision tables without altering
  `comparison.results` or historical v1 JSON.
- Add project-scoped foreign keys/checks, uniqueness and indexes for bounded
  lookup and replay idempotency.
- Persist output/material digests and safe status codes; never persist secrets
  or unauthorized prompt content.
- Implement transactional save/reconcile for duplicate delivery, concurrent
  workers, process restart and outcome-unknown attempts.
- Add additive backup/restore coverage and an exact rollback that disables v2
  writers while retaining v2 evidence.

**Exit tests**

- Migration forward/rollback rehearsal on a copy of the Stage 5 database.
- PostgreSQL restart restores summary, all relationships and analysis lineage.
- Same input idempotency and concurrent insert races converge to one result.

### WP3 — Authority-safe shortlist

**Owner:** Comparison module with existing retrieval Port.

**Actions**

- Keep exact normalized identity as deterministic, provider-free `NO_OP` path.
- Add bounded lexical/hybrid retrieval and optional entity/topic/time hints over
  the pinned Canonical snapshot.
- Apply project, access scope, sensitivity and provider-egress policy before
  ranking and before model prompt creation.
- Persist the complete shortlist audit: Canonical snapshot, lexical projection
  watermark/base, semantic generation/source-projection identity, semantic
  Canonical base version, query readiness, policy revision, K/cap, selected
  target identities, exclusion counts, truncation and coverage status.
- Require exact snapshot/projection/generation compatibility. Stale, degraded,
  unavailable or base-mismatched retrieval fails closed; insufficient coverage
  cannot produce `NEW`, `UNRELATED` or an approving Review path.
- Ensure similarity/rank is never written as a relationship type or conflict.

**Exit tests**

- Full-corpus prompt prohibition test.
- Unauthorized target never appears in shortlist, prompt, rationale, result or
  error text.
- Deterministic shortlist replay produces the same digest.

### WP4 — Governed semantic analysis

**Owner:** Existing AI Provider/Capability runtime.

**Actions**

- Route through the capability-based provider registry; no vendor name in the
  Comparison contract.
- Validate structured output against the v2 schema and verify every referenced
  Canonical resource/Evidence exists in the pinned snapshot.
- Store immutable AnalysisRevision with provider/model/capability, credential
  revision reference, prompt/schema/policy revision, attempt, timing, input and
  material digests.
- Separate retryable, terminal, policy-blocked, unavailable and outcome-unknown
  outcomes. Never fallback to `NEW` when semantic analysis is required.
- Preserve challenger/model-disagreement material rather than majority-voting
  it away.

**Exit tests**

- Provider unavailable blocks completion/Draft/approval.
- Schema-invalid output is terminal or retryable by policy and never becomes a
  relationship.
- Exact duplicate path makes zero semantic calls.

### WP5 — Comparison orchestration and Review bridge

**Owner:** Stage 5 Comparison and Change Set Review.

**Actions**

- Orchestrate WP1–WP4 into immutable v2 summaries and multi-resource relation
  rows.
- Persist `UNRELATED` only for analyzed eligible shortlist targets; do not emit
  protected `POLICY_BLOCKED` targets.
- Map relationships to existing supported review operations without inventing
  Canonical mutation authority. Exact duplicate may recommend `NO_OP`; semantic
  duplicate still requires user review.
- Make Review freshness, sufficient shortlist coverage and user-only approval
  require a completed v2 result.
- Keep v1 consumers/readers isolated; use explicit capability negotiation and
  enforce one Review-authoritative path per project + Candidate revision.

**Exit tests**

- Review cannot approve stale, unavailable, ambiguous or conflict-only results.
- Unsupported resource types and insufficient shortlist coverage cannot become
  `NEW`/`UNRELATED` or produce a Draft/approval.
- Two Candidates with one shared target retain independent relationship records.
- One Candidate with `SUPPORTS`, `REFINES` and `UNRELATED` results retains all
  three without a winner field.

### WP6 — Operational rollout and replacement

**Actions**

- Add safe metrics and Activity/audit projections without protected content.
- Enable v2 by project/capability flag only after migration and contract gates,
  using mutually exclusive states:
  - `V1_ONLY`: v1 is the only Review-authoritative path;
  - `V2_SHADOW`: v1 remains authoritative and v2 may persist shadow evidence
    but cannot emit Review completion, Draft, Approval or Canonical handoff;
  - `V2_ACTIVE`: v2 is the only authoritative path for newly eligible
    Candidate revisions, while v1 is historical/read-compatible only.
- Enforce the invariant that exactly one comparison contract version is
  Review-authoritative for a project + Candidate revision; dual approval paths
  are rejected.
- Keep v1 as rollback path for at least two compatible releases.
- Document disable, retry, quarantine, export and rollback procedures. Disabling
  v2 stops new v2 authority, preserves historical v2 evidence, and never
  automatically replays a v2-completed/approved Candidate through v1. Manual
  re-entry must be explicit and auditable.
- Run adapter replacement tests with in-memory and alternate provider doubles.

**Exit**

- Definition of Done Module, Flow, Product, Architecture and OSS gates pass.
- Exact implementation head is recorded before ECAV re-entry.

## 6. Focused acceptance matrix

| ID   | Scenario             | Expected evidence                                                                                            | Gate             |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| C-01 | N1 against C1        | Candidate revision/digest + new Evidence + C1 ID/revision + snapshot + relationship + analysis material      | Gate A           |
| C-02 | N2 against C2        | Same durable identity chain; meaningful support/refine/duplicate relation                                    | Gate A           |
| C-03 | N3/N4 against C1     | Material overlap without forced exact duplicate or conflict                                                  | Gate A           |
| C-04 | C3 negative control  | No unjustified semantic duplicate between automate-last and N1–N4                                            | Gate A           |
| C-05 | N5–N7 examples       | No exact duplicate of C0–C3 solely because of shared First Principles theme                                  | Gate A           |
| C-06 | Multi-resource       | One Candidate can persist different relations to at least two Claims                                         | Contract/Review  |
| C-07 | Exact identity       | One deterministic `EXACT_DUPLICATE -> NO_OP`, no provider call, replay-safe                                  | Flow             |
| C-08 | Provider unavailable | `SEMANTIC_UNAVAILABLE`, no `ComparisonCompletedV2`, Draft or approval, retryable path visible                | Flow/Product     |
| C-09 | Similarity trap      | High lexical/vector similarity does not create conflict without typed semantic evidence                      | Architecture     |
| C-10 | Scope denial         | Unauthorized Canonical target is filtered before shortlist/prompt/output                                     | Security         |
| C-11 | Freshness            | Candidate/snapshot/policy/model change makes prior result stale; approval rejected                           | Approval         |
| C-12 | Recovery             | Restart/replay/concurrent workers preserve one result and all immutable children                             | Reliability      |
| C-13 | Compatibility        | v1 rows retain original values; no lossy v2 downcast or silent reinterpretation                              | Migration        |
| C-14 | ECAV re-entry        | Gate A durable relationship proof; only then Gate B and C                                                    | Product          |
| C-15 | Claim-only scope     | Issue #203 compares only Claims; unsupported resource types never become `NEW`/`UNRELATED` or enter analysis | Contract/Product |
| C-16 | Shortlist coverage   | Snapshot/projection/generation mismatch, stale/degraded readiness or truncation blocks `NEW` and Review      | Flow/Approval    |
| C-17 | Rollout authority    | `V1_ONLY`/`V2_SHADOW`/`V2_ACTIVE` permit exactly one Review-authoritative path per Candidate revision        | Migration/Review |

## 7. Migration, rollback and compatibility

Migration is additive and ordered:

```text
schema/tables/readers
  -> repositories and contract tests
  -> v2 comparison in shadow/deterministic mode
  -> Review v2 consumer and approval-negative tests
  -> explicit project capability enablement (`V1_ONLY`/`V2_SHADOW`/`V2_ACTIVE`)
  -> ECAV Gate A re-entry
```

No semantic backfill is performed from v1 rows. Existing v1 `NEW_CLAIM` rows
remain “not semantically compared,” not proven novel. A rollback disables the v2
writer/consumer flag and leaves v2 rows for audit; v1 and Canonical state are
untouched. A Candidate already completed or approved under v2 is not
automatically replayed through v1; any re-entry is explicit and auditable.
Removing v1 requires a later ADR and observed consumer evidence. No project may
have dual v1/v2 Review-authoritative paths for the same Candidate revision.

## 8. OSS and direct-implementation record

The four verified references in the Module Architecture Role Matrix were
reviewed for this boundary. They remain `REFERENCE_ONLY` (gbrain, ddsyasas,
OpenKnowledge) or previously audited extraction/reference material (llmwiki);
none supplies a provider-neutral, access-safe, user-approved semantic
Candidate-to-Canonical authority that can be adopted without violating
Shotgun ownership. The decision is therefore `NO_RELEVANT_OSS` for this role.

The implementation must still use the existing provider/retrieval Ports and
retain replaceable adapters. No new OSS runtime, database, SDK or lockfile is
authorized by this design package.

## 9. Definition-of-Done checklist for the later implementation PR

- [ ] ADR-160 accepted and linked to Issue #203.
- [ ] v2 schemas, events and failure taxonomy versioned.
- [ ] Additive migration, rollback and backup/restore tested.
- [ ] Candidate/snapshot/analysis/relationship digests are immutable.
- [ ] Exact-match, semantic, unavailable, stale and replay paths tested.
- [ ] Security-negative and provider-egress tests pass.
- [ ] Review approval remains user-only and Canonical write remains Stage 6.
- [ ] v1 history is not reinterpreted and v1 clients cannot receive a lossy
      v2 result.
- [ ] Adapter replacement, Golden ECAV corpus and bounded performance tests
      pass.
- [ ] Only then rerun ECAV Gate A → Gate B → Gate C.

## 10. Explicit stop boundary for this design PR

This document does not authorize Product code, migrations, schema changes,
provider execution, DeepSeek/OpenAI/live calls, ECAV reruns, branch merge or
Ready for Review. The next action after Draft PR review is either ADR-160
revision/acceptance or a new implementation request; no code is to be inferred
from this plan alone.
