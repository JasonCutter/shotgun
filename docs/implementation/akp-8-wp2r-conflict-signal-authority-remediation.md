# AKP-8 WP2R — Production Conflict Signal Authority Remediation

- Status: **ADR_CORRECTION_READY_FOR_REVIEW**
- Current WP2 status: **BLOCKED_BEFORE_IMPLEMENTATION / MISSING_PRODUCT_CAPABILITY**
- Baseline: `main@0077ddc90efe4b3756cce66ad31bbc021c49395b`
- Remediation branch: `codex/akp-8-wp2r-conflict-signal-authority-remediation`
- Scope: Phase A authority audit and ADR-151 decision completion only
- Product/runtime changes: **NONE**
- Migration/table/runtime dependency/lockfile changes: **NONE**
- Tests added: **NONE**
- ADR status: `ADR-151 PROPOSED / USER APPROVAL PENDING`

## 1. Purpose and stop condition

WP2 requested one integrated ADR-142 E2E-M acceptance chain through a real
production Conflict path. Implementation stopped before creating any
acceptance fixture when the existing composition was found to have no
production supplier for the required typed conflict signal.

The original Phase A audit correctly found that every frozen mapping was either
unavailable or required a new authority decision. The blocked WP2 branch
remains untouched; WP2 A/B/C/M/P acceptance implementation has not resumed.

The first ADR-151 correction selected a user-approved conflicting pair. GPT's
review rejected that design because it repackaged a conflict already
identified by a user and could not satisfy active Discovery's newly detected
causal requirement. The final correction therefore defines a reusable active
rule, an automatic server evaluator and a persisted derived assertion. It does
not authorize implementation.

## 2. Sources inspected

| Source                                                                               | Finding                                                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-136                                                                              | `CONFLICT_HYPOTHESIS` is derived and non-Canonical; typed contradiction basis must validate before Conflict review.                  |
| ADR-137                                                                              | Discovery consumes bounded typed signal Ports; semantic similarity and AI cannot establish Conflict.                                 |
| ADR-138                                                                              | Durable trigger/job behavior does not supply typed conflict authority.                                                               |
| ADR-139                                                                              | Conflict re-entry preserves both statements for review; it does not create the missing detector.                                     |
| ADR-142                                                                              | E2E-M requires a real conflict finding, derived review path and mandatory-visibility proof.                                          |
| ADR-149 / ADR-150                                                                    | Conflict semantics are deterministic and missing comparators remain fail-closed.                                                     |
| `modules/discovery-finding-fingerprint/src/hypothesis-neighborhood.ts`               | `DiscoveryCompetingResourcePortV1` and `DiscoveryExistingCanonicalConflictPortV1` exist; the selector requires compatible signals.   |
| `adapters/discovery-runtime-product/src/index.ts`                                    | The conflict dependencies are optional passthroughs; no concrete production reader exists.                                           |
| `assemblies/shotgun-app/src/application.ts`                                          | Normal composition passes neither conflict reader.                                                                                   |
| `packages/contracts/src/knowledge-model.ts`                                          | `ConflictCandidate` has generic candidate fields, subject IDs, summary, kind and Evidence, but no typed pair or semantic assertion.  |
| `modules/knowledge-model/src/index.ts`                                               | Stage 9 validates schema, SourceVersion, Evidence, references and Atomic Group review; approval is not conflict-semantic validation. |
| `adapters/postgres-stage9/src/index.ts`                                              | Approved Knowledge is read from `knowledge.review_groups`; there is no typed incompatibility assertion or rule store.                |
| `modules/knowledge-model/module-manifest.json`                                       | Stage 9 owns review data and has `canWriteCanonical: false`.                                                                         |
| `modules/compiled-truth/src/index.ts` and `packages/contracts/src/compiled-truth.ts` | Compiled Truth is a derived projection and does not preserve a typed incompatibility comparator.                                     |

No relevant OSS supplies the required authority without violating the
Canonical/Evidence/Approval boundary. Decision: `NO_RELEVANT_OSS`.

## 3. Frozen mapping audit

