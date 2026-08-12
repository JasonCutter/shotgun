# A7 Detailed Design — Settings → AI Frontend Product

- Status: **FROZEN / ACCEPTED BY USER**
- Parent: ADR-143
- Depends on: A6 completion
- Does not authorize: Ask runtime cutover

## 1. Objective

A7 creates the canonical user-facing `/settings/ai` workspace for configuring the Project AI provider, model and credential through the A6 server control plane. It does not create any new Browser authority.

## 2. Route and navigation

Canonical route:

```text
/settings/ai
```

The existing `/settings/models` view remains an informational/model-profile surface unless a later approved cleanup consolidates it. `/settings/ai` is the only Product surface that owns active provider/model/credential configuration.

## 3. Page read state

On load the page reads the A6 AI Settings read model and renders:

```text
AI Provider
Model
Credential status
API Key entry/replacement control
Test Connection
Connection status
Privacy approval status
Deployment eligibility
Current configuration revision
Save status / recoverable outcome state
```

Provider/model options come only from server descriptors. The UI does not synthesize arbitrary model IDs or providers.

## 4. Initial/default state

For a fresh Project with no managed AI configuration:

- DeepSeek is preselected as the default **UI selection**;
- no fake credential is shown;
- no hidden configuration save occurs;
- Save remains unavailable until the selected provider has an eligible credential/model combination;
- the page explains that an API key is required before AI can run.

For a Project in `LEGACY_GEMINI_COMPATIBILITY`, the page represents that state explicitly and offers migration to Project-managed configuration. It does not claim that a legacy environment key is a stored Project credential.

For `PROJECT_MANAGED`, the current provider/model/revision and masked credential metadata are shown.

## 5. Provider switching UX

The provider selector includes all three initial providers:

```text
DeepSeek
OpenAI
Google Gemini
```

Changing the selector changes only the draft UI state until Save succeeds. It does not immediately change active runtime authority.

Each provider exposes only models returned by the server for that provider. If a provider/model is server-disabled/unavailable, the UI presents the server reason and blocks activation without fabricating a workaround.

## 6. API key input security

The API key field is always write-only from the Product perspective.

Rules:

- existing key is never prefilled;
- plaintext is never returned by the server;
- no localStorage/sessionStorage/IndexedDB persistence;
- no URL/search-param serialization;
- no analytics/telemetry capture;
- no React Query cache entry containing the plaintext;
- no console logging;
- successful create/replace clears the field immediately;
- navigation away discards unsaved plaintext;
- browser autocomplete is disabled where feasible for secret safety;
- masked display is metadata only, such as `Configured · revision 2`.

## 7. Credential lifecycle UX

### Create

When no Project-managed credential exists for the selected provider:

```text
API Key [................]
[ Test Connection ] [ Save ]
```

### Replace

Existing credential is represented only by metadata. Entering a new key creates a replacement revision through A6.

### Revoke/remove

The user may revoke/remove a credential through explicit destructive confirmation. The UI must clearly show if the active Project AI configuration references that credential and what AI availability impact will occur.

Removal/revocation never causes automatic fallback to another provider/key.

## 8. Test Connection UX

Test Connection supports:

- draft key before persistence;
- current stored exact credential.

The UI sends no Source/Evidence/Conversation data. It displays only A6 non-secret status:

```text
Connected
Authentication failed
Model unavailable
Rate limited
Temporarily unavailable
Connection not tested
```

A failed Test Connection does not silently save or activate anything.

Test Connection is not an unconditional prerequisite for Save; the user may save a syntactically valid credential/configuration and receive a clear `Not tested` status. This avoids making transient provider/network availability the authority for credential persistence. The runtime may still fail deterministically if the credential is invalid.

## 9. Save orchestration

### Existing credential reused

```text
save Project AI configuration
-> success / conflict / outcome recovery
```

### New/replacement key entered

