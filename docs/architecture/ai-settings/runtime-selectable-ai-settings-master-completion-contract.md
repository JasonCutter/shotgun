# Runtime-selectable AI Settings — Master Completion Contract

- Status: **FROZEN / ACCEPTED BY USER**
- Canonical architecture: ADR-133, ADR-143
- Subject base: `main@ae0de25e91b8ed9d7fc875ef8b39771ec57f4c45`
- Program: `A1–A9 Runtime-selectable AI Settings`
- Product implementation authority: Section-by-Section only
- Deployment / Production Verification: separately authorized

## 1. Purpose

This document is the finite implementation map for the Shotgun feature that lets an authorized user choose an AI provider and model, enter/replace the provider API key in Settings, optionally test the connection, save the Project configuration, and have the next new Ask execution use that provider without restarting Shotgun.

DeepSeek is the initial default selection and the primary live verification provider. OpenAI and Google Gemini are full operational providers, not configuration-only placeholders: when a valid key is entered and their configuration is saved, the next new execution must be able to use them through the same server-authoritative runtime path.

This contract prevents scope drift by defining every Section's entry condition, owned responsibility, explicit exclusions and exit condition before the remaining implementation resumes.

## 2. Program map

| Section | Name | Status at subject base | Primary owned outcome |
| --- | --- | --- | --- |
| A1 | ADR-133 architecture | COMPLETE | Server-authoritative multi-provider architecture accepted |
| A2 | Credential Vault & Secure Persistence | COMPLETE / FINAL_AFTER_MERGE | encrypted Project/provider credential lifecycle |
| A3 | Provider Registry / Model Catalog / Project AI Configuration | COMPLETE / FINAL_AFTER_MERGE | registered providers/models and revisioned Project selection authority |
| A4 | Provider-specific Privacy & Deployment Authority | NEXT | Project/provider approval + provider-aware deployment ceiling |
| A5 | Execution Identity / Pinning / Retry Foundation | NOT_STARTED | immutable AI execution identity and deterministic retry semantics |
| A6 | AI Settings Backend Control Plane & Multi-provider Connectivity | NOT_STARTED | secret-safe Settings backend, three provider adapters, Test Connection |
| A7 | Settings → AI Frontend Product | NOT_STARTED | complete user configuration workflow |
| A8 | Effective Runtime Resolution / Provider Routing / Ask Cutover | NOT_STARTED | request-time routing through saved Project configuration |
| A9 | E2E / Actual-use Completion Closure | NOT_STARTED | finite whole-flow evidence and Program closure |

No Section automatically starts the next one. Every Section is closed independently with exact-head evidence and post-merge main CI before the next Section starts.

## 3. Global invariants

These apply to every A4–A9 implementation:

1. Browser input is never provider/model/credential/privacy/deployment authority.
2. Provider/model choices are accepted only if present in the server-owned A3 registry/catalog.
3. Credential plaintext is never persisted outside the A2 vault's bounded secret handling path.
4. Credential ciphertext is not copied into Settings snapshots, frontend payloads, audit events or AnswerRun pins.
5. Project identity and access are server-derived.
6. SourceVersion is required for Ask context; Evidence remains optional; no AI result becomes Canonical automatically.
7. Restricted external transfer is always denied.
8. Private external transfer requires provider-aware deployment ceiling plus matching Project/provider approval.
9. Configuration changes apply only to new executions; in-flight execution identity is immutable.
10. Retry never silently substitutes another provider, model, configuration revision or credential revision.
11. Existing exact-head PASS evidence is reused rather than rerun without a changed risk.
12. `TEST_DATABASE_URL` is the only allowed target for destructive/reset database tests.
13. Existing DeepSeek uncommitted worktree state, if still present, is not destroyed/reset/reused without a separate architecture check.
14. AKP Product implementation remains outside this Program.

## 4. A4 frozen boundary — Provider-specific Privacy & Deployment Authority

### Entry

A3 is `COMPLETE / FINAL_AFTER_MERGE` on canonical main.

### Owned design

Logical authority:

```text
ProviderExternalTransferApproval
projectId
providerId
approved
approvalRevision
reviewedBy
reviewedAt
```

Approval is Project + Provider scoped, revisioned, audited and `REVIEW_REQUIRED` under ADR-103. Existing Settings proposal/review machinery is reused where it satisfies the authority contract; a parallel review system is not introduced without need.

Deployment ceiling is provider-aware, defaults to deny, and prefers:

```text
AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS
```

Only A3-registered provider IDs are meaningful. `GEMINI_ALLOW_PRIVATE` is compatibility-only for `google-gemini`; it never authorizes OpenAI or DeepSeek.

Historical `privacy.externalTransferAllowed=true` is interpreted as a compatibility approval for `google-gemini` only when no provider-specific Gemini approval record exists. Provider-specific history always wins once created. Historical generic Settings data is preserved, not rewritten.

### A4 acceptance criteria

