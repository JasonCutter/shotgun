# AKP v1 — Section Detailed Architecture Candidate

- Status: **CANDIDATE / WHOLE-DESIGN REVIEW REQUIRED**
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Master Program structure: **USER-CONFIRMED**
- Detailed Section decisions: **NOT YET ACCEPTED**
- Product implementation: **NOT_AUTHORIZED**
- Proposed ADRs: ADR-134 through ADR-142

This is the normalized second-pass detailed design after the whole-design gap review. Git history preserves the initial candidate. The canonical Phase ADD remains unchanged until explicit user approval.

---

# AKP-0 — Program Baseline & Completion Contract

## Purpose

Freeze the exact-main baseline, finite Program Acceptance Criteria, non-scope, dependencies, cross-Section gaps, ADR ownership and completion gate before Product implementation.

## Inputs

- Knowledge Flow Steps 16, 17, 18/20 and 22;
- Phase 5/6 ADD;
- `main@f08ae632220ac613ae0e90c04930ceb323aac40b`;
- Stage 6/7/10 evidence;
- existing Graph, Review, Activity, quality-evaluation, external Action and ADR-133 AI-provider architecture;
- PR #30 deferred architecture record.

## Outputs

1. capability matrix;
2. cross-Section gap register;
3. AKP-PAC-01..30 candidate completion contract;
4. non-scope;
5. dependency map;
6. ADR-134..142 candidate inventory;
7. whole-design approval gate.

## Acceptance Criteria

- **AKP0-AC-01** exact canonical main SHA recorded.
- **AKP0-AC-02** every active-knowledge capability classified COMPLETE/PARTIAL/MISSING/DEFERRED with repository evidence.
- **AKP0-AC-03** Outbox/Review/Graph/Activity/provider authority reuse explicitly identified.
- **AKP0-AC-04** finite PAC/non-scope frozen only after user whole-design approval.
- **AKP0-AC-05** every identified gap has one owning Section and cross-Section dependencies are recorded.
- **AKP0-AC-06** ADR ownership is unique; all AKP ADRs remain PROPOSED before approval.
- **AKP0-AC-07** ADD/Product/migration/dependency/Ready/Merge remain unauthorized before approval.
- **AKP0-AC-08** scope expansion requires Master Scope Amendment.

## Work Package

AKP-0 is docs/architecture only: audit -> whole-design review -> accepted baseline/PAC/non-scope -> architecture governance record.

---

# AKP-1 — Hybrid Semantic Retrieval

## Goal

Complete Step 16 semantic retrieval as a rebuildable approved-knowledge projection while preserving Stage 7 lexical retrieval and citation authority.

## Architecture

```text
Compiled Truth / approved knowledge
 -> SemanticRepresentationBuilder(versioned)
 -> SemanticEmbeddingResolver
 -> SemanticIndexRepositoryPort
 -> pgvector adapter candidate
 -> SemanticRetriever

LexicalRetriever + SemanticRetriever
 -> HybridRetrievalCoordinator
 -> Citation resolver
```

## Contracts

### `SemanticEmbeddingProfileV1`

```text
profileId/projectId/profileRevision
providerCapabilityRef/modelRef
representationVersion
distanceMetric/normalizationPolicy
status = BUILDING | ACTIVE | RETIRED | FAILED
createdAt/activatedAt?
```

Profile is independent of Ask model. External model/credential/privacy resolution uses ADR-133 and pins effective execution revisions. No secret is stored.

### `SemanticIndexItemV1`

```text
semanticItemId/projectId
resourceRef/resourceType
sourceProjectionDigest/canonicalVersion
semanticTextDigest
embeddingProfileId/revision
evidenceIds[]
accessScope[]/sensitivity
indexedAt
```

### `HybridSearchResultV1`

Preserves normal resource/citation identity plus retrieval signals, lexical/semantic/hybrid ranks, semantic profile revision and projection freshness. It has no similarity-derived truth confidence.

## Corpus and representation

Default corpus: eligible approved/current Claim/Fact/Entity/Relation/Event/Decision representations. Exclude unapproved/rejected Candidates, raw web content, arbitrary Raw Source bulk chunks and non-Canonical Discovery findings.

