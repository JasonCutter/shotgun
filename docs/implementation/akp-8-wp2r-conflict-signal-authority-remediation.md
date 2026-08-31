# AKP-8 WP2R — Production Conflict Signal Authority Remediation

- Status: **BLOCKED_ARCHITECTURE_GAP**
- Current WP2 status: **BLOCKED_BEFORE_IMPLEMENTATION / MISSING_PRODUCT_CAPABILITY**
- Baseline: `main@0077ddc90efe4b3756cce66ad31bbc021c49395b`
- Remediation branch: `codex/akp-8-wp2r-conflict-signal-authority-remediation`
- Scope: Phase A authority audit and proposed ADR only
- Product/runtime changes: **NONE**
- Migration/table/runtime dependency/lockfile changes: **NONE**
- Acceptance tests: **NONE ADDED**
- ADR status: `ADR-151 PROPOSED / USER APPROVAL PENDING`

## 1. Purpose and stop condition

WP2 requested one integrated ADR-142 E2E-M acceptance chain through a real
production Conflict path. The implementation stopped before creating any
acceptance fixture when the existing composition was found to have no
production supplier for the required typed conflict signal.

GPT then issued WP2R as a separate bounded remediation. Its Phase A rule is
explicit: audit existing approved/project-authorized sources first; if every
frozen incompatibility mapping is unavailable or requires a new authority
decision, do not implement Product, do not fabricate a reader, and prepare
ADR-151 instead.

The audit reached that stop condition. The blocked WP2 branch remains
untouched, and WP2 A/B/C/M/P acceptance implementation has not resumed.

## 2. Authority and architecture sources inspected

| Source                                                                                                                    | Finding                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/adr/ADR-136-typed-discovery-finding-envelope-and-reentry-mapping-boundary.md`                          | `CONFLICT_HYPOTHESIS` is derived, non-Canonical, and maps to Conflict review only after typed contradiction basis validates.                                                  |
| `docs/architecture/adr/ADR-137-bounded-multi-signal-active-discovery-engine-boundary.md`                                  | Discovery consumes bounded typed signal Ports; semantic similarity and AI cannot establish Conflict.                                                                          |
| `docs/architecture/adr/ADR-138-durable-triggered-discovery-runtime-over-existing-outbox-and-job-foundations.md`           | Runtime/job durability does not supply typed conflict authority.                                                                                                              |
| `docs/architecture/adr/ADR-139-discovery-reentry-through-derived-provenance-validation-and-existing-review-authority.md`  | Conflict re-entry preserves both statements for review; it does not create the missing detector.                                                                              |
| `docs/architecture/adr/ADR-142-finite-end-to-end-acceptance-gate-and-akp-v1-closure-boundary.md`                          | E2E-M requires a real conflict finding, derived review path, and mandatory-visibility proof.                                                                                  |
| `docs/architecture/adr/ADR-149-discovery-semantic-essence-and-pre-persistence-fingerprint-identity-boundary.md`           | Conflict contradiction kind is deterministic WP2 authority and is not model-owned.                                                                                            |
| `docs/architecture/adr/ADR-150-akp-7-epistemic-comparator-authority-deferral-and-governed-unresolved-reentry-boundary.md` | Missing semantic comparators must remain fail-closed rather than inferred from weak signals.                                                                                  |
| `modules/discovery-finding-fingerprint/src/hypothesis-neighborhood.ts`                                                    | The existing `DiscoveryCompetingResourcePortV1` and `DiscoveryExistingCanonicalConflictPortV1` contracts are present; the Conflict selector requires both compatible signals. |
| `adapters/discovery-runtime-product/src/index.ts`                                                                         | The two typed dependencies are optional passthroughs; no concrete production reader is implemented here.                                                                      |
| `assemblies/shotgun-app/src/application.ts`                                                                               | Normal `startShotgunApplication` composition does not pass either typed conflict reader.                                                                                      |

No new OSS is relevant to this authority gap. The existing repository and
contract stack remains the only integration surface (`NO_RELEVANT_OSS`); a
conflict-detection library, vector package, LLM evaluator, or workflow runtime
would not be allowed to become incompatibility truth.

## 3. Frozen mapping audit

The required verdict vocabulary is used literally: `SAFE_EXISTING_AUTHORITY`,
`UNAVAILABLE_IN_CURRENT_PRODUCT`, or `REQUIRES_NEW_AUTHORITY_DECISION`.

| Mapping                                           | Candidate production source and lifecycle                                                                                                     | Project/access/sensitivity                                                                      | Evidence/provenance                                                                      | Deterministic participant identity                                                                                                       | Current/approved state                                            | Signal-contract assessment                                                                                                                             | Verdict                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `FACTUAL` → `TYPED_PROPOSITION`                   | `PostgresKnowledgeModelRepository.listApprovedItems(projectId)` returns approved `RelationCandidate` payloads from `knowledge.review_groups`. | Group-level `projectId`, `accessScope`, and `sensitivity` are retained.                         | Candidate `evidenceIds` and model-evidence binding are validated by the Knowledge Model. | Relation endpoints are candidate IDs, but no accepted incompatibility relation is defined for competing `relationType` values.           | Approved source data exists.                                      | Exposing a competition would require a new rule such as “same endpoints + different relation type = conflict”; that rule is not an existing authority. | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `TEMPORAL` → `TEMPORAL_QUALIFICATION`             | Approved `RelationCandidate.validFrom`, `validTo`, and `temporalEvidenceIds`; Compiled Truth derives only a projection temporal state.        | Group/project security is retained; projection security is flattened to item scope/sensitivity. | Temporal evidence IDs are required to be attached to the candidate.                      | Relation endpoint IDs are available, but no authority defines temporal incompatibility or overlap semantics.                             | Approved source data exists.                                      | Date comparison or `CURRENT`/`CONFLICT` projection interpretation would create a new comparator.                                                       | `REQUIRES_NEW_AUTHORITY_DECISION` |
| `IDENTITY` → `IDENTITY_ASSIGNMENT`                | Approved `EntityCandidate.resolution` exposes `NEW`, `EXACT_MATCH`, or `POSSIBLY_SAME`.                                                       | Group/project security is retained.                                                             | Entity evidence IDs are retained and validated.                                          | No production identity authority exposes conflicting assignments as exact participant pairs; `POSSIBLY_SAME` is not a conflict decision. | Candidate data may be approved, but no conflict authority exists. | Different names, aliases, or resolution statuses cannot be promoted to identity incompatibility.                                                       | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |
| `MODEL_DISAGREEMENT` → `EXPLICIT_CONFLICT_SIGNAL` | `ModelAssessment` is retained inside approved candidates; `modelDisagreementView()` is a read-side variant summary.                           | Candidate group security is retained.                                                           | Each model output cites candidate evidence.                                              | Candidate IDs exist, but no explicit server-issued incompatibility signal is persisted.                                                  | Approved model outputs exist.                                     | Multiple provider/model strings or differing wording are explicitly forbidden as the source of Conflict.                                               | `UNAVAILABLE_IN_CURRENT_PRODUCT`  |

### Existing Canonical Conflict reader

`DiscoveryExistingCanonicalConflictPortV1` cannot be safely wired from current
production data:

- `CanonicalClaim` contains `claimText`, source/evidence identity and security,
  but no typed Conflict kind or participant list.
- `PostgresCanonicalKnowledgeRepository.commitFrontendDraft()` writes the
  Frontend approval into a `CanonicalClaim`; typed `ConflictProposalValueV1`
  is not retained as a Canonical Conflict record.
- `ConflictCandidate` is an approved Knowledge Review candidate, not a
  Canonical Conflict. The Knowledge Model manifest sets `canWriteCanonical:
