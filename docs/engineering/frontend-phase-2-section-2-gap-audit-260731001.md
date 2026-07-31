# Frontend Phase 2 Section 2 Gap Audit

- Date: 2026-07-31
- Base: `main@3e342d57df1b078fa50fe8c085a42ce3f6e4dfa3`
- Status: IMPLEMENTATION STARTED

## Existing foundation

Section 1 Sources, Product Session, Route Guard, Leave Guard, SourceVersion, Evidence, and Citation return foundations are merged.

## Missing boundaries

- Conversation, Branch, Turn, and AnswerRun persistence
- protected question command and outcome recovery
- server default Ask mode and fallback
- SourceVersion exploration and Evidence selection
- streaming, partial result, cancel, and retry
- exact citation return restoration
- model and cost disclosure
- export, feedback, and typed transition seeds
- cache isolation, offline, accessibility, performance, and E2E evidence

## Current slice

Typed contracts, decoder tests, a read client, and a Browser-only question draft shell were added. Submission remains disabled until the protected server command exists.

Database Migration, new Runtime Dependency, PR Ready, merge, and Section completion are outside the current authorization.
