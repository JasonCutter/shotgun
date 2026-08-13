# A9 DeepSeek Test Connection Evidence Candidate — 2026-08-14

## Scope and status

This record captures the **one bounded DeepSeek Test Connection** authorized by the user after the historical Test Connection record was found unrecoverable. It is a non-secret evidence candidate for A9-AC02 / P-AC07. It does not authorize Ready for Review, merge, deployment, production verification, a provider approval, a configuration save, a paid Ask, or any retry.

| Field                                                     | Value                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence class                                            | `GATE_RECORD`                                                                                                                            |
| Status authority                                          | `A9_AC02_PAC07_TEST_CONNECTION_EVIDENCE_CANDIDATE`                                                                                       |
| Authorized operation                                      | Exactly one DeepSeek Test Connection                                                                                                     |
| Product context                                           | Local Shotgun Product; Project `JasonNote` (`abbde1df-e128-4076-8ed8-cf990942aad4`)                                                      |
| Provider / model                                          | `deepseek` / `deepseek-v4-flash`                                                                                                         |
| Credential state                                          | Configured revision `1`                                                                                                                  |
| AI configuration revision                                 | `1`                                                                                                                                      |
| Local runtime head                                        | `bf00d53a62032f59311d99d665694e6a3331b4cb`                                                                                               |
| PR #112 canonical base                                    | `f07527761c563120a0be41090b6860da0f81dd0c`                                                                                               |
| Test Connection path drift, runtime head → canonical base | None; the only changed files were `modules/frontend-ask-execution/src/index.ts` and `tests/unit/frontend-ask-execution-identity.test.ts` |
| Current evidence PR                                       | [#112](https://github.com/JasonCutter/shotgun/pull/112), Draft                                                                           |
| Deterministic-evidence exact head preceding this record   | `3c4ca2bb944b9bc599d6c3bd3afae095bc591683`                                                                                               |
| Exact-head CI preceding this record                       | [31728014863](https://github.com/JasonCutter/shotgun/actions/runs/31728014863): Quality, Frontend, and Required Gates SUCCESS            |

## Observed result

The local Product AI settings screen showed the configured DeepSeek provider and `deepseek-v4-flash` model. Before the action, the current UI session showed that no connection result had yet been recorded. The authorized Test Connection control was clicked once. The resulting Product UI showed **`Last Test Connection: Connected`** and **`Provider connection succeeded.`**

The user-facing success result, configured credential revision, configuration revision, provider, and model are the only captured result fields. No secret, encrypted envelope component, authorization material, raw provider response, provider request identifier, or request payload was read, copied, logged, or recorded.

## Bounded-operation ledger

| Operation                                             | Result                  |
| ----------------------------------------------------- | ----------------------- |
| DeepSeek Test Connection                              | EXECUTED ONCE — SUCCESS |
| AI configuration save                                 | NOT EXECUTED            |
| Credential write, replacement, revocation, or removal | NOT EXECUTED            |
| Provider approval request                             | NOT EXECUTED            |
| Paid Ask                                              | NOT EXECUTED            |
| Retry                                                 | NOT EXECUTED            |
| Private or restricted context transfer                | NOT EXECUTED            |
| Deployment / Production Verification                  | NOT STARTED             |

## Canonicalization limits

The Product Test Connection result is an ephemeral response; the backend returns its non-secret result and does not persist a historical success record. This document therefore preserves the one-time non-secret observation, the authorization boundary, the runtime identity, and the equivalent Test Connection path check against the PR #112 canonical base.

This evidence closes only the historical **Test Connection evidence availability** gap as a candidate. It does **not** declare A9 complete. PR #112 remains Draft, and Ready for Review or merge require separate user authorization.

## Non-secret handling

No API key, credential plaintext, credential identifier beyond the configured revision, ciphertext, nonce, authentication tag, authorization header/value, provider request identifier, raw provider response, question, source text, evidence text, or restricted/private payload appears in this record.
