# ADR-151 — Discovery Production Conflict Signal Authority

- Status: **ACCEPTED**
- Proposed at: 2026-09-01
- Decision date: **2026-09-01**
- Accepted at: **2026-09-01**
- Accepted by: **USER**
- Decision owner: `USER`
- Work item: `AKP-8 WP2R — Production Conflict Signal Remediation`
- Subject base: `main@0077ddc90efe4b3756cce66ad31bbc021c49395b`
- Related ADRs: ADR-136, ADR-137, ADR-138, ADR-139, ADR-142, ADR-149, ADR-150
- Product implementation: **AUTHORIZED FOR THE BOUNDED AKP-8 WP2R REMEDIATION DEFINED BY THIS ADR**

## Context

AKP-8 WP2 stopped before implementing acceptance tests because the frozen
ADR-142 E2E-M journey requires a real production `CONFLICT_HYPOTHESIS` path,
while the canonical composition exposes no production authority that supplies
the typed incompatibility signal consumed by the existing Discovery selector.

The existing ports and downstream safety gates are present, but the current
production assembly leaves `competingResource` and
`existingCanonicalConflict` optional. The WP2R Phase A audit found no safe
existing source that can be exposed through those ports without a new governed
incompatibility authority. The first ADR-151 proposal was then corrected once:
it selected a user-approved conflicting pair, which would merely repackage a
conflict already identified by the user and would not satisfy the active
Discovery meaning in ADR-136/ADR-137/ADR-142.

This proposal makes the rule, evaluator and assertion layers explicit. A user
approves a rule, never each detected pair. The server detects later matching
Relation pairs automatically. This ADR does not amend ADR-142, weaken E2E-M,
or authorize Product implementation before user approval and a subsequent
bounded implementation request.

## Phase A audit conclusion

### Frozen mapping audit

| Frozen mapping                                    | Current source inspected                                                                                          | Current conclusion                                                                                                                         | Verdict                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `FACTUAL` → `TYPED_PROPOSITION`                   | Approved `RelationCandidate` payloads returned by `PostgresKnowledgeModelRepository.listApprovedItems(projectId)` | Endpoints, relation type and Evidence are retained, but no accepted production authority defines an incompatible exact Relation-type pair. | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `TEMPORAL` → `TEMPORAL_QUALIFICATION`             | Approved relation `validFrom`/`validTo`/`temporalEvidenceIds` and Compiled Truth temporal state                   | Values and Evidence exist, but no accepted authority defines temporal incompatibility or overlap.                                          | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `IDENTITY` → `IDENTITY_ASSIGNMENT`                | `EntityCandidate.resolution`                                                                                      | `NEW`, `EXACT_MATCH` and `POSSIBLY_SAME` do not expose a deterministic conflicting assignment pair or identity-conflict reader.            | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |
| `MODEL_DISAGREEMENT` → `EXPLICIT_CONFLICT_SIGNAL` | `ModelAssessment` and `modelDisagreementView()`                                                                   | The view summarizes model output variants; it is not a server-issued incompatibility authority.                                            | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |

### Approved `ConflictCandidate` adjudication

**Verdict: `NOT_VALID_AS_DISCOVERY_INCOMPATIBILITY_AUTHORITY`.**

The current approved Knowledge `ConflictCandidate` is not a rule, is not an
assertion, is not selected as a `DiscoveryCompetingResourcePortV1` authority
and cannot be used for `DiscoveryExistingCanonicalConflictPortV1`.

The evidence is structural and semantic:

1. `ConflictCandidate` contains `candidateId`, `subjectCandidateIds[]`,
   free-form `summary`, `conflictKind`, candidate Evidence and optional model
   outputs. It does not contain a typed left/right proposition pair, typed
   values, a server-issued incompatibility signal ID, or a conflict-specific
   provenance assertion.
2. The `knowledge-candidate.v1` schema and Stage 9 `assertCandidates` validate
   shape, SourceVersion, Evidence binding, uniqueness and references.
   `ReviewKnowledgeGroup` records a user decision for the whole Atomic Group;
   it does not validate conflict semantics.
3. Repository search found no production ConflictCandidate producer. The
   contract/database instances are fixtures, not a server-authoritative
   comparison result.
4. `APPROVED` is a Knowledge Review ledger state, not Canonical Conflict
   registration and not approval of a reusable incompatibility rule.