- A4-AC01: provider-specific approval authority exists.
- A4-AC02: revisions/history are immutable and Project/provider isolated.
- A4-AC03: approval change requires separate owner review/approval.
- A4-AC04: deployment ceiling is provider-aware and default-deny.
- A4-AC05: arbitrary provider IDs cannot raise the ceiling.
- A4-AC06: legacy Gemini flags/approval never authorize OpenAI/DeepSeek.
- A4-AC07: historical Gemini compatibility works only until provider-specific authority exists.
- A4-AC08: restricted context is hard-denied.
- A4-AC09: private context needs both deployment and Project/provider approval.
- A4-AC10: existing Ask authorization/masking boundary remains intact.
- A4-AC11: no actual private external egress is required for A4 completion.
- A4-AC12: A5/runtime routing/UI/Test Connection remain out of scope.

### Exit

A4 implementation merged, automatic post-merge main CI successful, no unresolved blocking architecture/security gap.

## 5. A5 frozen boundary

Detailed authority: `a5-execution-identity-pinning-and-retry-detailed-design.md`.

A5 owns one immutable AI identity per AnswerRun plus per-attempt effective audit. It extends the existing durable `frontend_ask.answer_run_attempts` model rather than creating a second execution system.

Exit means the database/contracts/repository/service semantics can prove that settings changes cannot alter an existing AnswerRun and that retries preserve the exact original provider/model/configuration/credential revision identity.

## 6. A6 frozen boundary

Detailed authority: `a6-ai-settings-backend-and-multi-provider-connectivity-detailed-design.md`.

A6 owns the server-side Settings AI read model, secret-safe credential commands, Project AI configuration command, three operational provider adapters, provider error normalization and Test Connection.

DeepSeek is the initial default and primary live verification path. OpenAI/Gemini must be executable adapters and immediately usable after valid configuration; they are not postponed as placeholders.

A6 does not cut Ask runtime over to the new router.

## 7. A7 frozen boundary

Detailed authority: `a7-settings-ai-frontend-detailed-design.md`.

A7 owns `/settings/ai` as the canonical Product workspace. It provides provider/model selection, credential create/replace/remove surface, Test Connection, privacy/deployment status and Save/recovery UX while preserving secret handling rules.

A7 does not make Browser state runtime authority and does not cut over Ask execution itself.

## 8. A8 frozen boundary

Detailed authority: `a8-effective-runtime-resolution-provider-routing-and-cutover-detailed-design.md`.

A8 owns `EffectiveAIConfigurationResolver`, provider routing, vault-to-adapter bounded execution and Ask cutover. For Project-managed configuration, startup env provider/model values cease to be execution authority. Settings changes apply to the next new execution without restart.

Existing Projects may remain in bounded `LEGACY_GEMINI_COMPATIBILITY` only until their first explicit managed configuration save, after which the authority transition to `PROJECT_MANAGED` is irreversible.

## 9. A9 frozen boundary

Detailed authority: `a9-end-to-end-actual-use-completion-detailed-design.md`.

A9 adds no new Product authority. It proves all hand-offs and closes the Program.

Primary live external verification is DeepSeek. OpenAI/Gemini must pass adapter/routing/switching contract evidence and be operational when valid credentials are entered. Additional live calls to those providers are optional when they would duplicate risk evidence; they become mandatory only if implementation-specific risk cannot otherwise be proven.

## 10. Whole-Program acceptance criteria

The Program is not complete until all are true:

- P-AC01: A1–A9 Section criteria are closed.
- P-AC02: provider choices are exactly server-registered choices.
- P-AC03: DeepSeek is the fresh-Project default selection.
- P-AC04: no credential is fabricated; no managed configuration exists until authorized save.
- P-AC05: DeepSeek/OpenAI/Gemini all support valid Settings configuration and execution.
- P-AC06: API key create/replace/remove uses secret-safe server boundaries.
- P-AC07: Test Connection exists for all operational providers and uses synthetic/public content only.
- P-AC08: provider-specific privacy/deployment authority is enforced.
- P-AC09: immutable AnswerRun pin and retry semantics are enforced.
- P-AC10: saved provider/model/key changes affect the next new Ask without restart.
- P-AC11: in-flight execution is not mutated by Settings changes.
- P-AC12: legacy Gemini compatibility cannot revive after Project-managed transition.
- P-AC13: definite provider failures use ADR-133 error taxonomy; 401/403 are not misclassified as unknown outcome.
- P-AC14: browser reload never redisplays secret material.
- P-AC15: whole-flow automated E2E passes.
- P-AC16: DeepSeek public/synthetic actual-use verification passes.
- P-AC17: final exact-head required CI passes.
- P-AC18: merge and automatic post-merge main CI pass.

Final status authority:

```text
Runtime-selectable AI Settings
COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED
```

Deployment and Production Verification remain separate states and are not implied by this completion status.

## 11. Change-control rule

Internal implementation details may change inside a frozen Section if they preserve all invariants and criteria. Any change to provider authority, credential secrecy, retry identity, privacy approval meaning, compatibility transition, three-provider usability, or Program exit criteria requires an explicit ADR amendment/new ADR before implementation proceeds.