Each type uses a deterministic semantic representation template. Template/version change changes digest and rebuild eligibility.

## Retrieval and ranking

1. server-authorized corpus selection;
2. bounded lexical Top-K;
3. bounded semantic Top-K;
4. deterministic versioned fusion, initially RRF candidate;
5. existing citation resolution;
6. signal explanation.

Final weights/cutoffs are benchmark evidence, never truth thresholds.

## Projection lifecycle

Logical additive stores may include semantic profiles, generations, index items and projection status. Incremental projection must upsert eligible changed resources and remove/tombstone superseded/retired/access-ineligible resources. At the same base/profile, incremental and full rebuilds must have logically equivalent active membership.

New profile builds before activation; active pointer switches explicitly; bounded last-known-good generation supports rollback. Vector payloads are rebuildable and sensitivity-bearing; old payloads can be pruned after rollback window while minimal build/audit metadata may persist.

## Security/privacy

Authorization occurs before/in Top-K, not after global retrieval. Both **index embeddings and query embeddings** use ADR-133 provider/privacy/credential authority. Raw query text is not globally logged/cached; any cache is project/profile/policy scoped and minimal.

## Readiness/failure

Lexical and semantic readiness are separate. Healthy lexical search remains available when semantic is stale/failed/unavailable, with explicit degraded semantic state. Semantic failure never rolls back Canonical.

## Quality

Golden Query set: exact, typo, synonym, paraphrase, Korean/English alias, temporal wording, ambiguous neighbors and negative controls. Verify citation correctness, lexical-only vs semantic-only vs hybrid quality, obsolete-item invalidation and incremental/full equivalence.

## Acceptance Criteria

- **AKP1-AC-01** vectors are derived/rebuildable, never Canonical/Evidence/confidence.
- **AKP1-AC-02** corpus excludes unapproved/raw bulk content.
- **AKP1-AC-03** deterministic typed representation/digest/version exists.
- **AKP1-AC-04** embedding profile is independent and ADR-133 resolved.
- **AKP1-AC-05** vector store is behind a Port; pgvector is first adapter candidate only.
- **AKP1-AC-06** auth/sensitivity enforced before/in retrieval.
- **AKP1-AC-07** Hybrid results preserve EvidenceSpan/SourceVersion citation.
- **AKP1-AC-08** query/index embedding follows provider-egress policy.
- **AKP1-AC-09** semantic degradation falls back to lexical where allowed.
- **AKP1-AC-10** incremental invalidation/tombstone and full equivalence proven.
- **AKP1-AC-11** generation switch/rollback/pruning does not mutate Canonical.
- **AKP1-AC-12** Golden Query evidence approves final rank/cutoff policy.

## Proposed Work Packages

WP1 contracts/representation/profile; WP2 storage/pgvector adapter; WP3 semantic+hybrid retrieval/citation; WP4 lifecycle/readiness/invalidation; WP5 quality/security/performance.

---

# AKP-2 — Discovery Finding Model

## Goal

Define a finite durable non-Canonical language for proactive findings without polluting Canonical candidate types.

## `DiscoveryFindingEnvelopeV1`

```text
findingId/findingRevision/projectId
findingType
status = DERIVED_INFERENCE
generationMethod = DETERMINISTIC | AI_ASSISTED | HYBRID
lifecycleState
payload
relatedResourceRefs[]/evidenceIds[]
sourceProjectionDigest/canonicalBase/runId
signalSummary/rationale/derivationSummary/provenance
accessScope[]/sensitivity
fingerprint/fingerprintVersion
createdAt/supersedesFindingId?
```

## Seven v1 types

1. `KNOWLEDGE_GAP` — missing fact, temporal gap, undefined term, unresolved question about a known conflict.
2. `EVIDENCE_GAP` — absent/weak/insufficient evidence coverage.
3. `RELATION_HYPOTHESIS` — typed relation/direction/time proposal.
4. `PATTERN_HYPOTHESIS` — bounded cluster/trend/recurring-association/temporal-change hypothesis.
5. `CONFLICT_HYPOTHESIS` — newly detected possible contradiction; not yet Canonical Conflict.
6. `CLARIFICATION_QUESTION` — concrete investigation/question next step.
7. `ACTION_SUGGESTION` — candidate-only action, structurally non-executable.

