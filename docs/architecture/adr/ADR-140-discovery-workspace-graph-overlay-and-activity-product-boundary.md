# ADR-140 — Discovery Workspace, Graph Overlay and Activity Product Boundary

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-6 — Discovery Product Experience`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-115, ADR-119, ADR-125, ADR-127, ADR-128, ADR-130, ADR-134, ADR-136, ADR-138, ADR-139
- Product implementation: **NOT_AUTHORIZED**

## Context

Current Product already has Knowledge Workspace, typed Semantic Graph, Review Center and Activity Workspace foundations. Graph contracts explicitly distinguish `CANONICAL`, `DERIVED_INFERENCE` and `DISCOVERY_CANDIDATE`. Review can represent a Discovery target kind. Activity establishes Job/Run/Attempt/Stage presentation authority. However the current Stage 10 Discovery is mainly reachable through manual backend endpoints and is not a complete owner-facing workflow.

A Product-level active system must let the owner understand what Shotgun found, why it was found, what authority it has, what Evidence supports it, whether it is fresh, what validation/review state it has reached, and what governed next action is available.

## Decision

### 1. Discovery is a Knowledge Workspace concern

Provide a project-scoped Discovery surface integrated with the Knowledge Product, e.g. `/knowledge/discoveries` or an equivalent Knowledge Workspace tab. Do not create a second isolated knowledge application.

The surface includes an Inbox/list, detail view and links into Graph, Evidence/Source, Review and Activity.

### 2. Discovery list/detail contract

Every displayed finding exposes, subject to access masking:

- finding type and current lifecycle (`NEW`, `VALIDATING`, `REVIEW_READY`, `RESOLVED`, `STALE`, etc.);
- concise summary/detail;
- `DERIVED_INFERENCE` / non-Canonical authority badge;
- generation method (`DETERMINISTIC`, `AI_ASSISTED`, `HYBRID`);
- reason/derivation summary;
- related approved resources;
- Evidence links/coverage;
- source projection/canonical base and freshness;
- ranking dimensions that are safe/product-meaningful;
- run/activity link;
- validation/re-entry/Review status;
- available governed actions.

The UI never renders semantic similarity/model confidence as Fact confidence.

### 3. Re-entry is automatic; owner actions operate on resulting state

AKP-5 automatically sends eligible persisted findings through derived validation/re-entry. The Discovery UI does not require or present a generic “make this valid” / “send to Phase 3” action as the normal path.

Baseline actions are capability-derived and server-authoritative:

- open existing Review when the finding is `REVIEW_READY`;
- inspect validation/re-entry state when still processing or rejected;
- inspect Evidence/Source lineage;
- open related Graph view;
- investigate/ask about the finding;
- dismiss;
- snooze;
- suppress exact/similar class when supported by AKP-7 and allowed by policy.

No Discovery card offers a direct “Write Canonical” action. Action suggestions do not expose an execution button until the existing Action governance creates the appropriate governed resource/capability.

### 4. Graph overlay binding

Bind persisted Discovery findings to the existing graph read model as non-Canonical overlays using the accepted `DERIVED_INFERENCE` / `DISCOVERY_CANDIDATE` authority and edge semantic classifications.

A relation hypothesis may be drawn as a candidate edge only in the overlay. A potential conflict may be shown as an explicit derived/conflict candidate overlay, not as a Canonical Conflict. All such overlays remain visually/semantically distinguishable from Canonical relations/conflicts. List/table fallback carries the same authority labels and evidence links; the canvas is never the only usable surface.

### 5. Review deep link, not Review duplication

Only review-eligible resources created by AKP-5 deep-link into the existing Review context. Raw/validating/stale findings can remain visible in Discovery but cannot masquerade as approvable Review items. Discovery UI may summarize Review state but does not own approval state.

### 6. Activity integration

Add Discovery as an adapter/domain source to the existing Activity projection rather than inventing a second operational timeline. Show current Discovery Job/Run/Attempt/Stage state, failure/retry/waiting/partial status, projection-wait reason/deadline, budget/truncation summary and links back to findings.

Activity observations never override the authoritative Discovery Job snapshot.

### 7. Attention/noise policy

Not every finding becomes a global Attention item or notification. Attention is created only when policy says the owner has a concrete review/investigation decision worth surfacing, considering priority, risk, freshness, material change and suppression state.

Batch/grouping is preferred for low/medium priority findings. The Product avoids repeated toasts or live announcements for background Discovery noise.

Mandatory conflict/safety/policy findings defined as non-suppressible by AKP-7 may still surface through dedicated Review/Attention behavior even when ordinary similar findings are suppressed.

### 8. Readiness/degraded state

The Workspace shows whether a result set is current, stale, partial/truncated, waiting for semantic capability, validating, review-ready or running deterministic fallback. A degraded semantic/AI subsystem must be explained without making healthy Canonical/lexical knowledge appear unavailable.

### 9. Accessibility and interaction stability

Discovery list/detail and Graph overlay are keyboard operable, text-labeled and non-color-only. Polling/refresh preserves focus/selection where possible and does not repeatedly announce non-actionable background changes.

### 10. Server authority and cache isolation

All Product reads/writes are server-bound to the effective project/principal/access revision. Browser candidate IDs, project IDs, ranking weights, model IDs or suppression scope are not authority. Client caches are project scoped and invalidated on project/session/access boundary changes.

## Consequences

- The user can perceive and govern active knowledge behavior without reading backend APIs.
- Automatic validation/re-entry remains visible without making the user the trigger for epistemic processing.
- Existing Graph, Review and Activity investments are reused.
- Discovery requires new Product read projections/endpoints and UI state but not new authority systems.
- Noise control and mandatory-risk visibility become explicit Product responsibilities.

## Rejected alternatives

- Backend-only Discovery as v1 completion.
- Require the user to click “send to validation” for every eligible finding.
- Canvas-only candidate visualization.
- Render a possible relation/conflict using the same semantics/style as Canonical authority.
- One-click Canonical approval from a finding card.
- Treat a raw unvalidated finding as Review-ready.
- A separate Discovery Review/Activity implementation.
- Notify the user about every generated finding.