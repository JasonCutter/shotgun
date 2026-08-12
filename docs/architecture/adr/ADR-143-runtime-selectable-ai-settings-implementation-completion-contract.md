# ADR-143 — Runtime-selectable AI Settings Implementation Completion Contract

- Status: **ACCEPTED**
- Proposed at: 2026-08-12
- Decision date: 2026-08-12
- Accepted at: 2026-08-12
- Accepted by: `USER`
- Decision owner: `USER`
- Work item: `Runtime-selectable AI Provider, Model & Credential Settings — Completion Contract`
- Subject base: `main@ae0de25e91b8ed9d7fc875ef8b39771ec57f4c45`
- Related ADRs: ADR-103, ADR-118, ADR-119, ADR-123, ADR-132, ADR-133
- Product implementation: **AUTHORIZED ONLY THROUGH THE FROZEN A4–A9 SECTION BOUNDARIES**

## Context

ADR-133 accepted the architecture for runtime-selectable AI provider, model and credential authority. A2 then implemented the encrypted credential vault and A3 implemented the server-owned provider registry, model catalog and revisioned Project AI configuration. The remaining work spans provider-specific privacy, immutable execution identity, Settings backend and frontend, runtime cutover, and final actual-use closure.

Without a finite implementation completion contract, later Sections could widen indefinitely or defer essential behavior until an undefined future phase. This ADR therefore freezes the Program boundary from A1 through A9 and defines exactly when the feature is complete.

The user clarified an additional Product requirement on 2026-08-12: DeepSeek is the initial default and primary live verification provider, but OpenAI, Google Gemini and DeepSeek must all be operationally usable. Selecting any of the three in Settings, entering a valid API key and saving must make that provider eligible for the next new execution without process restart. OpenAI and Gemini are not configuration-only placeholders.

## Decision

### 1. Finite Program boundary

The implementation Program is exactly A1 through A9:

```text
A1  Architecture / ADR-133
A2  Credential Vault & Secure Persistence
A3  Provider Registry / Model Catalog / Project AI Configuration
A4  Provider-specific Privacy & Deployment Authority
A5  Execution Identity / Pinning / Retry Foundation
A6  AI Settings Backend Control Plane & Multi-provider Connectivity
A7  Settings → AI Frontend Product
A8  Effective Runtime Resolution / Provider Routing / Ask Cutover
A9  End-to-End / Actual-use Completion Closure
```

A Section does not start until its predecessor is complete and explicitly closed. A later Section cannot silently absorb unfinished acceptance criteria from an earlier Section.

### 2. Section ordering

The post-A5 sequence is intentionally:

```text
Backend control plane
-> Frontend Product surface
-> Runtime cutover
```

This prevents a period in which Ask runtime depends on Project-managed AI configuration before the Product gives an authorized user a complete way to create and inspect that configuration.

### 3. Provider operational contract

The initial provider set remains:

- `deepseek`
- `openai`
- `google-gemini`

DeepSeek is the initial Product default selection and the primary live external-provider verification path. This does **not** reduce the required capability of OpenAI or Gemini.

At Program completion all three providers must support the same user-facing lifecycle:

```text
select provider
-> select registered model
-> enter/replace API key
-> optional Test Connection
-> save Project AI configuration
-> next new Ask uses the selected provider/model/credential
```

A process restart is not required. An in-flight AnswerRun does not change provider because Settings changed.

A fresh Project with no managed AI configuration presents DeepSeek as the default selection, but it does not fabricate a credential or silently persist a configuration. Until a credential is supplied and a configuration is saved, the AI capability is `CONFIGURATION_REQUIRED`/`UNAVAILABLE` according to the Product contract.

### 4. Existing-Project compatibility transition

Existing Projects that have never created Project-managed AI configuration may remain in a bounded `LEGACY_GEMINI_COMPATIBILITY` state defined by ADR-133. This preserves existing behavior while the user migrates through Settings.

The first explicit Project AI configuration save creates an irreversible authority transition to `PROJECT_MANAGED` for provider/model/credential selection. After that transition:

- the current revisioned Project AI configuration is authoritative;
- no provider/model is silently taken from startup environment defaults;
- an explicitly removed Gemini credential does not resurrect `GEMINI_API_KEY`;
- OpenAI and DeepSeek never obtain a legacy credential fallback.

Historical records are preserved; no compatibility transition rewrites prior Settings or credential history.

### 5. Execution identity

Every new AnswerRun obtains one immutable AI execution identity before provider invocation:

```text
providerId
modelId
aiConfigurationRevision
credentialId
credentialRevision
initialProviderPolicyFingerprint
```

Every attempt records its effective policy/context audit in addition to that identity. Settings changes never mutate an existing pin.

`RETRY_SAME_CONTEXT` keeps the original provider/model/configuration/credential revision and context identity. `RETRY_CURRENT_POLICY` keeps the same provider/model/configuration/credential identity and reevaluates only the current policy eligibility required by ADR-133. A revoked or removed pinned credential revision fails closed; the latest credential is never substituted automatically.