## Security composition

Multi-resource findings are one-project only. Effective audience is no broader than the safe common/intersection authorized audience of all contributing inputs/execution context; sensitivity is the highest/most restrictive effective classification. If safe common disclosure cannot be derived, do not materialize the finding. The composed classification also governs AI egress.

## Provenance/signals

Deterministic findings preserve rule/version/input digests. AI/hybrid findings preserve immutable execution pin plus prompt/schema/policy versions without secrets. Retrieval/semantic/graph/temporal/evidence/ranking signals are not truth confidence.

## Fingerprint/lifecycle

Fingerprint normalizes type + typed related resources + semantic proposal identity under a version; timestamps/run wording are excluded. Exact duplicate identity is separate from user suppression.

Lifecycle:

```text
NEW -> VALIDATING -> REVIEW_READY/REENTERED
      -> DISMISSED/SUPPRESSED
      -> RESOLVED/STALE/SUPERSEDED
```

History is preserved. Canonical/projection change can reconcile prior findings to RESOLVED/STALE/SUPERSEDED.

## Retention

Pre-persistence rejected proposals may be ephemeral. Persisted findings that enter governance, their re-entry/validation lineage and explicit feedback/suppression are durable non-Canonical records covered by backup/restore/project-deletion/audit retention, distinct from rebuildable vectors.

## Re-entry mapping

Relation -> Relation governance; Pattern -> derived Claim/knowledge path; Conflict -> existing Conflict comparison/review; Gap/Evidence Gap -> Knowledge Gap/investigation; Question -> investigation; Action -> Action Candidate governance. Mapping occurs only through AKP-5 validation/re-entry.

## Acceptance Criteria

- **AKP2-AC-01** seven types are schema-discriminated.
- **AKP2-AC-02** every finding is explicitly non-Canonical DERIVED_INFERENCE.
- **AKP2-AC-03** generation method/provenance durable.
- **AKP2-AC-04** restrictive multi-resource security composition enforced.
- **AKP2-AC-05** lineage supports revalidation/reconciliation.
- **AKP2-AC-06** fingerprint versioned and independent of incidental wording/time.
- **AKP2-AC-07** lifecycle/history retained, including RESOLVED/STALE/SUPERSEDED.
- **AKP2-AC-08** signals cannot become Fact confidence.
- **AKP2-AC-09** Action Suggestion non-executable.
- **AKP2-AC-10** durable governed findings participate in retention/backup policy.
- **AKP2-AC-11** explicit type-to-governance mapping exists.

## Proposed Work Packages

WP1 contracts/taxonomy/security/provenance; WP2 persistence migration/repository; WP3 fingerprint/lifecycle/reconciliation model; WP4 compatibility/serialization/retention tests.

---

# AKP-3 — Active Discovery Engine

## Goal

Generate useful v1 findings from bounded authorized approved signals using deterministic and AI-assisted strategies.

## Signal architecture

```text
Compiled Truth
Hybrid Retrieval
Semantic Graph
Temporal/Conflict state
Evidence coverage
 -> DiscoverySignalFacade
 -> versioned Strategy Registry
 -> bounded candidate-neighborhood selection
 -> optional AI classification/explanation
 -> deterministic Quality Gate
 -> DiscoveryFindingEnvelope
```

Ports are project/access/sensitivity/projection-version/budget bound.

## Strategies

- Knowledge Gap: disconnected/under-connected Entity, missing expected context, temporal gap/unresolved question.
- Evidence Gap: empty/weak lineage or unresolved competing support.
- Relation: semantic neighbors + graph absence + type/time compatibility -> bounded pair -> optional AI relation classification -> deterministic validation.
- Pattern: bounded typed neighborhoods -> explainable cluster/trend/recurring/temporal hypothesis.
- Conflict: bounded competing current propositions/relations with incompatible values/times -> optional AI explanation -> deterministic contradiction/identity checks.
- Clarification: concrete question generated from qualified finding context.
- Action: actionable consequence with rationale/risk/affected resources; remains non-executable.

