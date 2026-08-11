# ADR-142 — Finite End-to-End Acceptance Gate and AKP v1 Closure Boundary

- Status: **ACCEPTED**
- Proposed at: 2026-08-11
- Decision date: 2026-08-12
- Accepted at: 2026-08-12
- Accepted by: `USER`
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
-> automatic derived validation/re-entry
-> Discovery UI/Graph explanation
-> Review-ready governed resource
-> Review/Approval
-> Canonical relation/change
-> new projection generation
-> later Discovery observes/reconciles the new Canonical state
```

This proves Phase-3 re-entry is automatic governance processing; a user click is not required to make the finding eligible for validation.

#### E2E-B — Periodic full scan

A persistent scheduled full scan executes without an interactive request, records Job/Run/Attempt/Stage state and creates/suppresses findings under bounded policy.

#### E2E-C — Explicit feedback/suppression

A user dismisses/snoozes/suppresses a finding; the feedback event is preserved and a logically repeated ordinary run obeys the exact/similar suppression scope without modifying truth confidence.

#### E2E-D — Semantic/AI degradation

Semantic embedding or AI-assisted Discovery becomes unavailable. Canonical remains unchanged; healthy lexical/deterministic capability behaves according to fallback policy; Product exposes degraded/partial state rather than fabricating normal readiness.

#### E2E-E — Restart recovery

A queued/running Discovery job survives process restart/lease expiry and completes or retries with one logical job outcome; duplicate logical findings are not created.

#### E2E-F — Duplicate Canonical event delivery

Repeated `CanonicalCommitted` delivery does not create duplicate logical Discovery Jobs or duplicate findings.

#### E2E-G — Stale-base review

Canonical/projection state changes after a finding is generated but before Review/Approval. The re-entry path detects stale authority and revalidates/rebuilds/fails closed rather than silently approving an obsolete inference.

#### E2E-H — Project/access/sensitivity isolation

Cross-project resource existence is not disclosed through semantic search, Discovery, Graph, Review, Activity or feedback APIs. A multi-resource finding uses the restrictive common access scope and highest effective sensitivity. External AI/embedding egress denied by policy fails closed.

#### E2E-I — Semantic profile generation switch/rollback

A new embedding profile builds a new projection generation, switches only after acceptance readiness and can roll back the active pointer without mutating Canonical.

#### E2E-J — Action non-execution

An Action Suggestion can become a governed Action Candidate but never executes externally from Discovery/Review alone; existing external-action approval/execution authority remains required.

#### E2E-K — Authority presentation

A derived relation/pattern/conflict is never rendered, cited or exported as Canonical merely because it has a high semantic/model score.

#### E2E-L — Feedback routing

Epistemic feedback creates validation/correction work; preference feedback changes ranking/suppression only.

#### E2E-M — Conflict discovery and mandatory-visibility suppression boundary

A newly detected potential contradiction becomes `CONFLICT_HYPOTHESIS`, passes derived validation into the existing Conflict comparison/review path, and remains non-Canonical until governed resolution. A prior ordinary `SUPPRESS_SIMILAR` preference cannot silently remove a materially new high-priority/non-suppressible conflict from the required Review/Attention surface.

#### E2E-N — Semantic invalidation and rebuild equivalence

A Canonical resource becomes superseded/retired/access-ineligible. Incremental semantic projection removes/tombstones it from the active retrievable corpus. A full rebuild at the same base/profile yields logically equivalent membership. Old vector payloads can be pruned without affecting Canonical or audit authority.

#### E2E-O — Query-embedding privacy and AI content isolation

A semantic query and AI-assisted Discovery call both pass ADR-133 provider/credential/egress authority. Restricted transfer fails closed. Knowledge/query content is treated as data; embedded prompt-like instructions cannot alter policy, invoke tools, execute external Actions or expose credentials.

#### E2E-P — Projection-wait timeout and finding reconciliation

A Discovery Job waiting on projections reaches its configured deadline and transitions to an explicitly allowed degraded, retryable or terminal state rather than waiting forever. A later Canonical change reconciles a fulfilled/obsolete prior finding to `RESOLVED`, `STALE` or `SUPERSEDED` while preserving history.

### 3. Acceptance dimensions

The final evidence matrix covers only risk-bearing deltas across:

- contract/schema compatibility;
- migration/rebuild/rollback and incremental/full-projection equivalence;
- persistence, retention, backup/restore and restart recovery;
- trigger idempotency and projection-wait disposition;
- security/non-disclosure/sensitivity composition and provider egress;
- prompt/content isolation for AI-assisted Discovery;
- semantic retrieval quality benchmark;
- Discovery precision/duplicate/suppression/conflict behavior;
- automatic re-entry and Review authority;
- Graph/Activity authority separation;
- Product accessibility/focus semantics;
- bounded performance/cost;
- failure/degraded-state recovery;
- history/audit/provenance and finding reconciliation.

### 4. Evidence reuse and test policy

Evidence already PASS at the same exact head is referenced, not rerun. Each implementation work package uses focused tests for its changed risk. The repository's required full checks are used at the final candidate boundary or when automatically triggered by CI, not repeatedly as a substitute for targeted evidence.

### 5. Program completion gate

`AKP v1 COMPLETE` requires all of the following:

1. every frozen AKP Program Acceptance Criterion PASS;
2. every frozen Section Acceptance Criterion PASS or an explicitly approved non-blocking disposition;
3. all mandatory E2E scenarios A-P PASS on the final exact Product head;
4. zero unresolved Critical/High architecture or security gaps;
5. every Deferred item assigned outside AKP v1 with impact recorded;
6. migration/rebuild/rollback/retention evidence complete where applicable;
7. required automatic CI on the final exact head successful;
8. user final completion approval;
9. normal merge/post-merge governance evidence complete before Canonical completion status is recorded.

### 6. Completion freezes scope

After the accepted completion declaration, a new capability cannot reopen AKP v1 merely by being described as “more active”. It becomes AKP v2 or a separately scoped architecture work item unless it proves the v1 completion evidence was false.

## Consequences

- Section-local success cannot hide broken hand-offs.
- Whole-design risks such as conflict visibility, query egress, semantic tombstones and infinite projection waits are explicitly tested.
- Program closure is objectively auditable.
- Test cost remains controlled through exact-head evidence reuse.
- Future active features receive a new scope rather than silently extending v1.

## Rejected alternatives

- Declare AKP complete when AKP-7 implementation merges without full-loop evidence.
- Require every historical test suite to be manually rerun after every Section.
- Treat successful happy-path relation discovery as sufficient while ignoring conflict/security/restart/invalidation cases.
- Use subjective “feels proactive” Product behavior as the completion definition.
- Leave future active features attached indefinitely to AKP v1.