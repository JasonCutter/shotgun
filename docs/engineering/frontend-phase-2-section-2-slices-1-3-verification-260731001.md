# Frontend Phase 2 Section 2 — Slices 1–3 Verification Candidate

- Document ID: `frontend-phase-2-section-2-slices-1-3-verification-260731001`
- Date: 2026-07-31
- Status: `VERIFIED CANDIDATE / READY FOR USER REVIEW`
- Pull Request: `#47`
- Branch: `codex/frontend-phase-2-section-2`
- Base: `main@3e342d57df1b078fa50fe8c085a42ce3f6e4dfa3`
- Verified implementation Head: `0c231cf24b5b645bc9a8d5677724b83581a8ff0e`
- Verified CI Run: `30630450428`

This document is Candidate evidence. It does not authorize PR Ready, merge, Section completion, Database Migration, a new Runtime Dependency, or the implementation of Slices 4 and later.

## 1. Verified Scope

Slices 1–3 implement and verify the read-only Ask and Conversations foundation:

1. bounded Ask contracts and runtime decoders;
2. protected server-authoritative Ask Product read APIs;
3. Active Project and Conversation Resource Project binding;
4. Browser-private, Project-fixed question drafts;
5. `/ask` and Conversation deep-link routing;
6. inaccessible-resource `NOT_FOUND` masking;
7. SourceVersion- and Evidence-pinned citations;
8. validated Citation return context with Conversation, Branch, Turn, AnswerRun, revision, scroll and focus restoration;
9. read-only capability presentation with `capabilities: []` while the Write boundary is unavailable.

No Submit Question execution, external AI execution, persistence, streaming, cancellation, retry, export, feedback, or seed generation is activated by this candidate.

## 2. Corrections Completed

The interrupted supplement work was completed with the following corrections:

- replaced ambiguous Playwright locators with role- and region-scoped locators;
- split Ask Browser verification into five explicit E2E scenarios;
- introduced real Project A, accessible non-active Project B, and inaccessible Project C fixtures;
- added a real Project B Conversation, Branch, Turn, AnswerRun, Citation, pinned SourceVersion and Evidence fixture;
- verified that an accessible Resource Project deep link does not change the Shell Active Project;
- verified that an inaccessible Conversation is masked as `NOT_FOUND`;
- added a strict discriminated Conversation Citation return contract and runtime decoders;
- rejected incomplete, unknown-field, route-mismatched, identity-mismatched and arbitrary-DOM-target return payloads;
- cleared stale Ask Workspace and draft state while Project or Conversation context reloads;
- enabled drafts only after the Server-returned Workspace Project is confirmed;
- validated return state against the current Conversation tree and revisions before scrolling or focusing;
- verified API response identity against requested Conversation, Branch and AnswerRun identifiers;
- added strict Workspace summary Project and submission envelope Project/Conversation invariant decoders;
- kept the Submit capability and button inactive in Slices 1–3.

## 3. Exact-Head CI Evidence

CI Run `30630450428` for Head `0c231cf24b5b645bc9a8d5677724b83581a8ff0e` completed successfully.

| Gate                               | Result       |
| ---------------------------------- | ------------ |
| Knowledge Flow generated baseline  | PASS         |
| Documentation governance           | PASS         |
| Formatting                         | PASS         |
| Lint                               | PASS         |
| Root Typecheck                     | PASS         |
| Dependency Audit                   | PASS         |
| SBOM generation and validation     | PASS         |
| Database Reset                     | PASS         |
| Stage 12 reuse and operations gate | PASS         |
| Full CI test suite                 | PASS         |
| Database Suite                     | PASS         |
| Frontend Typecheck                 | PASS         |
| Frontend Unit Tests                | PASS         |
| Frontend Production Build          | PASS         |
| Chromium E2E                       | PASS — 21/21 |
| Required Gates                     | PASS         |

## 4. Acceptance Criteria Candidate Matrix

The meanings below remain exactly those in `frontend-phase-2-section-2-contract-snapshot-260731001.md`. This document does not redefine the criteria.

