# Issue 203 WP6 Comparison Rollout Runbook

## Setting

Use the append-only project Settings command with key
`comparison.stage5.rollout` and one of `V1_ONLY`, `V2_SHADOW`, or `V2_ACTIVE`.
The setting is validated and classified as HIGH risk / confirmation-required.
Missing or invalid values resolve to `V1_ONLY`. A Settings read error is not
treated as missing: Candidate processing fails closed before either authority
creates a new result.

## State behavior

- `V1_ONLY`: v1 comparison and v1 Review remain the only path. New v2 work is
  not executed.
- `V2_SHADOW`: v1 remains authoritative; v2 executes and persists evidence,
  but cannot create a v2 Review Draft, decision, approval, or Canonical write.
- `V2_ACTIVE`: v1 is gated before its comparison write; v2 is the sole path.
  A completed v2 result is bridged to Review exactly once through the durable
  Review repository. Provider failure never replays v1.

## Rollback and downgrade

Change the setting to `V1_ONLY` or `V2_SHADOW` through the normal Settings
command and confirmation flow. A CandidateValidated event already in flight may
finish v2 persistence, but the coordinator re-reads authority before Review;
on downgrade it blocks the v2 Draft and performs no v1 replay. Preserve all
historical rows and investigate unresolved v2 outcomes from their safe failure
codes.

## Freshness and observability

Review freshness re-reads the current candidate/evidence digest, Canonical
snapshot, lexical projection readiness/watermark/base, semantic generation,
provider/model/capability metadata, semantic policy revisions, and rollout
authority. Unknown reads block Review as
`FRESHNESS_UNAVAILABLE`; no model generation is performed by the adapter.
Operational logs may contain rollout, contract, outcome, disposition, safe
failure, and Review-blocked reason only. Never log candidate text, rationale,
evidence contents, or provider credentials.
