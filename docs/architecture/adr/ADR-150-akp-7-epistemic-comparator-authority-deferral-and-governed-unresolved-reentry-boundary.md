# ADR-150 — AKP-7 Epistemic Comparator Authority Deferral and Governed Unresolved Re-entry Boundary

- Status: **ACCEPTED**
- Proposed at: 2026-09-01
- Decision date: 2026-09-01
- Accepted at: 2026-09-01
- Accepted by: `USER`
- Decision owner: `USER`
- Work item: `AKP-7 WP4 — Epistemic Feedback Re-entry`
- Subject base: `main@06fe75fb2175fb37748d456a3d8c4af910a41101`
- Related ADRs: ADR-121, ADR-136, ADR-138, ADR-139, ADR-141, ADR-147, ADR-149
- Product implementation: **AUTHORIZED FOR THE BOUNDED WP4 REFINEMENT DEFINED BY THIS ADR**

## Context

AKP-7 WP4 routes all six active EPISTEMIC feedback kinds through the existing
durable `DERIVED_DISCOVERY` re-entry and validation lane. The route preserves the
exact feedback/Finding revision identity, authoritative resource and Evidence
lineage, freshness/security checks, and a governed validation outcome.

The implementation review established that the current repository does not expose
an approved semantic authority that can adjudicate the six validation focuses:

| Feedback kind            | Validation focus          |
| ------------------------ | ------------------------- |
| `INCORRECT_RELATION`     | `RELATION_CORRECTNESS`    |
| `INSUFFICIENT_EVIDENCE`  | `EVIDENCE_SUFFICIENCY`    |
| `WRONG_ENTITY`           | `ENTITY_IDENTITY`         |
| `TEMPORAL_ERROR`         | `TEMPORAL_VALIDITY`       |
| `MISLEADING_PATTERN`     | `PATTERN_VALIDITY`        |
| `MISIDENTIFIED_CONFLICT` | `CONFLICT_CLASSIFICATION` |

This is an implementation-discovered boundary refinement analogous to ADR-147.
It does not add an AKP Section or change AKP-0 through AKP-8. It must not be
resolved by inventing a truth engine, semantic comparator, AI/heuristic validator,
or raw feedback-reason classifier.

## Decision

### 1. Preserve the complete governed re-entry route

All six EPISTEMIC kinds remain active and routed. The durable sequence is:

```text
persist feedback
  -> exact durable epistemic trigger
  -> DERIVED_DISCOVERY correction/re-entry intake
  -> authoritative resource and Evidence lineage
  -> existing freshness/security authority
  -> governed validation result
```

Feedback remains non-Evidence context. `reasonKind` is
`NON_EVIDENCE_USER_CHALLENGE`; changing the raw reason cannot create Evidence,
Fact, Claim, Canonical state, or semantic truth authority.

### 2. Defer missing semantic comparator authority

The following authorities are not created by WP4:

- Evidence sufficiency authority;
- entity-resolution truth authority;
- temporal proposition comparator;
- pattern proof/refutation authority;
- conflict classifier;
- new relation-correctness truth authority;
- AI validator, heuristic validator, or raw feedback text classifier.

The existing outcome contract remains exactly:

```text
SUPPORTED | NOT_SUPPORTED | INSUFFICIENTLY_RESOLVABLE
```

V1 may not fabricate `SUPPORTED` or `NOT_SUPPORTED` from a user reason, ranking
signal, similarity, `signalSummary`, semantic neighborhood, model output, generic
Compiled Truth presence, or absence of a matching item. When approved authority
cannot safely adjudicate the correction, `INSUFFICIENTLY_RESOLVABLE` is the
correct governed result. It is not Evidence, user truth, feedback rejection or
approval, Canonical state, or Review approval.

The current conservative fallback is therefore intentional production behavior:
when no approved semantic comparator is configured, the assembled consumer
persists `INSUFFICIENTLY_RESOLVABLE` after lineage and freshness gates. Assembly
may omit the semantic comparator deliberately to preserve this fail-closed
boundary.

### 3. Keep Review eligibility outcome- and lifecycle-bound

`INSUFFICIENTLY_RESOLVABLE` and `NOT_SUPPORTED` never create a correction Review
resource. Only an authoritative `SUPPORTED` result may make correction Review
materialization eligible.

For a supported correction, `REVIEW_READY` is normally readable. A saved
correction resource remains hidden while its Finding is `VALIDATING` until an
authorized `VALIDATING -> REVIEW_READY` transition succeeds. Existing distinct
correction visibility for `REENTERED`, `DISMISSED`, and `SUPPRESSED` is retained.
No lifecycle transition is introduced merely to make the Review reader return a
resource.

### 4. Future activation gate

A future comparator may be activated only through a separate user-approved
architecture decision that defines, at minimum:

- Evidence sufficiency owner, threshold, and lineage versioning;
- entity identity owner, aliases, equivalence, stable identity, and conflict behavior;
- temporal proposition authority, interval comparison, and `CURRENT`/`PAST`/`FUTURE` semantics;
- pattern proof/refutation, member sufficiency, statistical authority, and structural authority;
- conflict classification for `FACTUAL`, `TEMPORAL`, `IDENTITY`, and `MODEL_DISAGREEMENT`, including comparison inputs;
- the future definition of relation correctness, where absence of an edge never automatically proves an incorrect relation.

The future decision must also define its Port/Adapter boundary, security and access
authority, versioned evaluation inputs, migration/replacement path, and rollback.

### 5. Preserve historical unresolved results

Durable unresolved outcomes are historical results. A future comparator must not
overwrite them in place. Future re-evaluation requires a new versioned attempt,
result, or identity. WP4 does not implement future re-evaluation.

## Consequences

- WP4 provides complete six-kind routing and durable lineage without asserting semantic truth.
- The production default is deterministic, auditable, and fail-closed when comparator authority is unavailable.
- Correction Review cannot be created from unresolved or unsupported outcomes.
- A saved supported correction cannot leak into Review during the `VALIDATING` crash gap.
- Comparator activation, truth ownership, and re-evaluation remain separately reviewable user decisions.
- There is no new migration, table, runtime dependency, lockfile change, or change to feedback identity, trigger identity, ranking, or suppression.

## Implementation status

This ADR is **ACCEPTED** by the user on 2026-09-01. Its bounded
implementation-discovered refinement is recorded in the WP4 implementation
document. It does not create a new AKP Section or update the whole-design
Acceptance Record as a new section; future semantic comparator activation and
re-evaluation remain subject to separate user-approved architecture decisions.
