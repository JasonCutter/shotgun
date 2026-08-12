# A9 Detailed Design — End-to-End Actual-use Completion Closure

- Status: **FROZEN / ACCEPTED BY USER**
- Parent: ADR-143
- Depends on: A8 completion
- Adds new Product authority: **NO**
- Primary live provider verification: `deepseek`

## 1. Objective

A9 proves that A1–A8 form one complete Product capability. It adds no new provider/configuration/privacy/credential authority. It owns only whole-flow acceptance evidence and the final Program completion decision.

## 2. Completion philosophy

Section-local unit/contract/database/browser tests can all pass while a hand-off remains broken. A9 therefore verifies the actual chain:

```text
Settings read
-> provider/model selection
-> API key handling
-> optional Test Connection
-> credential persistence
-> Project AI configuration save
-> new Ask request
-> effective runtime resolution
-> immutable pin
-> provider routing
-> structured answer/citations
-> retry/error behavior
```

Evidence already PASS on the same exact head is referenced rather than rerun. A9 adds only cross-boundary tests and actual-use evidence not already proven by Section tests.

## 3. Mandatory automated E2E scenarios

### E2E-A — Fresh Project DeepSeek configuration and Ask

```text
fresh Project
-> /settings/ai defaults selection to DeepSeek
-> no credential/config exists yet
-> enter DeepSeek key through secret-safe test fixture
-> optional Test Connection
-> Save
-> new Ask
-> resolved provider = deepseek
-> exact config/credential revisions pinned
-> structured answer succeeds through routed provider test double
```

The test must prove that DeepSeek default selection did not itself create hidden credential/configuration state.

### E2E-B — Restart-free provider switch DeepSeek -> OpenAI

```text
Run A pinned to DeepSeek
-> Settings save OpenAI + OpenAI credential
-> no process restart
-> Run A identity remains DeepSeek
-> new Run B resolves OpenAI
```

Provider calls may use deterministic stubs unless live evidence is specifically needed.

### E2E-C — Restart-free provider switch OpenAI -> Gemini -> DeepSeek

Each new execution uses the newly saved provider while prior AnswerRuns retain their original pins. This proves all three operational routes are reachable through the same Product control plane.

### E2E-D — Credential replacement

```text
provider credential revision 1 active
-> replace key -> revision 2
-> save new config revision referencing rev 2
-> new Run uses rev 2
-> old Run/retry identity does not silently change to rev 2
```

### E2E-E — Exact credential revocation on retry

```text
Run pin references credential rev 1
-> revoke/remove exact rev 1
-> RETRY_SAME_CONTEXT
-> fail closed
-> no rev 2/latest substitution
```

### E2E-F — RETRY_CURRENT_POLICY

```text
original Run provider/model/config/key remain pinned
-> provider privacy approval/deployment eligibility changes
-> RETRY_CURRENT_POLICY
-> current policy reevaluated
-> provider/model/config/key remain original
```

### E2E-G — Restricted hard deny

Restricted Source/SourceVersion/Evidence context reaches no external-provider adapter or secret callback. UI/Ask returns safe policy-denied behavior.

### E2E-H — Private provider-specific eligibility

For a deterministic test provider route:

```text
private + deployment deny -> deny
private + deployment allow + Project/provider not approved -> deny
private + deployment allow + matching approval -> eligible
Gemini approval -> does not approve OpenAI/DeepSeek
```

No actual private external egress is required for Program completion.

### E2E-I — Secret non-disclosure

Across Settings, command outcome recovery, browser reload, AnswerRun events, activity/history APIs, logs captured by test harness and database projections:

- API key plaintext absent;
- encrypted vault envelope absent outside vault persistence boundary;
- authorization header absent.

### E2E-J — Stale configuration save

Two Settings clients observe revision N. One saves N+1. The stale client cannot overwrite it. If a new credential was already saved before the conflict, the Product accurately reports credential success/configuration conflict and allows safe reconciliation without duplicate secret write.

### E2E-K — Legacy Gemini compatibility migration

For an existing compatibility fixture:

```text
no explicit AI config history
-> legacy Gemini compatibility works according to ADR-133/A4
-> user saves explicit DeepSeek/OpenAI/Gemini config
-> mode becomes PROJECT_MANAGED
-> later managed credential removal does not resurrect legacy provider/credential authority
```

### E2E-L — AI unavailable does not kill non-AI Product

With no eligible AI config/key/master-key capability, the application starts and non-AI Product surfaces remain usable. AI returns a safe configuration/unavailable state.

### E2E-M — Provider error taxonomy

Deterministic adapter fixtures prove:

```text
401 auth rejection -> AUTHENTICATION_FAILED
policy denial -> POLICY_DENIED
429 -> RATE_LIMITED
5xx -> RETRYABLE_DEPENDENCY
timeout -> TIMEOUT
invalid structured output -> VALIDATION_ERROR
definite other failure -> TERMINAL_FAILURE
truly indeterminate operation -> OUTCOME_UNKNOWN
```

### E2E-N — Worker recovery preserves identity

A queued/running AnswerRun with durable pin survives the existing recovery path; restart/reclaim does not resolve a new provider/model/key from current Settings.

## 4. Live actual-use verification

### 4.1 Required primary live path — DeepSeek

When the user explicitly supplies/authorizes a valid DeepSeek API key, A9 verifies with public/synthetic content only:

