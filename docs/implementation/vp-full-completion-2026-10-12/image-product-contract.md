# Image observation product integration — approved isolated implementation

## Decision and history

The user approved the image-only contract and isolated implementation in this
chat: **“이미지 전용 계약·격리 구현 승인”**. This follows the decision draft
`C:\dev\artifacts\vp-full-completion-2026-10-12\image-product-integration-decision-draft.md`.
It does not authorize operating activation, real AI egress, or raw audio/video.
The earlier image preparation HOLD remains the record of its earlier state.

PR #385 was separately approved and merged as
`3675a95961cfdbb28f992356a2968b4613e6f426`, tree
`edba03800f32518682fe816411f1e31c7d37143d`. Exact-head CI `38372113568` and
post-merge main CI `38394700999` each passed Quality, Frontend, and Required
Gates. The new product integration described here is local work on
`codex/vp-image-observation-contract`; it was not part of PR #385.

## Authority and runtime scope

### 2026-10-15 isolated live acceptance amendment

After the earlier Fake-only approval, the user explicitly approved
**“격리 이미지 계약 보완·최대 2회 실호출 승인”**. The current local extension
permits one image analysis and one Ask response in the isolated acceptance
workload. The aggregate ten-call authorization includes the prior sealed UNKNOWN
slot and seven completed text responses; neither is retried or reclassified.
This amendment preserves the earlier decision history above.

The application requires explicit `imageObservationIsolatedLive` injection,
`runtime-test`, a generated `shotgun_test_iso_*` database, an unexpired acceptance
identity bound to the image hash and credential fingerprint, and its authorization
callback before capture and again before egress. The same captured Vault secret,
configuration and model are used. Fake and live injections are mutually exclusive.
Normal runtime profiles reject this option; normal image capability remains OFF.

The existing execution `record_json` records `ISOLATED_LIVE_ACCEPTANCE` and the
acceptance ID. Legacy records without a transport label remain Fake. Cross-kind
replay fails closed. No migration, new budget authority or relation budget claim
is added for image/Ask. An external acceptance transport guard enforces the
remaining two calls, exact image bytes, ordered image/Ask roles, durable receipts,
and no automatic replay. The existing persistent relation authority is checked,
without representing an image call as VP_RELATION.

This reuses the pinned native DeepSeek adapter, Vault, Source pipeline, existing
AI execution owner, VP Ledger, PostgreSQL and Ask contracts (`AUGMENT`); the
dependency lockfile and image prompt/schema are unchanged. Existing OSS license,
version, security and replacement decisions in the linked origin/native reports
continue to apply. No new package/runtime is adopted. Rollback removes only this
explicit local option; historical execution identity remains readable. Operating
migrations/configuration, workers and app remain unchanged. This diagnostic
acceptance cannot certify visual semantics or reference Gold.

- VP Ledger owns typed, append-only `GENERATED_UNVERIFIED` image observations.
  These are neither original Evidence quotes nor certified Facts or Claims.
- OriginalAsset bytes, SourceVersion, hash, dimensions, pixel region, annotation
  transformation, and the completed AI execution identify each derivation.
  A pixel region identifies location; it does not prove semantic correctness.
- The existing AI owner records one durable request/call/attempt, captured
  provider/model/configuration/credential/policy identity, output, and outcome.
  Replayed completed output reuses the derivation. An uncertain outcome never
  authorizes another call.
- Application activation requires an explicit injected Fake HTTP transport,
  `runtime-test`, and a generated `shotgun_test_iso_*` database. There is no
  environment switch, production fallback, or new budget authority. The normal
  application image capability remains OFF. Existing v6 and confidence gate
  remain unchanged.
- Owner membership, SourceVersion scope/sensitivity, standing policy, existing
  configuration and Vault are checked. Captured credentials are disposed on all
  execution exits. Test credentials are synthetic; no operating secret changed.

The image Source pipeline has a distinct `IMAGE_OBSERVATION_COMPLETED` result.
It creates no Evidence indexing result, Candidate batch, or Stage4 extraction.
UNKNOWN maps to reconciliation, not successful extraction or a silent retry.

