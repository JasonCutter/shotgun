# A8 OSS Integration Decision

Status: `NO_RELEVANT_OSS` for new runtime-routing adoption; existing Shotgun
provider adapters and the pinned `@google/genai` dependency remain in place.

## Scope reviewed

The A8 boundary is server-authoritative request-time resolution, immutable
execution pinning, provider-specific privacy gating, bounded credential access,
and integration with the existing Ask durable worker. The reviewed repository
role matrix and existing evaluation material covered:

- `https://github.com/garrytan/gbrain` — execution/job patterns are
  `REFERENCE_ONLY`; its runtime and provider authority are not adopted.
- `https://github.com/lucasastorian/llmwiki` — transformation/evidence scope;
  not relevant to provider routing.
- `https://github.com/ddsyasas/llm-wiki` — Settings/Ask UX patterns only;
  not a backend runtime authority.
- Inkeep OpenKnowledge — UI/activity patterns only; its runtime and storage
  authority are excluded.

No external runtime package was reused, extracted, or added for A8. No
upstream version, commit, license, or lockfile entry is therefore being
promoted to a production dependency.

## Decision and replacement boundary

`EffectiveAIConfigurationResolver` and `AIProviderRouter` remain Shotgun-owned
ports and adapters. A2 owns secret access, A3 owns provider/model authority,
A4 owns egress eligibility, A5 owns the durable execution pin, and the Ask
worker remains the owner of claim, retry, recovery, and grounding semantics.

The direct implementation is necessary because an external runtime would not
be safely isolatable behind these boundaries without transferring Project,
privacy, credential, or canonical execution authority. Replacement remains
possible through `AskAnswerProviderRouterPort` and the existing connectivity
adapter contract. A future OSS candidate may be reconsidered only after a
version/license/security review and adapter contract tests.
