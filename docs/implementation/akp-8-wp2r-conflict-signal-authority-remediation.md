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

## 1. Purpose and initial stop condition

WP2 requested one integrated ADR-142 E2E-M acceptance chain through a real
production Conflict path. The implementation stopped before creating any
acceptance fixture when the existing composition was found to have no
production supplier for the required typed conflict signal.

The original Phase A audit correctly found that every frozen mapping was either
unavailable or required a new authority decision. The blocked WP2 branch
remains untouched; WP2 A/B/C/M/P acceptance implementation has not resumed.

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
| `packages/contracts/src/knowledge-model.ts`                                          | `ConflictCandidate` has generic candidate fields, subject IDs, summary, kind and Evidence, but no typed pair/semantic assertion.     |
| `modules/knowledge-model/src/index.ts`                                               | Stage 9 validates schema, SourceVersion, Evidence, references and Atomic Group review; approval is not conflict-semantic validation. |
| `adapters/postgres-stage9/src/index.ts`                                              | Approved Knowledge is read from `knowledge.review_groups`; there is no typed incompatibility assertion store.                        |
| `modules/knowledge-model/module-manifest.json`                                       | Stage 9 owns review data and has `canWriteCanonical: false`.                                                                         |
| `modules/compiled-truth/src/index.ts` and `packages/contracts/src/compiled-truth.ts` | Compiled Truth is a derived projection and does not preserve a typed incompatibility comparator.                                     |

No relevant OSS supplies the required authority without violating the
Canonical/Evidence/Approval boundary. Decision: `NO_RELEVANT_OSS`.

## 3. Initial frozen mapping audit (preserved)

| Mapping                                           | Current source                                                                                                  | Initial verdict                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `FACTUAL` → `TYPED_PROPOSITION`                   | Approved relations retain endpoints, relation type and Evidence, but no accepted incompatibility rule exists.   | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `TEMPORAL` → `TEMPORAL_QUALIFICATION`             | Approved relation temporal values and Evidence exist, but no approved overlap/incompatibility authority exists. | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `IDENTITY` → `IDENTITY_ASSIGNMENT`                | Entity resolution has `NEW`, `EXACT_MATCH` and `POSSIBLY_SAME`, not a deterministic conflict pair.              | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |
| `MODEL_DISAGREEMENT` → `EXPLICIT_CONFLICT_SIGNAL` | `modelDisagreementView()` is a read view over model outputs, not a server-issued conflict signal.               | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |

`DiscoveryExistingCanonicalConflictPortV1` remains unavailable: Canonical Claim
stores free-form `claimText` and does not retain typed Conflict participants;
Frontend `ConflictProposalValueV1` is not retained as a typed Canonical Conflict;
Stage 9 cannot write Canonical. No participant reconstruction is allowed.

## 4. ConflictCandidate adjudication correction

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

## 5. Selected proposed architecture

ADR-151 now selects **Option B: a new governed typed incompatibility assertion
authority** rather than leaving the source choice to a later implementation.

- **Authority owner:** `stage9.knowledge-model` / Shotgun Knowledge Model,
  retaining `canWriteCanonical: false`.
- **Durable source:** `knowledge.typed_incompatibility_assertions`.
- **Producer:** a server-side `TypedIncompatibilityReviewAuthority` fed only by
  a dedicated user-bound `APPROVE_TYPED_INCOMPATIBILITY_ASSERTION` decision.
- **Consumer boundary:** a versioned `TypedIncompatibilityAssertionReaderPort`
  maps active records to the existing `DiscoveryCompetingResourcePortV1`;
  Discovery never reads the table directly.
- **Classification:** durable, non-Canonical, project-scoped governed data;
  not a Compiled Truth item, Canonical Claim, Discovery finding or semantic
  cache.

The producer writes only when a user with the required review scope explicitly
governs two distinct exact approved/current Relation participant revisions as
an incompatible factual proposition pair. The server verifies project
equality, exact typed resource identity, one pinned source snapshot, attached
Evidence, freshness, audit/provenance and security composition. The producer
does not compare relation labels/types, text, embeddings or model output.

The proposed `TypedIncompatibilityAssertionV1` contains the equivalent of:

