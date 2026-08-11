# Phase 6 ADD — AKP v1 Accepted Amendment

- Status: **ACCEPTED**
- Accepted at: 2026-08-12
- Accepted by: `USER`
- Applies to: Step 18/20/22 Productization and AKP closure
- Related accepted ADRs: ADR-134, ADR-139, ADR-140, ADR-141, ADR-142
- Product implementation: **NOT_AUTHORIZED**

## Amendment purpose

This amendment records the accepted Product-level delivery, feedback and closure boundaries needed to make the already-designed active knowledge loop observable and governable by the owner. It supplements the original Phase 6 ADD and does not replace its accepted decisions.

## Product experience refinement

Discovery is integrated into the existing Knowledge Workspace rather than becoming a separate knowledge application. The Product provides a project-scoped Discovery Inbox/list/detail surface with links to Evidence/Source, Graph, Review and Activity.

Each finding displays, subject to access masking:

- finding type and lifecycle;
- explicit non-Canonical / `DERIVED_INFERENCE` authority;
- deterministic, AI-assisted or hybrid generation method;
- derivation reason and related approved resources;
- Evidence lineage and Canonical/projection base/freshness;
- validation/re-entry/Review state;
- safe ranking dimensions and Activity link;
- governed next actions.

Semantic/model similarity is never presented as Fact confidence.

Eligible findings enter derived validation automatically. The Product shows `VALIDATING`, `REVIEW_READY`, stale/resolved and degraded states, but does not make the user the trigger for epistemic validation.

## Graph, Review and Activity refinement

Persisted Discovery findings bind into the existing Graph as non-Canonical derived/discovery overlays. Relation and Conflict hypotheses are visually and semantically distinct from Canonical relations/conflicts; accessible list/table fallback preserves the same authority labels and Evidence links.

Only validated/review-eligible normalized resources enter the existing Review authority. Raw findings are not immediately approvable, and Discovery UI never owns a direct Canonical-write approval.

Discovery Job/Run/Attempt/Stage observations feed the existing Activity/Attention architecture. Activity remains a projection over domain-owned runtime state, not a second Discovery authority. Attention is selective and noise-controlled; not every finding becomes a notification.

## Feedback refinement

Discovery feedback is append-only durable non-Canonical history and is separated into two non-interchangeable classes.

### Epistemic feedback

Examples include incorrect relation, insufficient Evidence, wrong Entity, temporal error, misleading pattern and misidentified conflict. These route into validation/correction/review work and never mutate Canonical directly.

### Preference / utility feedback

Examples include useful, not relevant, already known, too frequent, snooze, suppress exact and suppress similar. These may alter ranking, timing, grouping or resurfacing only. They never change Evidence strength, Fact/Claim truth status or source authority.

System fingerprint dedupe, user suppression and feedback remain distinct concepts. `SUPPRESS_SIMILAR` is explicit, versioned and scoped; it cannot silently become a filter against opposing or newly material knowledge.

Preference suppression cannot erase mandatory materially new Conflict/Safety/Policy Review or Attention visibility. Material change, distinct finding revision or a non-suppressible policy class may override ordinary resurfacing suppression with an explanation.

AKP v1 adaptive prioritization is transparent, deterministic and revisioned. Model fine-tuning, online learning and implicit clickstream/usage telemetry are not completion requirements.

## Finite AKP v1 closure

AKP v1 is complete only after all frozen `AKP-PAC-01` through `AKP-PAC-30`, all Section acceptance criteria and ADR-142 mandatory E2E scenarios A-P pass on the final exact Product head, with zero unresolved Critical/High architecture or security gaps, explicit Deferred dispositions, required migration/rebuild/rollback/retention evidence, successful required automatic CI and final user completion approval.

Mandatory end-to-end coverage includes:

- Canonical-triggered relation discovery and governed Canonical return loop;
- persistent periodic scan;
- feedback/suppression;
- semantic/AI degradation;
- restart and duplicate-event recovery;
- stale-base Review;
- project/access/sensitivity isolation;
- semantic generation switch/rollback;
- Action non-execution;
- derived-vs-Canonical authority presentation;
- feedback class routing;
- Conflict discovery plus mandatory-visibility suppression boundary;
- semantic invalidation/tombstone and full/incremental equivalence;
- query-embedding privacy and AI prompt/content isolation;
- bounded projection wait and finding reconciliation.

Already-PASS evidence at the same exact head is reused; duplicate full test or CI execution is not required for completion.

## Change-history rule

This amendment supplements the original Phase 6 accepted design. Future capabilities described merely as “more active” do not silently extend AKP v1 after closure; they require AKP v2 or a separately approved architecture work item.