5. `subjectCandidateIds[]`, summary, labels, aliases, model output and enum
   membership cannot establish the exact participant pair or typed semantics.

The four `conflictKind` enum values therefore do not imply support for the four
frozen mappings. An approved ConflictCandidate remains a governed review record
and may be reconsidered only by a separately approved contract refinement.

## Decision

Subject to user approval, Shotgun v1 **will use a governed, versioned Typed
Proposition Conflict Rule authority plus a deterministic server-side evaluator**.
The authority chain is:

```text
ACTIVE TypedPropositionConflictRuleV1
  + approved/current typed Relation revisions
  -> deterministic TypedPropositionConflictEvaluatorV1
  -> TypedIncompatibilityAssertionV1
  -> DiscoveryCompetingResourcePortV1
  -> CONFLICT_HYPOTHESIS
```

The rule is approved independently of any resource pair. The server evaluates
approved/current Relation resources automatically; no user identifies or
approves each detected pair.

### 1. Rule authority owner and durable source

The rule authority owner will be `stage9.knowledge-model` / Shotgun Knowledge
Model. It retains `canWriteCanonical: false` and owns the durable governed rule
source:

```text
knowledge.typed_proposition_conflict_rules
```

The rule store is a Source of Truth for the explicitly approved incompatibility
policy. It is project-scoped by default. A future global rule is permitted only
if an independently authorized global policy source exists; it must still be
evaluated inside an authorized Project context. This ADR does not assume a
global rule.

### 2. Rule contract and exact semantics

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

The exact relation-type pair is the semantic content of the rule. A rule means:

> For two approved/current Relation propositions in the same Project whose
> exact relation-type pair matches this rule and whose exact endpoints satisfy
> this rule's direction semantics, the pair is mutually incompatible for
> Discovery conflict-candidate purposes.

The rule does not mean that all different Relation types conflict. It does not
mean that same endpoints plus different types conflict unless that exact type
pair is present in an `ACTIVE` rule. Relation type comparison is exact and
server-governed, not string similarity or free-text comparison.

Participant binding is deterministic:

- `DIRECTED_SAME_ORIENTATION`: both Relations are `DIRECTED`, and
  `left.fromCandidateId = right.fromCandidateId` and
  `left.toCandidateId = right.toCandidateId`.
- `UNDIRECTED_CANONICAL_PAIR`: both Relations are `UNDIRECTED`, and the two
  endpoint IDs are canonicalized by UTF-16 ordinal ordering before comparison.
- A directed/undirected mixed pair does not match either binding and fails
  closed.
- The two Relation candidate IDs and revision numbers are retained as exact
  participant identity. Labels, entity names, aliases and semantic identity
  are never used.

The rule's relation-type pair is normalized deterministically for rule lookup;
the evaluator emits one logical assertion for a matching pair, regardless of
scan order.

### 3. Rule governance lifecycle

A user or authorized Project owner may create, revise, retire or supersede a
rule through a dedicated governed decision equivalent to
`APPROVE_TYPED_PROPOSITION_CONFLICT_RULE`. That decision approves:

```text
relationType A + relationType B
+ participant-binding policy
+ direction semantics
```

It does **not** approve:

```text
resource revision A + resource revision B
```

Rule revisions are append-only. A retired or superseded rule cannot produce new
assertions. A new rule revision creates a new evaluation identity and never
silently rewrites historical assertions or Discovery findings.

### 4. Automatic evaluator and producer

The only V1 producer of incompatibility assertions will be the deterministic
server-side `TypedPropositionConflictEvaluatorV1`. It reads:

- `ACTIVE` project-authorized `TypedPropositionConflictRuleV1` records; and
- approved/current `RelationCandidate` revisions through the existing
  Knowledge Model authority, including their exact endpoint IDs, relation type,
  direction, revision, SourceVersion and Evidence lineage.

For each bounded Project evaluation, it emits a
`TypedIncompatibilityAssertionV1` only when all of the following are true:

- exactly one active rule matches the normalized exact Relation-type pair;
- both Relation participants are approved/current and belong to the same
  Project;
- the rule's endpoint and direction binding matches exactly;
- the server resolves both exact candidate IDs and revisions;
- required Evidence is present and inspectable for both participants;
- restrictive security composition is safe;
- the pinned source/canonical/discovery bases are current and the bounded
  evaluation is complete.

