# ADR-164 — DeepSeek V4.1 Flash Model Identity

- Status: **ACCEPTED**
- Proposed at: 2026-09-14
- Accepted at: 2026-09-14
- Acceptance authority: Project Shotgun GPT/controller approval
- Decision owner: Project Shotgun controller
- Work item: Issue #306
- Subject base: `main@28d0296e7e7dc0509b89f4077ecd6f7a565a3c5b`
- Related decisions: ADR-133, ADR-143, ADR-161, ADR-162
- Product implementation: **AUTHORIZED by Issue #306**
- Database migration: **NOT REQUIRED**

## Context

The DeepSeek V4.1 Flash service now identifies the current generative model as
`deepseek-flash`. The older `deepseek-v4-flash` identifier appears in immutable
historical configuration revisions, provider-call records, execution pins and
evidence. New Product configuration and execution must use the current identity
without rewriting those historical records.

## Decision

The canonical identity for newly authored generative execution is:

```text
providerId = deepseek
modelId    = deepseek-flash
display    = DeepSeek V4.1 Flash
```

ADR-161 remains authoritative for the DeepSeek-only provider boundary and its
no-fallback, credential, privacy, standing-policy and historical-recovery rules.
Only ADR-161's model-identity clause is superseded by this decision.

The provider registry exposes `deepseek-flash` as the sole selectable current
DeepSeek generative model. `deepseek-v4-flash` is a bounded historical alias: it
is not listed or accepted by new configuration/profile writes, but an existing
durable historical pin may resolve the exact alias for retry/replay. The alias
must retain its original model identity when sent to the provider. Current
configuration rows are not silently rewritten; a new canonical configuration
must be explicitly saved by the owner before a new logical request can run.

No database migration is introduced. Existing rows remain immutable and
replayable. Rollback is the existing configuration revision path: the owner may
save a governed canonical revision, while historical revisions remain readable.

## Verification and OSS integration

Required coverage includes current registry presentation, canonical-only new
configuration/profile writes, canonical Source/Ask/Discovery pins, historical
alias retry/replay reconstruction, provider-router compatibility, and negative
checks that the alias is not selectable. The standing DeepSeek-only policy,
Canonical/Review/Approval boundaries and no-fallback behavior remain unchanged.

`NO_RELEVANT_OSS`: this is a provider identity/catalog correction. The verified
gbrain, llmwiki, llm-wiki and Inkeep OpenKnowledge references remain
`REFERENCE_ONLY`; no dependency or lockfile change is adopted.