| Mapping                                           | Current source                                                                                                  | Verdict                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `FACTUAL` → `TYPED_PROPOSITION`                   | Approved relations retain endpoints, relation type and Evidence, but no accepted incompatibility rule exists.   | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `TEMPORAL` → `TEMPORAL_QUALIFICATION`             | Approved relation temporal values and Evidence exist, but no approved overlap/incompatibility authority exists. | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `IDENTITY` → `IDENTITY_ASSIGNMENT`                | Entity resolution has `NEW`, `EXACT_MATCH` and `POSSIBLY_SAME`, not a deterministic conflict pair.              | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |
| `MODEL_DISAGREEMENT` → `EXPLICIT_CONFLICT_SIGNAL` | `modelDisagreementView()` is a read view over model outputs, not a server-issued conflict signal.               | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |

`DiscoveryExistingCanonicalConflictPortV1` remains unavailable: Canonical
Claim stores free-form `claimText` and does not retain typed Conflict
participants; Frontend `ConflictProposalValueV1` is not retained as a typed
Canonical Conflict; Stage 9 cannot write Canonical. No participant
reconstruction is allowed.

## 4. ConflictCandidate adjudication

**Verdict: `NOT_VALID_AS_DISCOVERY_INCOMPATIBILITY_AUTHORITY`.**

The approved Knowledge `ConflictCandidate` is not a safe source for
`DiscoveryCompetingResourcePortV1` and is not a Canonical Conflict reader.

Evidence:

- The contract contains `subjectCandidateIds[]`, free-form `summary`,
  `conflictKind`, Evidence and optional model outputs, but no typed left/right
  proposition pair, typed values, server-issued signal ID or conflict-specific
  provenance assertion.
- The JSON Schema and `assertCandidates` validate shape, SourceVersion,
  Evidence binding, uniqueness and references. The generic Atomic Group
  `APPROVE` decision does not validate that the conflict meaning is proven.
- Repository search found no production ConflictCandidate producer. The
  contract/database instances are fixtures and cannot establish production
  authority.
- `APPROVED` is the Stage 9 review-ledger state, not Canonical registration and
  not an explicit typed incompatibility decision.
- Subject IDs are not sufficient to derive the exact Discovery participant
  pair; labels, aliases, summaries, model output and enum values cannot repair
  the missing semantics.

The current ConflictCandidate remains a governed review record. Its four enum
values do not imply support for the four frozen mappings.

## 5. Final proposed architecture

ADR-151 selects a governed, versioned Typed Proposition Conflict Rule
authority plus a deterministic server-side evaluator. The authority chain is:

```text
ACTIVE TypedPropositionConflictRuleV1
  + approved/current typed Relation revisions
  -> deterministic TypedPropositionConflictEvaluatorV1
  -> TypedIncompatibilityAssertionV1
  -> DiscoveryCompetingResourcePortV1
  -> CONFLICT_HYPOTHESIS
```

This replaces the previously considered pair-specific approval design. A user
approves a rule, never each detected pair. The server detects later matching
Relation pairs automatically.

### 5.1 Rule authority and durable source

- **Owner:** `stage9.knowledge-model` / Shotgun Knowledge Model, retaining
  `canWriteCanonical: false`.
- **Durable governed source:** `knowledge.typed_proposition_conflict_rules`.
- **Scope:** project-scoped by default; a future global rule requires a
  separately authorized global policy source and must still run inside an
  authorized Project context.
- **Governance command equivalent:** `APPROVE_TYPED_PROPOSITION_CONFLICT_RULE`.

The user or authorized Project owner may create, revise, retire or supersede a
rule. The decision approves a relation-type pair, participant-binding policy
and direction semantics. It never approves a resource pair.

### 5.2 Rule contract and exact semantics

The versioned rule is equivalent to:

```text
schemaVersion = typed-proposition-conflict-rule.v1
ruleId
ruleRevision
projectId
leftRelationType
rightRelationType
participantBinding = SAME_EXACT_ENDPOINT_PAIR
directionSemantics = DIRECTED_SAME_ORIENTATION | UNDIRECTED_CANONICAL_PAIR
kind = FACTUAL
source = TYPED_PROPOSITION
status = ACTIVE | RETIRED | SUPERSEDED
provenance / approvalAuthority
createdAt
```

The exact relation-type pair is the semantic content of the rule. A rule
means that two approved/current Relation propositions in the same Project,
with the exact relation-type pair and exact endpoints satisfying the rule's
direction semantics, are mutually incompatible for Discovery conflict
candidate purposes.

The rule does not mean that all different Relation types conflict. Same
endpoints plus different relation type do not conflict unless that exact type
pair is present in an `ACTIVE` rule. Relation type comparison is exact and
server-governed, not string similarity or free-text comparison.

