# Snapshot — Frontend Phase 1–2 Cross-Phase Integration

- Canonical: [Frontend Phase 1–2 Cross-Phase Integration 결정문](https://app.notion.com/p/3a65181d71ad81e28b9cfb13f322e983)
- Fetched: 2026-07-24T03:11:07.988Z
- Export scope: Section 2-relevant visible excerpt

## Project and command boundaries

- Active, Resource, Draft, and Effective Project contexts are distinct.
- Existing Resource actions bind to the Resource Project and do not switch the active Project.
- Connectivity, authentication, session, and backend readiness are separate state axes.
- Protected Sources, Ask, Preview, Citation, Export, Feedback, and Knowledge Transition routes share an authentication boundary.
- Every write uses CSRF, idempotency, typed preconditions, Project context, and `OUTCOME_UNKNOWN` handling.
- Async resources use snapshots as authority; SSE is only a live-update mechanism.

## Contract Normalization Section 3

- Product API writes use a versioned `FrontendCommandRequest`.
- The server transforms a validated browser request into its authoritative internal command envelope.
- Browser request fields are envelope version, command type/schema version, client request and idempotency keys, Project context, policy binding, preconditions, correlation context, issue time, and typed payload.
- Server receipt/outcome owns `commandId`, accepted Principal/Project/Policy context, semantic digest, and correlation/causation/trace identifiers.
- The server atomically validates revision, digest, Project, and policy preconditions.
- `OUTCOME_UNKNOWN` is resolved through the existing command, dedup ledger, or expected domain resource. A new-key automatic retry is prohibited.

## Superseding clarifications

- Ask uses server `defaultAskMode`; `CANONICAL_MODE` is fallback.
- Initial Settings drafts are excluded from Home Continue Working and route-outside restore.
- `ResourceSnapshot` is the common upper term; the authoritative Answer Run snapshot is `AskAnswerRunSnapshot`.
- Historical “Frontend Sections 1–3” and “Frontend Section 2-x/3-x” references must be normalized to phase-qualified names.
- Ask completion wording is “Frontend Phase 2 Section 2 — Ask·Conversations Workspace 완료”.
