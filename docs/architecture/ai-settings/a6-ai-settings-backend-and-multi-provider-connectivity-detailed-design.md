# A6 Detailed Design — AI Settings Backend Control Plane & Multi-provider Connectivity

- Status: **FROZEN / ACCEPTED BY USER**
- Parent: ADR-143
- Depends on: A5 completion
- Initial default/live verification provider: `deepseek`
- Required operational providers: `deepseek`, `openai`, `google-gemini`
- Does not authorize: Ask runtime cutover

## 1. Objective

A6 builds the complete server-side Product control plane needed by `/settings/ai` and implements operational provider connectivity for DeepSeek, OpenAI and Google Gemini. It deliberately stops before changing the existing Ask runtime to request-time provider routing; that cutover belongs to A8.

## 2. Server-owned AI Settings read model

Canonical read endpoint shape is logically:

```text
GET /api/v1/settings/ai?targetProjectId=...
```

The response is server-derived and contains only non-secret data:

```text
projectId
mode: LEGACY_GEMINI_COMPATIBILITY | PROJECT_MANAGED | UNCONFIGURED
currentConfiguration?: {
  providerId
  modelId
  credentialId
  credentialRevision
  aiConfigurationRevision
  updatedBy
  updatedAt
}
providers: ProviderDescriptor[]
credentials: ProviderCredentialStatus[]
providerPrivacy: ProviderPrivacyStatus[]
deploymentEligibility: ProviderDeploymentStatus[]
defaultProviderId: deepseek
capabilityAvailability
```

Credential status may include `CONFIGURED`, `REVOKED`, `REMOVED`, `UNAVAILABLE`, revision and timestamps. It never includes plaintext, ciphertext or an environment value.

The A3 registry/model catalog remains the authority for provider/model choices. The read model may project it but must not duplicate a browser-owned catalog.

## 3. Secret-safe credential write boundary

Credential writes require dedicated routes/commands that do not persist the secret in the generic frontend command gateway payload.

Logical commands:

```text
POST /api/v1/settings/ai/credentials
POST /api/v1/settings/ai/credentials/:credentialId/replace
POST /api/v1/settings/ai/credentials/:credentialId/revoke
POST /api/v1/settings/ai/credentials/:credentialId/remove
```

Create/replace requests may contain the plaintext API key over the authenticated request transport. Server rules:

1. validate Project membership/management authority before secret handling;
2. validate provider against A3 registry;
3. pass the secret directly into `CredentialVaultPort` bounded creation/replacement logic;
4. do not store the request body, secret or ciphertext in generic command persistence, audit events or application logs;
5. return only credential id/revision/lifecycle/availability metadata;
6. zero/transient secret buffers according to the A2 contract where the implementation has byte-level ownership.

Idempotency must be supported without requiring secret replay storage. Recommended shape: a secret-safe idempotency record stores request identity + resulting credential metadata, never the secret.

## 4. Project AI configuration command

Logical command:

```text
POST /api/v1/settings/ai/configuration
```

Input contains no secret:

```text
projectId (server-targeted/validated)
expectedAiConfigurationRevision
providerId
modelId
credentialId
credentialRevision
```

The server reuses A3 `ProjectAIConfigurationService` validation:

- provider registered and enabled;
- model belongs to provider;
- credential belongs to same Project/provider;
- exact credential revision active/available;
- stale expected revision fails closed.

Save creates a new AI configuration revision and does not delete credentials belonging to another provider.

A fresh Project defaults the UI selection to DeepSeek, but no Project AI configuration is silently created before a valid credential/configuration save.

## 5. Credential + configuration Save orchestration

The Product UI may present one Save action, but the backend authority remains two-step when a new secret is involved:

```text
credential create/replace
-> resulting credential id/revision
-> configuration save with revision precondition
```

If credential persistence succeeds but configuration save conflicts/fails, the credential remains safely stored but inactive unless already referenced by the current configuration. The response must let A7 show this partial outcome clearly. The backend does not roll back by deleting the credential automatically because credential lifecycle/audit is independent authority.

## 6. Provider adapter architecture

All three provider adapters implement one Shotgun provider port with normalized structured-generation and connectivity behavior.

Required adapters:

```text
DeepSeekAIProviderAdapter
OpenAIProviderAdapter
GeminiAIProviderAdapter
```

Provider-specific SDK/client types remain inside adapters. Domain/Ask modules depend only on Shotgun ports/contracts.

The adapter factory/router implementation may be prepared in A6 for connectivity commands, but A6 does not wire it as the Ask runtime authority.

## 7. Vault-to-adapter credential handshake

Provider credentials are supplied through a bounded vault callback/handle:

```text
CredentialVault.withCredential(exact scope/revision, secret =>
  ephemeral provider client/operation(secret)
)
```

Requirements:

- exact Project/provider/credential/revision is specified;
- vault revalidates lifecycle/availability immediately before callback;
- callback scope is bounded to one connectivity/generation operation or one explicitly bounded adapter session;
- plaintext secret is not returned to general application code;
- provider adapter cannot persist secret into shared configuration, singleton state, logs or error payloads;
- callback completion ends plaintext lifetime under Product control.

A singleton adapter that permanently owns a decrypted API key is not the target A6 architecture.

## 8. Test Connection

Logical command:

```text
POST /api/v1/settings/ai/test-connection
```

Supported credential sources:

```text
DRAFT_CREDENTIAL
STORED_CREDENTIAL
```

`DRAFT_CREDENTIAL` is transient and never persisted solely because it was tested. `STORED_CREDENTIAL` resolves an exact active vault revision.

