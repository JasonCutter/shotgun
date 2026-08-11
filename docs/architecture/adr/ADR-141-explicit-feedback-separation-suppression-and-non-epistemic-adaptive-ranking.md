# ADR-141 — Explicit Feedback Separation, Suppression and Non-Epistemic Adaptive Ranking

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-7 — Feedback & Adaptive Prioritization`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-090, ADR-115, ADR-128, ADR-134, ADR-136, ADR-137, ADR-140
- Product implementation: **NOT_AUTHORIZED**

## Context

Current Stage 10 fingerprint uniqueness suppresses exact duplicate findings, but it is not user feedback. Shotgun's Knowledge Flow requires feedback to return to the system while preserving the distinction between factual correction and user preference. A naive self-improvement loop could incorrectly turn frequent clicks, approvals or preferences into evidence that a proposition is true.

AKP v1 needs a learning loop that improves usefulness without modifying epistemic authority.

## Decision

### 1. Explicit feedback is append-only history

Persist `DiscoveryFeedbackEventV1` records with at least:

```text
feedbackId
projectId
findingId/findingRevision
actor
feedbackClass
feedbackKind
reason?
scope?
createdAt
```

Feedback does not overwrite the original finding. Review decisions, Canonical approvals and feedback remain separate event types even when they can be analyzed together.

### 2. Two non-interchangeable feedback classes

#### Epistemic feedback

Examples:

- `INCORRECT_RELATION`
- `INSUFFICIENT_EVIDENCE`
- `WRONG_ENTITY`
- `TEMPORAL_ERROR`
- `MISLEADING_PATTERN`

These signals create or route to validation/correction/review work. They do not directly mutate Canonical or simply subtract a preference score.

#### Preference / utility feedback

Examples:

- `USEFUL`
- `NOT_RELEVANT`
- `ALREADY_KNOWN`
- `TOO_FREQUENT`
- `SNOOZE`
- `SUPPRESS_EXACT`
- `SUPPRESS_SIMILAR`

These may influence ranking, timing, grouping and suppression. They do not change Evidence strength, Fact/Claim truth status or source authority.

### 3. Duplicate suppression is separate from user suppression

System duplicate control continues to use deterministic logical fingerprints. User suppression is a persisted policy/event with actor, scope and optional expiry.

`SUPPRESS_SIMILAR` may use a versioned semantic family/matcher, but only after an explicit user action. It cannot silently infer that a rejected finding means every semantically similar opposing view should be hidden.

### 4. Snooze is temporary state

Snooze records an expiry/review time and does not delete the finding or permanently suppress its fingerprint. A materially revised finding may reappear according to policy with clear revision lineage.

### 5. Transparent deterministic v1 ranking policy

V1 uses a versioned, inspectable `DiscoveryRankingPolicy`, not a required ML model. Inputs may include:

- novelty;
- explicit project/user relevance;
- Evidence coverage;
- impact/reach;
- temporal urgency;
- redundancy penalty;
- explicit feedback-derived utility penalty/boost;
- suppression/snooze state;
- estimated cost/risk.

The resulting score is a presentation/discovery priority, never Truth Probability.

### 6. Approval/rejection history is not truth training

The system may measure which suggestion types are useful or noisy, but an accepted/approved finding cannot cause its semantic category to be treated as more factually true in future. Likewise, repeated rejection cannot justify hiding contradictory evidence or weakening Canonical comparison requirements.

### 7. Implicit behavior telemetry is deferred

Clicks, opens, search frequency and viewing time are not required AKP v1 learning inputs. If a later version proposes implicit behavior signals, it requires explicit privacy/product policy and remains non-epistemic.

### 8. Ranking changes are revisioned and auditable

A change to ranking weights/rules creates a new ranking-policy revision. Each ordered Discovery response can identify the effective policy revision. Historical findings/feedback are not rewritten when policy changes.

### 9. Security and scope

Feedback and suppression are project/principal scoped as defined by the Product authority model. A user cannot suppress another project's finding or infer hidden findings through suppression APIs.

## Consequences

- Shotgun can become less noisy and more personally useful without learning false truth from preferences.
- Feedback history supports future evaluation while remaining auditable.
- V1 remains implementable without a separate ML training/serving stack.
- Semantic "suppress similar" requires careful scoped matching but is explicitly opt-in.

## Rejected alternatives

- Increase Fact confidence because a Claim is frequently opened/cited/approved.
- Optimize the Discovery engine for approval rate as the primary objective.
- Treat Review rejection and "not relevant" as the same signal.
- Delete dismissed findings and lose history.
- Require learned/opaque ranking for v1.
- Use implicit clickstream telemetry as a mandatory v1 feature.