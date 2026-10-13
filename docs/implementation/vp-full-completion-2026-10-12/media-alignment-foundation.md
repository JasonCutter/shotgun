# VP-08 media alignment foundation — inactive contract v1

Date: 2026-10-13. Local development baseline:
`27ff952398869b7ba956b01c39db709ed2a43b6a` in the isolated
`vp-full-completion` worktree. This is reversible implementation under the
[full execution directive](./execution-directive.md), not production activation
or final VP acceptance.

## Product gap and implemented boundary

The [media boundary audit](./media-boundary-audit.md) identified that binary
audio/video had neither time/frame selectors nor a versioned original-to-derived
alignment contract. `media-alignment/1.0.0` now supplies concrete types and a
strict runtime parser in `packages/contracts/src/media-alignment.ts`.

The existing [ADR-083](../../architecture/adr/ADR-083-stage-3-plain-text-transformation-and-evidence.md)
allows only `source` origin as `EvidenceSpan`. Generated words cannot safely
become raw original Evidence through an additive selector change. The new
generated text IR is therefore a separate inactive adapter contract. Existing
`DocumentIR`, `SourceMap`, `EvidenceSpan`, active upload support and authority
schemas remain at their current versions. It is exported for future isolated
adapters, with no event registration, DB persistence, new Ledger authority,
model, egress or product capability activation.

Implemented behavior:

- `MediaTimeRangeSelectorV1`: integral milliseconds relative to the original
  asset, nonnegative start, exclusive end, positive range, end at or before
  declared duration. Adjacent ranges are valid. Overlap and reverse order fail.
- `MediaFrameSelectorV1`: zero-based display-frame index, original presentation
  timestamp and immutable frame-content SHA-256. All three must match an entry
  in an independently obtained trusted frame manifest. Missing/duplicate frames,
  inconsistent timestamps and out-of-bounds indexes fail closed. Variable frame
  rates use actual manifest timestamps rather than deriving time from FPS.
- Optional frame regions reuse the existing `BoundingBoxSelector` type, restricted
  to positive integral pixel geometry inside the pinned frame dimensions.
- Original binding requires exact project, stable Source, SourceVersion, original
  SHA-256, MIME and duration equality with caller-supplied trusted pins. Video
  also requires its frame count. The caller must obtain these through authorized
  SourceVersion/asset ports, not use the untrusted output as its own verifier.
- Every derived Unicode code point has exactly one ordered TextPosition/
  TextQuote/exact-hash alignment. Missing prefixes/suffixes, holes, overlapping
  mappings, wrong quotes/hashes, alternate selectors and mixed time/frame maps
  are rejected. Time gaps are permitted: this does **not** assert complete
  semantic coverage of an original asset.
- `generated-transcript` or `generated-description`, generator identity/version,
  request digest and derived text digest are mandatory. `UNVERIFIED` meaning and
  `DECLARED` alignment status are mandatory. Unknown fields, `origin: source`,
  `Fact` and verified-status claims fail validation. Structural consistency does
  not prove that a transcript is correct or that a described object exists.
- Parsed results are copied into deeply frozen snapshots; subsequent adapter or
  context mutations cannot alter accepted source pins or alignment. Safe
  non-retryable `VALIDATION_ERROR` messages never echo original content.
- The parser limits derived text to 128,000 Unicode code points, alignment/frame
  inventory to 16,384 entries and duration to 31 days. Each code point is decoded
  once for range validation; text processing does not rescan the complete string
  for every segment. Limits reject rather than truncate.

## OSS decision before implementation

The existing Stage 3/8 decisions and source registry were the starting point.
No new dependency or upstream implementation was imported.

