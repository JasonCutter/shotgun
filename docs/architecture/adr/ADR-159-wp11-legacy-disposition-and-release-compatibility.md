# ADR-159 — WP-11 Legacy Disposition and Release Compatibility

- Status: **Accepted for WP-11 implementation**
- Date: 2026-09-04
- Work item: Runtime/Data Integrity WP-11, Issue #187
- Canonical base: `main@24897104386d02af9fcd4d1012ef0976566f6139`
- Implementation branch: `codex/wp11-legacy-disposition-deprecation`
- Controller authorization: Issue #187 comment `5541320053`
- Related decisions: ADR-139, ADR-156, ADR-158

## Authority and scope

This decision is limited to the frozen WP-11 compatibility and classification
scope: DE-01, DE-02, DE-03, DE-05 and DP-05. It does not authorize WP-12, route
removal, event rewiring, a new Product API, a new projection owner, or a
persistent telemetry store. Canonical, Review, Discovery re-entry,
cited-answer, Activity and History authorities remain the owners already
established on canonical `main`.

The classification-first rule is mandatory. Every target is assigned exactly
one of `KEEP_ACTIVE`, `DEPRECATE`, `REMOVE`, `INTENTIONAL_TERMINAL`, or
`REFERENCE_ONLY`. No target is physically removed in WP-11.

## Frozen disposition matrix

