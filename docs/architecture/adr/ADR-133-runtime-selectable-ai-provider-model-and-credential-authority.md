# ADR-133 — Runtime-selectable AI Provider, Model & Credential Authority

- Status: **ACCEPTED**
- Proposed at: 2026-08-11
- Decision date: 2026-08-11
- Accepted at: 2026-08-11
- Accepted by: `USER`
- Decision owner: user
- Work item: Runtime-selectable AI Provider, Model & Credential Settings
- Subject base: `main@ef0f2e3d7153e16e4f0226817e3e54b6b7cec9ae`
- Related ADRs: ADR-084, ADR-093, ADR-096, ADR-102, ADR-103, ADR-105, ADR-118, ADR-119, ADR-121, ADR-123, ADR-132
- Product implementation: **NOT_AUTHORIZED**

> This ADR is an accepted architecture decision. It does not by itself
> authorize Product implementation. Product code, database migrations, runtime
> wiring, frontend, tests, CI, deployment and private provider egress remain
> separately unauthorized.

## Context

A0 found that the current runtime is startup-fixed to Gemini credentials and a
single model. Provider selection, model selection and credential handling are
not represented as a server-authoritative, revisioned Project configuration.
The existing `privacy.externalTransferAllowed` setting is historical and
Gemini-oriented, while provider-specific privacy approval, secure credential
storage and execution pinning are absent. A runtime switch therefore cannot be
added safely by changing an environment variable or by putting a key in the
existing Settings JSON.

The existing Ask contracts remain in force: SourceVersion is required,
Evidence is optional, Source and Project authority is Server-derived, private
and restricted data policy is enforced before external egress, and an AI
candidate/answer is not a Canonical Fact. This ADR adds provider/configuration
authority without changing those meanings.

## Decision status and scope

The architecture will use a Server-owned provider registry, a Project-scoped
AI configuration, an encrypted credential vault boundary, provider-specific
external-transfer approval, and request-time resolution with immutable
execution pinning. A provider/model change is a new configuration revision and
is applied to the next new execution without a process restart.

The Browser may select from Server-returned descriptors and capabilities, but it
never supplies provider authority, model authority, credential authority,
privacy approval or deployment policy as proof.

## 1. Credential vault boundary

`CredentialVaultPort` is the only Product boundary that can persist or resolve
provider credentials. Its logical operations are:

- encrypt and create a credential;
- resolve a credential for an authorized provider execution;
- replace/rotate a credential and increment `credentialRevision`;
- remove/revoke a credential;
- read non-secret metadata and availability state.

The logical `ProviderCredential` record contains:

```text
credentialId
projectId
providerId
encryptedSecret
encryptionVersion
keyVersion
credentialRevision
createdAt
updatedAt
```

`encryptedSecret` is an authenticated ciphertext envelope, not a plaintext
value. The vault never returns plaintext through a repository, Product API,
Settings snapshot, browser response, log, audit event or error. A provider
adapter may receive decrypted bytes only inside a bounded, in-memory execution
callback/handle owned by the vault; callers cannot request or retain a generic
plaintext value.

Credential persistence is separate from Settings JSON. A Project setting may
refer to `credentialId` and report masked metadata, but it cannot contain a
secret, ciphertext copied into a client payload, or an environment value.

## 2. Encryption and key authority

The baseline envelope is AES-256-GCM with a unique nonce per encryption and an
authentication tag. The deployment supplies the master key outside the
database, using the secret `SHOTGUN_CREDENTIAL_MASTER_KEY`. The envelope and
vault metadata record the algorithm/encryption version and `keyVersion`.

Missing, malformed or wrong-version master-key material fails closed for AI
credential resolution. It does not require the non-AI application to fail at
startup; the effective AI capability is `UNAVAILABLE` with a non-secret reason.

Credential replacement is an explicit Server command. Rotation writes a new
encrypted envelope and revision, and never edits an old audit event or exposes
the old plaintext. A deployment may retain an old key version only for an
explicit, bounded re-encryption window; there is no implicit key fallback.

## 3. Server-owned provider registry

The registry is immutable at runtime and is owned by the Server. The initial
provider identifiers are:

- `openai`
- `google-gemini`
- `deepseek`

Each registry entry identifies its adapter kind, credential requirements,
provider data-policy identifier/revision, native capabilities, Shotgun-usable
capabilities, supported model descriptors and status. The Browser cannot add a
provider, change a provider policy, or treat an arbitrary provider string as
registered.

## 4. Model catalog and capability semantics

The model catalog is Server-owned and versioned. A native provider capability
must not be presented as a Shotgun Product capability until the corresponding
ingestion, validation and output contract exists.

### OpenAI

The initial catalog entry is:

```text
providerId: openai
modelId: gpt-5.6-luna
displayName: GPT-5.6 Luna
provider-native: text=true, image=true, audio=false, structuredOutput=true
```

It must support Text, Image understanding and Shotgun structured generation.
Audio understanding is not a Shotgun requirement for this catalog entry. The
catalog must still record which capabilities are provider-native versus
currently usable by Shotgun.

