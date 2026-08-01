# Frontend Phase 2 Section 2 I03 Implementation Contract

Status: `APPROVED_FOR_IMPLEMENTATION`
Approval date: 2026-08-01
Work item: `FE-P2-S2-I03`
Governing snapshot: `frontend-phase-2-section-2-contract-snapshot-260731001.md`

This document records the implementation boundary approved for I03. It is not a
completion record. I03 is complete only when the Section 2 completion manifest and
all Definition of Done gates have current evidence.

## Scope

I03 implements the remaining Answer Execution contract for the Ask product:

- server-authoritative AnswerRun execution behind an `AskAnswerProviderPort`;
- durable attempt and event history for queued, running, partial, terminal, and
  outcome-unknown states;
- replayable partial answer events without treating partial output as an
  authoritative final answer;
- explicit cancel, `RETRY_SAME_CONTEXT`, and `RETRY_CURRENT_POLICY` commands;
- provider/model/token/cost disclosure when the provider supplies the value;
- export and feedback bound to the original AnswerRun identity;
- explicit `IntakeDraftSeed`, `DraftChangeSetSeed`, and
  `UserDirectiveProposalSeed` transitions.

The server derives the target Project from the AnswerRun and the authenticated
read scope. Browser payloads and headers cannot change principal, Project,
policy, access, or resource ownership. `OUTCOME_UNKNOWN` is terminal for the
current attempt and never causes an automatic provider resubmission.

## Exclusions

- no automatic Canonical Knowledge write, ChangeSet approval, directive
  execution, or external action;
- no browser-side persistence used as execution authority;
- no provider-specific type, database identifier, or raw output exposed as a
  Shotgun canonical contract;
- no Phase 3 implementation;
- no new provider dependency. Existing `@google/genai` remains behind the
  existing structured provider adapter and the new Ask provider port.

## State and event contract

An AnswerRun is authoritative only in its persisted snapshot. Partial events
are append-only and ordered by `(answer_run_id, ordinal)`. A final statement and
its citations are written only after citation validation against the selected
Source, SourceVersion, and Evidence identities. Provider text is not Evidence.

The allowed lifecycle is:

`QUEUED -> RUNNING -> STREAMING -> PARTIAL -> SUCCEEDED`

with explicit terminal branches to `FAILED`, `CANCEL_REQUESTED -> CANCELLED`,
or `OUTCOME_UNKNOWN`. Retry creates a new durable attempt and preserves the
prior attempt/event history. Same-context retry keeps the accepted access and
policy revisions; current-policy retry records the newly accepted revisions.

## Required verification

The implementation must provide evidence for:

1. strict contract decoding and rejection of unknown or authority fields;
2. successful execution and durable partial-event replay;
3. invalid citation fail-closed behavior;
4. cancellation distinct from transaction rollback;
5. both retry modes and no automatic retry after `OUTCOME_UNKNOWN`;
6. export, feedback, and all three transition seeds preserving AnswerRun and
   Project identity without Canonical mutation;
7. idempotency, restart recovery, concurrent lifecycle mutation, and the
   existing Section 2 Slices 1-5 regression suite.

## Migration and rollback

Migration `022_frontend_phase2_ask_execution.sql` is additive. Existing
`ACTION_REQUIRED / MODEL_EXECUTION_NOT_CONFIGURED` rows remain valid and are
not rewritten. Disabling the provider leaves authoritative reads and existing
seed/export/feedback records available. A failed rollout is repaired forward
with additive SQL and a disabled execution capability; no destructive down
migration or deletion of AnswerRun history is allowed.