| Target                              | Disposition                         | Current-main evidence                                                                                                                                                                                                                          | WP-11 action                                                                                                                          | Removal/next-step condition                                                                                   |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DerivedInferenceReady` (DE-01)     | `DEPRECATE`                         | `modules/compiled-truth/src/index.ts` still publishes the event; no registered handler consumes `messageType: 'DerivedInferenceReady'`; production Discovery uses `RunKnowledgeDiscoveryDurable`; active re-entry is `DiscoveryFindingReadyV1` | Keep the existing producer and `INTENTIONAL_TERMINAL` handoff. Do not invent a consumer and do not rewrite the event.                 | Removal is eligible only after two released compatibility versions and release-level observed usage evidence. |
| `DraftChangeSetReady` (DE-02)       | `INTENTIONAL_TERMINAL` / keep as-is | Existing `stage5.change-set-review` manifest declares terminal owner, retention and audit/UI observability                                                                                                                                     | Verify and document the existing owner; no consumer or duplicate owner.                                                               | Separate approved contract/ADR change only.                                                                   |
| `ReviewDecisionRecorded` (DE-02)    | `INTENTIONAL_TERMINAL` / keep as-is | Existing `stage5.change-set-review` manifest declares terminal owner, retention and audit/UI observability                                                                                                                                     | Verify and document the existing owner; no consumer or duplicate owner.                                                               | Separate approved contract/ADR change only.                                                                   |
| `ProjectionReady` (DE-02)           | `INTENTIONAL_TERMINAL` / keep as-is | Existing `stage7.projection-search` manifest declares terminal owner, watermark retention and readiness observability                                                                                                                          | Verify and document the existing owner; no consumer or duplicate owner.                                                               | Separate approved contract/ADR change only.                                                                   |
| `POST /intake` (DE-03)              | `DEPRECATE`                         | Legacy handler remains wired in `assemblies/shotgun-app/src/server.ts`; protected Sources staging/submission Product routes are the successor flow                                                                                             | Preserve behavior; add `Deprecation: true`, successor `Link`, optional authoritative `Sunset`, and content-free invocation telemetry. | Removal requires two released compatibility versions plus release-level usage evidence.                       |
| `POST /search` (DE-03)              | `DEPRECATE`                         | Legacy handler remains wired in `assemblies/shotgun-app/src/server.ts`; `POST /product-api/frontend/search/query` is the successor                                                                                                             | Preserve behavior; add `Deprecation: true`, successor `Link`, optional authoritative `Sunset`, and content-free invocation telemetry. | Removal requires two released compatibility versions plus release-level usage evidence.                       |
| `POST /ask/query` (DE-03/DE-05)     | `KEEP_ACTIVE`                       | `stage7.cited-answer` remains registered and the route is the cited-answer compatibility path                                                                                                                                                  | Preserve behavior and emit no deprecation or sunset signal. Count only as `ACTIVE_COMPATIBILITY`.                                     | No WP-11 removal or deprecation.                                                                              |
| `modules/cited-answer` (DE-05)      | `KEEP_ACTIVE`                       | Manifest provides `AskCanonicalKnowledge`; server route is still wired and used                                                                                                                                                                | No change.                                                                                                                            | Existing cited-answer contract remains active.                                                                |
| `ActivityProjectionBuilder` (DP-05) | `KEEP_ACTIVE`                       | Uses explicit Activity read-model store, adapter ports and project-scoped watermarks; rebuild is deterministic and durable                                                                                                                     | No rename and no second state authority.                                                                                              | A rename could be considered only for a proven stateless projection, which is not the current implementation. |
| `HistoryProjectionBuilder` (DP-05)  | `KEEP_ACTIVE`                       | Uses explicit History read-model store, four owning-Domain adapters and rebuild watermarks                                                                                                                                                     | No rename and no second state authority.                                                                                              | A rename could be considered only for a proven stateless projection, which is not the current implementation. |

The matrix intentionally distinguishes a terminal handoff from an active
consumer. `INTENTIONAL_TERMINAL` is an owner/retention/observability
declaration; it is not permission to create a handler.

## Legacy route compatibility contract

The legacy handlers and response bodies remain unchanged. The application
adds metadata at the request boundary for exact paths only:

- `POST /intake`: `Deprecation: true` and a `Link` header containing
  `successor-version` links for `/product-api/frontend/sources/staging/bytes`,
  `/product-api/frontend/sources/staging/url`, and
  `/product-api/frontend/sources/submissions`.
- `POST /search`: `Deprecation: true` and
  `</product-api/frontend/search/query>; rel="successor-version"`.
- `POST /ask/query`: no `Deprecation`, `Link`, or `Sunset` header.

The hook strips the query string only for exact route classification. It does
not classify `/search/hybrid` or any other prefix as `/search`.

### Truthful Sunset rule

The assembly may receive explicit release-owned dates through
`ApplicationOptions.legacyRouteSunsetDates`. Values must be valid IMF-fixdate
HTTP dates. An absent or invalid value emits no `Sunset` header; the runtime
never derives a date from the current time, a branch, or a guessed release
schedule. The date is response metadata only and does not change handler
behavior. Rollback removes only the deprecation metadata and leaves the old
handler available.

## Compatibility telemetry boundary

`LegacyRouteUsageRegistry` is an application-owned, in-memory operational
projection. It has a fixed three-route key set, a versioned safe snapshot and a
per-route invocation counter capped at a bounded maximum. A process restart may
reset the counters. The snapshot is exposed through `/health` as
`legacyRouteTelemetry` and through the existing application state for
verification/monitoring only.

The registry records route attempts before decoding/authentication and stores
only:

```text
version: 1
routes: [{ route, disposition, invocationCount, successorPaths, sunset? }]
```

It never records Project ID, Principal/Actor, request body, query text,
headers, credentials, response body, source text, prompt, error details or
security context. Recording is best effort and is wrapped so an observation
failure cannot change route success/failure or business state. The counter is
not a deletion authority and is not, by itself, release-level usage evidence.

## Projection boundary

Activity and History are persistent, rebuildable read-model projections. Their
builders consume explicit owning-Domain read adapters and commit project-scoped
records/watermarks through existing stores. Deterministic rebuild is an
implementation property, not evidence that the builders are stateless. WP-11
therefore keeps both names, stores and ownership boundaries unchanged.

## Compatibility removal gate and rollback

`/intake`, `/search`, and the legacy `DerivedInferenceReady` publication may be
removed only after **at least two released compatibility versions** have
shipped and release-level observed usage evidence has been collected for the
relevant target. A single process-local zero count is insufficient. Removal is
a later separately approved change that must include migration, contract,
security-negative and rollback evidence.

If deprecation causes an integration regression, rollback is an exact-code
revert/removal of the `Deprecation`, `Link`, `Sunset` and telemetry observation
surface while retaining the original route/event handler. No migration or
persistent data rollback is required.

## OSS integration decision

`NO_RELEVANT_OSS` for the route-header compatibility registry and disposition
evidence: these are Shotgun application policy and HTTP boundary semantics, and
no reviewed OSS candidate can own the Canonical/Review/Discovery compatibility
authority without violating the module boundary. Existing verified references
(gbrain, lucasastorian/llmwiki, ddsyasas/llm-wiki and Inkeep OpenKnowledge)
remain `REFERENCE_ONLY`; no dependency, lockfile, runtime or database is
adopted in WP-11.

## Verification obligations

The WP-11 delta is proved by the focused contract and integration tests. They
verify the exact disposition matrix, defensive bounded snapshots, route parity,
successor links, truthful Sunset behavior, `/ask/query` active compatibility,
attempt counting on validation failure and hostile-content redaction. Existing
Activity/History projection suites are prior exact-head evidence and are not
duplicated locally. The final pushed exact head is subject to automatic
repository CI.