Otherwise no positive assertion is produced. The evaluator does not perform
pair-specific interactive review, relation-label comparison, free-text
comparison, embedding comparison, model judgment, ranking or feedback-based
truth selection.

Semantic retrieval may reduce a bounded candidate neighborhood when allowed by
ADR-137, but retrieval can only nominate pairs for rule evaluation. Only an
active exact rule match establishes incompatibility.

### 5. `TypedIncompatibilityAssertionV1`

The assertion is durable, non-Canonical and a rebuildable persisted governed
signal. It is not Truth, Fact, Claim, Canonical Conflict or a Discovery finding.
Its contract is equivalent to:

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

`leftResourceRef` and `rightResourceRef` resolve to the exact Relation
participant revisions used by the evaluator. The assertion provenance retains
rule identity/revision, participant candidate IDs/revisions, both Evidence
lineages, effective security, source/canonical bases and evaluator contract
version. The evaluator never manufactures Evidence.

### 6. Stable assertion identity and persistence classification

Rules are the durable governed Source of Truth. Assertions are a persisted,
rebuildable derived projection of:

```text
active rule revision
+ normalized exact participant revisions
+ pinned source/canonical/discovery base identity
```

The logical assertion identity is deterministic from those immutable typed
inputs. It excludes summary text, AI wording, rank, similarity, run ID and
timestamps. A repeated scan at the same rule revision and bases resolves to the
same assertion identity; content changes under that identity are rejected.

The rule store and assertion store participate in normal backup/restore,
project-deletion, retention and audit policy. Historical assertions/findings
that entered governance remain retained. Rebuilding the active projection may
recompute current status from active rules and approved/current Relations, but
must not erase the historical assertion/review lineage.

### 7. V1 mapping

V1 supports exactly:

```text
FACTUAL -> TYPED_PROPOSITION
```

The evaluator-produced assertion is mapped to the existing
`DiscoveryCompetingResourcePortV1`. Discovery can then emit a new,
non-Canonical `CONFLICT_HYPOTHESIS`, which continues through ADR-136/ADR-139
derived validation and the existing Conflict comparison/review path.

The following remain `RESERVED / UNSUPPORTED` in V1:

- `TEMPORAL -> TEMPORAL_QUALIFICATION`: no date-overlap or temporal
  incompatibility comparator;
- `IDENTITY -> IDENTITY_ASSIGNMENT`: no deterministic identity-assignment
  conflict authority;
- `MODEL_DISAGREEMENT -> EXPLICIT_CONFLICT_SIGNAL`: model variants are not
  conflict truth.

### 8. Newly detected causal example

This architecture satisfies the active Discovery requirement because the rule
pre-exists the conflicting pair:

1. A Project owner approves an active rule for exact Relation types A and B
   under `DIRECTED_SAME_ORIENTATION`; the owner does not name resources.
2. An approved/current Relation of type A exists for exact endpoint pair
   `(entity-1, entity-2)`.
3. Later, an approved/current Relation of type B is introduced for the same
   exact directed endpoint pair.
4. The server evaluator scans the approved/current typed Relation revisions,
   matches the active rule and creates a new deterministic assertion. No user
   identifies or approves that pair.
5. Discovery reads the assertion through the competing-resource Port and emits
   a new non-Canonical `CONFLICT_HYPOTHESIS`; derived validation and Review
   remain downstream.

This is not a user-pair assertion or a re-packaged `ConflictCandidate`. A rule
may be active before either participant exists, so the conflict pair is newly
detected by the server from current typed knowledge.

### 9. Existing Canonical Conflict decision

`DiscoveryExistingCanonicalConflictPortV1` remains
`UNAVAILABLE_IN_CURRENT_PRODUCT`. `CanonicalClaim` and the current Frontend
Draft → Canonical path do not retain a typed Conflict kind and exact participant
list. `ConflictProposalValueV1` and an approved Knowledge `ConflictCandidate`
cannot be reconstructed into that reader. Typed incompatibility rules,
assertions and Discovery findings remain separate from Canonical Conflict; a
future typed Canonical Conflict persistence decision is outside this ADR.

### 10. Security and disclosure

The rule and evaluator require Project authorization and Project equality. For a
multi-resource assertion, effective access scope is the restrictive
intersection/common audience authorized for both participants and the execution
context. Effective sensitivity is the highest/most restrictive participant
classification and applicable policy. If there is no safe common audience, the
rule is not applied to the pair and no assertion/signal is exposed. Cross-project
and unauthorized participants fail closed without disclosing resource
existence.

