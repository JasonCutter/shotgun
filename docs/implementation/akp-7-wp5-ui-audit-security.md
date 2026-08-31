# AKP-7 WP5 — Feedback UI, Audit, and Security Closure

Status: Draft implementation record; awaiting GPT/owner acceptance.

## Baseline and branch

- Base: `main@d2716b178ec924d499aef43066ab0143e66351b9`
- Working branch: `codex/akp-7-wp5-ui-audit-security`
- Draft PR title: `AKP-7 WP5: Feedback UI Audit and Security Closure`
- This record covers WP5 only. It does not authorize AKP-8, merge, Ready-for-review, or deployment.

## Scope delivered

WP5 exposes the existing Discovery feedback contract through the owner surface:

`Discovery Inbox/Detail → explicit owner feedback → existing WP2 command → WP3 ranking/suppression → WP4 epistemic re-entry → principal/project-scoped owner history`

The UI does not create semantic authority. It sends the existing `frontend.discovery.feedback.v1` command through `DiscoveryFeedbackProductCommandRequestV1`, reads `DiscoveryFeedbackProductStateV1`, and keeps server-owned identity, policy, authorization, timestamps, suppression identity, matcher/version, and outcome semantics on the server.

Visible controls are:

- `Useful` and `Not relevant` on Inbox cards and the exact Finding detail.
- Focused slash commands: `discovery.feedback.useful`, `discovery.feedback.not_relevant`, `discovery.feedback.already_known`, `discovery.feedback.too_frequent`, `discovery.snooze`, `discovery.suppress_exact`, `discovery.suppress_similar`, `discovery.report_issue`, and `discovery.feedback_history`.
- The command palette exposes those commands only when an authorized exact Finding is focused; otherwise they are hidden. Existing `discovery.dismiss` remains a separate command.

Excluded from this WP5 change:

- New semantic truth, Candidate, Evidence, Canonical, Approval, Review, Graph, Activity, Attention, or ranking authority.
- Client-side suppression, truth correction, telemetry, automatic retry, schema migration, new runtime dependency, or backend storage redesign.
- AKP-8 and any Ready/merge/deploy action.

## Feedback and epistemic mapping

Utility feedback only affects usefulness, ordering, timing, or suppression:

| Owner action | Class | Kind |
| --- | --- | --- |
| Useful | `UTILITY` | `USEFUL` |
| Not relevant | `UTILITY` | `NOT_RELEVANT` |
| Already known | `UTILITY` | `ALREADY_KNOWN` |
| Too frequent | `UTILITY` | `TOO_FREQUENT` |
| Snooze | `UTILITY` | `SNOOZE` |
| Suppress exact | `UTILITY` | `SUPPRESS_EXACT` |
| Suppress similar | `UTILITY` | `SUPPRESS_SIMILAR` |

The Snooze surface is explicitly source-Finding-only. It does not present a Project
scope option because WP3 semantics do not broaden Snooze to the whole Project.

`Report issue` is epistemic re-entry only. It supports the six frozen WP5 kinds:

`INCORRECT_RELATION`, `INSUFFICIENT_EVIDENCE`, `WRONG_ENTITY`, `TEMPORAL_ERROR`, `MISLEADING_PATTERN`, and `MISIDENTIFIED_CONFLICT`.

An optional owner reason is limited to 500 characters. The UI uses “request re-check” language and never claims that a Finding was corrected, accepted, fixed, or made Canonical. ADR-150 V1 outcomes remain safely representable as insufficiently resolvable.

## Security, isolation, and retry behavior

- Browser requests contain only schema version, client request/idempotency tokens, the allowed feedback class/kind, the exact Finding id/revision, the selected scope, the optional bounded reason, and the optional future `snoozeUntil`.
- The browser does not submit `projectId`, `principalId`, `actor`, `feedbackId`, `suppressionId`, `fingerprint`, `matcherVersion`, policy, or server timestamps.
- Detail actions require an exact Finding id/revision and the active project id. Mismatched or stale context fails closed.
- Snooze and suppression are server-authoritative intents. The browser does not locally override mandatory visibility or suppression state.
- `OUTCOME_INDETERMINATE`/unknown outcomes use the existing resolver exactly once. The UI disables new submissions, keeps the exact request identity, reads the scoped state after resolution, and never blindly resubmits.
- Pending writes block project switching and close/escape paths that would lose the exact context; unrelated navigation remains available. Retry is not implicit.
- History is read from existing `feedbackHistory` and `suppressionHistory`, filtered to the exact principal/project/Finding revision by the existing contract. The surface renders owner-safe labels, time, reason, scope, expiry, and effect only; infrastructure identifiers are not shown.
- Mandatory-visibility explanations remain visible even when the owner has supplied feedback.

