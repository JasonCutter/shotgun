# Frontend Phase 2 Section 2 Contract Snapshot

- Snapshot ID: `frontend-phase-2-section-2-contract-snapshot-260731001`
- Date: 2026-07-31
- Status: **HISTORICAL CANDIDATE SNAPSHOT — AC DEFINITIONS PRESERVED**
- ADR: ADR-123 Accepted on 2026-08-01
- Slices 4–5 successor contract: `frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md`

This document preserves the original AC-01 through AC-24 meanings used for Slices 1–3 and the remaining Section 2 work. It is not deleted or silently rewritten. ADR-123 and the approved Slices 4–5 Frozen Implementation Contract add concrete Write and Persistence implementation gates without renumbering or changing these acceptance criteria.

## Candidate Acceptance Criteria

- AC-01 Protected, versioned Ask Product API and runtime decoders.
- AC-02 Principal, Session, Project, capability, sensitivity, and policy authority are server-derived.
- AC-03 New questions bind to Active Project; follow-ups bind to Conversation Resource Project.
- AC-04 Conversation, Branch, Turn, and AnswerRun identities are separate and revisioned.
- AC-05 Browser question drafts are private and not persisted as Canonical or Evidence.
- AC-06 Server provides default Ask mode, available modes, and fallback reason.
- AC-07 Question validation is bounded and fail-closed.
- AC-08 Source exploration requires SourceVersion pinning; Evidence selection is optional.
- AC-09 `AskAnswerRunSnapshot` is the authoritative run state.
- AC-10 Streaming and partial results do not replace the authoritative snapshot.
- AC-11 Cancel is distinct from rollback.
- AC-12 Retry distinguishes accepted-context and current-policy execution.
- AC-13 `OUTCOME_UNKNOWN` never causes automatic resubmission.
- AC-14 Idempotency replay returns the original accepted command or run.
- AC-15 Citations pin SourceVersion and Evidence identities.
- AC-16 Citation return restores Conversation, Branch, Turn, result revision, scroll, and focus.
- AC-17 Model identity and cost are disclosed when available.
- AC-18 Conversation listing and search are bounded and Project-scoped.
- AC-19 Project switch and cache invalidation do not leak or move Conversations.
- AC-20 Offline and stale states fail closed for writes.
- AC-21 Export and feedback preserve resource identity.
- AC-22 Ask re-enters Sources only through `IntakeDraftSeed`.
- AC-23 Canonical change candidates use `DraftChangeSetSeed`; directives use `UserDirectiveProposalSeed`.
- AC-24 Accessibility, responsive UI, performance, Contract, integration, and E2E gates pass before completion.

## Historical implementation status at snapshot creation

As recorded on 2026-07-31: AC-05 contract and Browser draft shell were IN PROGRESS. AC-01 decoder foundation was IN PROGRESS. Remaining criteria were NOT RUN. No criterion was marked PASS by this snapshot.

## Later governance status

- Slices 1–3 were separately verified, user-approved and merged through PR #47.
- ADR-123 was accepted on 2026-08-01.
- Slices 4–5 implementation gates were approved and frozen in `frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md`.
- The reviewed Slices 4–5 candidate at `8c8cdc542e3c598d10fd62aaa2e10f2ed28a01b1` remains blocked pending architecture remediation.
- This status does not declare Section 2 complete.
