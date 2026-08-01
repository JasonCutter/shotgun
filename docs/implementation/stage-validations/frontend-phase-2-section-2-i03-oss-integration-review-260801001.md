# Frontend Phase 2 Section 2 I03 OSS Integration Review

Status: `APPROVED_FOR_IMPLEMENTATION`
Review date: 2026-08-01
Target: `FE-P2-S2-I03` / Answer Execution

This is the OSS Integration Gate input for implementation. It does not claim
that the I03 gate or Section 2 is complete.

## Decisions

| Candidate                                                              | Decision         | Version / license                                             | Boundary and reason                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [gbrain](https://github.com/garrytan/gbrain)                           | `REFERENCE_ONLY` | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT              | Use the verified Job, retry, timeout, idempotency, and lock-recovery patterns as review input. Do not install its Runtime or database model; Shotgun owns AnswerRun and Command Ledger identity. |
| [llm-wiki](https://github.com/ddsyasas/llm-wiki)                       | `REFERENCE_ONLY` | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT              | Use Ask/Chat, model, cost, and action-oriented UX patterns. Do not import its backend, SQLite schema, ingestion, query, or LLM client.                                                           |
| [OpenKnowledge](https://github.com/inkeep/open-knowledge)              | `REFERENCE_ONLY` | `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later | Use activity, partial-result, and evidence-grouping design patterns only. No GPL source or runtime is included.                                                                                  |
| [Google Gen AI JavaScript SDK](https://github.com/googleapis/js-genai) | `ADOPT`          | `@google/genai` `2.12.0` / Apache-2.0                         | Existing pinned Gemini adapter remains the only SDK boundary. The Ask module receives the provider-neutral `AskAnswerProviderPort`; no new dependency or direct SDK import is added.             |

## Direct implementation decision

Shotgun directly implements the AnswerRun lifecycle, durable events, citation
validation, export, feedback, and transition seed ports because the reviewed
OSS candidates do not own Shotgun's Canonical/Evidence/Approval boundaries and
cannot be promoted to the common database or command contracts. The replacement
boundary is `AskAnswerExecutionRepositoryPort` plus `AskAnswerProviderPort`.
The in-memory adapter is a test/local adapter; the PostgreSQL adapter owns the
durable production tables. A replacement provider must pass the same provider,
citation, replay, and failure contract tests.

## Migration, security, and maintenance

- Migration is additive `022_frontend_phase2_ask_execution.sql`; recovery is
  forward-only and retains prior events and attempts.
- The provider is denied restricted evidence and must receive only server-loaded
  selected Evidence; provider output is never promoted to Evidence.
- Project and policy revisions are captured on every attempt. Resource Project
  access is resolved from the server-side AnswerRun record.
- Pins and licenses above were taken from the repository OSS registry and must
  be rechecked before any SDK/model upgrade.