```text
schemaVersion, assertionId, assertionRevision, projectId
leftResourceRef, rightResourceRef
kind = FACTUAL, source = TYPED_PROPOSITION
evidenceIds, provenance
accessScope, sensitivity
sourceAuthorityId = stage9.typed-incompatibility-review
sourceAuthorityRevision = 1.0.0
canonicalBase, sourceBase
status = ACTIVE | SUPERSEDED | RETIRED
createdAt, supersededAt?, retiredAt?
```

The signal ID is server-owned (`assertionId` plus revision), and provenance
retains the explicit review decision, participant revisions, Evidence lineage,
authority version and bases. It is not generated from wording, ranking or
similarity.

## 6. Mapping, security and completeness decision

V1 supports exactly:

```text
FACTUAL -> TYPED_PROPOSITION
```

The first Discovery run may emit a new non-Canonical `CONFLICT_HYPOTHESIS`
from an active assertion, after which ADR-136/139 derived validation and the
existing Conflict comparison/review path still apply. This is a separate
governed input, not recycling an existing Canonical Conflict and not a direct
Canonical write.

These remain `RESERVED / UNSUPPORTED`:

- `TEMPORAL -> TEMPORAL_QUALIFICATION` — no date-overlap comparator;
- `IDENTITY -> IDENTITY_ASSIGNMENT` — no deterministic assignment conflict
  authority;
- `MODEL_DISAGREEMENT -> EXPLICIT_CONFLICT_SIGNAL` — model variants are not
  conflict truth.

The producer and reader require same-project participants. Effective access is
the restrictive common/intersection audience; effective sensitivity is the
highest/most restrictive participant classification and policy. No safe common
audience, cross-project pair or unauthorized participant yields an assertion or
disclosed existence. Evidence/provenance references remain inspectable through
their existing authorities without leaking hidden content.

The reader uses the existing `COMPLETE | TRUNCATED` vocabulary. `COMPLETE`
requires an available authority, valid pinned bases and a complete bounded
read. `TRUNCATED` means a bound, budget or incomplete base prevented a complete
read and never proves absence of conflict. Unavailable authority, unsupported
contract or invalid base must not become `COMPLETE + empty`; the optional Port
remains degraded and no positive conflict candidate is emitted.

## 7. Persistence, history and rollback

The selected design requires a new durable non-Canonical assertion table or
equivalent append-only store. Its immutable assertion revision plus explicit
review decision are the governed source of truth; the Discovery reader is
rebuildable. Retention, backup/restore, project deletion and audit policy apply.

The implementation must add a separately reviewed versioned migration, but this
correction adds no migration, table or schema. Existing assertion identities
must reject content mutation; supersession and retirement append history.
Participant retirement/supersession, Evidence or base changes and later
Canonical updates trigger re-evaluation without rewriting old assertions or
findings. Existing reconciliation owns `RESOLVED`, `STALE` and `SUPERSEDED`.

Rollback disables/removes the reader from normal assembly, leaves assertion
records dormant/read-only, preserves all review/Evidence/Canonical/Discovery
history, and returns unsupported/unavailable reads to safe degraded behavior.
Deleting storage requires a separate governed migration.

## 8. Why ADR-151 v1 was not decision-complete

The first proposal correctly stated that a typed authority was required, but it
left the owner, exact persisted source, producer, supported mapping and
persistence decision for a later implementation request. It therefore did not
give the user a concrete architecture to approve. This correction records the
Option B owner/producer/source and the single supported mapping while preserving
the original Phase A gap findings.

## 9. Non-change record and approval gate

This correction is documentation/governance-only:

- Product/runtime implementation: **NONE**
- tests or fake adapters: **NONE**
- migration/table/schema: **NONE**
- dependency/lockfile: **NONE**
- comparator heuristic: **NONE**
- ADR-142 E2E-M: unchanged and unproven

ADR-151 remains `PROPOSED / USER APPROVAL PENDING`; no approval is recorded.
After user approval, GPT must issue a separate bounded implementation request
with the migration, exact contract/schema, normal assembly wiring, Contract/
Golden Corpus/Security/Replacement tests and rollout/rollback steps. Until
then WP2 remains blocked, WP3/deployment/AKP v1 completion do not start, and
PR #156 must remain OPEN / DRAFT.