## `DiscoveryModelProfileV1`

Separate from Ask model and SemanticEmbeddingProfile. References a server-owned provider/model capability and resolves via ADR-133. Persist effective provider/model/config/credential/policy/prompt/schema revisions without secrets.

## Prompt/content isolation

Knowledge is untrusted **data**, not instruction. AI receives bounded structured envelopes with instruction/data separation. Discovery AI has no external tool/Action execution authority. Structured output is decoded and deterministically schema/security/identity/evidence validated; embedded prompt-like content cannot override system/provider/privacy/budget policy.

## Quality gates

Reject before persistence if scope invalid, references invalid, canonical equivalent already exists, self-reference invalid, temporal/schema rules fail, required lineage missing, fingerprint duplicate/suppression applies, or budget exhausted. Missing Evidence is allowed only when the finding itself is explicitly a gap.

## Budget/ranking

Bound resources scanned, neighbors/resource, pairs/groups, findings, provider calls, tokens, estimated cost, wall-clock and concurrency. Exhaustion is explicit partial/truncation.

Priority dimensions may include novelty, explicit relevance, evidence coverage, impact, urgency, redundancy and cost/risk. No score is Truth Probability.

## Degraded mode

If AI unavailable, deterministic-capable strategies may run with effective strategy set recorded and result PARTIAL/degraded. AI-required strategies are skipped/fail explicitly; no fabricated normal output.

## Acceptance Criteria

- **AKP3-AC-01** strategy registry versioned/bounded.
- **AKP3-AC-02** authorized/version-bound signal reads only.
- **AKP3-AC-03** deterministic/AI/hybrid distinguishable.
- **AKP3-AC-04** relation/conflict/pattern candidate space bounded before AI.
- **AKP3-AC-05** every frozen v1 type has accepted generation/disposition.
- **AKP3-AC-06** deterministic quality gate before persistence.
- **AKP3-AC-07** DiscoveryModelProfile distinct and ADR-133 pinned.
- **AKP3-AC-08** prompt injection/content cannot alter policy or execute tools/Actions.
- **AKP3-AC-09** token/cost/time/concurrency budgets enforced.
- **AKP3-AC-10** positive/negative quality fixtures include conflict cases.

## Proposed Work Packages

WP1 signal facade/deterministic strategies; WP2 relation/pattern/conflict neighborhoods; WP3 AI profile/structured output; WP4 quality/budget/ranking; WP5 evaluation/degradation/security.

---

# AKP-4 — Trigger, Scheduling & Durable Runtime

## Goal

Make Discovery proactive and restart-safe after Canonical changes, on persistent schedule and on manual request.

## Trigger/runtime

```text
CanonicalCommitted ----+
Persistent Schedule ---+-> DiscoveryTriggerCoordinator
Manual Command --------+        |
                                v
                       Discovery Job/Run/Attempt/Stage
                                |
                           AKP-3 Engine
                                |
                      persist findings + FindingReady
```

## Trigger classes

- `CANONICAL_COMMITTED`: idempotent incremental Job after required projections.
- `SCHEDULED_FULL_SCAN`: persisted periodic full scan; weekly architecture default, exact local schedule configurable.
- `MANUAL`: explicit authorized bounded request.

Existing Canonical Outbox is reused; no second outbox.

## Durable state

```text
QUEUED
WAITING_FOR_PROJECTION
RUNNING
PARTIAL
SUCCEEDED
FAILED_RETRYABLE
FAILED_TERMINAL
CANCELLED
```

Typed stages include WAIT_FOR_PROJECTION, LOAD_SIGNALS, GENERATE_FINDINGS, QUALITY_GATE, PERSIST_FINDINGS, PUBLISH_REENTRY, RECONCILE_FINDINGS. ADR-130 identity semantics apply; Domain Retry creates new Attempt, transport retry does not.

