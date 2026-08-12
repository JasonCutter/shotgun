# A6 AI Settings Backend and Multi-Provider Connectivity Implementation Record

## Boundary

A6 owns the server-side AI Settings read model, Project AI configuration and
secret-safe credential commands, provider connectivity adapters, normalized
provider errors, and synthetic Test Connection. It does not change the Ask
runtime authority, introduce a Provider Router, add Settings UI, or perform
private Project-data egress.

## OSS integration decisions

The repository's four validated OSS references were reviewed for this slice.
Their runtimes and persistence models do not provide a compatible bounded
credential-vault callback, A3 revisioned configuration authority, or A4
provider-specific approval boundary. They remain `REFERENCE_ONLY`; no OSS
runtime or database schema was imported.

| Candidate             | Decision          | Reason and boundary                                                                                          |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| garrytan/gbrain       | `REFERENCE_ONLY`  | Job/retry and adapter ideas only; its runtime/database cannot own Shotgun credentials or settings authority. |
| lucasastorian/llmwiki | `NO_RELEVANT_OSS` | Conversion/Evidence components are outside A6 connectivity.                                                  |
| ddsyasas/llm-wiki     | `REFERENCE_ONLY`  | Settings UX patterns only; its client/runtime is not the server authority.                                   |
| Inkeep OpenKnowledge  | `REFERENCE_ONLY`  | UI/activity patterns only; no provider credential or policy authority is adopted.                            |

Provider SDK decisions are explicit: the existing pinned `@google/genai`
package is retained behind the Gemini adapter; OpenAI and DeepSeek use their
official HTTPS APIs through injected fetch transports so SDK types cannot leak
into Shotgun contracts. All three adapters are replaceable through
`AIProviderConnectivityAdapter`.

## Official provider verification

Verified 2026-08-12 against official documentation:

- OpenAI `gpt-5.6-luna`: Responses API and structured outputs supported.
- Google Gemini `gemini-3.6-flash`: stable model and Interactions API model;
  structured output is supported.
- DeepSeek `deepseek-v4-flash`: Chat Completions endpoint and JSON output are
  supported.

The frozen A3 catalog identifiers therefore remain unchanged. No silent model
substitution was made.

## Historical DeepSeek worktree

The pre-existing dirty root worktree's DeepSeek adapter and environment-based
runtime selector were inspected. They are useful as Stage 4 transport and
error-mapping reference, but they permanently accept a constructor API key and
select a single process-wide Ask provider. They were not copied into A6. The
root worktree and its change set remain untouched.

## Persistence and rollback

No A6 migration is required. A6 composes the additive A2 credential tables,
A3 configuration tables, A4 approval tables, and existing Settings privacy
read model through their ports. Existing history and audit ownership remain
unchanged. Removing this slice removes the route registration and service
composition; the existing A2-A5 tables remain valid.

## Security and replacement contract

Provider adapters receive a decrypted key only inside the A2 bounded callback.
Draft keys are transient and zeroed after Test Connection. Settings responses,
configuration history, audit payloads, and provider error messages contain no
plaintext or ciphertext. Provider adapters map definite authentication,
rate-limit, dependency, timeout, validation, and terminal outcomes to the
canonical Shotgun taxonomy. A later adapter replacement must pass the same
synthetic Test Connection and secret-non-disclosure contract tests.
