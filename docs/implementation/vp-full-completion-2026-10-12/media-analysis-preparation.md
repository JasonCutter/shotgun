# Inactive frame analysis preparation — connected offline proof

Date: 2026-10-13. Scope: an executable, isolated connection from immutable video
bytes through selected decoded frames and prepared native image transport to
generated `media-alignment/1.0.0` descriptions. This is not active video intake,
real provider meaning validation or final VP acceptance.

## Implemented connection

`modules/media-analysis-preparation/src/index.ts` exposes
`prepareMediaFrameAnalysis(asset, selectedFrameIndices, producer, executor)`.
The module imports contracts and Node hashing only. It injects
`MediaFrameProducerPort` and `PreparedFrameExecutorPort`; it imports no decoder,
AI adapter, neighbor domain module, DB or credential resolver. No active
assembly registers it and it grants no Evidence/Ledger write authority.

Preparation verifies and snapshots original Source/project/SourceVersion/asset
identity, original bytes and byte length. The decoder output must preserve
those pins and return every selected frame exactly once, in selected display
order. Each returned PNG is copied, hashed and checked against its manifest
digest and pixel geometry. The existing media alignment parser checks duration,
frame count, timestamps, identity, manifest and text mapping bounds before any
provider execution.

The selected batch must contain one through four unique increasing frame
indices. More than four fails without silently truncating, adding batches or
making a model call. Original input is limited to 10 MiB; each frame is limited
to 8 MiB, aggregate selected frames to 20 MiB, dimensions to 4096 and pixels to
4,194,304. The descriptor request caps output at 4,096 tokens. This experimental
frame prompt/schema is independent of the active v6 relation/candidate policy;
neither v6 nor the active model capability catalog is changed.

Execution accepts only an already prepared, authorized executor. The orchestration
does not resolve credentials or authorize egress. Its process-local handle and
executor instance are consumed before the asynchronous call. Concurrent or
subsequent calls are rejected. If the executor throws, the handle reports
`OUTCOME_UNKNOWN`, prohibits retries and requires resolution of that existing
attempt. No internal paid-call retry occurs. Malformed response output consumes
the handle and records `OUTPUT_REJECTED`. This is not durable cross-restart
idempotency; production routing must use the existing durable provider ledger
before activation.

Independent review reproduced a mutable-executor substitution after preparation:
the changed callable executed while provenance retained the original identity.
Preparation now captures the identity object, its values and execution callable
before awaiting the decoder, rejects object/value/callable replacement after that
await and immediately before dispatch, and calls the captured function with its
original executor instance. Identical-value identity-object replacement also fails
closed. Rejection occurs before consuming the handle or making an executor call.
The trusted executor must still capture immutable authorization internally; these
checks cannot authenticate a malicious implementation that lies about execution.

Responses must confirm the captured model and image transport revision and all
selected frame hashes in request order. The structured payload contains exactly
one nonempty generated description for each selected frame index. Missing,
duplicate, unknown or extra frame output, unexpected properties, original/Fact
authority fields, malformed JSON and invalid response provenance fail closed.
Output order may differ; validated descriptions are reordered into selected
display order. Their Unicode positions, exact quotes/hashes and immutable
frame selectors form the existing inactive media alignment contract. Separator
newlines are explicitly included in the preceding aligned range.

Success returns only `GENERATED_UNVERIFIED` output with `UNVERIFIED` meaning,
`DECLARED` alignment, selected/described indices, unsampled count,
`unsampledMeaning: UNVERIFIED`, `audioTranscribed: false` and
`fullMediaMeaningVerified: false`. It captures decoder identity/commit,
provider/model/adapter/transport identity, plan digest, exact transport request
digest, response-text digest, provider response ID, selected frame byte hashes
and provider-reported token usage. It creates no source-origin EvidenceSpan or
objective Fact. Token counters are provider declarations, not reconciled cost.

## Reuse decision

The existing [media foundation](./media-alignment-foundation.md),
[offline FFmpeg proof](./media-frame-offline-proof.md) and
[native image transport preparation](./native-image-transport-preparation.md)
were reviewed before adding this connection.

