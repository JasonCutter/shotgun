# ADR-142 — Finite End-to-End Acceptance Gate and AKP v1 Closure Boundary

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-8 — End-to-End Active Knowledge Acceptance`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-097, ADR-098, ADR-118, ADR-124, ADR-130, ADR-134, ADR-135, ADR-136, ADR-137, ADR-138, ADR-139, ADR-140, ADR-141
- Product implementation: **NOT_AUTHORIZED**

## Context

AKP v1 deliberately spans retrieval, derived finding contracts, Discovery algorithms, durable triggers, re-entry governance, Product experience and feedback. Individual Section tests can all pass while the active knowledge loop is still broken at a hand-off. Program completion therefore requires a finite cross-section acceptance gate rather than declaring success after the last feature PR.

Shotgun governance also requires exact-head evidence, no quiet scope drift, and no unnecessary duplicate CI/test execution.

## Decision

### 1. AKP-8 owns closure, not new Product authority

AKP-8 adds no alternate Canonical, Review, Activity, Search or Discovery authority. It defines the end-to-end acceptance evidence that must be true before `AKP v1 COMPLETE` can be recorded.

### 2. Mandatory end-to-end scenarios

The final acceptance matrix includes at least:

#### E2E-A — Canonical-triggered active relation loop

```text
approved Canonical change
-> CanonicalCommitted
-> required projections update
-> incremental Discovery job
-> persistent Relation Hypothesis finding
-> Discovery UI/Graph explanation
-> governed validation/re-entry
-> Review/Approval
-> Canonical relation/change
-> new projection generation
-> later Discovery observes the new Canonical state
```

#### E2E-B — Periodic full scan

A persistent scheduled full scan executes without an interactive request, records Job/Run/Attempt/Stage state and creates/suppresses findings under bounded policy.

#### E2E-C — Explicit feedback/suppression

A user dismisses/snoozes/suppresses a finding; the feedback event is preserved and a logically repeated run obeys the exact/similar suppression scope without modifying truth confidence.

#### E2E-D — Semantic/AI degradation

Semantic embedding or AI-assisted Discovery becomes unavailable. Canonical remains unchanged; healthy lexical/deterministic capability behaves according to fallback policy; Product exposes degraded/partial state rather than fabricating normal readiness.

#### E2E-E — Restart recovery

A queued/running Discovery job survives process restart/lease expiry and completes or retries with one logical job outcome; duplicate logical findings are not created.

#### E2E-F — Duplicate Canonical event delivery

Repeated `CanonicalCommitted` delivery does not create duplicate logical Discovery Jobs or duplicate findings.

#### E2E-G — Stale-base review

Canonical/projection state changes after a finding is generated but before Review/Approval. The re-entry path detects stale authority and revalidates/rebuilds/fails closed rather than silently approving an obsolete inference.

#### E2E-H — Project/access/sensitivity isolation

Cross-project resource existence is not disclosed through semantic search, Discovery, Graph, Review, Activity or feedback APIs. External AI/embedding egress denied by policy fails closed.

#### E2E-I — Semantic profile generation switch/rollback

A new embedding profile builds a new projection generation, switches only after acceptance readiness and can roll back the active pointer without mutating Canonical.

#### E2E-J — Action non-execution

An Action Suggestion can become a governed Action Candidate but never executes externally from Discovery/Review alone; existing external-action approval/execution authority remains required.

#### E2E-K — Authority presentation

A derived relation/pattern is never rendered, cited or exported as Canonical merely because it has a high semantic/model score.

#### E2E-L — Feedback routing

Epistemic feedback creates validation/correction work; preference feedback changes ranking/suppression only.

### 3. Acceptance dimensions

The final evidence matrix covers only risk-bearing deltas across:

- contract/schema compatibility;
- migration/rebuild/rollback;
- persistence and restart recovery;
- trigger idempotency;
- security/non-disclosure/sensitivity;
- semantic retrieval quality benchmark;
- Discovery precision/duplicate/suppression behavior;
- re-entry and Review authority;
- Graph/Activity authority separation;
- Product accessibility/focus semantics;
- bounded performance/cost;
- failure/degraded-state recovery;
- history/audit/provenance.

### 4. Evidence reuse and test policy

Evidence already PASS at the same exact head is referenced, not rerun. Each implementation work package uses focused tests for its changed risk. The repository's required full checks are used at the final candidate boundary or when automatically triggered by CI, not repeatedly as a substitute for targeted evidence.

### 5. Program completion gate

`AKP v1 COMPLETE` requires all of the following:

1. every frozen AKP Program Acceptance Criterion PASS;
2. every frozen Section Acceptance Criterion PASS or an explicitly approved non-blocking disposition;
3. all mandatory E2E scenarios PASS on the final exact Product head;
4. zero unresolved Critical/High architecture or security gaps;
5. every Deferred item assigned outside AKP v1 with impact recorded;
6. migration/rebuild/rollback evidence complete where applicable;
7. required automatic CI on the final exact head successful;
8. user final completion approval;
9. normal merge/post-merge governance evidence complete before Canonical completion status is recorded.

### 6. Completion freezes scope

After the accepted completion declaration, a new capability cannot reopen AKP v1 merely by being described as "more active". It becomes AKP v2 or a separately scoped architecture work item unless it proves the v1 completion evidence was false.

## Consequences

- Section-local success cannot hide broken hand-offs.
- Program closure is objectively auditable.
- Test cost remains controlled through exact-head evidence reuse.
- Future active features receive a new scope rather than silently extending v1.

## Rejected alternatives

- Declare AKP complete when AKP-7 implementation merges without full-loop evidence.
- Require every historical test suite to be manually rerun after every Section.
- Use subjective "feels proactive" Product behavior as the completion definition.
- Leave future active features attached indefinitely to AKP v1.