## Accessibility and localization

The feedback surface uses the existing accessible dialog behavior with focus capture/restore, keyboard navigation, Escape handling, labelled controls, pending state, and polite status announcements. Issue reasons have an explicit maximum and live character count. All new visible strings, command labels, aliases, statuses, scopes, issue-kind descriptions, history labels, and mandatory-visibility copy are localized in English and Korean.

## OSS Integration Gate

WP5 is an owner UX/audit integration over existing Shotgun contracts. No new OSS dependency was introduced and the Open-source Role Matrix does not require a new entry.

| Candidate / pinned version | Decision | WP5 boundary and evidence |
| --- | --- | --- |
| PostgreSQL `16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | `ADOPT` (existing foundation) | PostgreSQL License; existing repository/state foundation remains behind Shotgun ports. No WP5 schema change. |
| Ajv `8.20.0` | `ADOPT` (existing foundation) | MIT; existing contract validation only. No new client authority. |
| `garrytan/gbrain` commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | `REFERENCE_ONLY` | MIT; useful Job/Fact/Search/Graph patterns, but its runtime and DB are not imported into the owner feedback boundary. |
| `ddsyasas/llm-wiki` commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | `REFERENCE_ONLY` | MIT; UX/action patterns only. Its backend, SQLite, ingest/query/lint, and LLM client are excluded. |
| Inkeep OpenKnowledge commit `f2834c237639e2cff603817ed88182b33f83cf91` | `REFERENCE_ONLY` | GPL-3.0-or-later; review/audit UI patterns only. Runtime, Git/MCP, and Canonical/Yjs boundary are excluded; Yjs remains deferred. |
| `lucasastorian/llmwiki` commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | `NO_RELEVANT_OSS` for WP5 | Apache-2.0; its conversion/evidence components do not provide the required Shotgun owner feedback/audit semantics. |
| Temporal, NATS, Redis, pg-boss, Graphile | `DEFER` | Not needed for this client boundary; revisit only with a server workflow or queue requirement. |

Direct UI implementation is justified because no reviewed candidate provides the required Shotgun-specific authorization, exact-revision isolation, Claim/Fact separation, approval boundary, and owner-safe audit semantics. The implementation stays replaceable through the existing client, command registry, dialog, localization, and feedback repository contracts.

## Verification

Focused frontend tests cover:

- Inbox Useful and Detail Not relevant product flows, including no Dismiss coupling.
- All nine focused command registrations and context gating.
- All six epistemic issue kinds, bounded issue input, and absence of correction-success claims.
- Suppression scope intent without fingerprint/matcher leakage.
- Owner-safe principal-scoped history rendering without infrastructure identifiers.

Latest local results:

- `npm --workspace @shotgun/web run test -- src/commands/discovery-feedback-command-surface.test.tsx src/routes/discovery-workspace.test.tsx src/commands/owner-command-registry.test.ts src/section3/global-tools.test.tsx` — 4 files, 34 tests passed.
- `npm run frontend:typecheck` — passed.
- `npm run lint -- --quiet` — passed.
- `git diff --check` — passed.

No database migration or new dependency was added, so migration/DB verification is not applicable. Rollback is a normal branch/PR revert; the existing feedback contracts and server state remain compatible. The full repository architecture/docs/OSS gates and exact-head CI are run before the Draft PR is reported as ready for GPT review.

## Known limits and next contract

- The owner surface reports “recorded” or “re-check requested”; it does not infer semantic acceptance or correction from a command outcome.
- A backend may report an insufficiently resolvable epistemic result; the UI preserves that uncertainty.
- This WP5 surface does not expose numeric ranking controls or truth editing.
- A full authenticated browser E2E depends on the repository’s configured service environment; focused contract/UI tests are the deterministic WP5 evidence.
- The existing feedback contract version remains `1.0.0`. Any future contract change must be separately reviewed and versioned.
