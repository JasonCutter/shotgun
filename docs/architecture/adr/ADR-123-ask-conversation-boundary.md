# ADR-123 — Ask Conversation Boundary

- Status: PROPOSED IN DRAFT PR
- Date: 2026-07-31
- Base: `main@3e342d57df1b078fa50fe8c085a42ce3f6e4dfa3`

## Decision candidate

- Independent questions bind to the server Active Project.
- Follow-up questions remain bound to the Conversation Resource Project.
- Conversation, Branch, Turn, and AnswerRun have separate identities and revisions.
- `AskAnswerRunSnapshot` is authoritative; streaming is transport only.
- Source exploration pins SourceVersion. Citations pin SourceVersion and Evidence.
- Browser question text remains a private draft until command acceptance.
- `OUTCOME_UNKNOWN` never triggers automatic resubmission.
- AI answers are not original Evidence and do not become Canonical automatically.
- Ask emits typed transition seeds rather than writing Sources or Canonical Knowledge directly.

## Current slice

Typed contracts, decoder tests, a read client, and a Browser-only question draft shell are being added. Persistence, command activation, streaming, cancel, retry, and transition execution remain pending.

No Database Migration or new Runtime Dependency is included. This ADR remains Candidate until later approval and merge.
