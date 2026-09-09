# ADR-130 Dated Amendment — Stage 5 Comparison Blocked Observability

- Amendment date: 2026-09-09
- Governing ADR: `ADR-130 — Frontend Agent·Job Activity Federated Projection, Identity and Retry Boundary`
- Tracking issue: `#245`
- Subject base: `main@d6b216ecf3d250f0c4aa774d58c98b8f2d30def2`
- Status: **IMPLEMENTATION-SCOPED AMENDMENT**
- Authority: Stage 5 V2 implementation review

## Purpose

This dated amendment records the narrow addition required to make pre-terminal
Stage 5 V2 blocked outcomes observable through the existing ADR-130 Activity
projection. It does not turn Activity into an execution ledger and does not
change the Comparison, Review, Approval, or Canonical authorities.

## Additive decision

Comparison owns a durable `blocked_outcomes_v2` operational read source for
safe Stage 5 blocks that have no terminal `ComparisonResultV2` or
`AnalysisRevisionV2`. The record is limited to project/candidate revision and
digest identity, blocked phase, allow-listed safe code, governing input digest,
access scope, sensitivity, timestamps, and active/resolved/superseded state.
Claim text, protected Canonical text, prompts, provider payloads, credentials,
and raw exception details remain excluded.

The identity is immutable and replay-idempotent. A replay of the same candidate
and governing input updates observation time only; a changed candidate revision
or governing identity creates a distinct record. A later terminal Stage 5
outcome resolves or supersedes the active block without deleting history.

## Activity boundary

`COMPARISON` is added as the smallest ADR-130 Activity domain extension. The
Comparison adapter is read-only, maps active blocks to `FAILED` /
`NEEDS_ATTENTION`, and maps resolved/superseded blocks to a non-attention
terminal projection. It exposes no generic Retry or Cancel action. Any future
re-entry remains server-authoritatively delegated to the existing
`RecompareClaimCandidate` boundary.

The Home Action Center may consume this federated Activity projection through
its existing failed/blocked mapping. It must not receive protected metadata or
gain Comparison/Review/Canonical mutation authority.

## Explicit exclusions

This amendment does not authorize a generic workflow/event store, a second
Activity execution ledger, v1 fallback, Candidate Generation changes, provider
policy changes, Review or Approval changes, Canonical writes, or owner-data
reprocessing. Invalid request, access, integrity, policy, snapshot, resource
scope, and similar security/input failures remain outside owner Attention and
continue to fail closed without a blocked record.

## Contract and rollback

The schema change is additive and guarded by Stage 5 table preflight. Rollback
is to stop registering the Comparison adapter and leave the operational table
untouched for forensic retention; no existing Activity, Comparison, Review, or
Canonical row is rewritten. Focused idempotency, security, adapter, and
terminal-resolution tests are required before this amendment is considered
implemented.
