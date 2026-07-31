# Frontend Phase 2 Section 2 Contract Snapshot

- Snapshot ID: `frontend-phase-2-section-2-contract-snapshot-260731001`
- Date: 2026-07-31
- Status: CANDIDATE IN DRAFT PR
- ADR: ADR-123 Proposed

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

## Current implementation status

AC-05 contract and Browser draft shell: IN PROGRESS. AC-01 decoder foundation: IN PROGRESS. Remaining criteria: NOT RUN. No criterion is marked PASS by this snapshot.