### 6. Secret-safe Settings control plane

The browser may submit a plaintext API key only to a dedicated secret-safe command boundary. The plaintext key must not be stored in generic Settings JSON, frontend command persistence, audit payloads, logs, URLs, query caches, browser storage or response bodies.

The server returns only non-secret credential metadata such as provider, credential id, revision, lifecycle/availability, masked/configured state and update time.

Credential create/replace and Project AI configuration save are separate authoritative operations even when the UI presents them as one guided Save flow.

### 7. Test Connection

All three providers expose the same Product-level Test Connection capability when their adapter is enabled. Test Connection:

- is a server command, not an Ask AnswerRun;
- uses only synthetic/public content;
- never sends Source, SourceVersion, Evidence or private/restricted Project content;
- may use a transient draft credential or an existing vault credential;
- returns only a non-secret status/capability result.

DeepSeek is the required primary live verification provider for initial completion evidence. OpenAI/Gemini adapter and switching behavior must still be complete and contract-tested so that entering valid credentials makes them immediately usable; repeated live external calls to all providers are not mandatory if they would duplicate verification without adding risk-bearing evidence.

### 8. Runtime resolver and routing

After A8, new Ask execution authority flows through:

```text
Server Principal / target Project authority
-> exact Project AI configuration revision
-> registered provider/model descriptor
-> exact credential metadata and vault availability
-> provider-specific privacy/deployment eligibility
-> immutable execution pin
-> credential-vault bounded callback
-> registry-backed provider router
-> provider adapter
-> existing structured Ask validation/grounding pipeline
```

Browser-selected strings and startup environment values cannot replace server authority for a Project-managed execution.

### 9. Error taxonomy

The final runtime honors ADR-133 deterministically:

- missing/invalid AI configuration or vault material -> `CONFIGURATION_REQUIRED` / `AI_CAPABILITY_UNAVAILABLE`;
- definite provider authentication failure -> `AUTHENTICATION_FAILED`;
- definite policy denial -> `POLICY_DENIED`;
- 429 -> `RATE_LIMITED`;
- provider 5xx / explicitly retryable dependency -> `RETRYABLE_DEPENDENCY`;
- timeout/cancellation at the provider deadline -> `TIMEOUT`;
- structured output/schema/semantic validation failure -> `VALIDATION_ERROR`;
- other definite failure -> `TERMINAL_FAILURE`;
- `OUTCOME_UNKNOWN` only when the provider operation result truly cannot be determined.

A definite 401/403 is never classified as `OUTCOME_UNKNOWN` merely because it came from an external provider.

### 10. Program completion gate

`Runtime-selectable AI Settings COMPLETE` requires all of the following:

1. A1–A9 frozen Section acceptance criteria are PASS;
2. A2 and A3 remain regression-clean;
3. Settings exposes DeepSeek, OpenAI and Google Gemini from server descriptors;
4. each provider supports credential create/replace, Test Connection and executable routing when validly configured;
5. DeepSeek is the initial default selection and primary live actual-use verification path;
6. provider/model/credential changes apply to the next new execution without process restart;
7. in-flight and retry identity invariants are preserved;
8. provider-specific privacy and deployment ceilings are enforced;
9. plaintext/ciphertext credential leakage tests are PASS;
10. final whole-flow automated E2E is PASS;
11. DeepSeek public/synthetic actual-use verification is PASS;
12. required final exact-head CI is successful;
13. merge is complete and the automatic post-merge `main` CI is successful;
14. Deployment and Production Verification remain separately authorized activities and are not silently implied by Program completion.

The final status is:

```text
COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED
```

### 11. Scope freeze

After this ADR is accepted, implementation may refine internal types, filenames, repository shapes and UI composition inside the frozen meanings. It may not silently change:

- provider authority;
- Browser authority;
- credential secrecy;
- retry identity;
- compatibility transition meaning;
- provider-specific privacy meaning;
- the requirement that all three providers become usable after valid Settings configuration;
- the A9 completion boundary.

A change to any of those meanings requires an explicit ADR amendment or a new ADR.

## Consequences

- The feature has a finite, auditable end state.
- DeepSeek can be the initial operational path without turning OpenAI/Gemini into decorative configuration placeholders.
- Runtime cutover occurs only after the Product can authoritatively manage configuration.
- Existing Gemini users can migrate without a forced outage, while managed Projects cannot fall back silently afterward.
- Exact-head evidence reuse remains valid; duplicate manual CI or repeated live-provider calls are not required without a new risk-bearing reason.

## Rejected alternatives

- Mark OpenAI/Gemini as configuration-only and defer execution support.
- Cut over Ask runtime before the Settings control plane and Product UI exist.
- Make DeepSeek a hard-coded runtime default that overrides saved Project configuration.
- Store API keys in generic Settings payloads or command audit records.
- Re-resolve the latest credential during retry.
- Require repeated paid/live external calls to every provider when equivalent contract evidence already proves the same path.
- Declare completion after UI implementation without actual request-time provider switching evidence.
