---
id: FRONTEND-PHASE-5-SECTION-1-CONTRACT-AMENDMENT-260913001
classification: CANDIDATE
status: proposed_pending_user_approval
revision: 2
created_at: 2026-09-13
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
base_snapshot: frontend-phase-5-section-1-contract-snapshot-260806001
governing_adr: ADR-130
tracking_pr: https://github.com/JasonCutter/shotgun/pull/283
---

# FE-P5-S1 — Activity Presentation Additive Contract Amendment (Proposal)

This document records the additive contract clarification required by the
Home Attention / Activity deep-link implementation. The approved r1 snapshot
at `frontend-phase-5-section-1-contract-snapshot-260806001.md` remains
immutable and authoritative for every unamended clause.

## 1. Proposed additive fields and semantics

### Activity attention reason

`ActivityDimensionsV1` may carry an optional display-safe `attentionReason`
owned by the owning Domain. It is explanatory presentation data only: it does
not grant authority, change lifecycle state, or replace the concrete Domain
resource identity. Existing acceptance criteria and the deny-by-default
security boundary remain unchanged.

### Activity temporal observations

For `ActivityRunViewV1`, `ActivityDomainAttemptViewV1` and
`ActivityStageViewV1`:

- `startedAt <= updatedAt` is required;
- when present, `startedAt <= completedAt` is required;
- `updatedAt` and `completedAt` are not ordered relative to one another.

`updatedAt` is an observation/reconciliation timestamp and may legitimately be
later than the owning Domain's terminal `completedAt`. Adapters must preserve
the authoritative `completedAt` value and must not synthesize or overwrite it
with `updatedAt`.

## 2. Scope and preservation

This is an additive presentation clarification only. It does not change:

- lifecycle, retryability, freshness or adapter-status vocabularies;
- Activity execution, approval, action or Canonical-write authority;
- Domain resource identity, persistence ownership or migration requirements;
- any FE-P5-S1 acceptance-criterion number or existing meaning.

The amendment remains a Candidate pending explicit user approval. Once
approved, it must be registered as an additive amendment in
`docs/architecture/contracts/contract-snapshot-registry.json`; until then the
base snapshot and this proposal are both retained without overwrite.
