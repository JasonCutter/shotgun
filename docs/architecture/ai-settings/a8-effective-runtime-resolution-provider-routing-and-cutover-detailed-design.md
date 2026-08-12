# A8 Detailed Design — Effective Runtime Resolution, Provider Routing & Ask Cutover

- Status: **FROZEN / ACCEPTED BY USER**
- Parent: ADR-143
- Depends on: A7 completion
- Initial default/live verification provider: `deepseek`
- Required operational providers: `deepseek`, `openai`, `google-gemini`

## 1. Objective

A8 replaces startup-fixed Ask provider authority with request-time Project-managed resolution while preserving existing Ask context, grounding, privacy, retry and durable worker semantics. This is the only Section that performs the runtime cutover.

## 2. EffectiveAIConfigurationResolver authority

The resolver is the only authority for effective provider/model/credential selection for Project-managed new executions.

Logical input:

```text
principalId
projectId
answerRunId
authorized context/sensitivity
execution kind: INITIAL | RETRY_SAME_CONTEXT | RETRY_CURRENT_POLICY
existing AIExecutionPin? (retry only)
```

Logical output for a new execution:

```text
EffectiveAIConfiguration
projectId
provider descriptor
model descriptor
aiConfigurationRevision
credentialId
credentialRevision
providerPolicyFingerprint
privacy/deployment eligibility
adapter route identity
```

The output contains no secret material.

## 3. New-execution resolution order

For a `PROJECT_MANAGED` Project:

```text
1. authenticate Principal and derive target/resource Project authority
2. resolve authorized Ask context and effective sensitivity
3. read exact current ProjectAIConfiguration revision
4. validate provider against A3 registry
5. validate model belongs to provider and is enabled
6. validate exact credential metadata belongs to same Project/provider/revision and is active
7. evaluate A4 provider-specific privacy + deployment eligibility
8. persist A5 immutable AIExecutionPin
9. enter A2 CredentialVault bounded callback for the exact credential revision
10. select adapter through registry-backed router
11. execute through existing structured Ask provider/validation/grounding contract
```

No provider network call may occur before steps 1–8 succeed.

## 4. Fresh Project behavior

A fresh Project with no managed configuration does not silently run DeepSeek or fabricate a credential merely because DeepSeek is the Product default selection.

Runtime result:

```text
CONFIGURATION_REQUIRED / AI_CAPABILITY_UNAVAILABLE
```

The Product directs the user to `/settings/ai`.

DeepSeek becomes the default actual provider only after the user provides an eligible credential and saves the DeepSeek Project configuration, unless the Project is an existing legacy Gemini compatibility Project as defined below.

## 5. Existing Project compatibility mode

A Project with no explicit AI configuration history may be classified as:

```text
LEGACY_GEMINI_COMPATIBILITY
```

only if the ADR-133 compatibility prerequisites are satisfied.

Compatibility behavior:

- provider identity is `google-gemini` only;
- model/credential comes from the bounded legacy compatibility rules, not Browser input;
- provider-specific privacy compatibility remains A4 authority;
- no OpenAI/DeepSeek legacy fallback exists;
- the compatibility path is read-only from the Project AI configuration perspective.

The first successful explicit Project AI configuration save changes mode permanently to:

```text
PROJECT_MANAGED
```

After transition, runtime never chooses provider/model from legacy startup defaults and never resurrects `GEMINI_API_KEY` after explicit managed removal.

## 6. Provider router

Logical contract:

```text
AIProviderRouter.resolve(providerId) -> provider adapter factory/route
```

Rules:

- only A3-registered/enabled provider IDs route;
- routes exist for DeepSeek, OpenAI and Google Gemini;
- adapter construction receives model/capability descriptors from server authority;
- credential bytes enter only through the A2 bounded callback;
- unknown/disabled provider fails closed;
- router does not inspect Browser payloads to choose provider.

## 7. Vault-to-provider invocation

Preferred runtime flow:

```text
credentialVault.withCredential({
  projectId,
  providerId,
  credentialId,
  credentialRevision
}, secret => router.execute({ providerId, modelId, secret, request }))
```

Exact API shape may differ, but the following are invariant:

- exact revision revalidated immediately before provider invocation;
- no long-lived global decrypted credential;
- no secret stored in execution pin/attempt audit/log/error;
- provider client lifetime is bounded to the execution/session contract;
- adapter result is normalized into existing Ask structured result types.

## 8. Ask integration

The existing `AskAnswerExecutionService` currently owns context resolution, provider policy evaluation, attempt audit, streaming/partial handling, completion/failure, retry and worker recovery. A8 modifies it through dependency inversion rather than replacing it wholesale.

Target composition:

```text
AskAnswerExecutionService
  -> EffectiveAIConfigurationResolver
  -> A5 execution pin/retry identity
  -> provider-aware policy resolver
  -> RoutedAskAnswerProvider / provider router
```

The current startup-fixed provider instance is removed as the authority for Project-managed execution.

Existing `NO_SUPPORTED_ANSWER`, citation validation, SourceVersion/Evidence semantics, cancellation, lease, partial streaming and durable recovery remain intact.

## 9. Settings change semantics

Example:

```text
Run A starts with DeepSeek / config rev 4 / credential rev 2

user saves OpenAI / config rev 5 / credential rev 1

Run A continues DeepSeek / rev 4 / cred rev 2
new Run B resolves OpenAI / rev 5 / cred rev 1
```

