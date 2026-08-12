# A5 Detailed Design — Execution Identity, Pinning & Retry Foundation

- Status: **FROZEN / ACCEPTED BY USER**
- Parent: ADR-143
- Depends on: A4 completion
- Does not authorize: provider runtime cutover, Settings AI UI, external provider execution

## 1. Objective

A5 makes provider/model/configuration/credential identity durable and immutable at the AnswerRun boundary before A8 changes the runtime provider dynamically. The design reuses the existing durable Ask execution system rather than introducing a parallel execution engine.

## 2. Existing execution foundation to preserve

The current Ask model already has:

- durable `answer_runs`;
- durable `answer_run_attempts`;
- attempt kinds `INITIAL`, `RETRY_SAME_CONTEXT`, `RETRY_CURRENT_POLICY`;
- access revision and policy context revision;
- resolved context digest and query plan revision;
- provider response/audit fields;
- worker lease/recovery behavior.

A5 extends those structures additively.

## 3. Authoritative data model

### 3.1 One immutable AnswerRun AI pin

Logical contract:

```text
AIExecutionPin
answerRunId
projectId
providerId
modelId
aiConfigurationRevision
credentialId
credentialRevision
initialProviderPolicyFingerprint
createdAt
```

Rules:

- exactly one logical pin per AnswerRun after AI identity is resolved;
- pin values are immutable;
- plaintext/ciphertext credentials are never present;
- provider/model/config/credential identity is not recomputed from current Settings after pin creation;
- the pin may be created atomically with the initial claim or in a pre-provider transaction owned by the execution repository, but provider invocation cannot begin before durable pin persistence succeeds.

### 3.2 Per-attempt audit

Each attempt records:

```text
attemptId
answerRunId
attemptNumber
attemptKind
providerId
modelId
aiConfigurationRevision
credentialId
credentialRevision
effectiveProviderPolicyFingerprint
resolvedContextDigest
queryPlanRevision
accessRevision
policyContextRevision
providerResponseId?
```

The AnswerRun pin describes immutable execution identity. Attempt audit records policy/context evaluation for that specific attempt.

## 4. Pin establishment

A5 introduces an execution-identity resolver port whose input is server authority, not Browser payload:

```text
resolveInitialAIExecutionIdentity({
  principalId,
  projectId,
  answerRunId,
  authorizedContext
})
```

For A5 tests this resolver may be deterministic/fake. Production A8 will supply the real `EffectiveAIConfigurationResolver`.

The A5 repository/API must make it impossible for the initial attempt to invoke a provider with a provider/model/credential tuple different from the durable pin.

## 5. Retry semantics

### 5.1 RETRY_SAME_CONTEXT

Identity:

```text
providerId                unchanged
modelId                   unchanged
aiConfigurationRevision   unchanged
credentialId              unchanged
credentialRevision        unchanged
resolvedContextDigest     must reproduce original compatible context identity
```

Immediately before execution, the exact pinned credential revision is revalidated. If it is revoked, removed, inaccessible, wrong-Project or unavailable, retry fails closed. No latest-credential lookup or substitution is allowed.

The original SourceVersion/context identity is retained. Re-resolution may occur only to prove the immutable source/context digest still matches; mismatch fails closed rather than silently changing the context.

### 5.2 RETRY_CURRENT_POLICY

Identity remains unchanged:

```text
provider/model/configuration/credential pin = original
```

Only current policy/provider eligibility is reevaluated. A newly selected provider/model/API key in Settings is not used for the retry.

### 5.3 New configuration requires new execution

There is no implicit `retry with current provider/model` meaning. To use a newly selected provider/model/credential, the user creates a new Ask execution.

## 6. Persistence design

A5 uses additive migration only.

Preferred physical design:

- add immutable pin columns to `frontend_ask.answer_runs`, or a one-to-one immutable `answer_run_ai_pins` table if trigger/compatibility constraints make that cleaner;
- add explicit provider/config/credential revision audit columns to `frontend_ask.answer_run_attempts`;
- preserve all existing AnswerRun/attempt rows; historical rows created before A5 may have null pin fields and are treated as `LEGACY_UNPINNED` historical data, not retroactively fabricated;
- new A5-managed execution rows require a complete pin before external provider invocation.

The implementation may choose columns vs one-to-one table after inspecting migration compatibility, but it cannot weaken the logical invariants above.

## 7. Repository/service contract

Minimum operations:

```text
readExecutionPin(answerRunId)
createExecutionPinIfAbsent(expected unpinned, pin)
readExactAttemptIdentity(attemptId)
setAttemptEffectivePolicy(...)
revalidatePinnedCredential(...)
```

`createExecutionPinIfAbsent` must be concurrency-safe. Two workers cannot create different pins for one AnswerRun.

## 8. Failure behavior

- no Project AI identity available -> `CONFIGURATION_REQUIRED`/`AI_CAPABILITY_UNAVAILABLE` at the future production resolver boundary;
- pin persistence conflict -> fail closed / execution not invoked;
- exact credential unavailable -> deterministic configuration/credential failure, not latest fallback;
- context digest mismatch -> deterministic fail closed;
- policy denial -> `POLICY_DENIED`;
- no failure path logs credential material.

## 9. Migration/recovery behavior

Worker restart/recovery must preserve the same pin. Recovery of a claimed/running attempt does not resolve current Settings again as new execution identity.

Lease loss and reclaim may create/recover attempt processing according to the existing worker contract, but the AnswerRun pin remains the sole provider/model/config/credential identity authority.

## 10. Explicit exclusions

A5 does not implement:

- OpenAI/DeepSeek/Gemini network adapters;
- provider Test Connection;
- Settings AI backend routes;
- `/settings/ai` frontend;
- runtime provider router;
- startup Gemini removal;
- actual external egress.

## 11. Acceptance criteria

- A5-AC01: every new managed AnswerRun has one immutable AI execution pin before provider invocation.
- A5-AC02: pin contains provider/model/configuration/credential revision/policy identity and no secret material.
- A5-AC03: concurrent initial workers cannot create divergent pins.
- A5-AC04: each attempt records effective policy/context audit plus the pinned identity.
- A5-AC05: Settings changes do not mutate an existing pin.
- A5-AC06: `RETRY_SAME_CONTEXT` preserves provider/model/config/credential and compatible context identity.
- A5-AC07: `RETRY_CURRENT_POLICY` preserves provider/model/config/credential and reevaluates only current policy eligibility.
- A5-AC08: revoked/removed/unavailable exact credential revision fails closed.
- A5-AC09: retry never substitutes the latest credential.
- A5-AC10: restart/recovery retains the original pin.
- A5-AC11: migration is additive and historical unpinned rows are preserved without fabricated identity.
- A5-AC12: existing cancellation, lease, recovery, export, feedback and transition-seed semantics regressions are absent.
- A5-AC13: runtime provider cutover remains out of scope.

## 12. Focused verification

Test only changed risk:

- immutable pin creation;
- concurrent pin race;
- attempt audit persistence;
- same-context retry identity;
- current-policy retry identity;
- revoked exact credential failure;
- Settings/config revision change after original run does not affect retry;
- worker recovery uses existing pin;
- secret leak negative assertions;
- database migration preservation under `TEST_DATABASE_URL`.

Do not duplicate the same invariant across multiple test layers unless a distinct boundary risk requires it.

## 13. Exit condition

A5 is complete only after implementation merge and successful automatic post-merge `main` CI. A6 cannot start before that closure.