### Google Gemini

The initial catalog entry is `google-gemini` / `gemini-3.6-flash`. The registry
records official native Text, Image understanding, Audio and structured-output
metadata. Audio capability is not a Shotgun requirement. The current Product
may expose only the subset that it can actually ingest, validate and ground;
native multimodal support alone does not claim that Shotgun accepts image/audio
Source content.

### DeepSeek

The initial catalog entry is `deepseek` / `deepseek-v4-flash`. It is
text-centred for the first integration and must produce structured JSON that
passes Shotgun local schema and semantic validation. No image or audio
capability is claimed by this ADR.

Every descriptor distinguishes:

1. provider-native capability metadata;
2. the currently enabled Shotgun-usable capability set;
3. the validation contract and capability revision.

## 5. Project AI configuration

The Server owns a revisioned logical `ProjectAIConfiguration`:

```text
projectId
activeProviderId
activeModelId
credentialId
aiConfigurationRevision
updatedBy
updatedAt
```

It contains no plaintext credential. `credentialId` must belong to the same
Project and registered provider. Provider credentials are independent records;
switching from one provider to another does not delete or overwrite the other
provider's credential. Save is an explicit authorized command and produces a
new configuration revision. It affects the next new execution only; an
in-flight execution retains its pin.

## 6. Request-time resolution and routing

An `EffectiveAIConfigurationResolver` resolves, at request time:

1. Server Principal and target/resource Project authority;
2. the Project configuration revision;
3. the registered provider and model descriptor;
4. the referenced credential metadata and vault availability;
5. current provider-specific privacy/deployment eligibility;
6. the provider adapter through a registry-backed factory/router.

The resolver is the only authority for effective provider/model/credential
selection. It revalidates Project ownership, access scope, sensitivity,
configuration revision and credential revision before provider execution.

Changing Settings does not restart the process and never mutates an existing
AnswerRun.

## 7. Execution pinning and audit

Every new Ask execution pins these values before provider invocation:

```text
providerId
modelId
aiConfigurationRevision
credentialId
credentialRevision
providerPolicyFingerprint
```

The pin is stored with the durable execution/attempt audit and contributes to
the effective context and policy digest where applicable. Plaintext credentials
never appear in the pin, provider-call audit, event payload, error or log.
The pin makes the route, credential revision and policy decision reproducible
even after Project Settings changes.

## 8. Retry semantics

- `RETRY_SAME_CONTEXT` retains the original provider, model, credential
  revision, AI configuration revision and source/context pin as identity and
  audit data. Immediately before provider invocation, the Server revalidates
  that the pinned credential revision is currently executable. If that
  revision is revoked, removed or unavailable, the retry fails closed; it does
  not substitute the latest credential. A new credential requires a new
  execution. The historical pin remains preserved, but it does not preserve
  permission to use a revoked secret. The same immutable SourceVersion context
  may be re-resolved, but a digest mismatch also fails closed.
- `RETRY_CURRENT_POLICY` keeps the original provider/model/configuration pin
  and reevaluates only the existing current privacy/provider-eligibility
  contract. It does not silently switch to a newly selected provider, model or
  credential.

A provider/model switch requires an explicit new configuration command and a
new execution. This ADR does not introduce an implicit “retry with current
model” meaning.

## 9. Provider-specific privacy and deployment authority

The logical authority is a Project-scoped
`ProviderExternalTransferApproval` record:

```text
projectId
providerId
approved
approvalRevision
reviewedBy
reviewedAt
```

Restricted Source, SourceVersion or Evidence context is always denied for an
external AI provider. Private context requires both the deployment ceiling and
a matching approval for the selected provider and Project. Public/internal
context remains subject to the existing provider data-policy contract.

`ProviderExternalTransferApproval` is an ADR-103 Settings Control Plane
high-risk change and is therefore `REVIEW_REQUIRED`; it cannot be an immediate
single-click toggle. Owner review and separate approval are required before
private external transfer becomes eligible.

The deployment ceiling is provider-aware and defaults to deny. The preferred
environment representation is a provider-scoped allowlist such as
`AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS`; it is deployment authority, not a
Project approval and not a replacement for the vault. The existing
`GEMINI_ALLOW_PRIVATE` is compatibility-only for Gemini and must never
authorize OpenAI or DeepSeek, nor bypass Project approval. Settings or key save
cannot raise the deployment ceiling.

The preflight and submit boundaries use the same Server source-selection
authorization and mask inaccessible or over-clearance identifiers. The
provider policy resolver receives only selections already authorized for Ask;
it does not infer authority from Browser sensitivity strings.

## 10. Historical Gemini approval preservation

The historical `privacy.externalTransferAllowed` value is preserved exactly,
including its revisions and audit events. If a Project has no
`google-gemini` provider-specific approval record, an old approved `true` value
is interpreted as a compatibility approval for `google-gemini` only. It does
not approve OpenAI or DeepSeek. A false, missing or ambiguous historical value
yields `NOT_APPROVED` for new provider-specific decisions.