## Ask and historical reads

Ask uses separate O references for generated observations and existing E
references for original Evidence. Unknown, duplicate, forged, cross-project,
and mismatched references fail validation. Server-bound references contain no
credential identity. A generated observation cannot become an E citation.

Query selection reuses PostgreSQL lexical terms, Korean suffix normalization,
full-text ranking and trigram similarity. Only current, authorized observations
with completed Source readiness enter the bounded shortlist. It no longer
selects the first twelve unrelated images. This retrieval behavior is not a
validated semantic recall claim; lexical misses and ambiguous questions remain
quality limits.

The attempt stores the exact image context and its digest. Completion checks
the current shortlist under the existing VP epoch lock and compares the full
reference to the authorized pinned derivation. Same-context replay rechecks
historical access and preserves the stored content. Read errors fail closed.

Model abstention is separate from the presence of context. An abstained answer
has no selected references and no supported-answer transition. All answers
with generated image context are export-only; they cannot seed governed
knowledge/directive proposals. This is a narrow safety restriction on the new
image flow, not a change to historical text-only answer capabilities.

AnswerRun, Conversation, Branch, and Workspace expose the same pinned
references. A newer SourceVersion makes a previously referenced image stale
without changing answer text, citation/reference IDs, or successful history.
An unrelated Source update does not make that answer stale. Current and
historical image preview both check latest ACL as well as selected-version ACL,
original hash/size, and complete pixel decoding. The authenticated original
image endpoint returns `private, no-store` bytes of the selected version.

## Reuse and corrections

The existing Python adapter, pinned Pillow and existing DeepSeek adapter are
augmented, without installing another library or adopting another runtime.
Existing Source intake, recovery, transformation persistence, VP epoch, Ask
worker and PostgreSQL transaction contracts are reused. OSS pin/license and
excluded runtime boundaries remain as recorded in
[origin safety](./image-description-origin-safety.md) and
[native preparation](./native-image-transport-preparation.md).

Python adapter `1.15.0` explicitly uses UTF-8 and fully decodes bounded pixels.
Header-only verification had allowed corrupt JPEG data; animated/multiframe
images are now rejected before credential resolution or provider invocation.
Known rejected provider output retains a bounded raw prefix, full response
digest, and provenance; an unobserved/uncertain response remains UNKNOWN.
The per-call derived transformation identity prevents a cached caption from
another execution being reused as this call's output.

Migration133–137 are additive and isolated-test rehearsed. Existing Source
progress must be deleted before VP observations; observations before AI image
executions; both before original lineage. Requested/running/stored/UNKNOWN
executions block reset. Existing authorized receipt, actor, fences and owner
routines remain the deletion authority. Backup coverage is conditioned on the
two new migrations; manifests with earlier migrations retain their historical
table coverage.

## Verification and remaining work

Evidence is under `C:\dev\artifacts\vp-full-completion-2026-10-12`:

| Evidence                                                       | Observed result                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-query-and-app-final.log`                                | Real app A/image → Ask → B/text → image revision → historical stale and pinned original preview: 1 PASS; VP observation database tests: 16 PASS                                 |
| `image-execution-observed-response-final.log`                  | Native/credential/execution boundary unit tests: 67 PASS                                                                                                                        |
| `image-execution-observed-response-final-postgres.log`         | Real PostgreSQL execution, ACK loss, restart and process crash/race: 8 PASS                                                                                                     |
| `image-t3-database-impact-final.log`                           | Isolated migration rollback, reset/UNKNOWN/ACL/ownership: 7 PASS                                                                                                                |
| `image-root-current-unit.log`                                  | Ask provider/references, preview and backup compatibility: 50 PASS                                                                                                              |
| `image-application-capability-unit.log`                        | Nonisolated/recovery bootstrap rejects image injection before DB connection: 2 PASS                                                                                             |
| `image-actual-application-waiting-unknown-final.log`           | Same queued AnswerRun resumes; unknown response remains 503/UNKNOWN without another call: 1 PASS (other case filtered, separately passed above)                                 |
| `image-backup-proof-corrected.log` / `image-backup-proof.json` | Actual pg_dump/restore: 136 integrity tables, 137 migrations, 1 original asset; exact bytes, observation, execution and readiness preserved; restored app OFF                   |
| `image-browser-mv7nacnp/result.json`                           | Actual Edge + built SPA + normal app: image upload → Ask → UNVERIFIED reference → pinned original pixels; review clicks/source selections/external requests/live calls all zero |
| `image-unit-contract-final.log`                                | Entire unit and contract suites: 2478 PASS, 0 FAIL                                                                                                                              |
| `image-full-frontend.log`                                      | Entire frontend suite: 405 PASS, 0 FAIL                                                                                                                                         |
| `image-ts6-final-audit.log` / `image-ts6-final-check.log`      | All 50 TS6 audit tests and reproducible current-v8 identity check PASS                                                                                                          |

Earlier Docker-offline setup failures and initial test-fixture mistakes remain
in their original logs. They are not relabeled as passing runs.

The initial waiting fixture incorrectly expected a nonexistent state name;
the existing contract is `QUEUED` while knowledge is pending. Its corrected
assertion verifies zero consumed Ask attempts and same-run automatic resumption.
The second fixture expected an accepted submission followed by failure, whereas
the product returns explicit `503 / OUTCOME_UNKNOWN`. The final test checks that
response, durable reconciliation state and no second call. The first backup
fixture incorrectly nested the erasure journal in the backup tree and was
blocked before dump; the corrected fixture uses separate owned trees.

The old Stage3 recovery suite's four tests repeated all migrations in each
10-second hook. Even the 132-migration baseline takes 13.5 seconds on this
DockerSocket transport; current 137 takes 16.7 seconds. The fixture now initializes
once in separately bounded suite setup, with fresh in-memory assets and unique
project/command/source IDs per test. All four recovery/idempotency assertions are
unchanged and passed. Related nonimage unit/contract tests passed 32/32.

An initial full unit run had 1654 PASS / 1 FAIL because the new application test
used an indirect fixture guard unrecognized by the required entrypoint gate.
The test now explicitly calls the existing test target guard; that gate passes
8/8. The first full contract run had 820 PASS / 3 FAIL because image-OFF intake
returned a different error code. The original `VALIDATION_ERROR` contract is now
preserved; both image-OFF and opt-in intake tests pass. No assertion or validator
was weakened. The final complete unit/contract run passed 2478/2478.

TS6 current v8 records fifteen unchanged-owner coordinate moves and one new
typed Ledger append boundary, with a direct concurrency/restart regression
relation. Its current regeneration/release checks and nine v8 tests pass.
Frozen v2–v7 hashes are unchanged. Repeated analysis exceeded the existing
five-second limit in initial broad runs. The audit now reuses only source-byte-
identical analysis, invalidates additions/removals/edits (including linked TSX),
and returns detached objects. Four negative cache tests protect source freshness,
root separation and caller mutation. No corpus result is cached; no validation
rule or timeout changed. The final 50/50 audit run passes under existing limits.

The initial browser fixtures were blocked by double transport guards, a
configured `port:0` URL rather than the actual listener, and Node-side HTTP under
the existing egress deny guard. The corrected fixture uses the already guarded
owned transport, verifies the actual loopback listener, and bootstraps through
same-origin browser HTTP. Backend egress denial stays intact; no production
configuration changed. The built SPA and authenticated image response displayed
the original 320×180 pixels with separate unverified interpretation labels.

Architecture, documentation, OSS, secret, ESLint, typecheck and the repository's
standard formatting checks pass. The combined database run passed the two actual
app cases, seven reset cases and five readiness cases (14 PASS). Its historical
projection setup hit the default ten-second hook because the focused command
omitted the repository database runner's existing 60-second setup limit. That
new fixture now declares the same bounded setup explicitly; its original
default test-body timeout/assertions remain, and the case passes independently
in 4.1 seconds after initialization. All four read surfaces, ACL denial, missing
provenance and database-error handling are checked. No earlier failure log is
overwritten or retrospectively reported as PASS. Publication is pending.

Real provider calls: **0**. New certified semantic Gold: **0**. Production image
activation, live image budget/egress proof, independently validated image
meaning quality and final installed Canonical identity remain unverified.
Audio/video, frozen 72/432/B12 and remaining24, Gold-B-7, protected worktrees
and stash remain unchanged. Whole VP completion is not claimed.

## 2026-10-14 — Published Draft and erasure review correction

Draft PR #386 initial head5fb47846, CI38516187838: Frontend SUCCESS, Quality/Required Gates FAILURE. Exact current T3 registration was missing two tables/six JSONB columns; historical migration checks assumed latest132. Corrected inventory preserves historical207/168 and the explicit128→130→132 gates, then tests subsequent migrations separately. Initial focused correction:6 PostgreSQL and2 unit PASS; typecheck/lint/format/v8 reproducibility PASS.

Independent Sol6 review additionally found image-only Ask conversations were absent from T3 Source-derived closure. Existing owner classification, authorization, fence, purge and readback must cover both statement references and pinned attempt contexts, related command/connector copies, invalid lineage and active/unknown blockers. No new erasure authority; historical migrations stay unchanged. Until those tests and new exact-head CI pass, publication acceptance remains blocked. The earlier137-migration backup proof is historical evidence, not a claim that later migrations were restored.

### Final owner correction evidence

Migration138 retains the original086/094/105 files and replaces only their current owner routines to include image-only conversation closure in Ask status/purge, command impact/snapshot and Connector Source tokens. Existing session-user, approved reset receipt, epoch fence, terminal-state checks and whole-conversation purge/readback remain. Invalid/missing observation lineage increments the existing unresolved-evidence blocker; no new approval database or owner is introduced.

The focused Ask PostgreSQL suite passed6/6: original text cleanup, unresolved Evidence and active run cases; new image-only statement/pinned context closure, invalid image SourceVersion lineage and OUTCOME_UNKNOWN cases. The positive image case also verifies command scrub, Connector token inclusion and independent same/other Project retention.

Final frozen138 backup restored136 integrity tables/138 migrations/1 original asset and137 contract files. Dump digest `sha256:ed2e3b74710fdcb7328a2150d4820699398adfb49c3e43ed9995538d1280cef4`; exact observation/execution/readiness and original bytes preserved. Restored app remainedOFF, fake image1/live0. The earlier138 intermediate and137 backup artifacts are retained separately; final proof: image-backup-proof-138.json. Operating containers remainexited;79 protectedfiles/13otherworktrees/stash/configuration unchanged.

2026-10-14 최종 보정 Gate: PostgreSQL17/17 (inventory/P0 migration/Ask/command/connector), unit2/2, TS6 50/50, v8 release/rebuild reproducibility, typecheck/ESLint/format/docs PASS. 역사086/094/105, frozenv2–v7, 동결평가79 files·13otherworktrees·stash/configuration은 보존한다. 이 결과는 최종 remote exact-head CI 이전의 로컬 증거다.

### 2026-10-14 — staged-schema fixture correction

CI38520171657 at headda5be2d3: Frontend SUCCESS, Quality/Required Gates FAILURE. Full DB740 PASS/5 FAIL/2 SKIP (747). All5 failures were in image-observation-t3-ownership.database.test.ts: the fixture intentionally installed136 then137 for the original rollback gate, but current impact inspection now requires138. The fixture keeps the137 rollback/apply assertions and adds138 rollback/readback plus twice-migrate single-registration before invoking current owner code. No production fallback, assertion removal, skip or timeout change. Initial CI38516187838 and this failed run remain preserved; pending-head results must not inherit earlier PASS.

Staged-schema fixture correction final result: image-observation-t3-ownership PostgreSQL8/8 PASS, including independent137 and138 rollback/readback and repeated migration registration1. Typecheck/ESLint/docs/v8 reproducibility PASS. Existing assertions and timeout limits remain unchanged. Production bytes did not change in this correction; the final138 backup proof still covers the same migration bytes. Together with the unchanged focused17 cases,25 distinct relevant PostgreSQL cases have passed locally. New exact-head remote CI must be checked separately.
