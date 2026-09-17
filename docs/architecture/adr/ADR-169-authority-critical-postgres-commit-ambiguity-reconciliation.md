# ADR-169 — Authority-Critical PostgreSQL Commit-Ambiguity Reconciliation

Status: Accepted for Issue #335 (2026-09-17)

## Context

The Issue #334 post-TF audit and the Issue #335 WP1 proof matrix demonstrated a
real PostgreSQL commit-success followed by lost-acknowledgement condition in
five authority-critical Stage 3, Stage 4, and Stage 5 paths. Raw callers could
attempt `ROLLBACK` after the database had already committed, and callers could
therefore observe a false failure even though the intended authority had become
durable. Eight existing SAFE_ALREADY replay paths were separately proven safe
and are not business-rewritten by this decision.

## Decision

1. `withSafePostgresTransaction` is the sole transaction-outcome authority for
   the approved Issue #335 corrections.
2. Once `COMMIT` has been attempted, no caller or helper may issue `ROLLBACK`.
3. A lost commit acknowledgement is represented as typed `OUTCOME_UNKNOWN`,
   not as an ordinary success or failure.
4. Each authority mutation reconciles the ambiguity with a clean-pool,
   operation-specific exact durable readback.
5. If the exact intended durable material is present, the caller returns the
   authoritative success result.
6. If the exact pre-operation material remains, the caller preserves
   `OUTCOME_UNKNOWN` and never fabricates success.
7. If different or newer durable material is present, the caller fails closed
   with the existing conflict or stale-version semantics.
8. Existing SAFE_ALREADY paths retain their current idempotency and replay
   behavior; no bespoke business rewrite is required unless a future RED proof
   identifies one.
9. This is a targeted correction, not a blanket replacement of every raw
   transaction in the repository.

## Scope

The decision applies only to these five functions:

- `adapters/postgres-stage3/src/runtime-data-integrity.ts`
  - `PostgresSourcesStage3ProgressRepository.claim`
  - `PostgresSourcesStage3AtomicPersistence.persist`
  - `PostgresSourcesStage4ContinuationStore.claimNext`
- `adapters/postgres-stage4/src/index.ts`
  - `PostgresAIProviderCallRepository.claimNextAttempt`
- `adapters/postgres-stage5/src/index.ts`
  - `PostgresChangeSetReviewV2Repository.markStaleIfCurrent`

The correction does not change the Canonical, Evidence, Approval, or Action
ownership boundaries; Stage 3 owns source-transformation and evidence
progress, Stage 4 owns provider-call execution records, and Stage 5 owns
review Draft state. RISK-001B and credential-scope hypotheses remain outside
this work package.

## OSS integration decision

`NO_RELEVANT_OSS` applies to this correction. The existing PostgreSQL adapter,
Shotgun transaction helper, and Shotgun-owned authority readbacks define the
required semantics; adopting an external runtime would not provide the
operation-specific ownership and fail-closed contracts. The previously
reviewed `gbrain`, `lucasastorian/llmwiki`, `ddsyasas/llm-wiki`, and Inkeep
OpenKnowledge references remain design or component references under the
existing Open-source Role Matrix. No new dependency, adoption, extraction, or
fork is introduced here.

## Verification

The proof matrix covers real commit success, lost acknowledgement, clean-pool
authoritative readback, correct reconciled caller result, zero post-commit
rollback attempts for all five corrected paths, exact retry/re-entry safety,
and duplicate prevention. All 13 proof tests pass, including the eight
SAFE_ALREADY cases. Focused PostgreSQL regressions, transaction-helper tests,
typecheck, lint, formatting, architecture checks, and the full database suite
are required before publish authorization.

## Migration, rollback, and publication boundary

No schema migration or Product database write is required. Rollback is a code
revert before publication; durable test fixtures are confined to
`shotgun_test`. This ADR and the five corrections remain in the working tree
until the controller reviews the STOP-BEFORE-PUBLISH report and separately
authorizes publication.

## References

- Issue #334 — Post-TF repository audit and RISK-001A classification
- Issue #335 — Post-TF Risk Correction WP1
- ADR-154 — Source/Evidence progress and Stage 4 continuation boundary
- ADR-155 — Connector durable state and `OUTCOME_UNKNOWN` recovery boundary
- ADR-163 — Explicit V2 `MODIFY_REVIEW` operation resolution