No process restart occurs.

Changing a key for the same provider similarly creates a new credential/configuration revision used only by subsequent new executions.

## 10. Retry integration

### RETRY_SAME_CONTEXT

A8 reads the A5 original pin and does not read current AI configuration as replacement identity. It revalidates:

- exact pinned credential revision still executable;
- exact provider/model still registered enough to reproduce execution identity;
- original context digest/source identity still valid;
- policy conditions required by ADR-133.

If exact credential is unavailable, fail closed. No latest key/provider/model substitution.

### RETRY_CURRENT_POLICY

Uses the same A5 original provider/model/config/credential pin. Reevaluate A4 current privacy/deployment eligibility only. Current Settings provider/model/key remain irrelevant to retry identity.

## 11. Provider-specific privacy enforcement

A4 eligibility is evaluated against the selected pinned provider, not a global Gemini flag.

- restricted -> always deny before provider callback;
- private -> deployment ceiling for exact provider AND Project/provider approval required;
- public/internal -> existing provider data-policy contract applies.

Provider policy fingerprint persisted in A5 attempt audit must identify the effective provider-specific decision.

## 12. Startup behavior after cutover

`GEMINI_API_KEY` is no longer required for the whole non-recovery application to start.

Missing AI credentials/configuration affect AI capability only:

```text
AI_CAPABILITY_UNAVAILABLE / CONFIGURATION_REQUIRED
```

Non-AI Product functionality remains available.

Startup may construct registry/router/vault/configuration services without resolving any plaintext provider key.

## 13. Provider error normalization

A8 consumes normalized A6 adapter errors and persists existing Ask failure/outcome states correctly.

Required semantics:

- authentication failure is terminal `AUTHENTICATION_FAILED`, not `OUTCOME_UNKNOWN`;
- Shotgun privacy/policy denial is `POLICY_DENIED`;
- rate limit/timeouts/retryable dependency/validation errors preserve their retryable contract;
- `OUTCOME_UNKNOWN` is reserved for genuinely indeterminate provider operation outcome.

Existing retry capability presentation must reflect these codes without changing provider identity semantics.

## 14. Recovery behavior

On process restart or worker lease recovery:

- claimed/recovered AnswerRun reads the existing A5 pin;
- current Settings are not resolved as a new identity;
- exact credential revision is revalidated before resumed/retried external invocation as appropriate;
- no duplicate logical provider call is intentionally issued where existing recovery state already indicates a completed provider outcome;
- genuinely uncertain prior provider outcome remains governed by existing `OUTCOME_UNKNOWN` recovery semantics.

## 15. Observability and non-secret audit

Allowed audit fields:

```text
providerId
modelId
aiConfigurationRevision
credentialId
credentialRevision
providerPolicyFingerprint
providerResponseId (when safe)
usage
failure taxonomy
```

Forbidden:

- API key plaintext;
- encrypted credential envelope;
- provider authorization headers;
- raw secret-bearing request objects.

## 16. Explicit exclusions

A8 does not:

- redesign `/settings/ai` UI;
- create new Provider approval semantics;
- change Canonical knowledge authority;
- enable restricted external transfer;
- implement AKP;
- perform deployment/production verification.

## 17. Acceptance criteria

- A8-AC01: `EffectiveAIConfigurationResolver` is the sole Project-managed provider/model/credential selection authority.
- A8-AC02: new execution resolves exact current Project configuration at request/claim execution time and pins it before provider invocation.
- A8-AC03: fresh unconfigured Project fails with configuration-required AI state rather than fabricating DeepSeek credentials.
- A8-AC04: valid saved DeepSeek configuration routes to DeepSeek without restart.
- A8-AC05: valid saved OpenAI configuration routes to OpenAI without restart.
- A8-AC06: valid saved Gemini configuration routes to Gemini without restart.
- A8-AC07: changing Settings never mutates an in-flight AnswerRun pin.
- A8-AC08: retry uses original A5 identity and never current provider/model/key as substitute.
- A8-AC09: exact revoked/removed credential fails closed.
- A8-AC10: provider-specific A4 privacy/deployment decision occurs before secret callback/provider egress.
- A8-AC11: legacy Gemini compatibility is bounded and permanently disabled after first managed config save.
- A8-AC12: `GEMINI_API_KEY` is no longer whole-app startup-required after cutover.
- A8-AC13: provider adapter errors map deterministically and definite auth failures are not unknown outcome.
- A8-AC14: SourceVersion/Evidence/citation/grounding/worker/recovery semantics regressions are absent.
- A8-AC15: no secret material appears in execution/audit/logging.

## 18. Focused verification

- resolver ordering and authority tests;
- DeepSeek/OpenAI/Gemini routing contract tests;
- restart-free provider switch tests;
- in-flight run immutability after Settings change;
- retry same-context/current-policy identity tests;
- revoked exact credential negative test;
- private/restricted egress gate before provider call;
- legacy -> Project-managed one-way transition;
- startup with no `GEMINI_API_KEY` and unavailable AI but healthy non-AI app;
- worker recovery retains pin;
- secret leakage negative tests.

Actual external provider live verification is minimized; DeepSeek is the primary live path and broader live calls are used only when required to prove implementation-specific risk.

## 19. Exit condition

A8 is complete after implementation merge and successful automatic post-merge `main` CI. Only then may A9 whole-flow closure begin.