Participant binding is deterministic:

- `DIRECTED_SAME_ORIENTATION`: both Relations are `DIRECTED`, and
  `left.fromCandidateId = right.fromCandidateId` and
  `left.toCandidateId = right.toCandidateId`.
- `UNDIRECTED_CANONICAL_PAIR`: both Relations are `UNDIRECTED`, and their
  endpoint IDs are canonicalized by UTF-16 ordinal ordering before comparison.
- A directed/undirected mixed pair does not match either binding and fails
  closed.
- Relation candidate IDs and revision numbers are retained as exact
  participant identity. Labels, entity names, aliases and semantic identity
  are never used.

The rule's relation-type pair is normalized deterministically for lookup; the
evaluator emits one logical assertion for a matching pair regardless of scan
order.

### 5.3 Automatic evaluator

The only V1 producer of incompatibility assertions is the deterministic
server-side `TypedPropositionConflictEvaluatorV1`. It reads:

- `ACTIVE` project-authorized `TypedPropositionConflictRuleV1` records; and
- approved/current `RelationCandidate` revisions through the existing
  Knowledge Model authority, including exact endpoint IDs, relation type,
  direction, revision, SourceVersion and Evidence lineage.

For each bounded Project evaluation, it emits an assertion only when exactly
one active rule matches the normalized exact Relation-type pair, both
participants are approved/current in the same Project, endpoint and direction
binding matches exactly, both candidate revisions resolve, required Evidence
is inspectable, restrictive security composition is safe, and the pinned
source/canonical/discovery bases are current and complete.

Otherwise no positive assertion is produced. The evaluator does not perform
pair-specific interactive review, relation-label comparison, free-text
comparison, embedding comparison, model judgment, ranking or feedback-based
truth selection.

Semantic retrieval may nominate a bounded pair for evaluation when allowed by
ADR-137, but retrieval can only nominate pairs. Only an active exact rule
match establishes incompatibility.

### 5.4 Assertion contract and identity

`TypedIncompatibilityAssertionV1` is durable, non-Canonical and rebuildable
derived governed data. It is not Truth, Fact, Claim, Canonical Conflict or a
Discovery finding. Its contract is equivalent to:

```text
schemaVersion = typed-incompatibility-assertion.v1
assertionId
assertionRevision
projectId
ruleId
ruleRevision
leftResourceRef
rightResourceRef
kind = FACTUAL
source = TYPED_PROPOSITION
evidenceIds[]
provenance
accessScope
sensitivity
sourceAuthorityId = stage9.typed-proposition-conflict-evaluator
sourceAuthorityRevision = 1.0.0
canonicalBase
sourceBase
status = ACTIVE | SUPERSEDED | RETIRED
createdAt
supersededAt?
retiredAt?
```

The resource references resolve to the exact Relation participant revisions
used by the evaluator. Provenance retains rule identity/revision, participant
candidate IDs/revisions, both Evidence lineages, effective security,
source/canonical bases and evaluator contract version. The evaluator never
manufactures Evidence.

Rules are the durable governed Source of Truth. Assertions are a persisted,
rebuildable projection of the active rule revision, normalized exact
participant revisions and pinned source/canonical/discovery base identity.
Logical assertion identity excludes summary text, AI wording, rank,
similarity, run ID and timestamps. A repeated scan at the same inputs resolves
to one identity; content mutation under that identity is rejected.

### 5.5 Mapping and causal requirement

V1 supports exactly:

```text
FACTUAL -> TYPED_PROPOSITION
```

The evaluator assertion maps to the existing
`DiscoveryCompetingResourcePortV1`. Discovery may then emit a new,
non-Canonical `CONFLICT_HYPOTHESIS`, followed by ADR-136/ADR-139 derived
validation and the existing Conflict comparison/review path.

The following remain `RESERVED / UNSUPPORTED` in V1:

- `TEMPORAL -> TEMPORAL_QUALIFICATION`: no temporal incompatibility
  comparator;
- `IDENTITY -> IDENTITY_ASSIGNMENT`: no deterministic assignment conflict
  authority;
- `MODEL_DISAGREEMENT -> EXPLICIT_CONFLICT_SIGNAL`: model variants are not
  conflict truth.

The active rule may pre-exist either participant, satisfying the newly detected
requirement:

1. A Project owner approves an active rule for exact Relation types A and B
   under `DIRECTED_SAME_ORIENTATION`; the owner does not name resources.
