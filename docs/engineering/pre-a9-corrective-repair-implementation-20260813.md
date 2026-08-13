# Pre-A9 Corrective Repair — Implementation Record

- **Status:** Implemented; focused verification pending exact-head CI.
- **Base:** `main@99af6cbfd746e849e1d914d5f1cc17828487971f`
- **Scope:** Pre-A9 repair only. This record does not reopen A1–A8 completion history, start A9, authorize deployment, or constitute production verification.

## Root causes and corrective scope

The OpenAI connectivity adapter treated the convenience SDK-style `output_text` value as if it existed in the raw `/v1/responses` HTTP payload. The adapter now extracts only non-empty `output_text` content parts from the raw response `output[]` message structure for both Test Connection and structured generation, preserving existing error normalization and safe failure behavior.

Credential create and replace previously had no stable client request identity or recoverable non-secret result. The repair adds dedicated request identity metadata to the credential-vault persistence boundary. The metadata is immutable, scoped by Project, and unique when present. It contains only `clientRequestId`; plaintext secrets, ciphertext envelopes, authorization headers, and generic frontend-command payloads remain outside this recovery mechanism. A retry first recovers the credential metadata and never writes another secret merely because the client observed an uncertain outcome.

The Product API and `/settings/ai` now expose the existing A4 `ProviderExternalTransferApprovalService` proposal and Owner approval path. The Product route does not use the generic historical privacy setting as a substitute, and the UI shows provider-specific **Approved**, **Not approved / Rejected**, and **Review required** states. The deployment ceiling and restricted-context hard deny remain server authority.

The settings UI no longer selects a credential by comparing `credentialRevision` across different credential IDs. It uses the exact credential referenced by the authoritative configuration; absent that reference, it accepts only a single unambiguous active candidate. Ambiguous candidate sets are intentionally not selected by the Browser.

The A8-after runtime message now states that a saved configuration applies to the next new AI execution while in-flight AnswerRuns and retry pins retain their original identity. The Test Connection projection now leaves a generic definite `TERMINAL_FAILURE` as `FAILED`, instead of asserting that it is always a model-unavailable condition.

## Frozen architecture and security invariants

This repair retains ADR-133 and ADR-143 authority boundaries. The Browser supplies no provider authority, model authority, credential authority, privacy authority, deployment authority, or retry identity. Provider-specific approval remains Project and provider scoped; historical generic approval remains Gemini-only through the established compatibility interpretation. A provider-specific Gemini approval record does not itself cause a Project to become `PROJECT_MANAGED`; the existing configuration save transition continues to be authoritative.

The repair adds no external OSS dependency. The affected behavior is an existing Shotgun adapter, vault, Product API, and Product UI correction rather than a candidate for external runtime adoption. The decision is therefore `NO_RELEVANT_OSS` for this narrowly corrective scope; existing module/port ownership and replacement boundaries are unchanged.

## Focused verification

The focused regression set covers raw OpenAI Responses parsing for Test Connection and structured generation, non-secret create/replace result recovery, credential-success/configuration-conflict handling, ambiguous multi-credential selection refusal, provider-specific approval Product commands and UI status wording, A4 provider isolation, A8 routing/pinning invariants, credential vault contract behavior, lint, formatting, and TypeScript type checking.

Database-backed credential persistence coverage is included in `tests/database/a2-credential-vault.test.ts` and is guarded by `TEST_DATABASE_URL`. It was not run in this environment because no `TEST_DATABASE_URL` was supplied; `DATABASE_URL` was not used as a fallback.

## Rollback and replacement

The migration is additive: it introduces a nullable, immutable, non-secret `client_request_id` and a partial unique index on the existing credential revision table. Removing the recovery path returns the prior behavior only after a deliberate migration rollback; no credential envelope or provider configuration data is transformed by this repair. The Product API additions are provider-specific review routes layered over the existing A4 authority, so they can be removed without modifying A4 approval history or its database records.
