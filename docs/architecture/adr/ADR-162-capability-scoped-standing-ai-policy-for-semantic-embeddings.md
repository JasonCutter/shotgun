# ADR-162 — Capability-Scoped Standing AI Policy for Semantic Embeddings

- Status: **ACCEPTED**
- Proposed at: 2026-09-06
- Accepted at: 2026-09-06
- Acceptance authority: Project Shotgun architecture/controller approval
- Decision owner: Project Shotgun controller
- Subject base: `main@aef057384681278dda17ae474e56b087855e8ee9`
- Related decisions: ADR-148, ADR-153, ADR-161

## Context

ADR-153 made Ask, embedding and Discovery share one provider-bound Standing AI
Processing Policy. ADR-161 subsequently made new generative execution
DeepSeek-only while explicitly preserving the independent semantic embedding
profile and registry authority. Applying the generative `providerId` binding to
an OpenAI embedding pin therefore incorrectly denies a valid semantic query and
degrades Comparison v2 readiness.

## Decision

For semantic embeddings, provider, model, profile, credential and representation
authority remains the active Semantic Embedding Profile plus the frozen Semantic
Generation pin. A capability-scoped standing-policy evaluator enforces only:

- project automatic-AI enabled/disabled authority;
- restricted external-transfer hard denial;
- private deployment-ceiling enforcement against the pinned embedding provider.

When a Standing AI Processing Policy exists and is enabled, a mismatch between
its generative `providerId` and the embedding pin provider does not deny
embedding execution. If no Standing Policy exists, the existing legacy
provider-approval/deployment compatibility path remains authoritative. No
automatic provider fallback is introduced.

The ordinary generative evaluator remains provider-bound and continues to fail
closed on a DeepSeek/OpenAI mismatch. The historical
`ignoreStandingProviderMismatch` recovery flag is not used by the embedding
router and its meaning is not broadened.

## Rejected alternatives

- changing an existing OpenAI embedding generation to DeepSeek;
- treating `deepseek-v4-flash` as an embedding model;
- duplicating the Standing AI Processing Policy or adding another Project UI toggle;
- weakening restricted/private deployment controls;
- rewriting existing semantic generations;
- using `ignoreStandingProviderMismatch` for normal embedding execution.

## Scope and invariants

The correction changes only the inappropriate generative provider comparison.
All existing embedding authority checks remain mandatory: active profile and
generation, revisions, provider/model and credential identity, registries,
representation, dimension, metric, normalization, watermark freshness,
connectivity, credential lifecycle, returned identity and vector validity. No
database migration is required, and Gate A evidence is immutable.

New Ask, Stage 4, Discovery and Comparison semantic analysis execution remains
DeepSeek-only under ADR-161.

## Verification

EMB-POL-1 through EMB-POL-8 cover the independent OpenAI embedding/DeepSeek
generative topology, deployment and restricted/disabled denials, unchanged
generative mismatch enforcement, Hybrid Retrieval readiness and Comparison
shortlist readiness. Focused type, architecture, formatting and changed-file
lint checks are required before the Draft PR is reviewed.

## OSS integration decision

`NO_RELEVANT_OSS` for capability-scoped policy evaluation. The verified gbrain,
llmwiki, llm-wiki and Inkeep OpenKnowledge references remain
`REFERENCE_ONLY`; no external policy engine or dependency is adopted.
