# ADR-141 — Explicit Feedback Separation, Suppression and Non-Epistemic Adaptive Ranking

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-7 — Feedback & Adaptive Prioritization`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-090, ADR-115, ADR-128, ADR-134, ADR-136, ADR-137, ADR-140
- Product implementation: **NOT_AUTHORIZED**

## Context

Current Stage 10 fingerprint uniqueness suppresses exact duplicate findings, but it is not user feedback. Shotgun's Knowledge Flow requires feedback to return to the system while preserving the distinction between factual correction and user preference. A naive self-improvement loop could incorrectly turn frequent clicks, approvals or preferences into evidence that a proposition is true, or allow a preference suppression rule to hide materially new contradictory knowledge.

AKP v1 needs a learning loop that improves usefulness without modifying epistemic authority or mandatory risk visibility.

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

Once persisted, explicit feedback and suppression events are durable non-Canonical user records covered by normal backup/restore, project-deletion and audit-retention policy. They are not disposable semantic-cache rows.

### 2. Two non-interchangeable feedback classes

#### Epistemic feedback

Examples:

- `INCORRECT_RELATION`
- `INSUFFICIENT_EVIDENCE`
- `WRONG_ENTITY`
- `TEMPORAL_ERROR`
- `MISLEADING_PATTERN`
- `MISIDENTIFIED_CONFLICT`

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

### 4. Suppression cannot erase mandatory epistemic/safety visibility

Suppression governs ordinary Discovery resurfacing, grouping and ranking. A suppression rule cannot remove a finding from a mandatory Conflict/Safety/Policy Review or Attention surface when:

- the underlying approved knowledge materially changed after the suppression decision;
- the new finding is a materially distinct revision under the versioned matcher/fingerprint policy; or
- policy marks the finding class/severity as non-suppressible.

Such a finding may be hidden from ordinary repetitive Discovery lists while still appearing in the dedicated governed surface with an explanation of why the prior suppression did not apply.

The purpose is to prevent preference suppression from becoming an epistemic filter bubble.

### 5. Snooze is temporary state

Snooze records an expiry/review time and does not delete the finding or permanently suppress its fingerprint. A materially revised finding may reappear according to policy with clear revision lineage.

### 6. Transparent deterministic v1 ranking policy

V1 uses a versioned, inspectable `DiscoveryRankingPolicy`, not a required ML model. Inputs may include novelty, explicit project/user relevance, Evidence coverage, impact/reach, temporal urgency, redundancy penalty, explicit feedback-derived utility penalty/boost, suppression/snooze state and estimated cost/risk.

The resulting score is a presentation/discovery priority, never Truth Probability.

### 7. Approval/rejection history is not truth training

The system may measure which suggestion types are useful or noisy, but an accepted/approved finding cannot cause its semantic category to be treated as more factually true in future. Likewise, repeated rejection cannot justify hiding contradictory Evidence or weakening Canonical comparison requirements.

### 8. Implicit behavior telemetry is deferred

Clicks, opens, search frequency and viewing time are not required AKP v1 learning inputs. If a later version proposes implicit behavior signals, it requires explicit privacy/product policy and remains non-epistemic.

### 9. Ranking changes are revisioned and auditable

A change to ranking weights/rules creates a new ranking-policy revision. Each ordered Discovery response can identify the effective policy revision. Historical findings/feedback are not rewritten when policy changes.

### 10. Security and scope

Feedback and suppression are project/principal scoped as defined by the Product authority model. A user cannot suppress another project's finding or infer hidden findings through suppression APIs. Suppression matching cannot access unauthorized resources merely to decide semantic similarity.

## Consequences

- Shotgun can become less noisy and more personally useful without learning false truth from preferences.
- Feedback history supports future evaluation while remaining auditable and recoverable.
- Explicit suppression remains useful without being allowed to hide materially new mandatory contradictions/safety findings.
- V1 remains implementable without a separate ML training/serving stack.

## Rejected alternatives

- Increase Fact confidence because a Claim is frequently opened/cited/approved.
- Optimize the Discovery engine for approval rate as the primary objective.
- Treat Review rejection and `NOT_RELEVANT` as the same signal.
- Apply `SUPPRESS_SIMILAR` forever to every future contradiction regardless of material change/risk.
- Delete dismissed findings/feedback and lose history.
- Require learned/opaque ranking for v1.
- Use implicit clickstream telemetry as a mandatory v1 feature.