false`.
- Reconstructing participants from a label, claim text, or projected conflict
  label would violate the frozen boundary.

Verdict: `UNAVAILABLE_IN_CURRENT_PRODUCT`. The reader remains unwired and no
duplicate guard test is fabricated.

## 4. Why the existing unit fixtures do not close the gap

`tests/unit/akp-3-wp2-hypothesis-neighborhood.test.ts` and
`tests/unit/akp-4-wp4-discovery-product.test.ts` inject
`competingResource`, `existingCanonicalConflict`, or explicit conflict
signals. Those fixtures validate the already-existing Port, selector, and
downstream safety contracts. They do not establish a production authority and
cannot be reused as WP2R production evidence.

The normal selector intentionally returns no Conflict candidate when either
required compatible signal is absent. This is the correct degraded behavior;
turning a missing source into `COMPLETE + empty` or a positive heuristic would
be unsafe.

## 5. Proposed architecture decision

The audit created
`docs/architecture/adr/ADR-151-discovery-production-conflict-signal-authority.md`
with status `PROPOSED / USER APPROVAL PENDING`.

ADR-151 requests an explicit owner and persisted/typed source for any future
incompatibility truth, including participant identity, Evidence/provenance,
project/security composition, completeness/fail-closed behavior,
versioning/migration, replacement, rollback, and future re-evaluation. It
explicitly rejects label comparison, string inequality, semantic similarity,
date overlap without an approved rule, model output, ranking, feedback, graph
absence, and Compiled Truth label parsing.

No Product/runtime implementation, schema, migration, lockfile, dependency,
test-only adapter, fake signal, or weakened E2E-M was added.

## 6. Resume and rollback conditions

WP2R may leave the audit-only state only after the user approves ADR-151 and
GPT issues a new bounded implementation request that names the approved
authority source and persistence decision. The next implementation must use
the normal `startShotgunApplication` composition and existing Port; it may
implement only mappings supported by the approved source.

Until then:

- AKP-8 WP2 remains `BLOCKED_BEFORE_IMPLEMENTATION`.
- E2E-M remains unproven and is not downgraded or removed.
- ADR-142 is not amended.
- WP2 acceptance tests do not begin.
- WP3, deployment, and AKP v1 completion do not begin or get declared.

No rollback action is required for this audit branch because production code
and data are unchanged. A future implementation must disable only the new
reader boundary on rollback, preserve Canonical/finding history, and keep
unsupported mappings fail-closed.

## 7. Verification and non-change record

Because this WP2R path ended at Phase A with an ADR-151 proposal, only the
documentation/governance checks appropriate to the changed files are required.
No PostgreSQL test was added or run; there is no local database status to
report for this audit-only path.

Expected changed files are documentation-only:

- `docs/architecture/adr/ADR-151-discovery-production-conflict-signal-authority.md`
- `docs/implementation/akp-8-wp2r-conflict-signal-authority-remediation.md`
- ADR registry/README registration for the proposed identifier

The final PR must remain OPEN / DRAFT. Ready, merge, deploy, WP2 resume, WP3,
and `AKP v1 COMPLETE` are not authorized by this record.
