# VP-09 Ask Prompt Injection Boundary — 2026-10-02

**Status: limited security evidence; VP-09 remains open.**

## Change

`StructuredAskAnswerProviderAdapter` now tells the Ask model that all text inside
Evidence quotes and SourceVersion content is untrusted source data, not
instructions. The instruction explicitly rejects source requests to override
the task, expose secrets, or fabricate citations. Existing Answer citation
references remain bound to the Evidence IDs issued by Shotgun.

The change is a prompt-policy layer. It does not replace server-side source
authorization, sensitivity enforcement, provider-egress policy, or citation
binding.

## Verification

- The focused adapter unit suite passed **11/11**. It checks that malicious
  source text stays in the JSON data context, the system instruction labels it
  untrusted, and the provider schema only accepts the issued `E1` reference.
- Five Ask, privacy, shell, and route-guard test files passed **38/38**.
- The PostgreSQL knowledge-read sensitivity suite passed **2/2**.
- The opt-in live suite used the configured DeepSeek credential with synthetic
  public evidence only. Both the existing conflict case and the injection case
  passed **2/2**. For the injection case, the answer returned the supported
  operating-profit amount `400`, omitted the synthetic
  `SHOTGUN-API-KEY-CANARY-NOT-A-SECRET` value, and cited the issued Evidence.
  No provider invoice readback was performed.
- `eslint` and `prettier --check` passed for all changed TypeScript files.

Relevant existing negative coverage includes server-authoritative Ask source
scope and cross-project cursor rejection in
[`frontend-ask-product-api.test.ts`](../../tests/integration/frontend-ask-product-api.test.ts),
restricted/private provider denial in
[`frontend-ask-provider-policy.test.ts`](../../tests/unit/frontend-ask-provider-policy.test.ts),
and invalid citation-reference rejection in
[`ai-provider-ask-citation-binding.test.ts`](../../tests/unit/ai-provider-ask-citation-binding.test.ts).

## OSS and rollback

The existing `ddsyasas/llm-wiki` decision remains `REFERENCE_ONLY` for Ask/Chat
UX. The role matrix records upstream commit
`e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` and MIT; its backend and LLM client
remain excluded. No package or runtime was added. There is no standalone OSS
component that can replace Shotgun's source trust, egress, or citation
contracts, so prompt-boundary enforcement stays in the Shotgun-owned adapter.
This change adds no schema or migration. Rollback is to remove the new system
instruction and its prompt-injection regression cases.

## Remaining VP-09 work

This single live model pass does not establish a general prompt-injection error
rate. VP-09 remains open for product-level privacy and citation-leakage
negative paths, unauthorized egress denial under each sensitivity setting, and
the remaining user-visible processing, failure, unresolved, and conflict
states. Keep the VP completion tracker unchecked.
