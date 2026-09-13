# Issue #287 — Comparison V2 required-ACK recovery classification

## Typed classification table

The publisher ACK boundary consumes typed state and readiness evidence only. A
missing evidence field is fail-closed (`FAILED_TERMINAL`); diagnostic `detail`
strings are never parsed for retryability.

| Source             | Typed state / reason                                                               | Evidence required for durable retry                                                                                               | Classification                        |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| AnalysisRevisionV2 | `FAILED_RETRYABLE` (except `OUTCOME_UNKNOWN`)                                      | state itself                                                                                                                      | `FAILED_RETRYABLE` (`retryable=true`) |
| AnalysisRevisionV2 | `FAILED_TERMINAL`                                                                  | state itself                                                                                                                      | `FAILED_TERMINAL` (`retryable=false`) |
| AnalysisRevisionV2 | `POLICY_BLOCKED`                                                                   | safe policy code                                                                                                                  | terminal re-entry (`retryable=false`) |
| AnalysisRevisionV2 | `SEMANTIC_UNAVAILABLE`                                                             | `PROVIDER_UNAVAILABLE`, `ANALYSIS_TIMEOUT`, `RETRYABLE_DEPENDENCY`, or explicit retryable execution evidence                      | durable retry only with evidence      |
| Shortlist          | `LEXICAL_STALE`, `SEMANTIC_STALE`, `GENERATION_UNAVAILABLE`, `GENERATION_MISMATCH` | typed reason/readiness                                                                                                            | durable retry                         |
| Shortlist          | `LEXICAL_UNAVAILABLE`                                                              | `lexicalRetryable` from a typed timeout/dependency error                                                                          | durable retry only with evidence      |
| Shortlist          | `SEMANTIC_UNAVAILABLE` / degraded readiness                                        | `semanticRetryable`, `semanticExecution` is `PROVIDER_UNAVAILABLE` or `TEMPORARILY_UNAVAILABLE`, or safe timeout/provider failure | durable retry only with evidence      |
| Shortlist          | policy, snapshot, coverage, contract, invalid, access, or unsupported states       | typed reason                                                                                                                      | terminal re-entry                     |
| Review Bridge      | `FRESHNESS_UNAVAILABLE`                                                            | typed recoverable freshness error                                                                                                 | durable retry only with evidence      |
| Review Bridge      | stale, authority, access, decision, aggregate, or eligibility blocks               | typed reason                                                                                                                      | terminal re-entry                     |
| Runtime            | rollout downgrade or missing Review bridge/configuration                           | typed runtime condition                                                                                                           | terminal re-entry                     |
| Runtime            | `OUTCOME_UNKNOWN`                                                                  | existing outcome-unknown path                                                                                                     | unchanged; never ordinary retry       |
| Runtime            | `EXPLICIT_OPERATOR_REENTRY`                                                        | server-owned trigger                                                                                                              | domain return; not publisher retry    |

## Boundary and OSS audit

- Target: Stage 5 Comparison V2 runtime required-ACK boundary; no Comparison,
  Review, Canonical, Product wire, retry-policy, or database authority change.
- `garrytan/gbrain` commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT),
  `lucasastorian/llmwiki` commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`
  (Apache-2.0), `ddsyasas/llm-wiki` commit
  `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` (MIT), and Inkeep OpenKnowledge
  commit `f2834c237639e2cff603817ed88182b33f83cf91` (GPL-3.0-or-later) were
  reviewed from the existing Stage 5 registry/ADR. All remain
  `REFERENCE_ONLY`; none provides a safe typed ACK/retry authority to adopt or
  extract. `NO_RELEVANT_OSS` applies to this internal classifier.
- Existing `ShotgunError` codes and the PostgreSQL connector/job-runtime retry
  contract are reused. No new error code, dependency, migration, or lockfile
  is introduced.
- Rollback is source-level: remove the classifier/typed evidence propagation;
  fail-closed required ACK remains the fallback and persisted history is not
  rewritten.