| Candidate                                                                                                                                                          | Reviewed identity and status                                                                                                                                                        | Decision and boundary                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Shotgun selector/hash/Unicode helpers                                                                                                                     | Local baseline above; underlying lucas locator review at `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0; existing security/maintenance record in `oss-source-registry.json` | Reuse existing helpers and TextPosition/TextQuote/BoundingBox types; no duplicate locator or source authority                                                                                              |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki)                                                                                                  | Commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0; Stage 3/8 registry security/maintenance review                                                                       | Existing reuse preserved; its text locator/runtime does not supply Shotgun original-media pinning or generated-text authority; no further extraction                                                       |
| [W3C Web Annotation](https://www.w3.org/TR/annotation-model/#text-position-selector) and [Media Fragments URI 1.0](https://www.w3.org/TR/media-frags/#naming-time) | Web Annotation Recommendation 2017-02-23 (`W3C-20150513`, existing registry); Media Fragments Recommendation 2012-09-25 (W3C document-use rules); reviewed 2026-10-13               | `REFERENCE_ONLY`; reuse text-selector semantics and temporal-fragment model; local integer-ms/profile and immutable pins remain Shotgun-owned. No W3C code copied or package adopted                       |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg), [official documentation](https://ffmpeg.org/ffmpeg.html)                                                               | Existing Role Matrix `DEFERRED`, no production pin/license acceptance; official frame/time extraction capabilities reviewed 2026-10-13                                              | `DEFER`; decoder/transcoder output cannot provide authenticated SourceVersion authority or transcript/description semantics. No FFmpeg install, binary execution or generated-frame extraction             |
| Exact generated-media binding validator                                                                                                                            | Scoped review of existing Stage 3/8 code, pinned lucas locator, W3C specifications and FFmpeg capabilities                                                                          | `NO_RELEVANT_OSS` for the exact Shotgun-owned generated-versus-original authority/pin validation. External runtime/schema adoption would not preserve these contracts; implement a pure replaceable parser |

No new `ADOPT`, `EXTRACT` or package `AUGMENT` was made. Existing lockfiles,
licenses and maintenance evidence are reused without claiming current universal
security clearance. The Role Matrix is not changed: audio/video/FFmpeg remains
inactive and deferred. Future adoption still requires exact upstream pin,
license/security/resource review and replacement/fidelity evidence.

The replacement boundary is a pure adapter result plus
`parseMediaAlignmentDocumentV1(value, trustedContext)`. Different offline fixture
adapters pass identical source/text/selector semantics while retaining separate
generator/request provenance. No package or internal DB ID is promoted into
Shotgun identity.

## Verification and limits

The credential-stripping isolated test runner was used. No live API, operating
DB, `.env`, original assets or frozen evaluation data were accessed.

- 42/42 new unit cases pass: Unicode/emoji, numeric/condition/negation strings,
  timing endpoints, original-pin mismatches, malformed digests/shapes, no
  original/Fact/verified promotion, complete alignment, bounded inputs, detached
  immutable snapshots, sparse variable-rate frame manifests and pixel geometry.
- 3/3 new adapter contracts pass: replacement, deterministic serialization/replay
  with stale SourceVersion rejection, and separation from active transformation/
  Evidence repositories. The compatibility contract runs the existing text
  intake→transformation→Evidence flow and reads full EvidenceSpan records.
- 8/8 existing Stage 3 transformation/Evidence contracts pass, including original
  text restoration, replay and historical revision behavior. These were run once
  as compatibility evidence; they are not new semantic Gold.
- Targeted ESLint and full TypeScript `tsc --noEmit` passed. No product schema or
  source-origin authority extension was required.

The first contract test incorrectly treated ListEvidenceSpans summaries as full
EvidenceSpan records. Its failure was corrected by querying each EvidenceSpan;
no product behavior changed to satisfy that test.

These are authored offline structural fixtures. They do not establish decoded
media fidelity, speech accuracy, speaker identity, whole-source recall, actual
provider quality, calibrated confidence, invoice cost or installed product
acceptance. Speaker identity, overlapping speech, alternative alignments and
mixed frame/time descriptions have no implicit v1 interpretation; adapters must
abstain rather than invent one.

## Activation, migration and rollback

No migration or production configuration change is required. Rollback removes
the new parser export/types/tests; existing immutable transformations, active
schemas and assets remain readable.

This closes the missing executable alignment foundation, not VP-08 or VP final
acceptance. Binary product support remains explicitly unsupported until an
authorized capability implements decoding/provenance, provider egress/budget,
durable response records, content-level fidelity and grounded-answer tests. A
future proposal must separately resolve how derived media text can be used by
the existing Evidence/Ledger authority without labeling it raw original text or
objective Fact. This contract grants no such permission.