2. An approved/current type-A Relation exists for exact endpoint pair
   `(entity-1, entity-2)`.
3. Later, an approved/current type-B Relation is introduced for that same
   exact directed endpoint pair.
4. The server evaluator scans approved/current typed Relation revisions,
   matches the active rule, and creates a new deterministic assertion. No user
   identifies or approves that pair.
5. Discovery reads the assertion through the competing-resource Port and emits
   a new non-Canonical `CONFLICT_HYPOTHESIS`; derived validation and Review
   remain downstream.

This is not a user-pair assertion or a re-packaged `ConflictCandidate`.

## 6. Canonical, security, completeness and AI boundaries

`DiscoveryExistingCanonicalConflictPortV1` remains unavailable. Canonical
Claim and the current Frontend Draft → Canonical path do not retain a typed
Conflict kind and exact participant list. Rules, assertions and Discovery
findings remain separate from Canonical Conflict; a future typed Canonical
Conflict persistence decision is outside this remediation.

The rule and evaluator require Project authorization and Project equality. For
a multi-resource assertion, effective access is the restrictive intersection
authorized for both participants and the execution context. Effective
sensitivity is the highest/most restrictive participant classification and
policy. No safe common audience, cross-project or unauthorized pair yields an
assertion or disclosed existence.

The reader uses `COMPLETE | TRUNCATED`: `COMPLETE` requires the authorized
rule source, valid pinned bases and complete bounded evaluation; `TRUNCATED`
means a bound, budget or incomplete base prevented completeness and never
proves absence. Missing or invalid authority must not become
`COMPLETE + empty`; the optional Port remains degraded and no positive finding
is emitted. Missing rules, graph edges and empty retrieval results are not
affirmative evidence of no incompatibility.

AI may explain a server-selected assertion under existing policy, but may not
create, alter or retire rules, select incompatibility truth, override exact
identity/security/completeness/kind/source or approve a detected pair.

## 7. Persistence, lifecycle, migration and rollback

The selected architecture requires future durable storage for both:

```text
knowledge.typed_proposition_conflict_rules
knowledge.typed_incompatibility_assertions
```

Rules are append-only governed revisions with `ACTIVE`, `RETIRED` and
`SUPERSEDED` lifecycle. A new revision creates a new evaluation identity and
does not rewrite historical assertions/findings. Assertions are persisted
derived projections; historical assertions/findings that entered governance
remain retained. Re-evaluation occurs when rules, participants, Evidence,
bases or security change. Existing reconciliation owns `RESOLVED`, `STALE`
and `SUPERSEDED` Discovery lifecycle states.

Migration is **REQUIRED after user approval** and must separately define
backup/restore, project deletion, retention, append-only revisions, rebuild
behavior and rollback. This correction writes no migration, table or schema.

Rollback disables/removes evaluator and reader wiring, preserves all rule,
assertion, review, Evidence, Canonical and Discovery history, and returns
conflict Discovery to safe degraded behavior. Removing future storage requires
a separately governed migration. Replacement adapters remain behind the
existing Port and must pass the same rule, evaluator, identity, security,
completeness, provenance and replacement Contract tests.

## 8. OSS and implementation boundary

No relevant OSS was identified. The four verified references remain outside
this authority boundary: gbrain, lucas, ddsyasas and Inkeep OpenKnowledge do
not provide a safe, directly reusable typed incompatibility authority for this
Stage. Decision: `NO_RELEVANT_OSS`.

This correction is documentation/governance-only:

- Product/runtime implementation: **NONE**
- tests or fake adapters: **NONE**
- migration/table/schema: **NONE**
- dependency/lockfile: **NONE**
- comparator heuristic: **NONE**
- ADR-142 E2E-M: unchanged and unproven

ADR-151 remains `PROPOSED / USER APPROVAL PENDING`; no approval is recorded.
After user approval, GPT must issue a separate bounded implementation request
with the migration, exact contract/schema, repositories, normal
`startShotgunApplication` wiring, Contract/Golden Corpus/Security/Replacement
tests and rollout/rollback steps. Until then WP2 remains blocked, WP3,
deployment and AKP v1 completion do not start, and PR #156 remains OPEN /
DRAFT.

## 9. Required next gate

The correction branch may be reviewed for ADR-151 completeness only. It must
not mark the ADR accepted, make PR #156 ready, merge, implement WP2, weaken
E2E-M or begin WP3. User approval is the next authority gate.
