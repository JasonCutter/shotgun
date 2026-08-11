# ADR-134 — Active Knowledge Productization v1 Boundary and Completion Contract

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-0 — Program Baseline & Completion Contract`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-086, ADR-087, ADR-090, ADR-098, ADR-125, ADR-127, ADR-128, ADR-130, ADR-133
- Product implementation: **NOT_AUTHORIZED**

> This is a whole-design review candidate. It allocates a finite architecture boundary but is not accepted until explicit user approval.

## Context

Shotgun already defines an active knowledge lifecycle in its Knowledge Flow: Canonical changes rebuild Compiled Truth/search/graph projections; Step 17 discovers gaps, relationships, patterns, questions and actions; Discovery results remain derived candidates and return to Phase 3; feedback later re-enters the system. Current Product implementation contains important foundations but only a narrow deterministic Knowledge Gap Discovery path is fully wired.

Designing one missing feature at a time risks an unbounded program with no objective completion point. AKP therefore needs a fixed program boundary before implementation.

## Decision

Create `AKP — Active Knowledge Productization v1` as a finite Productization program over existing Knowledge Flow responsibilities. AKP is not a new Knowledge Flow Phase and cannot redefine Canonical, Claim/Fact, Evidence, Review or external Action authority.

The program contains exactly these baseline Sections unless an explicit scope amendment is approved:

1. AKP-0 Program Baseline & Completion Contract
2. AKP-1 Hybrid Semantic Retrieval
3. AKP-2 Discovery Finding Model
4. AKP-3 Active Discovery Engine
5. AKP-4 Trigger, Scheduling & Durable Runtime
6. AKP-5 Validation Re-entry & Governance
7. AKP-6 Discovery Product Experience
8. AKP-7 Feedback & Adaptive Prioritization
9. AKP-8 End-to-End Active Knowledge Acceptance

## Completion meaning

AKP v1 is COMPLETE only when the persistent Product closes this governed loop:

```text
Canonical Commit
-> Compiled Truth/Search/Graph projections
-> Hybrid semantic retrieval
-> bounded Discovery
-> derived finding + provenance
-> validation/comparison/impact
-> Review and explicit approval
-> Canonical change
-> projections and Discovery again
```

Explicit feedback must also close two separate paths:

- epistemic feedback -> validation/correction/review;
- preference/utility feedback -> ranking/suppression only.

A backend-only algorithm, a manual `/knowledge/discovery/run` endpoint, a `reentryPhase` label without a consumer, or a hidden candidate store does not satisfy completion.

## Program invariants

1. Discovery cannot write Canonical.
2. AI output cannot become Fact without the existing approved Fact-change boundary.
3. Discovery Action suggestions cannot execute externally without Action governance.
4. Compiled Truth/search/graph/vector projections remain rebuildable and non-Canonical.
5. Access scope/sensitivity are inherited end to end.
6. Existing Outbox, Review, Graph, Activity and typed failure foundations are reused.
7. Same-exact-head PASS evidence is reused; duplicate test/CI execution is not a completion requirement.

## Scope-control rule

A newly proposed capability enters AKP v1 only when it is necessary to satisfy a frozen Program Acceptance Criterion. Otherwise it is recorded as AKP v2 or separate follow-up architecture work. Adding or splitting a Section requires an explicit AKP Master Scope Amendment and cannot silently move the completion boundary.

## Non-scope

AKP v1 excludes autonomous Fact approval, direct Discovery Canonical mutation, automatic external Action execution, generic autonomous web research, model fine-tuning/online learning, implicit behavior-based truth scoring, mandatory external vector DB adoption, unconditional Raw Source vectorization, self-modifying agents, and the deferred generalized durable knowledge-import queue.

## Consequences

### Positive

- The program has an objective start/end boundary.
- Cross-Section gaps can be found before Product implementation.
- Existing Shotgun architecture is completed rather than replaced.
- Later capabilities cannot become silent moving goalposts.

### Costs

- Some implementation may be intentionally delayed until all cross-Section contracts are understood.
- AKP depends on accepted external architecture such as ADR-133 for external AI execution.

## Rejected alternatives

### Implement Semantic Retrieval first and discover later

Rejected because it hides re-entry, scheduler, Review, Product and feedback gaps until late implementation.

### Define a new autonomous-agent Knowledge Flow phase

Rejected because Step 16/17/22 already define the required lifecycle and authority boundaries.

### Keep AKP open-ended

Rejected because it removes a verifiable completion definition and invites scope drift.

## Acceptance dependency

The full AKP master design and proposed ADR-135 through ADR-142 must be reviewed together before this ADR is accepted.