Test payload requirements:

- synthetic/public content only;
- no Source, SourceVersion, Evidence, conversation history or private/restricted Project text;
- minimal provider request sufficient to prove authentication, selected model access and structured-response compatibility;
- no provider response body containing user data is persisted;
- result is a non-secret status record.

Logical result:

```text
providerId
modelId
status: CONNECTED | AUTHENTICATION_FAILED | MODEL_UNAVAILABLE | RATE_LIMITED | TEMPORARILY_UNAVAILABLE | FAILED
checkedAt
safeMessage
providerRequestId? (only if non-secret and policy permits)
```

Test Connection is available for all three operational providers. DeepSeek is the primary live verification provider for this Program.

## 9. Provider model/capability verification gate

Before enabling a registry model for real execution, implementation must verify against the provider's official API/SDK documentation/current capability surface:

- exact model identifier;
- structured output support required by Shotgun;
- streaming behavior if used by Ask;
- authentication method;
- timeout/cancellation capability.

If the current provider no longer supports the ADR-133 catalog identifier/capability, implementation must not silently substitute another model. Return:

```text
BLOCKED — ADR-133 MODEL CATALOG AMENDMENT REQUIRED
```

and amend architecture explicitly.

## 10. Normalized error taxonomy

Provider adapters map definite outcomes to ADR-133:

```text
credential missing / vault unavailable -> CONFIGURATION_REQUIRED | AI_CAPABILITY_UNAVAILABLE
401 or explicit authentication rejection -> AUTHENTICATION_FAILED
403 caused by Shotgun/privacy policy -> POLICY_DENIED
403 caused by provider account/model permission -> AUTHENTICATION_FAILED or TERMINAL_FAILURE with explicit adapter classification
429 -> RATE_LIMITED
5xx -> RETRYABLE_DEPENDENCY
timeout/cancel at deadline -> TIMEOUT
invalid/malformed structured result -> VALIDATION_ERROR
other definite failure -> TERMINAL_FAILURE
truly indeterminate operation outcome -> OUTCOME_UNKNOWN
```

The adapter must distinguish provider authentication/account permission from Shotgun privacy policy when evidence permits; it cannot collapse every 401/403 into `POLICY_DENIED`.

## 11. Legacy Gemini credential behavior

A6 may expose non-secret compatibility metadata:

```text
Legacy environment credential configured
```

It never returns `GEMINI_API_KEY`. Legacy credential precedence remains ADR-133 and is enforced fully at A8 runtime cutover. Saving/replacing/removing a Project-managed Gemini credential records managed history so later explicit removal cannot resurrect legacy fallback.

OpenAI/DeepSeek have no legacy fallback.

## 12. Authorization and outcome recovery

All AI Settings reads/writes require authenticated Project membership. Mutating configuration/credentials requires the existing manage-settings/owner/admin authority appropriate to the operation; provider external-transfer approval remains A4 `REVIEW_REQUIRED` owner authority.

Non-secret mutation commands reuse established revision/idempotency/outcome-recovery semantics where safe. Secret-bearing credential commands use a specialized secret-safe idempotency/outcome mechanism, but their results must still be recoverable by client request id without storing the key.

## 13. Explicit exclusions

A6 does not:

- make `/settings/ai` frontend Product-complete;
- change existing Ask execution to dynamic provider routing;
- mutate existing AnswerRun pins;
- enable private external transfer without A4 authority;
- deploy to production.

## 14. Acceptance criteria

- A6-AC01: one server-authoritative AI Settings read model exposes A3 registry/configuration and non-secret credential/privacy state.
- A6-AC02: DeepSeek is the fresh-Project default selection descriptor.
- A6-AC03: no credential/configuration is fabricated for a fresh Project.
- A6-AC04: create/replace/revoke/remove credential operations are Project/provider scoped and secret-safe.
- A6-AC05: plaintext/ciphertext is absent from generic Settings JSON, command persistence, logs and responses.
- A6-AC06: configuration save is revisioned and validates exact provider/model/credential ownership/availability.
- A6-AC07: credential-save success + configuration-save conflict is represented without secret loss or silent activation.
- A6-AC08: DeepSeek/OpenAI/Gemini adapters implement the common Shotgun provider contract.
- A6-AC09: all three support Test Connection through synthetic/public content only.
- A6-AC10: DeepSeek live Test Connection/structured generation is the primary external verification path when a test key is explicitly available/approved.
- A6-AC11: OpenAI/Gemini are executable adapter paths, not configuration-only placeholders.
- A6-AC12: provider model/capability mismatch blocks for architecture amendment rather than silent substitution.
- A6-AC13: error mapping follows ADR-133 and definite authentication errors are not `OUTCOME_UNKNOWN`.
- A6-AC14: A2/A3/A4/A5 invariants remain intact.
- A6-AC15: Ask runtime cutover remains out of scope.

## 15. Focused verification

- read-model authority/masking;
- credential secret leakage negative tests;
- idempotent create/replace result recovery without persisted secret;
- Project/provider isolation;
- stale configuration revision conflict;
- Test Connection uses synthetic request and refuses Source/Evidence payloads;
- adapter contract tests for all three providers using deterministic provider fakes/HTTP stubs;
- DeepSeek live public/synthetic verification only when explicitly authorized and key available;
- exact provider error mapping;
- database preservation using `TEST_DATABASE_URL` only.

## 16. Exit condition

A6 is complete after implementation merge and successful automatic post-merge `main` CI. A7 cannot start before closure.