## Projection readiness/wait timeout

Job binds required projection base. WAITING_FOR_PROJECTION has a persisted deadline. On expiry policy chooses explicit degraded strategy set, FAILED_RETRYABLE or FAILED_TERMINAL. No infinite silent wait.

## Recovery/idempotency

Reuse PostgreSQL/in-process worker patterns with bounded leases. Restart/lease expiry makes retryable work reclaimable. Logical Job identity binds project+trigger+base+policy/profile revisions. Duplicate events/redelivery cannot create duplicate logical Jobs/findings.

Rapid commits can coalesce only when lineage proves later base subsumes prior pending work; latest Canonical base is never lost.

## Reconciliation

Canonical/projection updates also budget reconciliation of active findings; fulfilled/obsolete/superseded findings become RESOLVED/STALE/SUPERSEDED while history remains.

## Activity

Discovery domain snapshots/events feed existing federated Activity projection. Activity presents but does not own Discovery state.

## Acceptance Criteria

- **AKP4-AC-01** CanonicalCommitted creates one idempotent incremental logical Job.
- **AKP4-AC-02** persistent periodic scheduler exists, not enum-only.
- **AKP4-AC-03** manual trigger server-authorized/bounded.
- **AKP4-AC-04** Discovery never runs inside Canonical transaction.
- **AKP4-AC-05** projection base/readiness/deadline/fallback explicit.
- **AKP4-AC-06** Job/Run/Attempt/Stage survives restart.
- **AKP4-AC-07** duplicate delivery cannot create duplicate Domain work.
- **AKP4-AC-08** lease/retry preserves prior failure context.
- **AKP4-AC-09** budgets persist across retries.
- **AKP4-AC-10** existing Activity integrates via adapter.
- **AKP4-AC-11** Canonical changes reconcile prior findings.
- **AKP4-AC-12** no generalized queue/workflow dependency without separate need/approval.

## Proposed Work Packages

WP1 trigger/job contracts+persistence; WP2 Canonical consumer+projection wait; WP3 scheduler+manual normalization; WP4 leases/retry/restart/idempotency/reconciliation; WP5 Activity/evidence.

---

# AKP-5 — Validation Re-entry & Governance

## Goal

Close the actual path from persisted derived finding into Phase 3 validation, comparison/impact, existing Review, approval and Canonical without weakening direct Source Evidence semantics.

## Core path

```text
FindingReady
 -> DiscoveryReentryCoordinator
 -> DiscoveryReentryManifest
 -> DerivedProvenanceValidation
 -> type-specific normalized candidate/change/conflict/investigation
 -> Comparison / Impact
 -> existing Review (ADR-128)
 -> approved ChangeSet
 -> existing Canonical commit
```

Eligible persisted findings re-enter automatically under policy. User click is not required to start validation; user authority remains at Review/Approval.

## `DiscoveryReentryManifestV1`

```text
manifestId/projectId
findingId/findingRevision/findingType
sourceProjectionDigest/canonicalBase
relatedResourceRefs[]/evidenceIds[]
derivationProvenance
accessScope[]/sensitivity
requestedReentryPurpose/createdAt
```

Idempotent by finding revision/purpose/base.

## Derived provenance origin

Do not change Stage 4 `ClaimCandidate.evidenceMode = DIRECT_EVIDENCE`. Add distinct `DERIVED_DISCOVERY` origin carrying finding/projection/canonical base, approved resource revisions, inherited evidence lineage and derivation provenance. Never fabricate SourceVersion.

## Type mapping

- Relation -> staged Relation proposal/change after endpoint/time validation.
- Pattern -> derived Claim/knowledge proposal with explicit member/evidence lineage.
- Conflict -> existing Conflict comparison/review after contradiction validation.
- Knowledge/Evidence Gap -> Knowledge Gap/investigation; missing evidence never positive proof.
- Question -> investigation resource/work.
- Action -> ActionCandidate governance; finding/Review alone cannot execute.

## Review bridge

