# Runtime/Data Integrity WP-11 — Legacy Disposition Validation

- Work package: WP-11
- Issue: `#187`
- Canonical base: `main@24897104386d02af9fcd4d1012ef0976566f6139`
- Authorized branch: `codex/wp11-legacy-disposition-deprecation`
- Scope: DE-01, DE-02, DE-03, DE-05, DP-05 only
- Status: implementation evidence recorded; final exact implementation head is
  reported with the delivery evidence

## Authority and execution boundary

Controller START authorization is Issue #187 comment `5541320053`. Before
implementation, the remote canonical `main` resolved to
`24897104386d02af9fcd4d1012ef0976566f6139`, the working branch started at the
same SHA, and the worktree was clean. Issue #187 was re-read as the frozen
contract. No file outside its maximum six-file allowlist is authorized.

WP-12 is not started by this work package.

## Current-main static trace and disposition evidence

The following facts were checked against the canonical base with `rg` and
manifest/source inspection. They are current facts, not future removal claims.

| Target                                      | Current fact and trace                                                                                                                                                                                                                                                                                                                                                    | Disposition                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `DerivedInferenceReady`                     | `modules/compiled-truth/src/index.ts:676` publishes `messageType: 'DerivedInferenceReady'`; no active handler for that message type is registered. `assemblies/shotgun-app/src/server.ts:4086` sends the durable `RunKnowledgeDiscoveryDurable` command. `modules/discovery-reentry` and `adapters/discovery-reentry-postgres` consume/persist `DiscoveryFindingReadyV1`. | `DEPRECATE`; retain existing producer and terminal handoff during compatibility window. |
| `DraftChangeSetReady`                       | `modules/change-set-review/module-manifest.json` declares terminal owner `stage5.change-set-review`, review retention and audit/UI observability.                                                                                                                                                                                                                         | `INTENTIONAL_TERMINAL`; keep as-is.                                                     |
| `ReviewDecisionRecorded`                    | `modules/change-set-review/module-manifest.json` declares terminal owner `stage5.change-set-review`, review retention and audit/UI observability.                                                                                                                                                                                                                         | `INTENTIONAL_TERMINAL`; keep as-is.                                                     |
| `ProjectionReady`                           | `modules/projection-search/module-manifest.json` declares terminal owner `stage7.projection-search`, watermark retention and readiness audit/metrics.                                                                                                                                                                                                                     | `INTENTIONAL_TERMINAL`; keep as-is.                                                     |
| `POST /intake`                              | `assemblies/shotgun-app/src/server.ts` keeps the legacy `SubmitIntake` handler. Successor Product flow is Sources staging bytes/URL followed by Sources submissions.                                                                                                                                                                                                      | `DEPRECATE`; no removal.                                                                |
| `POST /search`                              | `assemblies/shotgun-app/src/server.ts` keeps the legacy `SearchCanonicalKnowledge` handler. Successor is `POST /product-api/frontend/search/query`.                                                                                                                                                                                                                       | `DEPRECATE`; no removal.                                                                |
| `POST /ask/query` and `stage7.cited-answer` | `server.ts` still wires `/ask/query`; `modules/cited-answer/module-manifest.json` provides `AskCanonicalKnowledge`. Existing cited-answer integration uses this compatibility path.                                                                                                                                                                                       | `KEEP_ACTIVE`; no deprecation signal.                                                   |
| `ActivityProjectionBuilder`                 | `modules/frontend-activity/src/activity-projection-builder.ts` reads owning-Domain adapters, writes an explicit read-model store and project-scoped watermarks, and commits atomically.                                                                                                                                                                                   | `KEEP_ACTIVE`; no rename.                                                               |
| `HistoryProjectionBuilder`                  | `modules/frontend-history/src/history-projection-builder.ts` reads four owning-Domain adapters, writes the History read-model store and watermarks, and rebuilds deterministically.                                                                                                                                                                                       | `KEEP_ACTIVE`; no rename.                                                               |

The existing manifests are intentionally not edited. In particular,
`DerivedInferenceReady` remains an `INTENTIONAL_TERMINAL` handoff in the
compatibility window; this WP records its deprecation status without inventing
a consumer or changing the handoff registry.

## Route compatibility evidence

The application request hook classifies exact paths and applies metadata before
authentication/decoding so attempts that fail validation are still observable.
Business handlers and response payloads are unchanged.

| Route             | Response metadata                                                                                  | Sunset behavior                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /intake`    | `Deprecation: true`; successor-version Links to Sources staging bytes, staging URL and submissions | `Sunset` only when `legacyRouteSunsetDates['/intake']` is an explicitly supplied valid IMF-fixdate |
| `POST /search`    | `Deprecation: true`; successor-version Link to `/product-api/frontend/search/query`                | `Sunset` only when `legacyRouteSunsetDates['/search']` is an explicitly supplied valid IMF-fixdate |
| `POST /ask/query` | No `Deprecation`, `Link` or `Sunset`                                                               | Not applicable; route remains active compatibility                                                 |

No date is hard-coded or derived from process time. Invalid/absent authority
means no `Sunset` header. `/search/hybrid` and other prefixes are not counted
or classified as `/search`.

## Safe telemetry evidence

`LegacyRouteUsageRegistry` is application-owned, in-memory and bounded. It has
exactly three fixed keys: `/intake`, `/search` and `/ask/query`. The health and
application-state snapshot exposes only route, disposition, successor paths,
optional normalized Sunset date and a capped invocation count. Process restart
may reset the counter.

The observer stores no Project ID, Principal/Actor, request body, query text,
headers, credentials, response body, source text, prompt, error details or
security context. Recording and metadata application are best effort; an
observation failure cannot alter route success/failure or business state. The
snapshot is operational monitoring only and cannot prove release-level zero
usage.

## Future removal conditions (not current facts)

No target is removed in WP-11. A future removal proposal for `/intake`,
`/search` or `DerivedInferenceReady` must prove all of the following:

1. at least two released compatibility versions have shipped;
2. release-level observed usage evidence covers the relevant target (a
   process-local zero counter is insufficient);
3. successor contract, migration, security-negative, replay and rollback
   evidence is approved; and
4. rollback can restore the old handler/event while removing only the
   deprecation signaling when necessary.

## OSS integration gate

Decision: `NO_RELEVANT_OSS` for the route compatibility registry and legacy
disposition policy. The reviewed gbrain, lucasastorian/llmwiki,
ddsyasas/llm-wiki and Inkeep OpenKnowledge references remain
`REFERENCE_ONLY`; no external runtime, database, package or lockfile is
introduced. The policy is application-owned because moving it behind an OSS
runtime would cross Shotgun's Canonical/Review/Discovery authority boundary.

## Focused verification record

Required WP-11 verification only:

- `npm run typecheck` — PASS
- `npx vitest run tests/contract/runtime-data-integrity-wp11-legacy-disposition.contract.test.ts tests/integration/runtime-data-integrity-wp11-legacy-routes.test.ts --maxWorkers=1 --fileParallelism=false` — PASS (6 tests)
- ESLint on changed TypeScript files — PASS
- Prettier on all five changed files — PASS
- `git diff --check` — PASS

Existing Activity/History projection suites are reused as prior exact-head
evidence and are not rerun solely for this work package. Automatic GitHub CI on
the final pushed exact head remains the repository-wide gate.

## Delivery record

The implementation finished with a complete diff against the canonical base and
an allowlist-only changed-file check. The implementation commit contains the
five authorized paths. The exact head, pushed Draft PR number and automatic CI
result are recorded in the delivery message; the PR remains OPEN / DRAFT, and
Ready, merge and WP-12 are outside this work package.