Once a provider-specific `google-gemini` approval record exists, that record is
always authoritative. Its explicit `false` or revoked state cannot be
overridden or revived by the historical generic approval. No historical row is
rewritten or deleted to perform this interpretation.

## 11. Legacy environment credentials

There is no automatic migration or plaintext copy of `GEMINI_API_KEY`. Legacy
fallback is available only while the Project remains in a compatibility state
that has never explicitly managed its AI credential. The effective precedence
in that state is:

1. an authorized Project vault credential;
2. a read-only legacy deployment credential for `google-gemini`;
3. `UNAVAILABLE`.

After the Project saves, replaces or explicitly removes a Gemini credential,
the Project credential authority takes precedence over legacy fallback. An
explicit removal therefore yields `UNAVAILABLE`; it never reactivates the
legacy `GEMINI_API_KEY` automatically.

The Server may expose only non-secret metadata such as “Legacy environment
credential configured”. It never returns, persists or logs the legacy value.
OpenAI and DeepSeek have no implicit legacy fallback.

## 12. Test-connection boundary

“Test connection” is a Server command, not an Ask execution. It uses a
synthetic/public request and never sends private Source or Evidence content. A
draft credential may be used transiently, or an existing vault credential may
be tested, but neither the secret nor provider payload is logged or included in
audit. The result is a non-secret capability/status outcome.

## 13. Error taxonomy

Provider and configuration failures are classified deterministically:

- missing/invalid vault key or credential configuration: `CONFIGURATION_REQUIRED`
  or `AI_CAPABILITY_UNAVAILABLE`;
- definite authentication or authorization/policy failures (HTTP 401/403):
  terminal `AUTHENTICATION_FAILED` or `POLICY_DENIED`, never
  `OUTCOME_UNKNOWN`;
- HTTP 429: `RATE_LIMITED`;
- provider 5xx or an explicitly retryable dependency failure:
  `RETRYABLE_DEPENDENCY`;
- timeout: `TIMEOUT`;
- invalid structured output or failed Shotgun validation: `VALIDATION_ERROR`;
- other definite failures: `TERMINAL_FAILURE`;
- `OUTCOME_UNKNOWN` only when the result of the provider operation cannot be
  determined.

## Rejected alternatives

- Storing plaintext or ciphertext in the existing Settings JSON: rejected
  because Settings snapshots, exports and browser reads are not a secret vault.
- One global API key or one global private-egress flag: rejected because
  Project/provider ownership and privacy approval would be lost.
- Browser-selected provider/model/credential IDs as authority: rejected because
  it creates a confused-deputy boundary.
- Automatically switching provider/model on retry: rejected because retries
  would cease to reproduce the original execution context.
- Treating provider-native multimodal support as Product ingestion support:
  rejected because it would overclaim Source and Evidence capability.
- Automatically migrating `GEMINI_API_KEY` or the historical generic approval:
  rejected because it would create an unreviewed secret/egress grant.

## Consequences

Positive consequences are auditable provider/model selection, safe credential
rotation, provider-specific privacy decisions, deterministic retries and
runtime switching without restart. The cost is a new secure persistence and
revision model, a provider-aware Settings/approval control plane and explicit
operational key management.

The existing Ask SourceVersion/Evidence semantics, citation lineage,
server-authoritative Project resolution, restricted hard deny, deployment
ceiling, Project approval and retry contracts remain unchanged except for the
additional provider/model/credential pin fields.

## Expected database migration scope (logical only)

Database migration is **REQUIRED** after this ADR is accepted. The migration
must be additive and reversible at the schema level and cover, at minimum:

- encrypted Project/provider credential envelopes and credential revisions;
- Project AI configuration revisions and foreign-key ownership;
- provider-specific external-transfer approvals and approval revisions;
- provider/model/credential/configuration pins on durable Ask execution audit;
- provider registry/model capability revision metadata where persistence is
  required;
- indexes, access checks and audit retention without storing plaintext.

No SQL, migration file or data rewrite is part of A1. Existing credentials,
Projects, Sources, Conversations and AnswerRuns are not changed by this ADR.

## Open questions for A2/A3

- Define deployment key provisioning, rotation window and operational ownership
  for `SHOTGUN_CREDENTIAL_MASTER_KEY`.
- Define the concrete Settings/API approval screens and revision commands while
  keeping authority Server-side.
- Select the concrete adapter credential handshake and bounded in-memory
  lifetime for each provider.
- Verify the `gpt-5.6-luna` adapter and capability contract before enabling it
  for production executions.

These are implementation details inside this boundary, not permission to widen
the A1 scope. If any requires changing retry identity, historical approval
meaning, encryption authority or Browser authority, return for a new
architecture decision.

## Explicit exclusions and evidence boundary

This A1 change does not modify Product code, database schema, environment
files, runtime/provider wiring, frontend, tests, CI, deployment or production
verification. It does not enable private Gemini egress, create Project
approvals, migrate `GEMINI_API_KEY`, or touch the uncommitted DeepSeek changes
already present in the worktree. Those changes remain preserved and outside
this ADR's commit scope.