Replace production empty in-memory Discovery source. Review consumes only **review-eligible normalized resources after derived validation/comparison preparation**, with lineage to the raw finding. Raw NEW/VALIDATING/failed/stale findings are visible only as appropriate in Discovery UI, not approvable items.

## Stale-base/retention

Check base before validation, Review context and approved mutation. Material staleness causes revalidation/rebuild/fail-closed. Governed findings, re-entry manifests and validation/provenance links are durable non-Canonical retention/backup records.

## Acceptance Criteria

- **AKP5-AC-01** real persistent FindingReady consumer exists.
- **AKP5-AC-02** eligible findings automatically enter idempotent re-entry.
- **AKP5-AC-03** direct ClaimCandidate semantics unchanged.
- **AKP5-AC-04** separate derived-provenance validation origin/profile exists.
- **AKP5-AC-05** no fake SourceVersion.
- **AKP5-AC-06** all seven finding types have governed mapping.
- **AKP5-AC-07** Review reads persistent review-eligible derived resources, not empty/raw source.
- **AKP5-AC-08** stale-base fails closed/revalidates.
- **AKP5-AC-09** ADR-128 remains approval authority.
- **AKP5-AC-10** Action cannot execute without external Action governance.
- **AKP5-AC-11** accepted Canonical change keeps origin/provenance history.

## Proposed Work Packages

WP1 re-entry/derived validation contracts; WP2 FindingReady consumer; WP3 persistent Review bridge; WP4 type mapping to existing comparison/impact/review; WP5 stale/provenance/security negative tests.

---

# AKP-6 — Discovery Product Experience

## Goal

Make active findings understandable/governable through the Knowledge Product while reusing Graph, Review and Activity authority.

## Surfaces

### Discovery Inbox/detail

Show type, lifecycle, non-Canonical authority, generation method, reason/derivation, related resources, Evidence, canonical/projection base/freshness, safe ranking signals, Activity, validation/re-entry/Review state and capabilities.

### Owner actions

- open existing Review only when REVIEW_READY;
- inspect validation/re-entry state;
- Evidence/Source;
- Graph;
- investigate/Ask;
- dismiss/snooze/suppress where policy allows.

No “Write Canonical”; no generic “make valid” button; no Action execution shortcut.

### Graph overlay

Persisted relation/pattern/conflict findings bind to existing DERIVED_INFERENCE/DISCOVERY_CANDIDATE overlays, never CANONICAL relation/conflict. Accessible list/table mirrors authority/evidence semantics.

### Activity/Attention

Discovery adapter feeds existing Activity with waiting/running/partial/failure/retry/budget/truncation details. Attention only for concrete actionable policy-worthy findings; low/medium are batched. Mandatory material Conflict/Safety/Policy may surface despite ordinary suppression.

## Readiness/accessibility/security

UI distinguishes current/stale/partial/truncated/waiting/validating/review-ready/degraded. Keyboard, semantic text, non-color-only authority, focus-preserving refresh, bounded announcements, project-scoped cache and non-disclosure are mandatory.

## Acceptance Criteria

- **AKP6-AC-01** Product UI, not backend-only.
- **AKP6-AC-02** derived authority visibly distinct.
- **AKP6-AC-03** why/evidence/provenance/freshness inspectable subject to masking.
- **AKP6-AC-04** automatic re-entry state visible; Review reused only when ready.
- **AKP6-AC-05** candidate Graph semantics distinct + accessible fallback.
- **AKP6-AC-06** existing Activity integrates via adapter.
- **AKP6-AC-07** Attention/noise bounded with mandatory-risk exception.
- **AKP6-AC-08** commands server-authoritative/capability-derived.
- **AKP6-AC-09** degraded/partial states explicit.
- **AKP6-AC-10** keyboard/focus/accessibility proven.
- **AKP6-AC-11** project/cache/non-disclosure proven.

## Proposed Work Packages

WP1 APIs/client; WP2 Inbox/detail; WP3 Graph binding; WP4 Activity/Attention; WP5 actions/accessibility/E2E.

---

# AKP-7 — Feedback & Adaptive Prioritization

## Goal

Use explicit feedback to improve usefulness/noise without turning preference into epistemic authority.