```text
/settings/ai
-> DeepSeek key
-> Test Connection success
-> Save DeepSeek configuration
-> new Ask using public/synthetic authoritative context
-> actual DeepSeek provider response
-> expected provider/model identity in durable audit
```

No private/restricted content is sent for this verification.

### 4.2 OpenAI/Gemini live calls

OpenAI and Gemini must be fully operational in implementation and contract/routing tests. The Program does not require repeated paid/live calls to every provider solely for symmetry when the common adapter/router contract is already proven and the user has directed initial testing to DeepSeek.

If a provider-specific behavior cannot be proven without a real call, one bounded synthetic/public call becomes required for that provider. Otherwise a user who later enters a valid OpenAI/Gemini key can immediately use Test Connection and the same routed runtime path without new Product implementation.

## 5. Provider switching completion evidence

Program completion requires evidence that the server can route each of these configurations:

```text
deepseek + registered DeepSeek model + valid credential
openai + registered OpenAI model + valid credential
google-gemini + registered Gemini model + valid credential
```

The evidence may be deterministic adapter/HTTP stub execution for OpenAI/Gemini when live calls are intentionally minimized, but the adapters may not be no-op/placeholders or return `CONFIGURATION_ONLY`.

## 6. Browser/Product acceptance

The whole-flow browser test proves:

- DeepSeek default selection for fresh Project;
- all three provider choices visible;
- provider-specific model list changes;
- write-only API key behavior;
- Test Connection status;
- Save and reload masked metadata;
- stale conflict handling;
- privacy/deployment status;
- accessible focus/error handling;
- no secret reappearance after reload/history navigation.

## 7. Database acceptance

Using only `TEST_DATABASE_URL`:

- A2 credentials survive A4–A8 migrations;
- A3 configuration history survives;
- A4 approval history survives;
- A5 pins/attempt audits persist;
- no destructive migration rewrites historical AnswerRuns into fabricated provider identities;
- exact pin/config/credential revision relationships remain queryable;
- test cleanup does not introduce cross-module FK regressions that prevent independent test isolation.

## 8. Security acceptance

A9 closes with zero unresolved Critical/High gaps in:

- credential plaintext/ciphertext exposure;
- Project/provider cross-scope access;
- Browser authority confusion;
- restricted/private egress enforcement;
- retry credential substitution;
- legacy fallback resurrection;
- raw provider error leakage;
- secret-bearing logging/telemetry.

## 9. Performance/operability sanity

A9 does not introduce a broad performance program, but it confirms:

- runtime provider selection does not require application restart;
- Settings read does not decrypt credentials;
- provider secret resolution occurs only immediately around provider work;
- normal Ask worker concurrency/recovery remains bounded;
- unavailable provider/config state does not produce a crash loop.

## 10. Evidence and test policy

- do not rerun an already-PASS exact-head Section suite without changed risk;
- use final required repository CI once on the candidate head or automatic CI equivalent;
- do not manually duplicate automatic GitHub Actions runs;
- live provider calls use minimal synthetic/public payloads and are not repeated simply to increase test count;
- production/private egress verification requires separate explicit user authorization.

## 11. Program acceptance matrix

A9 records explicit PASS/FAIL for:

```text
A1 architecture acceptance
A2 secure credential vault
A3 provider/model/config authority
A4 privacy/deployment authority
A5 execution pin/retry identity
A6 backend/provider connectivity
A7 Settings Product UI
A8 runtime cutover
E2E-A through E2E-N
DeepSeek live actual-use
final exact-head CI
merge
post-merge main CI
```

No `COMPLETE` status is recorded while any mandatory item is pending.

## 12. Final status transition

Before merge:

```text
IMPLEMENTED / EXACT_HEAD_CI_VERIFIED / ACTUAL_USE_VERIFIED_CANDIDATE
```

After merge and successful automatic main CI:

```text
Runtime-selectable AI Settings
COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED
```

Deployment:

```text
NOT_STARTED
```

Production Verification:

```text
NOT_STARTED
```

unless separately authorized and performed.

## 13. Acceptance criteria

- A9-AC01: E2E-A through E2E-N PASS.
- A9-AC02: DeepSeek live synthetic/public Test Connection + Ask verification PASS when key/egress explicitly authorized.
- A9-AC03: OpenAI/Gemini operational adapter/routing switching evidence PASS; they are not placeholders.
- A9-AC04: no mandatory private external egress occurs for completion.
- A9-AC05: no credential secret/ciphertext leakage is found outside allowed vault persistence.
- A9-AC06: retry identity/revocation behavior PASS end-to-end.
- A9-AC07: legacy-to-managed one-way transition PASS.
- A9-AC08: application remains usable without configured AI capability.
- A9-AC09: provider error taxonomy PASS.
- A9-AC10: final exact-head required CI PASS.
- A9-AC11: merge completes and automatic post-merge main CI PASS.
- A9-AC12: zero unresolved Critical/High architecture/security gaps.
- A9-AC13: final status is recorded only after all preceding criteria pass.

## 14. Scope closure

After A9 closure, additional provider features, extra models, cost optimization, automatic provider failover, provider ranking, new multimodal ingestion, or expanded active-knowledge behavior are new work items. They do not silently reopen this Program unless evidence proves the frozen completion contract was false.
