# ADR-154: WP-04 Source/Evidence Stage 3 Progress and Stage 4 Continuation

- Status: Accepted for WP-04 implementation
- Date: 2026-09-03
- Scope: Source Product Stage 3 → Evidence → Stage 4 handoff

## Decision

WP-04 adds three additive authorities:

1. `source_product.source_stage3_progress` owns one fenced logical Stage 3
   execution position per `(project_id, source_version_id)`.
2. `evidence.indexing_results` records the durable indexing outcome, including
   an explicit `NO_EVIDENCE` result. Existing EvidenceSpan rows remain the
   Evidence authority.
3. `evidence.stage4_continuations` records the durable Stage 4 handoff and its
   lease/retry lifecycle. It is created only when the indexing result has at
   least one EvidenceSpan.

The existing `source_product.intake_submissions`, items, attempts, and the
`OUTCOME_INDETERMINATE` transition remain the submission lifecycle authority.
They are not duplicated into the new progress table. `EvidenceIndexedV1` keeps
`items.minItems = 1`; a zero-result indexing run is internal `NO_EVIDENCE` and
does not publish that event.

## Invariants

- Materialization is committed before Stage 3 execution; post-commit errors
  never rollback a committed SourceVersion.
- A Stage 3 retry resumes the same SourceVersion and uses the progress row's
  fencing token; it never creates a new SourceVersion.
- `INDEXED` has `evidence_count > 0`; `NO_EVIDENCE` has `evidence_count = 0`.
- Stage 4 failure changes only the continuation state. SourceVersion and Stage
  3 durable outcomes remain successful.
- Historical Evidence without a durable Stage 4 intent is not permission to
  call a provider. Historical rows without Evidence are
  `RECONCILIATION_REQUIRED`, never inferred `NO_EVIDENCE`.
- The production application starts a Stage 3 recovery dispatcher during
  startup and repeats it periodically; the Canonical-only recovery harness
  deliberately does not start Source/Stage 3 or Stage 4 workers.
- A Stage 4 connector `TIMEOUT`/`OUTCOME_UNKNOWN`, or a continuation lease that
  expires while publishing, becomes durable `OUTCOME_UNKNOWN`. It is not
  automatically replayed against a provider; explicit reconciliation reuses
  the deterministic candidate-generation request identity.

## Alternatives rejected

- Submission-level state alone: cannot express SourceVersion-level execution,
  lease/fence, or zero-result outcome.
- Adding Stage 3 lifecycle columns to intake items: would couple Source Product
  to Evidence result and continuation ownership and cannot serve a
  SourceVersion reused across product lifecycle paths without duplication.
- Generic `pipeline_progress`: rejected as an unbounded second workflow
  authority; the table is explicitly SourceVersion Stage 3 only.
- Reusing Discovery recovery tables: rejected because their lifecycle and
  ownership are Discovery-specific.

## OSS / reference decision

- PostgreSQL 16.14: `ADOPTED` as the durable transaction/lease store.
- gbrain migration/recovery patterns: `REFERENCE_ONLY`; no gbrain runtime or
  schema IDs cross the Shotgun ports.
- lucasastorian/llmwiki transformation/evidence patterns:
  `EXTRACT/AUGMENT` through the existing transformer and Evidence ports; no
  SQLite/VaultFS/MCP runtime is introduced.
- ddsyasas/llm-wiki and Inkeep OpenKnowledge: `REFERENCE_ONLY` for UX/patterns;
  no backend or GPL runtime is introduced.