Evidence and provenance references remain inspectable through their existing
authorities without leaking hidden participant content. Discovery receives
bounded typed references and signal metadata only; it cannot manufacture
Evidence, Facts, Claims or Canonical state.

### 11. Completeness and fail-closed behavior

The evaluator and reader use the existing Discovery completeness vocabulary
`COMPLETE | TRUNCATED`:

- `COMPLETE` means the authorized rule source was available, the pinned bases
  were valid, all bounded eligible current Relations were evaluated and no
  budget/security truncation occurred.
- `TRUNCATED` means a bound, budget or incomplete base prevented a complete
  bounded evaluation. It is not proof that no conflict exists.
- Missing/invalid rule authority, unsupported rule contract or unavailable
  source must not become `COMPLETE + empty`. The optional Port remains absent
  or degraded and no positive Conflict candidate is emitted.
- Unsupported mappings remain unavailable. Missing rules, missing Relations,
  missing graph edges and empty retrieval results are not affirmative evidence
  of no incompatibility.

### 12. AI boundary

AI may later explain a server-selected assertion or candidate under existing
provider/egress policy. AI may not create, alter or retire rules; select
incompatibility truth; override exact participant identity, security,
completeness, kind or source; or approve a detected pair.

### 13. History, re-evaluation, rollback and replacement

When a rule is retired/superseded, a participant is retired/superseded or no
longer current, Evidence/base becomes invalid, or Project/security no longer
permits the pair, the evaluator marks the current assertion inactive through a
new governed revision/status record. It does not rewrite historical assertions
or findings. Existing reconciliation remains responsible for `RESOLVED`,
`STALE` and `SUPERSEDED` Discovery lifecycle states.

Rollback disables/removes the evaluator and reader from normal assembly, leaves
rule/assertion/review history preserved, and returns conflict Discovery to safe
degraded behavior. Canonical is not mutated and no deletion is required for
operational rollback. Removing the future rule/assertion schema requires a
separately governed migration.

Replacement adapters must remain behind the existing Port and pass the same
rule, evaluator, identity, security, completeness, provenance and replacement
Contract tests.

### 14. Migration decision

The selected architecture requires future durable storage for both the governed
rule source and the persisted assertion projection:

```text
knowledge.typed_proposition_conflict_rules
knowledge.typed_incompatibility_assertions
```

Migration is **REQUIRED after user approval** and must be separately reviewed,
versioned and reversible. This WP2R correction writes **no migration, table or
schema**. The future migration must define backup/restore, project deletion,
retention, append-only revisions, rebuild behavior and rollback explicitly.

## Explicitly rejected

- User approval of every conflicting Relation pair as the primary E2E-M
  detection authority.
- Using an approved `ConflictCandidate` as a rule or assertion.
- Treating `ConflictCandidate.conflictKind` enum membership as proof of any
  typed incompatibility mapping.
- All-different-type conflict, same-endpoint conflict without an active exact
  rule, semantic similarity, embedding distance, labels, aliases, free-text
  inequality, date overlap, ranking, feedback, graph absence or model output
  as conflict truth.
- Parsing `CompiledTruthItem.label` or `CanonicalClaim.claimText` to recover
  participants or typed values.
- Promoting a rule, assertion or Discovery finding into Canonical truth.
- Wiring `DiscoveryExistingCanonicalConflictPortV1` from the current lossy
  Canonical Claim projection.
- Weakening or removing ADR-142 E2E-M.

## Approval gate and implementation boundary

This ADR remains **PROPOSED / USER APPROVAL PENDING**. It must not be marked
accepted by the WP2R correction branch, and no user approval may be recorded in
the repository.

After user approval, GPT must issue a separate bounded implementation request
that names the exact contract/schema, rule and assertion repositories,
versioned migration, normal `startShotgunApplication` wiring,
Contract/Golden Corpus/Security/Replacement tests and rollout/rollback steps.
Until that request exists:

- Product/runtime/test/schema implementation is **NOT AUTHORIZED**;
- no migration/table/dependency/lockfile is written;
- WP2 remains `BLOCKED_BEFORE_IMPLEMENTATION`;
- E2E-M remains unproven and is not weakened or removed;
- WP3, deployment and AKP v1 completion must not start or be declared.
