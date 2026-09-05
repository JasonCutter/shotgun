# ADR-161 — DeepSeek-only Generative AI Execution

- Status: **ACCEPTED**
- Proposed at: 2026-09-05
- Accepted at: 2026-09-05
- Acceptance authority: Project Shotgun architecture/controller approval
- Decision owner: Project Shotgun controller
- Subject base: `main@7e28a156489a7af2e254be1074ea29fc82bf456c`
- Related decisions: ADR-133, ADR-143, ADR-148, ADR-153, ADR-154, ADR-160

## Context

Shotgun retains OpenAI and Gemini adapters and historical execution evidence, but
new generative requests must have one deterministic provider authority. Separate
semantic embedding execution is not generative completion and remains governed by
its existing embedding registry and profile.

## Decision

All new authoritative generative AI execution uses exactly:

```text
providerId = deepseek
modelId    = deepseek-v4-flash
```

The existing Project AI configuration, Credential Vault, provider registry,
provider policy, Standing AI Processing Policy, Effective AI Configuration
Resolver, Discovery profile service and governed provider ports remain the
authority. Product composition enables the DeepSeek-only policy at those existing
boundaries; no second router or per-feature provider call is introduced.

New active configuration and standing-policy writes using OpenAI, Gemini or any
other provider fail closed. Runtime resolution also rejects a current non-DeepSeek
configuration for a new logical request. DeepSeek failures retain the existing
retry/terminal semantics and never fall back automatically to another provider.

An existing durable request may continue only with its exact frozen historical
provider/model/credential/policy identity when the existing recovery contract
supplies that identity. Historical configuration revisions, provider-call rows,
AnswerRun pins, Discovery profiles and review evidence are immutable/readable and
are not rewritten or converted to DeepSeek. A historical provider cannot create a
new logical request.

## Accepted and rejected alternatives

Accepted:

- DeepSeek-only new generation with `deepseek-v4-flash`.
- Shared Product authority and Vault/Policy/Resolver boundaries.
- Independent embedding subsystem unchanged.
- Explicit fail-closed behavior without provider fallback.

Rejected:

- deleting OpenAI/Gemini adapters or rewriting historical identity;
- direct DeepSeek calls from Ask, Stage 4, Discovery or Comparison modules;
- silent OpenAI/Gemini fallback after a DeepSeek failure;
- treating DeepSeek generation as an embedding implementation.

## Scope and enforcement

The policy covers Ask answer generation, Source/Stage 4 extraction and
re-extraction, Discovery generation, Comparison v2 semantic analysis and other
structured generative paths using the shared execution authority. Embedding
generation/retrieval is explicitly outside this decision.

## Verification and failure semantics

Focused DSK-1 through DSK-8 tests cover configuration rejection/acceptance,
runtime defense, Ask, Stage 4, Discovery, Comparison identity, no fallback and
historical recovery. A missing or unusable project-scoped DeepSeek credential is
reported as `DEEPSEEK_EXTERNAL_CREDENTIAL_REQUIRED`; no secret is fabricated or
printed. Migration and rollback use the existing Product command paths and retain
all prior revisions.

## OSS integration decision

`NO_RELEVANT_OSS` for provider authority policy. The verified gbrain, llmwiki,
llm-wiki and Inkeep OpenKnowledge references remain `REFERENCE_ONLY`; none is
promoted to Shotgun runtime, provider selection, Canonical or embedding authority.
No new dependency or lockfile change is adopted.