| AC                                                                                | Candidate status | Evidence boundary                                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 Protected, versioned Ask Product API and runtime decoders                   | PASS             | Protected read routes, bounded decoders, strict identity and cross-resource invariant validation.                                                          |
| AC-02 Server-derived authority                                                    | PASS             | Principal, Session, Active/accessible Projects and policy context originate from Server scope; inaccessible resources are masked.                          |
| AC-03 Active Project and Conversation Resource Project binding                    | PASS             | New `/ask` uses Active Project; deep-linked follow-up Workspace uses Server-resolved Resource Project without switching Active Project.                    |
| AC-04 Separate and revisioned Conversation, Branch, Turn and AnswerRun identities | PASS             | Separate identities and revisions are decoded and cross-validated in read projections.                                                                     |
| AC-05 Browser-private question drafts                                             | PASS             | Draft remains Browser-only, Project-fixed, leave-guarded and cleared across confirmed context changes.                                                     |
| AC-06 Ask mode and fallback projection                                            | PASS             | Server supplies default and available modes; the default must belong to the available set. Write execution remains inactive.                               |
| AC-07 Bounded and fail-closed question validation                                 | PASS             | Question, identifiers, arrays, timestamps, enums and unknown fields are bounded or rejected.                                                               |
| AC-08 Source exploration SourceVersion pinning                                    | PASS             | Citation and source-selection contracts pin SourceVersion; Browser round trip verifies the pinned version.                                                 |
| AC-09 Authoritative `AskAnswerRunSnapshot`                                        | PARTIAL          | Authoritative read snapshot contract and projection exist; actual Answer execution lifecycle is not implemented.                                           |
| AC-10 Streaming and partial result boundary                                       | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-11 Cancel distinct from rollback                                               | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-12 Accepted-context and current-policy Retry                                   | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-13 `OUTCOME_UNKNOWN` no automatic resubmission                                 | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-14 Idempotency replay                                                          | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-15 Citation SourceVersion and Evidence identity pinning                        | PASS             | Citation contracts and Browser fixture preserve SourceVersion and Evidence identities.                                                                     |
| AC-16 Citation return restoration                                                 | PASS             | Real Browser round trip restores the exact Conversation, Branch, Turn, AnswerRun revision, Citation, scroll and focus context.                             |
| AC-17 Model identity and cost disclosure                                          | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-18 Bounded Project-scoped Conversation listing and search                      | PASS             | Read listing is bounded and projected only for the selected Workspace Project. Search execution beyond current read foundation remains outside this slice. |
| AC-19 Project switch and cache isolation                                          | PASS             | Project switching is leave-guarded; drafts and projections are not moved across Projects; Resource deep links do not mutate Active Project.                |
| AC-20 Offline and stale write safety                                              | PARTIAL          | Write capabilities remain absent and stale Workspace input is disabled; the future Write pipeline is not implemented.                                      |
| AC-21 Export and feedback identity                                                | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-22 `IntakeDraftSeed` re-entry                                                  | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-23 `DraftChangeSetSeed` and `UserDirectiveProposalSeed`                        | NOT_RUN          | Slices 4+.                                                                                                                                                 |
| AC-24 Accessibility, responsive, performance and completion gates                 | PARTIAL          | Current unit, build, Chromium and required gates pass; full Section scope and completion evidence remain outstanding.                                      |

Summary:

- PASS: AC-01–AC-08, AC-15, AC-16, AC-18, AC-19
- PARTIAL: AC-09, AC-20, AC-24
- NOT_RUN: AC-10–AC-14, AC-17, AC-21–AC-23
- FAIL: none
- BLOCKED: none

## 5. Migration and Dependency Impact

- Database Migration: `ZERO / NOT REQUIRED FOR SLICES 1–3`
- New Runtime Dependency: `ZERO / NOT ADDED`
- Existing Node, React, Fastify, Contract and test infrastructure was reused.

## 6. Remaining Section 2 Scope

The following remain outside this verified candidate:

- protected Submit Question Command;
- Conversation, Branch, Turn and AnswerRun persistence;
- external model execution;
- streaming and partial result recovery;
- Cancel, Retry and `OUTCOME_UNKNOWN` recovery;
- Command idempotency replay;
- model identity and cost disclosure;
- export and feedback;
- `IntakeDraftSeed`, `DraftChangeSetSeed` and `UserDirectiveProposalSeed`;
- final accessibility, responsive, performance and completion evidence.

## 7. Governance Boundary

PR #47 must remain Draft. This candidate does not authorize:

- Database Migration creation or execution;
- a new Runtime Dependency;
- PR Ready transition;
- merge to `main`;
- Frontend Phase 2 Section 2 completion;
- Frontend Phase 2 Section 3 start.
