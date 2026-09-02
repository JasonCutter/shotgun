# Project Standing AI Processing Policy — Implementation Record

## Scope

This record implements [ADR-153](../architecture/adr/ADR-153-project-standing-ai-processing-policy.md)
on the validated Ask-runtime correction branch. The prior Ask/CSRF/Source/BOM/
actual-use correction remains unchanged at its accepted exact head and is not
retested here.

## Contract and persistence

- `packages/policy/src/index.ts` owns the deterministic standing-policy
  contract, writer port, evaluator, and optimistic-revision service.
- `packages/contracts/src/ai-standing-policy.ts` carries the non-secret
  Project/provider/configuration/policy identity.
- Migration `060_project_standing_ai_processing_policy.sql` owns the append-only
  revision stream and current pointer with immutable/monotonic database guards.
- The PostgreSQL adapter writes a non-secret settings audit event for each
  policy change.
- Existing Projects migrate to disabled revision 1; new Project creation
  initializes disabled revision 1 transactionally.

## Effective resolution

- Ask uses the standing policy before the historical per-provider approval
  path. Restricted context and deployment hard-deny still win.
- Semantic embedding resolution and provider routing use the same evaluator;
  the execution pin records the standing-policy revision.
- Discovery uses the existing effective AI execution resolver, whose Ask policy
  authority now resolves the standing policy.
- Credential vault ownership and provider/model/configuration validation remain
  independent and unchanged.

## Capability wiring audit

| Product path                          | Status      | Evidence/boundary                                                                                                                                                                     |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask                                   | `WIRED`     | `AskProviderPolicyResolver` reads standing authority before Ask eligibility and submission revalidation.                                                                              |
| Embeddings                            | `WIRED`     | `SemanticEmbeddingAuthorityResolver` and `SemanticEmbeddingRouter` evaluate the same standing authority.                                                                              |
| Stage 4 candidate analysis/validation | `NOT_WIRED` | The current production assembly does not invoke an external Stage 4 provider path; its deterministic contract remains unchanged. This work does not claim Ask success proves Stage 4. |
| AKP Discovery AI-assisted generation  | `WIRED`     | Discovery resolves through `EffectiveAIConfigurationResolver`/`DiscoveryAIExecutionResolver`, which consumes the standing-aware Ask policy authority.                                 |

## OSS and replacement boundary

The existing OSS evaluation record remains the starting point. No new OSS
dependency is introduced. The deterministic in-process evaluator is behind a
package port and the PostgreSQL adapter owns only standing-policy persistence;
provider SDKs and adapter-specific IDs do not enter the domain contract.

## Validation record

Focused policy, Ask, embedding, and AI settings tests are run during
implementation. The final `npm run check` is run once from a clean checkout
with the dedicated `TEST_DATABASE_URL`; the exact result and all stage outcomes
are recorded in the completion report. The prior DeepSeek actual-use test is
not repeated.
