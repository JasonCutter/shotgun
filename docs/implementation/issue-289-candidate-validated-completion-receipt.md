# Issue #289 — CandidateValidated V2 completion receipt

- Issue: [#289](https://github.com/JasonCutter/shotgun/issues/289)
- Canonical base: `main@13fbbde43a6ecf8d0303531863ea371f3b06fda9`
- Target module: `stage5.comparison`
- Target seam: `CandidateValidated` event handler → durable Connector/Job result
- Status: implementation and focused verification on branch; merge intentionally excluded

## Source audit

The audit was performed against the exact canonical base before editing.

| Rollout / trigger                        | Pre-change handler result                                                                                                | Side effects and ACK boundary                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `V1_ONLY` / event or replay              | `undefined` after the V1 `ComparisonResult` is published                                                                 | V1 comparison and `ComparisonCompleted` remain authoritative for this path              |
| `V2_SHADOW` / event or replay            | `undefined` after the V1 compatibility comparison is published                                                           | V2 is observed only; V1 remains the successful path                                     |
| `V2_ACTIVE` / `INITIAL_OR_EVENT_REPLAY`  | `undefined` because `executeComparison` returns normalized V2 outcome without a V1 result and the handler returned early | Orchestrator completion plus Review bridge `DRAFT_CREATED` is the required-ACK boundary |
| `V2_ACTIVE` / explicit operator re-entry | Command already returned the normalized V2/review result; no event-job receipt was involved                              | Existing command behavior is unchanged                                                  |

The weak/null path was therefore the `V2_ACTIVE` CandidateValidated event: the
handler's `if (!execution.result) return` discarded the successful V2 outcome.
`ConnectorRuntime.executeDeduplicatedDurable` passes a handler return value to
`PostgresJobRuntime.run`; `PostgresJobRuntime.complete` and
`PostgresDedupStore.complete` already persist that value as JSONB. The storage
seam needed no schema change. `DedupStore.get` exposes the value for duplicate
delivery and reconciliation; `JobRecord` intentionally remains an operational
state projection and does not make the result a domain contract.

The current result consumers are Connector duplicate/read-back/reconciliation
paths and the PostgreSQL durable adapter. No Product API, UI, Activity
projection, telemetry, Comparison authority, Review authority, or Canonical
writer treats the connector/job result as authoritative domain state.

Semantic deduplication is keyed by the existing project/security/consumer/
message/semantic identity and fingerprint. A completed duplicate returns the
persisted result without invoking the handler. The V2 Review bridge also
converges replayed completed comparisons on its existing
`comparison-v2:<comparisonId>` draft identity.

The accepted safe identifier available at this seam is the opaque V2
`comparisonId`. A Comparison revision is not part of the existing accepted
runtime result, so no synthetic revision was added.

## Receipt design

Only the authoritative V2 event-success boundary returns this internal,
operational projection:

```ts
{
  kind: 'CANDIDATE_VALIDATED_COMPLETION';
  version: 1;
  rollout: 'V2_ACTIVE';
  v1Executed: false;
  v2Status: 'COMPLETED';
  comparisonId?: string;
  reviewStatus: 'DRAFT_CREATED';
}
```

Every field is bounded operational evidence: rollout explains the selected
server policy, `v1Executed` distinguishes the legacy path, `v2Status` records
the terminal lifecycle, `comparisonId` is an opaque lookup identity when the
accepted runtime returned it, and `reviewStatus` proves the same Review draft
boundary that permits the required ACK. The receipt contains no candidate or
evidence text, rationale, prompt, provider output, security-scope contents,
Canonical content, approval decision, or serialized V2 aggregate.

The event handler now returns the receipt after the authoritative V2 runtime
boundary. If that boundary is missing Review evidence it fails closed. V1-only
and shadow event return behavior remains unchanged. The event-handler type was
made result-capable so the durable runtime can persist the internal value; no
wire schema or Product contract was changed.

## Integration and OSS decision

This is a narrow seam change; no external package was adopted or extracted.
The existing verified references were reviewed using the repository's locked
source records:

| Candidate                                                         | Version / commit                           | License          | Decision and boundary                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT              | `REFERENCE_ONLY`; job/retry/recovery ideas are already represented by Shotgun's Connector/Job Ports; no runtime or DB model is imported |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0       | `REFERENCE_ONLY`; its conversion/evidence components do not provide this Connector result seam                                          |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT              | `REFERENCE_ONLY`; Action/Home UX is unrelated to durable CandidateValidated result persistence                                          |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)  | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later | `REFERENCE_ONLY`; Activity/Burst Diff presentation is unrelated and its runtime/storage is excluded                                     |

The existing PostgreSQL durable Connector adapter remains the previously
approved foundation choice. No new dependency, version pin, migration,
Contract Snapshot, or ADR is introduced. Rollback is a code rollback to the
prior handler return behavior; persisted JSONB values remain readable by the
existing adapter.

## Verification plan and results

- Unit: authoritative V2 completion returns the exact bounded shape and a
  structural/data-minimization assertion rejects content-bearing fields.
- Unit: a V2 path without Review success fails closed and cannot produce a
  receipt.
- Database: retryable first attempt → successful second attempt persists one
  receipt in `connector.jobs` and `connector.dedup_records`; a fresh runtime
  reads it back and a duplicate returns the same value. A terminal failure
  leaves both result fields null/absent.
- `npm run typecheck` and Prettier checks for changed files are required.

The PostgreSQL test is guarded by `TEST_DATABASE_URL` and is skipped when no
isolated test database is configured locally; CI must execute it with the
repository's normal database gate.

## Exclusions and remaining risks

Recompare Product/UI/HTTP behavior, retry-policy redesign, Review approval or
authority changes, Canonical writes, new Product surfaces, Home/Activity work,
semantic stale fallback, provider-specific behavior, and database migration are
intentionally excluded. The receipt is operational evidence only; any future
consumer must preserve that non-authority boundary.