## `DiscoveryFeedbackEventV1`

Append-only fields: feedback/project/finding revision/actor/class/kind/reason/scope/time.

### Epistemic

`INCORRECT_RELATION`, `INSUFFICIENT_EVIDENCE`, `WRONG_ENTITY`, `TEMPORAL_ERROR`, `MISLEADING_PATTERN`, `MISIDENTIFIED_CONFLICT`. These route to validation/correction/review work.

### Preference/utility

`USEFUL`, `NOT_RELEVANT`, `ALREADY_KNOWN`, `TOO_FREQUENT`, `SNOOZE`, `SUPPRESS_EXACT`, `SUPPRESS_SIMILAR`. These affect priority/timing/grouping/suppression only.

## Dedupe/suppression/snooze

System fingerprint dedupe remains separate. User suppression is persisted with actor/scope/expiry/matcher version. Similar suppression requires explicit user action. Snooze is temporary.

Suppression does **not** remove materially new/high-priority/non-suppressible Conflict/Safety/Policy findings from mandatory governed surfaces. A new material revision is re-evaluated rather than blindly hidden.

## Ranking

V1 uses deterministic versioned `DiscoveryRankingPolicy` over novelty, explicit relevance, evidence coverage, impact, urgency, redundancy, cost/risk and explicit utility feedback. Score is presentation/discovery priority, never Truth Probability. Approval rate may measure Product quality but cannot train truth.

Implicit click/view/search telemetry and ML ranking are excluded from v1 completion.

## Retention/security

Feedback/suppression is durable non-Canonical user history under backup/restore/project-deletion/audit policy. Matching cannot inspect unauthorized resources or leak other projects.

## Acceptance Criteria

- **AKP7-AC-01** append-only feedback/audit.
- **AKP7-AC-02** epistemic vs utility schema-distinct.
- **AKP7-AC-03** epistemic routes to correction/validation.
- **AKP7-AC-04** utility cannot change Evidence/Fact/Claim authority.
- **AKP7-AC-05** dedupe and user suppression separate.
- **AKP7-AC-06** snooze temporary/history-preserving.
- **AKP7-AC-07** suppress-similar explicit/versioned.
- **AKP7-AC-08** mandatory material Conflict/Safety/Policy visibility cannot be erased by preference suppression.
- **AKP7-AC-09** ranking deterministic/versioned/explainable.
- **AKP7-AC-10** implicit telemetry/ML not v1 requirement.
- **AKP7-AC-11** feedback retention/project security proven.

## Proposed Work Packages

WP1 feedback/suppression/ranking contracts+storage; WP2 Product commands/state; WP3 ranking integration; WP4 epistemic feedback re-entry; WP5 UI/audit/security.

---

# AKP-8 — End-to-End Active Knowledge Acceptance

## Goal

Prove all Section hand-offs as one safe persistent loop and establish a finite `AKP v1 COMPLETE` boundary.

## Mandatory scenarios A-P

- **A** Canonical-triggered relation loop including automatic derived validation/re-entry and later reconciliation.
- **B** persistent scheduled full scan without user request.
- **C** explicit feedback/suppression survives rerun/restart without truth change.
- **D** semantic/AI degradation with lexical/deterministic safe behavior.
- **E** restart/lease recovery with one logical outcome.
- **F** duplicate Canonical event produces no duplicate logical Job/finding.
- **G** stale-base Review revalidates/fails closed.
- **H** project/access/sensitivity isolation including restrictive multi-input composition/egress.
- **I** semantic profile generation build/switch/rollback.
- **J** Action Suggestion cannot externally execute without existing Action authority.
- **K** relation/pattern/conflict inference never rendered/exported as Canonical by score alone.
- **L** epistemic feedback routes to correction; utility only to ranking/suppression.
- **M** Conflict Hypothesis enters existing Conflict governance and suppression cannot erase materially new mandatory conflict visibility.
- **N** semantic tombstone/invalidation and full/incremental equivalence.
- **O** query embedding privacy plus knowledge-as-data/prompt/tool isolation.
- **P** projection-wait deadline typed disposition plus finding reconciliation.