| Candidate                                                               | Reviewed identity and decision                                                                                                                                                                       | Included/excluded boundary                                                                                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing Shotgun media alignment parser and selector/hash helpers       | `media-alignment/1.0.0`; reuse existing owned implementation                                                                                                                                         | Strict source/frame/Unicode mapping reused; no second source schema, locator, Evidence authority or model quality oracle                                                       |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) via existing offline adapter | `n9.0.2`, commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`, supplier `9.0.2`, GPL-3.0-or-later; exact binary pins in `adapters/media-frame-ffmpeg-offline/runtime.lock.json`; production `DEFERRED` | Reuse inactive adapter behind producer port and its bounded pipe-only runner. No install/download, operating PATH search, media storage or production adoption                 |
| Existing native DeepSeek inline image transport                         | `deepseek-inline-vision-v1`; adapter `deepseek-chat-completions-v2-temperature-0.2`, captured `deepseek-flash` identity; fake HTTP only                                                              | Reuse its immutable inline-byte transport through injected executor. No live API call, external image URL, model fallback, active capability change or credential resolution   |
| Exact preparation orchestration                                         | `NO_RELEVANT_OSS` for Shotgun's generated-media/immutable-source/selected-frame/single-use contract after reviewing the three existing boundaries above                                              | Minimal owned glue. Importing another agent/provider runtime would not supply these source and authority contracts. No new dependency, copied upstream code or lockfile change |

Security, licensing, maintenance and replacement evidence for adopted code
remains in the linked reports and registry; this connection does not certify
current universal security clearance. The open-source Role Matrix production
audio/video deferral remains unchanged. The pure producer/executor ports are
replacement boundaries. A different decoder or prepared model executor must
pass the same source/frame-binding and response-cardinality contracts.

## Verification

The credential-stripping test runner executed only the focused connection tests.
No operating environment file, real AI credential, live provider, production DB,
original asset or frozen evaluation dataset was accessed.

- **23/23 preparation contract cases PASS:** exact original/frame binding,
  generated provenance and unsampled coverage; original/frame mismatch and
  selection bounds rejected before execution; missing/duplicate/unknown frame
  descriptions, malformed response provenance and extra authority fields rejected;
  one execution after success, rejection or uncertainty; concurrent and second
  handle executor reuse prevented; immutable snapshots preserved; executor identity
  value/object and callable substitution after preparation or during decoder await
  rejected before any execution.
  A class executor with a private counter verifies that the captured function
  retains its original instance binding and executes once. The captured-call
  request also pins its PNG MIME as a literal type; runtime bounds are unchanged.
- **2/2 portable integrations PASS:** the offline FFmpeg adapter with an injected
  fake CLI producer connects to the real native DeepSeek transport with injected
  fake HTTP, then to media alignment v1. Uploaded image byte hashes match
  manifest/provenance/alignment hashes; exact serialized HTTP request and response
  digests match. Native HTTP uncertainty makes one request and cannot retry.
- **1/1 real pinned decoder integration PASS on this host:** the existing owned
  `media-frame-runtime/ffmpeg-9.0.2-essentials_build` decodes the previously
  authored synthetic variable-rate MP4 proof. Selected indexes `[0,1,3]`
  preserve original presentation timestamps `[0,100,900]` ms and exact generated
  PNG bytes through native fake HTTP and aligned descriptions. Decoded frame
  count is four; the unselected frame remains unverified. This case skips on
  hosts without the owned pinned runtime/fixture; portable cases always run.
- Targeted ESLint, full `tsc --noEmit` and the architecture boundary check PASS.

The real synthetic media input is
`C:/dev/artifacts/vp-full-completion-2026-10-12/media-frame-runtime/ffmpeg-9.0.2-essentials_build/proof/synthetic-vfr.mp4`.
This integration only reads that proof and does not rewrite the FFmpeg producer
artifacts. All descriptions are authored fake HTTP outputs. Real decoded pixels
and correct timestamps do not certify AI semantic accuracy or full-media recall.

## Rollback and remaining activation requirements

No migration is needed. Removing the new preparation module/tests disconnects
this isolated orchestration without changing original assets, SourceVersions,
prior transformations, active Evidence/Ledger contracts or model policy.

The connected chain is implemented but remains inactive. Product activation
still requires authorized provider capability/egress/budget, durable request and
response records through the existing provider ledger, content-level fidelity
and grounded-answer tests, handling of derived text under the existing authority,
and product intake/preview/Ask integration. Speaker identity, transcription,
unsampled scenes, overlapping alignment and whole-video meaning remain outside
this prepared frame-only connection. No VP-08 or VP final acceptance claim follows.
