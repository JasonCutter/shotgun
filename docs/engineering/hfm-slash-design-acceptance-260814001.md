---
id: HFM-SLASH-DESIGN-ACCEPTANCE-260814001
classification: ACCEPTED
status: DESIGN_FROZEN
accepted_at: 2026-08-14
subject_base: 575b8031b3beccc9fba5541809285c5a29b89d11
repository: JasonCutter/shotgun
canonical_branch: main
governing_adr: ADR-145
implementation_plan: docs/implementation/human-facing-minimalism-slash-command-product-implementation-plan-260814001.md
---

# Shotgun Human-Facing Minimalism + Slash Command — Design Acceptance

## 1. Owner decision

The owner accepted the detailed design and authorized merge of the design package on 2026-08-14.

Accepted scope:

- ADR-145 Human-Facing Minimalism and Slash Command Control Plane;
- the complete implementation program `HFM-S0` through `HFM-S8`;
- explicit start/finish boundary;
- per-section detailed design and completion targets;
- `KEEP / SLASH / REMOVE / CONDITIONAL` disposition model;
- `/` command discovery and on-demand control surface;
- proactive visibility of approval, destructive, privacy, credential, permission, cost, failure, and recovery states;
- removal of internal-only and non-actionable information from normal owner UI;
- Search, locale, Source Detail, Ask hierarchy, persistent navigation, Settings compression, and inactive-placeholder correction within the bounded program;
- targeted verification and no unnecessary duplicate testing.

## 2. ADR identifier correction

The design was initially drafted under `ADR-140`, but canonical documentation already owned that identifier. Exact-head CI documentation validation detected the collision. The accepted HFM decision therefore uses the next free identifier, `ADR-145`.

This is an identifier correction only. It does not change the accepted architecture decision or implementation scope.

Until the implementation plan itself is next amended, any plain-text `ADR-140` reference inside `HFM-SLASH-PLAN-260814001` that refers to Human-Facing Minimalism / Slash Command Control Plane MUST be interpreted as `ADR-145`. The pre-existing canonical `ADR-140` remains unrelated and unchanged.

## 3. Authority transition

This acceptance activates the GitHub implementation plan as the implementation authority for this program.

The temporary Google Drive document `UI개선사항` is now retired from implementation use. It may remain as historical smoke-test evidence, but:

- no implementation requirement is sourced from it after this acceptance;
- no implementation decision is considered accepted merely because it appears there;
- future detailed design changes must be recorded in the GitHub implementation plan, an explicit amendment, ADR, or verification/closure record.

## 4. Section state after design acceptance

```text
ADR-145: ACCEPTED
Implementation plan: DESIGN_FROZEN / AUTHORIZED
HFM-S0: AUTHORIZED / NOT_STARTED
HFM-S1..HFM-S8: NOT_STARTED
Product implementation: NOT_STARTED
```

Design acceptance does not claim that the HFM-S0 inventory work has already been executed. HFM-S0 remains the first implementation gate.

## 5. Implementation order

Implementation proceeds in the frozen order:

```text
HFM-S0 → HFM-S1 → HFM-S2 → HFM-S3 → HFM-S4 → HFM-S5 → HFM-S6 → HFM-S7 → HFM-S8
```

A later section does not silently absorb unfinished required work from an earlier section.

## 6. Completion authority

The program is not COMPLETE until the final contract in `HFM-SLASH-PLAN-260814001` is satisfied, including implementation, targeted runtime verification, exact-head required CI, merge to canonical `main`, post-merge CI, and final closure with `FINAL_AFTER_MERGE` authority.

## 7. Merge authorization

This design package is authorized to merge to `main`, subject only to repository mergeability and automatically required exact-head checks. No Product implementation is included in this design PR.