## Evidence dimensions

Contracts/migrations; rebuild/rollback/retention; persistence/restart/idempotency; security/non-disclosure/sensitivity/egress; prompt isolation; semantic quality; Discovery quality/conflict/suppression; automatic re-entry/Review; Graph/Activity authority; accessibility; performance/cost; degraded recovery; provenance/history/reconciliation.

## Completion gate

`AKP v1 COMPLETE` only when:

1. all frozen PAC/Section AC PASS or explicitly approved non-blocking disposition;
2. E2E A-P PASS on final exact Product head;
3. zero unresolved Critical/High architecture/security gaps;
4. every Deferred item assigned outside v1 with impact;
5. migration/rebuild/rollback/retention evidence complete;
6. required automatic CI on exact head PASS;
7. user final completion approval;
8. normal merge/post-merge governance records completion.

Same-exact-head PASS evidence is reused; focused tests cover changed risk; duplicate full test/CI is not required.

## Acceptance Criteria

- **AKP8-AC-01** E2E A-P evidenced.
- **AKP8-AC-02** all PAC/Section AC dispositions complete.
- **AKP8-AC-03** no Critical/High unresolved cross-Section gap.
- **AKP8-AC-04** security/degraded/restart/invalidation cases proven, not happy path only.
- **AKP8-AC-05** representative performance/cost bounded.
- **AKP8-AC-06** exact-head evidence reuse policy followed.
- **AKP8-AC-07** user explicitly approves completion.
- **AKP8-AC-08** merge/post-merge records `AKP v1 COMPLETE`; later active features become v2/follow-up.

## Proposed Work Packages

WP1 cross-Section evidence matrix; WP2 E2E A-P fixtures; WP3 security/recovery/degraded/performance; WP4 final gap/Deferred audit; WP5 completion authorization/merge/post-merge closure.

---

# Cross-Section Contract Map

| Producer | Contract/output | Consumer | Critical rule |
|---|---|---|---|
| Stage 6 Canonical | `CanonicalCommitted` | AKP-4 | existing durable Outbox reused |
| Compiled Truth/Graph | digests/versions/readiness | AKP-1/3/4 | exact projection base |
| AKP-1 | semantic projection + Hybrid retrieval | AKP-3 | signal != truth; citation retained |
| AKP-2 | `DiscoveryFindingEnvelopeV1` | AKP-3/4/5/6/7 | derived provenance/security/lifecycle |
| AKP-3 | finding/run output | AKP-4/5 | bounded quality-gated generation |
| AKP-4 | durable Job + FindingReady + reconciliation | AKP-5/6 | idempotent proactive runtime |
| AKP-5 | validated/review-eligible resource | existing Review/Canonical + AKP-6 | no fake direct Evidence / no auto approval |
| AKP-6 | explicit owner commands | AKP-7/existing Review | UI is not authority |
| AKP-7 | feedback/suppression/ranking policy | AKP-3/6 | preference cannot alter epistemic truth |
| all | evidence | AKP-8 | whole-loop closure |

# External Dependency Map

- **ADR-133:** external embedding and AI-assisted Discovery final acceptance requires its Product provider/model/credential/privacy authority; AKP defines separate profiles and does not duplicate it.
- **PR #30 Durable Knowledge Processing:** generalized durable import/queue remains outside v1; AKP-4 adds only Discovery-specific durable state using existing foundations.
- **Stage 12.1 Quality Evaluation:** reuse for semantic/Discovery evaluation rather than creating another generic evaluation platform.

# Whole-design completion review result

The normalized candidate has explicit ownership for the identified gaps: direct-vs-derived provenance, semantic lifecycle/query privacy, seven-type finding taxonomy including conflict, restrictive multi-resource security, bounded AI/prompt isolation, real triggers/scheduler/wait timeout/reconciliation, automatic re-entry, persistent Review bridge, Product Graph/Activity integration, feedback/suppression safety and finite E2E closure.

Any new issue found during user review is amended across affected ADR/Section documents before acceptance; it does not enter Product implementation silently.