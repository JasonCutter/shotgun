# Historical Candidate — Ask Conversation Boundary (Former ADR-123 Draft)

- Original status: `PROPOSED IN DRAFT PR`
- Original date: 2026-07-31
- Original base: `main@3e342d57df1b078fa50fe8c085a42ce3f6e4dfa3`
- Historical source path: `docs/architecture/adr/ADR-123-ask-conversation-boundary.md`
- Disposition: **SUPERSEDED AND PRESERVED AS HISTORY**
- Authoritative successor: `docs/architecture/adr/ADR-123-ask-command-conversation-persistence-and-outcome-recovery-boundary.md`

This file preserves the earlier ADR-123 candidate without retaining a second ADR owner. The accepted ADR-123 expands and replaces this candidate after architecture review identified missing Command Ledger, persistence, revision, outcome recovery, SourceSelection validation, and migration requirements.

## Original decision candidate

- Independent questions bind to the server Active Project.
- Follow-up questions remain bound to the Conversation Resource Project.
- Conversation, Branch, Turn, and AnswerRun have separate identities and revisions.
- `AskAnswerRunSnapshot` is authoritative; streaming is transport only.
- Source exploration pins SourceVersion. Citations pin SourceVersion and Evidence.
- Browser question text remains a private draft until command acceptance.
- `OUTCOME_UNKNOWN` never triggers automatic resubmission.
- AI answers are not original Evidence and do not become Canonical automatically.
- Ask emits typed transition seeds rather than writing Sources or Canonical Knowledge directly.

## Original current-slice note

Typed contracts, decoder tests, a read client, and a Browser-only question draft shell were being added. Persistence, command activation, streaming, cancel, retry, and transition execution remained pending.

No Database Migration or new Runtime Dependency was included in this candidate. It never became the authoritative ADR owner.