```text
credential create/replace
-> receive credential id/revision metadata
-> configuration save with expected AI config revision
```

The UI must distinguish partial outcomes.

Example:

```text
Credential saved.
AI configuration was not changed because the configuration revision changed.
Reload current settings or retry configuration save.
```

It must not retry credential creation blindly and create duplicate revisions after an uncertain network outcome; it uses the A6 client request/outcome recovery path.

## 10. Concurrency and stale state

The page stores the server-observed `aiConfigurationRevision` and uses it as the save precondition. If stale:

- do not overwrite newer Project AI configuration;
- show a conflict state;
- reload authoritative current configuration;
- preserve unsaved non-secret provider/model draft where safe;
- require explicit retry after reconciliation.

Plaintext key handling remains ephemeral during conflict recovery.

## 11. Privacy and deployment presentation

The page displays provider-specific private-transfer status using A4 server authority, for example:

```text
Private Project context
Project approval: Approved / Review required / Not approved
Deployment: Allowed / Blocked
Effective: Eligible / Not eligible
```

The UI cannot directly flip `REVIEW_REQUIRED` approval to true. It routes the user through the existing Owner review/approval flow.

Restricted data is presented as never eligible for external AI transfer.

## 12. Runtime expectation messaging

Before A8 cutover, A7 may state that the saved configuration is ready for the next runtime-enabled execution, but it must not falsely claim dynamic Ask routing has already changed.

After A8, the same page message becomes:

```text
Saved. New AI executions will use <provider>/<model>.
Existing/in-flight executions keep their original configuration.
```

A7 implementation should use capability flags/read-model state so this message does not require a second UI architecture rewrite.

## 13. Accessibility and error handling

- labels are programmatically associated with selectors/secret field/buttons;
- keyboard-only operation covers provider/model/key/Test/Save;
- focus moves to actionable error summary after failed command;
- status is not conveyed by color alone;
- loading/saving/testing states prevent accidental duplicate submission;
- safe server messages are rendered; raw provider errors are not exposed.

## 14. Explicit exclusions

A7 does not:

- make Browser-selected provider/model authoritative;
- persist plaintext secrets;
- cut Ask runtime over to the new provider router;
- bypass A4 approval review;
- modify A5 execution pins/retry behavior;
- deploy to production.

## 15. Acceptance criteria

- A7-AC01: `/settings/ai` is the canonical active AI configuration workspace.
- A7-AC02: all three providers are selectable from server descriptors.
- A7-AC03: fresh Project defaults UI selection to DeepSeek without fabricating credential/configuration.
- A7-AC04: provider-specific model choices are server-derived.
- A7-AC05: API key is write-only and absent from browser persistence/cache/URL/logging.
- A7-AC06: create/replace/revoke/remove credential flows use A6 secret-safe commands.
- A7-AC07: Test Connection works for draft/stored credential without sending Project knowledge.
- A7-AC08: Save supports existing or new credential and accurately represents partial outcomes.
- A7-AC09: stale revision cannot overwrite newer configuration.
- A7-AC10: provider-specific privacy/deployment status is authoritative and `REVIEW_REQUIRED` cannot be bypassed.
- A7-AC11: legacy compatibility vs Project-managed state is presented accurately.
- A7-AC12: accessibility and duplicate-submission controls cover the full workflow.
- A7-AC13: no runtime cutover is silently performed by A7.

## 16. Focused verification

- browser route/read model rendering;
- DeepSeek default selection on fresh Project;
- all three provider/model switching UI states;
- secret persistence negative tests;
- credential create/replace/remove flows;
- Test Connection draft/stored flows;
- stale config conflict and outcome recovery;
- partial credential-success/config-failure UX;
- owner privacy review routing;
- keyboard/focus/accessibility checks.

## 17. Exit condition

A7 is complete after implementation merge and successful automatic post-merge `main` CI. A8 runtime cutover cannot start before closure.
